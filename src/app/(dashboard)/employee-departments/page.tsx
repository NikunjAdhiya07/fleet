"use client";

import { useEffect, useMemo, useState } from "react";
import { Building2, Loader2, Save, Trash2, UsersRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Department = { _id: string; name: string };

type MappingRow = {
  _id: string;
  employeeName: string;
  departmentId?: { _id: string; name: string } | string;
};

function normEmployeeName(v: unknown) {
  return String(v ?? "").trim();
}

export default function EmployeeDepartmentsPage() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [employees, setEmployees] = useState<string[]>([]);
  const [rows, setRows] = useState<MappingRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [selectedEmployee, setSelectedEmployee] = useState("");
  const [selectedDepartment, setSelectedDepartment] = useState("");

  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => a.employeeName.localeCompare(b.employeeName));
  }, [rows]);

  const fetchDepartments = async () => {
    const res = await fetch("/api/departments", { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as Department[];
    setDepartments(Array.isArray(data) ? data : []);
  };

  const fetchEmployees = async () => {
    // Reuse existing endpoint that already merges employee names from CallLog + DeviceCallLog
    const res = await fetch("/api/call-tracker/employees", { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as { employees?: string[] };
    setEmployees(Array.isArray(data.employees) ? data.employees : []);
  };

  const fetchRows = async () => {
    const res = await fetch("/api/employee-departments", { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as MappingRow[];
    setRows(Array.isArray(data) ? data : []);
  };

  const fetchAll = async () => {
    setIsLoading(true);
    try {
      await Promise.all([fetchDepartments(), fetchEmployees(), fetchRows()]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void fetchAll();
  }, []);

  const saveMapping = async () => {
    const employeeName = normEmployeeName(selectedEmployee);
    if (!employeeName || !selectedDepartment) return;

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/employee-departments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeName, departmentId: selectedDepartment }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert((data as { error?: string })?.error ?? "Failed to save mapping");
        return;
      }
      setSelectedEmployee("");
      setSelectedDepartment("");
      await fetchRows();
    } finally {
      setIsSubmitting(false);
    }
  };

  const removeMapping = async (id: string) => {
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/employee-departments?id=${id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert((data as { error?: string })?.error ?? "Failed to delete mapping");
        return;
      }
      await fetchRows();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-8 relative min-h-[calc(100vh-8rem)]">
      <div className="absolute top-0 right-[20%] w-[500px] h-[500px] bg-indigo-500/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 left-[10%] w-[400px] h-[400px] bg-fuchsia-500/5 rounded-full blur-[100px] pointer-events-none" />

      <div className="flex justify-between items-center relative z-10">
        <div>
          <h1 className="text-4xl font-extrabold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-white to-slate-400 flex items-center gap-3">
            <UsersRound className="w-8 h-8 text-indigo-400" />
            Employee → Department
          </h1>
          <p className="text-slate-400 mt-2">
            For employees that appear in Call Logs by name (no user record).
          </p>
        </div>
      </div>

      <div className="grid gap-8 xl:grid-cols-4 relative z-10">
        <Card className="xl:col-span-1 bg-slate-900/60 backdrop-blur-xl border-slate-800/60 shadow-2xl h-fit overflow-hidden relative">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-500 to-fuchsia-500" />
          <CardContent className="pt-8 space-y-5">
            <div className="flex items-center gap-2">
              <Building2 className="w-5 h-5 text-fuchsia-400" />
              <h2 className="text-xl font-bold text-white tracking-tight">Assign Department</h2>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Employee (from call logs)</label>
              <Select value={selectedEmployee} onValueChange={setSelectedEmployee}>
                <SelectTrigger className="h-11 bg-slate-950/50 border-slate-700/80 text-white">
                  <SelectValue placeholder="Select employee" />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-800 text-slate-100 shadow-xl">
                  {employees.map((e) => (
                    <SelectItem
                      key={e}
                      value={e}
                      className="text-slate-100 focus:bg-slate-800 focus:text-slate-100 data-[highlighted]:bg-slate-800 data-[highlighted]:text-slate-100"
                    >
                      {e}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Department</label>
              <Select value={selectedDepartment} onValueChange={setSelectedDepartment}>
                <SelectTrigger className="h-11 bg-slate-950/50 border-slate-700/80 text-white">
                  <SelectValue placeholder="Select department" />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-800 text-slate-100 shadow-xl">
                  {departments.map((d) => (
                    <SelectItem
                      key={d._id}
                      value={d._id}
                      className="text-slate-100 focus:bg-slate-800 focus:text-slate-100 data-[highlighted]:bg-slate-800 data-[highlighted]:text-slate-100"
                    >
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button
              type="button"
              onClick={saveMapping}
              disabled={isSubmitting || !selectedEmployee || !selectedDepartment}
              className="w-full h-12 bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white font-bold shadow-lg shadow-indigo-500/25 transition-all"
            >
              {isSubmitting ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Save className="mr-2 h-5 w-5" />}
              Save Mapping
            </Button>

            <Button type="button" variant="secondary" onClick={fetchAll} disabled={isSubmitting} className="w-full">
              Refresh lists
            </Button>
          </CardContent>
        </Card>

        <Card className="xl:col-span-3 bg-slate-900/60 backdrop-blur-xl border-slate-800/60 shadow-2xl overflow-hidden rounded-2xl">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-slate-900/80 backdrop-blur-md">
                <TableRow className="border-slate-800 hover:bg-transparent">
                  <TableHead className="text-slate-400 font-semibold tracking-wider text-xs uppercase py-4">
                    Employee Name
                  </TableHead>
                  <TableHead className="text-slate-400 font-semibold tracking-wider text-xs uppercase py-4">
                    Department
                  </TableHead>
                  <TableHead className="text-slate-400 font-semibold tracking-wider text-xs uppercase text-right py-4">
                    Actions
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={3} className="h-40 text-center">
                      <Loader2 className="h-8 w-8 animate-spin mx-auto text-indigo-500 mb-2" />
                      <p className="text-sm text-slate-500">Loading mappings...</p>
                    </TableCell>
                  </TableRow>
                ) : sortedRows.length === 0 ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={3} className="h-32 text-center text-slate-500">
                      No mappings yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  sortedRows.map((r) => {
                    const dept =
                      typeof r.departmentId === "string"
                        ? ""
                        : r.departmentId?.name ?? "";
                    return (
                      <TableRow key={r._id} className="border-slate-800/60 hover:bg-slate-800/30 transition-colors group">
                        <TableCell className="font-semibold text-slate-200 whitespace-nowrap py-4">
                          {r.employeeName}
                        </TableCell>
                        <TableCell className="py-4 text-slate-300">{dept || "—"}</TableCell>
                        <TableCell className="text-right py-4">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-9 w-9 text-slate-400 hover:bg-rose-500/10 hover:text-rose-400 rounded-full transition-colors"
                            onClick={() => removeMapping(r._id)}
                            disabled={isSubmitting}
                            title="Remove Mapping"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </Card>
      </div>
    </div>
  );
}

