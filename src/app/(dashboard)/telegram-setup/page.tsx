"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import {
  BotMessageSquare,
  Plus,
  Trash2,
  Unlink,
  CheckCircle2,
  XCircle,
  Loader2,
  RefreshCw,
  Phone,
  Info,
  Pencil,
  Check,
  X,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Employee = {
  _id: string | null;
  employeeName: string;
  phoneNumber: string | null;
  telegramChatId: string | null;
  registeredAt: string | null;
  source: "both" | "call_log_only" | "manual_only";
};

export default function TelegramSetupPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const broadcastEmployeesChanged = () => {
    try {
      window.localStorage.setItem("app:invalidateEmployees", String(Date.now()));
    } catch {
      // ignore
    }
    window.dispatchEvent(new Event("app:invalidateEmployees"));
  };

  // Inline phone editing state — maps employeeName → draft phone string
  const [editingPhone, setEditingPhone] = useState<Record<string, string>>({});
  const [savingPhone, setSavingPhone] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<Record<string, string>>({});

  // Manual add form (for employees not in call logs)
  const [manualName, setManualName] = useState("");
  const [manualPhone, setManualPhone] = useState("");
  const [manualSubmitting, setManualSubmitting] = useState(false);
  const [manualError, setManualError] = useState("");

  const fetchEmployees = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/telegram/employees");
      if (res.ok) {
        const data = await res.json();
        setEmployees(data);
      } else {
        const err = await res.text();
        console.error("[TelegramSetup] API error:", res.status, err);
      }
    } catch (e) {
      console.error("[TelegramSetup] Fetch failed:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEmployees();
  }, []);

  // ── Save phone number for an employee ────────────────────────────────────
  const handleSavePhone = async (employeeName: string) => {
    const phone = (editingPhone[employeeName] ?? "").trim();
    setPhoneError((p) => ({ ...p, [employeeName]: "" }));

    if (!phone) {
      setPhoneError((p) => ({ ...p, [employeeName]: "Phone number is required" }));
      return;
    }

    setSavingPhone(employeeName);
    try {
      const res = await fetch("/api/telegram/employees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeName, phoneNumber: phone }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPhoneError((p) => ({ ...p, [employeeName]: data.error ?? "Failed to save" }));
      } else {
        setEditingPhone((p) => {
          const next = { ...p };
          delete next[employeeName];
          return next;
        });
        fetchEmployees();
        broadcastEmployeesChanged();
      }
    } finally {
      setSavingPhone(null);
    }
  };

  // ── Unlink Telegram ───────────────────────────────────────────────────────
  const handleUnlink = async (id: string) => {
    if (!confirm("Unlink this employee's Telegram? They'll need to re-register via the bot.")) return;
    setActionLoading(id + "_unlink");
    try {
      await fetch("/api/telegram/employees", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      fetchEmployees();
      broadcastEmployeesChanged();
    } finally {
      setActionLoading(null);
    }
  };

  // ── Delete (manual-only employees only) ──────────────────────────────────
  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Remove "${name}" completely?`)) return;
    setActionLoading(id + "_del");
    try {
      await fetch(`/api/telegram/employees?id=${id}`, { method: "DELETE" });
      fetchEmployees();
      broadcastEmployeesChanged();
    } finally {
      setActionLoading(null);
    }
  };

  // ── Manual add (for employees NOT in call logs) ───────────────────────────
  const handleManualAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setManualError("");
    if (!manualName.trim() || !manualPhone.trim()) {
      setManualError("Both fields are required.");
      return;
    }
    setManualSubmitting(true);
    try {
      const res = await fetch("/api/telegram/employees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeName: manualName.trim(), phoneNumber: manualPhone.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setManualError(data.error ?? "Failed to add.");
      } else {
        setManualName("");
        setManualPhone("");
        fetchEmployees();
        broadcastEmployeesChanged();
      }
    } finally {
      setManualSubmitting(false);
    }
  };

  const connected = employees.filter((e) => e.telegramChatId);
  const pending = employees.filter((e) => !e.telegramChatId && e.phoneNumber);
  const noPhone = employees.filter((e) => !e.phoneNumber);

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white flex items-center gap-3">
            <BotMessageSquare className="h-8 w-8 text-indigo-400" />
            Telegram Setup
          </h1>
          <p className="text-slate-400 mt-1 text-sm">
            Employees are auto-detected from call logs. Add phone numbers so they can self-register.
          </p>
        </div>
        
        <button
          onClick={async () => {
            if (!confirm("Register the current URL as the Telegram webhook?")) return;
            setActionLoading("webhook");
            try {
              const res = await fetch("/api/telegram/setup", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ webhookUrl: window.location.origin + "/api/telegram/webhook" }),
              });
              const data = await res.json();
              if (res.ok) alert("Webhook registered successfully ✅");
              else alert("Failed: " + (data.error || "Unknown error"));
            } catch (err) {
              alert("Error registering webhook");
            } finally {
              setActionLoading(null);
            }
          }}
          disabled={actionLoading === "webhook"}
          className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium transition-colors disabled:opacity-50 whitespace-nowrap"
        >
          {actionLoading === "webhook" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Register Webhook
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="bg-slate-900 border-slate-800">
          <CardContent className="pt-4 pb-4 px-4">
            <div className="text-xs text-slate-400 mb-1">Telegram Connected</div>
            <div className="text-2xl font-bold text-emerald-400">{connected.length}</div>
          </CardContent>
        </Card>
        <Card className="bg-slate-900 border-slate-800">
          <CardContent className="pt-4 pb-4 px-4">
            <div className="text-xs text-slate-400 mb-1">Awaiting /start</div>
            <div className="text-2xl font-bold text-sky-400">{pending.length}</div>
          </CardContent>
        </Card>
        <Card className="bg-slate-900 border-slate-800">
          <CardContent className="pt-4 pb-4 px-4">
            <div className="text-xs text-slate-400 mb-1">Phone Needed</div>
            <div className="text-2xl font-bold text-amber-400">{noPhone.length}</div>
          </CardContent>
        </Card>
      </div>

      {/* How it works */}
      <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-4 flex gap-3">
        <Info className="h-5 w-5 text-indigo-400 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-slate-300 space-y-1">
          <p className="font-medium text-indigo-300">How self-registration works</p>
          <ol className="list-decimal list-inside space-y-0.5 text-slate-400 text-xs">
            <li>Add the employee's phone number in the row below</li>
            <li>Employee opens the Telegram bot → sends <code className="bg-slate-800 px-1 py-0.5 rounded">/start</code></li>
            <li>Bot prompts for their phone number → employee sends it</li>
            <li>Bot verifies and links their Telegram automatically</li>
          </ol>
        </div>
      </div>

      {/* Employee Table */}
      <Card className="bg-slate-900 border-slate-800">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base text-slate-200">Employee Telegram Status</CardTitle>
          <button
            onClick={fetchEmployees}
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            Refresh
          </button>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
            </div>
          ) : employees.length === 0 ? (
            <div className="text-center text-slate-500 py-12 text-sm">
              No call logs found yet. Employees will appear here once they sync.
            </div>
          ) : (
            <>
              {/* Desktop */}
              <div className="hidden sm:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-950/50">
                      <th className="text-left px-4 py-3 text-slate-400 font-medium">Employee</th>
                      <th className="text-left px-4 py-3 text-slate-400 font-medium">Phone Number</th>
                      <th className="text-left px-4 py-3 text-slate-400 font-medium">Telegram</th>
                      <th className="text-left px-4 py-3 text-slate-400 font-medium">Registered</th>
                      <th className="text-left px-4 py-3 text-slate-400 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {employees.map((emp) => {
                      const isEditing = emp.employeeName in editingPhone;
                      const isSavingThis = savingPhone === emp.employeeName;

                      return (
                        <tr key={emp.employeeName} className="border-b border-slate-800 hover:bg-slate-800/30">
                          {/* Name */}
                          <td className="px-4 py-3">
                            <div className="font-medium text-slate-200">{emp.employeeName}</div>
                            {emp.source === "call_log_only" && (
                              <div className="text-xs text-slate-500 mt-0.5">from call logs</div>
                            )}
                            {emp.source === "manual_only" && (
                              <div className="text-xs text-slate-500 mt-0.5">added manually</div>
                            )}
                          </td>

                          {/* Phone */}
                          <td className="px-4 py-3">
                            {!emp.phoneNumber || isEditing ? (
                              <div className="flex items-center gap-2">
                                <div className="relative">
                                  <Phone className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-500" />
                                  <Input
                                    value={isEditing ? editingPhone[emp.employeeName] : ""}
                                    onChange={(e) =>
                                      setEditingPhone((p) => ({
                                        ...p,
                                        [emp.employeeName]: e.target.value,
                                      }))
                                    }
                                    onFocus={() => {
                                      if (!isEditing) {
                                        setEditingPhone((p) => ({
                                          ...p,
                                          [emp.employeeName]: emp.phoneNumber ?? "",
                                        }));
                                      }
                                    }}
                                    placeholder="9876543210"
                                    className="pl-8 h-8 w-40 bg-slate-950 border-slate-700 text-white text-xs font-mono"
                                    type="tel"
                                  />
                                </div>
                                {isEditing && (
                                  <>
                                    <button
                                      onClick={() => handleSavePhone(emp.employeeName)}
                                      disabled={isSavingThis}
                                      className="flex items-center justify-center w-7 h-7 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-400 transition-colors disabled:opacity-50"
                                    >
                                      {isSavingThis ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                      ) : (
                                        <Check className="h-3.5 w-3.5" />
                                      )}
                                    </button>
                                    <button
                                      onClick={() =>
                                        setEditingPhone((p) => {
                                          const next = { ...p };
                                          delete next[emp.employeeName];
                                          return next;
                                        })
                                      }
                                      className="flex items-center justify-center w-7 h-7 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-400 transition-colors"
                                    >
                                      <X className="h-3.5 w-3.5" />
                                    </button>
                                  </>
                                )}
                                {phoneError[emp.employeeName] && (
                                  <span className="text-rose-400 text-xs">
                                    {phoneError[emp.employeeName]}
                                  </span>
                                )}
                                {!isEditing && !emp.phoneNumber && (
                                  <span className="text-amber-400 text-xs">← add number</span>
                                )}
                              </div>
                            ) : (
                              <div className="flex items-center gap-2 group">
                                <span className="font-mono text-slate-300 text-xs">{emp.phoneNumber}</span>
                                <button
                                  onClick={() =>
                                    setEditingPhone((p) => ({
                                      ...p,
                                      [emp.employeeName]: emp.phoneNumber ?? "",
                                    }))
                                  }
                                  className="hidden group-hover:flex items-center justify-center w-6 h-6 rounded bg-slate-700 hover:bg-slate-600 text-slate-400 transition-colors"
                                >
                                  <Pencil className="h-3 w-3" />
                                </button>
                              </div>
                            )}
                          </td>

                          {/* Telegram status */}
                          <td className="px-4 py-3">
                            {emp.telegramChatId ? (
                              <span className="flex items-center gap-1.5 text-emerald-400 text-xs font-medium">
                                <CheckCircle2 className="h-3.5 w-3.5" /> Connected
                              </span>
                            ) : emp.phoneNumber ? (
                              <span className="flex items-center gap-1.5 text-sky-400 text-xs font-medium">
                                <XCircle className="h-3.5 w-3.5" /> Awaiting /start
                              </span>
                            ) : (
                              <span className="text-slate-600 text-xs">Need phone first</span>
                            )}
                          </td>

                          {/* Registered at */}
                          <td className="px-4 py-3 text-slate-500 text-xs">
                            {emp.registeredAt
                              ? format(new Date(emp.registeredAt), "MMM d, yyyy HH:mm")
                              : "—"}
                          </td>

                          {/* Actions */}
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              {emp.telegramChatId && emp._id && (
                                <button
                                  onClick={() => handleUnlink(emp._id!)}
                                  disabled={actionLoading === emp._id + "_unlink"}
                                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 text-xs font-medium transition-colors disabled:opacity-50"
                                >
                                  {actionLoading === emp._id + "_unlink" ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <Unlink className="h-3 w-3" />
                                  )}
                                  Unlink
                                </button>
                              )}
                              {/* Only allow full delete for manually-added employees */}
                              {emp.source === "manual_only" && emp._id && (
                                <button
                                  onClick={() => handleDelete(emp._id!, emp.employeeName)}
                                  disabled={actionLoading === emp._id + "_del"}
                                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 text-xs font-medium transition-colors disabled:opacity-50"
                                >
                                  {actionLoading === emp._id + "_del" ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <Trash2 className="h-3 w-3" />
                                  )}
                                  Remove
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile Cards */}
              <div className="block sm:hidden divide-y divide-slate-800">
                {employees.map((emp) => {
                  const isEditing = emp.employeeName in editingPhone;
                  const isSavingThis = savingPhone === emp.employeeName;
                  return (
                    <div key={emp.employeeName} className="p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="font-semibold text-slate-200">{emp.employeeName}</div>
                        {emp.telegramChatId ? (
                          <span className="flex items-center gap-1 text-emerald-400 text-xs font-medium">
                            <CheckCircle2 className="h-3.5 w-3.5" /> Connected
                          </span>
                        ) : emp.phoneNumber ? (
                          <span className="flex items-center gap-1 text-sky-400 text-xs font-medium">
                            <XCircle className="h-3.5 w-3.5" /> Awaiting /start
                          </span>
                        ) : (
                          <span className="text-amber-400 text-xs">Phone needed</span>
                        )}
                      </div>
                      {!emp.phoneNumber || isEditing ? (
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <Input
                              value={isEditing ? editingPhone[emp.employeeName] : ""}
                              onChange={(e) =>
                                setEditingPhone((p) => ({ ...p, [emp.employeeName]: e.target.value }))
                              }
                              onFocus={() => {
                                if (!isEditing) {
                                  setEditingPhone((p) => ({ ...p, [emp.employeeName]: emp.phoneNumber ?? "" }));
                                }
                              }}
                              placeholder="Enter phone number"
                              className="flex-1 bg-slate-950 border-slate-700 text-white text-xs font-mono h-8"
                              type="tel"
                            />
                            <button
                              onClick={() => handleSavePhone(emp.employeeName)}
                              disabled={isSavingThis}
                              className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium disabled:opacity-50"
                            >
                              {isSavingThis ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
                            </button>
                          </div>
                          {phoneError[emp.employeeName] && (
                            <p className="text-rose-400 text-xs">{phoneError[emp.employeeName]}</p>
                          )}
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-slate-400 text-xs">{emp.phoneNumber}</span>
                          <button
                            onClick={() => setEditingPhone((p) => ({ ...p, [emp.employeeName]: emp.phoneNumber ?? "" }))}
                            className="text-slate-500 hover:text-slate-300"
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                        </div>
                      )}
                      {emp.registeredAt && (
                        <div className="text-xs text-slate-500">
                          Registered: {format(new Date(emp.registeredAt), "MMM d, yyyy HH:mm")}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Manual Add — for employees not in call logs */}
      <Card className="bg-slate-900 border-slate-800">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm text-slate-400 flex items-center gap-2">
            <Plus className="h-4 w-4" />
            Add Employee Not in Call Logs
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleManualAdd} className="flex flex-col sm:flex-row gap-3">
            <Input
              placeholder="Employee name"
              value={manualName}
              onChange={(e) => setManualName(e.target.value)}
              className="bg-slate-950 border-slate-700 text-white flex-1"
            />
            <Input
              placeholder="Phone number"
              value={manualPhone}
              onChange={(e) => setManualPhone(e.target.value)}
              className="bg-slate-950 border-slate-700 text-white flex-1 font-mono"
              type="tel"
            />
            <button
              type="submit"
              disabled={manualSubmitting}
              className="flex items-center gap-2 px-5 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm font-medium transition-colors disabled:opacity-50 flex-shrink-0"
            >
              {manualSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Add
            </button>
          </form>
          {manualError && <p className="mt-2 text-sm text-rose-400">{manualError}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
