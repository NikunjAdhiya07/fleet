"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, Download, PhoneCall, Loader2, RefreshCw, UsersRound, FileSpreadsheet } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

type Category = "Personal" | "Staff" | "Existing Client" | "New Client" | "Courier";

type Row = {
  serialNumber: number;
  mobileNumber: string;
  name: string;
  callCount: number;
  category: "" | Category;
};

type ApiState = {
  rows: Row[];
  categories: Category[];
};

function normDigits(v: unknown) {
  return String(v ?? "").replace(/\D+/g, "");
}

export function CallTrackerClient() {
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [state, setState] = useState<ApiState>({ rows: [], categories: [] });
  const [error, setError] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const didAutoSyncRef = useRef(false);
  const [employees, setEmployees] = useState<string[]>([]);
  const [ignoredEmployees, setIgnoredEmployees] = useState<string[]>([]);
  const [ignoreOpen, setIgnoreOpen] = useState(false);

  const [mobileInput, setMobileInput] = useState("");
  const [search, setSearch] = useState("");

  const [needs, setNeeds] = useState<"none" | "category" | "name_and_category">("none");
  const [pendingMobile, setPendingMobile] = useState<string>("");
  const [pendingName, setPendingName] = useState("");
  const [pendingCategory, setPendingCategory] = useState<string>("");
  const [lastLogged, setLastLogged] = useState<Row | null>(null);

  const filtered = useMemo(() => {
    const qDigits = normDigits(search);
    if (!qDigits) return state.rows;
    return state.rows.filter((r) => normDigits(r.mobileNumber).includes(qDigits));
  }, [state.rows, search]);

  const fetchAll = async () => {
    const res = await fetch("/api/call-tracker", { cache: "no-store" });
    if (!res.ok) throw new Error("Failed to load call tracker");
    const data = (await res.json()) as ApiState;
    setState(data);
  };

  const fetchEmployees = async () => {
    const res = await fetch("/api/call-tracker/employees", { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as { employees?: string[] };
    setEmployees(Array.isArray(data.employees) ? data.employees : []);
  };

  const broadcastEmployeesChanged = () => {
    try {
      window.localStorage.setItem("app:invalidateEmployees", String(Date.now()));
      window.localStorage.setItem("app:invalidateCallLogs", String(Date.now()));
    } catch {
      // ignore
    }
    window.dispatchEvent(new Event("app:invalidateEmployees"));
    window.dispatchEvent(new Event("app:invalidateCallLogs"));
  };

  useEffect(() => {
    (async () => {
      try {
        const saved = typeof window !== "undefined" ? window.localStorage.getItem("callTracker:ignoredEmployees") : null;
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed)) setIgnoredEmployees(parsed.filter((v) => typeof v === "string"));
        }
        await fetchAll();
        await fetchEmployees();
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const submitLog = async (payload: { mobileNumber: string; name?: string; category?: string }) => {
    setIsSubmitting(true);
    try {
      setError("");
      const res = await fetch("/api/call-tracker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Failed to log call");

      setState({ rows: data.rows, categories: data.categories });
      setNeeds(data.needs);
      setPendingMobile(normDigits(payload.mobileNumber));
      setLastLogged(data.row ?? null);
      // New calls can introduce new employees in downstream views.
      void fetchEmployees();
      broadcastEmployeesChanged();
      return data as { needs: typeof needs; row: Row; rows: Row[]; categories: Category[] };
    } catch (e: any) {
      setError(String(e?.message ?? e ?? "Something went wrong"));
      throw e;
    } finally {
      setIsSubmitting(false);
    }
  };

  const onLogCall = async () => {
    const mobile = normDigits(mobileInput);
    if (!mobile) return;

    setPendingName("");
    setPendingCategory("");
    setLastLogged(null);

    let data: { needs: typeof needs };
    try {
      data = await submitLog({ mobileNumber: mobile });
    } catch {
      return;
    }

    // If no extra details needed, clear input for fast entry.
    if (data.needs === "none") {
      setMobileInput("");
      setPendingMobile("");
    }
  };

  const onSaveDetails = async () => {
    const mobile = normDigits(pendingMobile);
    if (!mobile) return;

    const payload: { mobileNumber: string; name?: string; category?: string } = { mobileNumber: mobile };
    if (needs === "name_and_category") {
      if (pendingName.trim()) payload.name = pendingName.trim();
      if (pendingCategory) payload.category = pendingCategory;
    } else if (needs === "category") {
      if (pendingCategory) payload.category = pendingCategory;
    }

    let data: { needs: typeof needs };
    try {
      data = await submitLog(payload);
    } catch {
      return;
    }
    if (data.needs === "none") {
      setNeeds("none");
      setPendingMobile("");
      setPendingName("");
      setPendingCategory("");
      setMobileInput("");
    }
  };

  const exportExcel = async () => {
    const res = await fetch("/api/call-tracker/export", { cache: "no-store" });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "call-tracker.xlsx";
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  };

  const importExcel = async (file: File) => {
    setIsSubmitting(true);
    try {
      setError("");
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/call-tracker/import", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Import failed");
      setState({ rows: data.rows, categories: data.categories });
    } catch (e: any) {
      setError(String(e?.message ?? e ?? "Import failed"));
    } finally {
      setIsSubmitting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const syncFromCallLogs = async () => {
    setIsSubmitting(true);
    try {
      setError("");
      const res = await fetch("/api/call-tracker/sync-from-call-logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ignoredEmployees }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Sync failed");
      setState({ rows: data.rows, categories: data.categories });
      void fetchEmployees();
      broadcastEmployeesChanged();
    } catch (e: any) {
      setError(String(e?.message ?? e ?? "Sync failed"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const exportEmployeeWiseExcel = async () => {
    setIsSubmitting(true);
    try {
      setError("");
      const res = await fetch("/api/call-tracker/export-by-employee", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ignoredEmployees }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? "Export failed");
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "call-tracker-by-employee.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(String(e?.message ?? e ?? "Export failed"));
    } finally {
      setIsSubmitting(false);
    }
  };

  useEffect(() => {
    if (didAutoSyncRef.current) return;
    if (isLoading) return;
    if (state.rows.length > 0) return;
    didAutoSyncRef.current = true;
    // If the tracker is empty, auto-pull "old data" from the existing call logs DB.
    void syncFromCallLogs();
  }, [isLoading, state.rows.length]);

  return (
    <div className="space-y-4">
      <Card className="p-4 bg-slate-900 border-slate-800">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex-1">
            <div className="text-sm text-slate-300 font-medium mb-1">Log a call</div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Input
                value={mobileInput}
                onChange={(e) => setMobileInput(e.target.value)}
                placeholder="Enter mobile number…"
                inputMode="numeric"
                className="bg-slate-950/40 border-slate-800 text-slate-200 placeholder:text-slate-500"
                onKeyDown={(e) => {
                  if (e.key === "Enter") onLogCall();
                }}
              />
              <Button onClick={onLogCall} disabled={isSubmitting || !normDigits(mobileInput)} className="gap-2">
                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <PhoneCall className="h-4 w-4" />}
                Log call
              </Button>
              <Button variant="secondary" onClick={exportExcel} className="gap-2">
                <Download className="h-4 w-4" />
                Export Excel
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void importExcel(f);
                }}
              />
              <Button
                variant="secondary"
                onClick={() => fileInputRef.current?.click()}
                disabled={isSubmitting}
              >
                Import Excel
              </Button>
              <Button variant="secondary" onClick={syncFromCallLogs} disabled={isSubmitting} className="gap-2">
                <RefreshCw className="h-4 w-4" />
                Sync from Call Logs
              </Button>
              <Button variant="secondary" onClick={exportEmployeeWiseExcel} disabled={isSubmitting} className="gap-2">
                <FileSpreadsheet className="h-4 w-4" />
                Employee-wise Excel
              </Button>
              <Button variant="secondary" onClick={() => setIgnoreOpen(true)} disabled={isSubmitting} className="gap-2">
                <UsersRound className="h-4 w-4" />
                Ignore employees
              </Button>
            </div>
            {lastLogged ? (
              <div className="mt-2 text-xs text-slate-500">
                Last: <span className="text-slate-300 font-mono">{lastLogged.mobileNumber}</span> — calls{" "}
                <span className="text-slate-300 font-medium">{lastLogged.callCount}</span>
              </div>
            ) : null}
            {error ? (
              <div className="mt-2 text-xs text-red-300">
                {error.includes("EBUSY") || error.toLowerCase().includes("busy") || error.toLowerCase().includes("used by another process")
                  ? "Excel file is locked. Please close `web/data/call-tracker.xlsx` in Excel and try again."
                  : error}
              </div>
            ) : null}
          </div>

          <div className="w-full sm:max-w-sm">
            <div className="text-sm text-slate-300 font-medium mb-1">Search</div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by mobile number…"
                className="pl-9 bg-slate-950/40 border-slate-800 text-slate-200 placeholder:text-slate-500"
              />
            </div>
          </div>
        </div>
      </Card>

      <div className="rounded-md border border-slate-800 bg-slate-900 overflow-hidden">
        <div className="sticky top-0 z-10 border-b border-slate-800 bg-slate-900/95 backdrop-blur supports-[backdrop-filter]:bg-slate-900/75 px-3 py-2 flex items-center justify-between">
          <div className="text-sm text-slate-300 font-medium">Call tracker</div>
          <div className="text-xs text-slate-500">
            Showing <span className="text-slate-300 font-medium">{filtered.length}</span> of{" "}
            <span className="text-slate-300 font-medium">{state.rows.length}</span>
          </div>
        </div>

        <div className="max-h-[70vh] overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-slate-800 hover:bg-slate-800/50">
                <TableHead className="text-slate-400">Serial</TableHead>
                <TableHead className="text-slate-400">Mobile</TableHead>
                <TableHead className="text-slate-400">Name</TableHead>
                <TableHead className="text-slate-400">Call Count</TableHead>
                <TableHead className="text-slate-400">Category</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow className="border-slate-800 hover:bg-slate-800/50">
                  <TableCell colSpan={5} className="h-24 text-center text-slate-500">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow className="border-slate-800 hover:bg-slate-800/50">
                  <TableCell colSpan={5} className="h-24 text-center text-slate-500">
                    No rows yet.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((r) => (
                  <TableRow
                    key={r.mobileNumber}
                    className={cn(
                      "border-slate-800 hover:bg-slate-800/50",
                      r.callCount >= 5 && "bg-amber-500/10"
                    )}
                  >
                    <TableCell className="text-slate-300">{r.serialNumber}</TableCell>
                    <TableCell className="text-slate-300 font-mono">{r.mobileNumber}</TableCell>
                    <TableCell className="text-slate-300">{r.name?.trim() ? r.name : "Unknown"}</TableCell>
                    <TableCell className="text-slate-300">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{r.callCount}</span>
                        {r.callCount >= 5 ? <Badge className="bg-amber-600/30 text-amber-200 border-amber-600/40">≥5</Badge> : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-slate-300">{r.category || "—"}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <Dialog open={needs !== "none"} onOpenChange={(open) => (!open ? setNeeds("none") : null)}>
        <DialogContent className="bg-slate-900 border-slate-800 text-slate-200">
          <DialogHeader>
            <DialogTitle>
              {needs === "category" ? "Select category" : "Add name & category"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="text-xs text-slate-500">
              Mobile: <span className="text-slate-300 font-mono">{pendingMobile}</span>
            </div>

            {needs === "name_and_category" ? (
              <div>
                <div className="text-sm text-slate-300 font-medium mb-1">Name</div>
                <Input
                  value={pendingName}
                  onChange={(e) => setPendingName(e.target.value)}
                  placeholder="Enter name…"
                  className="bg-slate-950/40 border-slate-800 text-slate-200 placeholder:text-slate-500"
                />
              </div>
            ) : null}

            <div>
              <div className="text-sm text-slate-300 font-medium mb-1">Category</div>
              <Select value={pendingCategory} onValueChange={setPendingCategory}>
                <SelectTrigger className="w-full bg-slate-950/40 border-slate-800 text-slate-200">
                  <SelectValue placeholder="Choose category…" />
                </SelectTrigger>
                <SelectContent>
                  {(state.categories ?? []).map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setNeeds("none")}>
                Cancel
              </Button>
              <Button onClick={onSaveDetails} disabled={isSubmitting || !pendingCategory || (needs === "name_and_category" && !pendingName.trim())}>
                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={ignoreOpen} onOpenChange={setIgnoreOpen}>
        <DialogContent className="bg-slate-900 border-slate-800 text-slate-200">
          <DialogHeader>
            <DialogTitle>Ignore employees</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-xs text-slate-500">
              Ignored employees are excluded from <span className="text-slate-300">Sync from Call Logs</span> and{" "}
              <span className="text-slate-300">Employee-wise Excel</span>.
            </div>

            <div className="max-h-64 overflow-auto rounded-md border border-slate-800">
              {employees.length === 0 ? (
                <div className="p-3 text-sm text-slate-500">No employees found yet.</div>
              ) : (
                <div className="divide-y divide-slate-800">
                  {employees.map((e) => {
                    const checked = ignoredEmployees.includes(e);
                    return (
                      <label key={e} className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-slate-800/30">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            const next = checked
                              ? ignoredEmployees.filter((x) => x !== e)
                              : [...ignoredEmployees, e];
                            setIgnoredEmployees(next);
                            window.localStorage.setItem("callTracker:ignoredEmployees", JSON.stringify(next));
                          }}
                        />
                        <span className="text-slate-200">{e}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between pt-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setIgnoredEmployees([]);
                  window.localStorage.setItem("callTracker:ignoredEmployees", "[]");
                }}
              >
                Clear
              </Button>
              <div className="flex items-center gap-2">
                <Button variant="secondary" onClick={() => void fetchEmployees()}>
                  Refresh list
                </Button>
                <Button onClick={() => setIgnoreOpen(false)}>Done</Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

