"use client";

import { useEffect, useMemo, useState } from "react";
import { Building2, Edit2, Loader2, Plus, Save, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Department = {
  _id: string;
  name: string;
  createdAt?: string;
};

type ApiError = { error?: string };

export default function DepartmentsPage() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [creatingName, setCreatingName] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const [editing, setEditing] = useState<Department | null>(null);
  const [editingName, setEditingName] = useState("");
  const [isUpdating, setIsUpdating] = useState(false);

  const [deleting, setDeleting] = useState<Department | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const sorted = useMemo(() => {
    return [...departments].sort((a, b) => a.name.localeCompare(b.name));
  }, [departments]);

  const fetchDepartments = async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/departments", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as Department[];
      setDepartments(Array.isArray(data) ? data : []);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void fetchDepartments();
  }, []);

  const createDepartment = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = creatingName.trim();
    if (!name) return;
    setIsCreating(true);
    try {
      const res = await fetch("/api/departments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as ApiError;
        alert(data?.error ?? "Failed to create department");
        return;
      }
      setCreatingName("");
      await fetchDepartments();
    } finally {
      setIsCreating(false);
    }
  };

  const openEdit = (d: Department) => {
    setEditing(d);
    setEditingName(d.name);
  };

  const updateDepartment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    const name = editingName.trim();
    if (!name) return;

    setIsUpdating(true);
    try {
      const res = await fetch("/api/departments", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ _id: editing._id, name }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as ApiError;
        alert(data?.error ?? "Failed to update department");
        return;
      }
      setEditing(null);
      await fetchDepartments();
    } finally {
      setIsUpdating(false);
    }
  };

  const deleteDepartment = async () => {
    if (!deleting) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/departments?id=${deleting._id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as ApiError;
        alert(data?.error ?? "Failed to delete department");
        return;
      }
      setDeleting(null);
      await fetchDepartments();
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-8 relative min-h-[calc(100vh-8rem)]">
      <div className="absolute top-0 right-[20%] w-[500px] h-[500px] bg-indigo-500/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 left-[10%] w-[400px] h-[400px] bg-fuchsia-500/5 rounded-full blur-[100px] pointer-events-none" />

      <div className="flex justify-between items-center relative z-10">
        <div>
          <h1 className="text-4xl font-extrabold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-white to-slate-400 flex items-center gap-3">
            <Building2 className="w-8 h-8 text-indigo-400" />
            Department Master
          </h1>
          <p className="text-slate-400 mt-2">Create departments and use them to categorize employees.</p>
        </div>
      </div>

      <div className="grid gap-8 xl:grid-cols-4 relative z-10">
        <Card className="xl:col-span-1 bg-slate-900/60 backdrop-blur-xl border-slate-800/60 shadow-2xl h-fit overflow-hidden relative">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-500 to-fuchsia-500" />
          <CardContent className="pt-8">
            <div className="flex items-center gap-2 mb-6">
              <Plus className="w-5 h-5 text-fuchsia-400" />
              <h2 className="text-xl font-bold text-white tracking-tight">Add Department</h2>
            </div>

            <form onSubmit={createDepartment} className="space-y-5">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Department Name</label>
                <Input
                  required
                  value={creatingName}
                  onChange={(e) => setCreatingName(e.target.value)}
                  className="h-11 bg-slate-950/50 border-slate-700/80 text-white focus:ring-fuchsia-500/50"
                  placeholder="Marketing"
                />
              </div>
              <Button
                type="submit"
                disabled={isCreating || !creatingName.trim()}
                className="w-full h-12 bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white font-bold shadow-lg shadow-indigo-500/25 transition-all"
              >
                {isCreating ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Save className="mr-2 h-5 w-5" />}
                Create Department
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="xl:col-span-3 bg-slate-900/60 backdrop-blur-xl border-slate-800/60 shadow-2xl overflow-hidden rounded-2xl">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-slate-900/80 backdrop-blur-md">
                <TableRow className="border-slate-800 hover:bg-transparent">
                  <TableHead className="text-slate-400 font-semibold tracking-wider text-xs uppercase py-4">Name</TableHead>
                  <TableHead className="text-slate-400 font-semibold tracking-wider text-xs uppercase text-right py-4">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={2} className="h-40 text-center">
                      <Loader2 className="h-8 w-8 animate-spin mx-auto text-indigo-500 mb-2" />
                      <p className="text-sm text-slate-500">Loading departments...</p>
                    </TableCell>
                  </TableRow>
                ) : sorted.length === 0 ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={2} className="h-32 text-center text-slate-500">
                      No departments yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  sorted.map((d) => (
                    <TableRow key={d._id} className="border-slate-800/60 hover:bg-slate-800/30 transition-colors group">
                      <TableCell className="font-semibold text-slate-200 whitespace-nowrap py-4">
                        {d.name}
                      </TableCell>
                      <TableCell className="text-right py-4">
                        <div className="flex justify-end items-center gap-2 opacity-80 group-hover:opacity-100 transition-opacity">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-9 w-9 text-slate-400 hover:bg-indigo-500/10 hover:text-indigo-400 rounded-full transition-colors"
                            onClick={() => openEdit(d)}
                            title="Edit Department"
                          >
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-9 w-9 text-slate-400 hover:bg-rose-500/10 hover:text-rose-400 rounded-full transition-colors"
                            onClick={() => setDeleting(d)}
                            title="Delete Department"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </Card>
      </div>

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="bg-slate-900 border-slate-800 text-slate-100 sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Edit Department</DialogTitle>
            <DialogDescription className="text-slate-400">Update the department name.</DialogDescription>
          </DialogHeader>
          <form onSubmit={updateDepartment} className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-300">Name</label>
              <Input
                required
                value={editingName}
                onChange={(e) => setEditingName(e.target.value)}
                className="bg-slate-950 border-slate-700 text-white"
              />
            </div>
            <DialogFooter className="pt-4">
              <Button type="button" variant="ghost" onClick={() => setEditing(null)} className="hover:bg-slate-800 text-slate-300">
                Cancel
              </Button>
              <Button type="submit" disabled={isUpdating} className="bg-indigo-600 hover:bg-indigo-700">
                {isUpdating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Save Changes
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent className="bg-slate-900 border-rose-500/20 text-slate-100 sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle className="flex items-center text-rose-500">
              <Trash2 className="w-5 h-5 mr-2" /> Delete Department
            </DialogTitle>
            <DialogDescription className="text-slate-400 pt-2 pb-4">
              Are you sure you want to delete <strong className="text-slate-200">{deleting?.name}</strong>?
              <br />
              <br />
              This will remove it from the master list. Existing users may still reference it until reassigned.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)} className="border-slate-700 hover:bg-slate-800 text-slate-300">
              <X className="w-4 h-4 mr-2" />
              Cancel
            </Button>
            <Button variant="destructive" onClick={deleteDepartment} disabled={isDeleting} className="bg-rose-600 hover:bg-rose-700">
              {isDeleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

