"use client";

import { useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, Loader2, Upload, UserCheck, Tag } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

const CATEGORY_COLORS: Record<string, string> = {
  personal: "bg-purple-500/15 text-purple-300 border-purple-500/30",
  staff: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  "Existing Client": "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  "New Client": "bg-amber-500/15 text-amber-300 border-amber-500/30",
  courier: "bg-slate-500/15 text-slate-300 border-slate-500/30",
  Family: "bg-purple-500/15 text-purple-300 border-purple-500/30",
  Colleague: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  Other: "bg-slate-500/15 text-slate-300 border-slate-500/30",
};

export default function IdentifiedContactsPage() {
  const [contacts, setContacts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<
    null | {
      imported: number;
      updated: number;
      skipped: number;
      totalRows?: number;
      skipReasons?: Record<string, number>;
      message?: string;
      error?: string;
    }
  >(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const loadContacts = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/contact-intelligence");
      if (res.ok) {
        const data = await res.json();
        setContacts(data.identifiedContacts ?? []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadContacts();
  }, []);

  const handleUpload = async (file: File) => {
    setUploading(true);
    setUploadResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/contact-intelligence/import", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(String((data as any)?.error ?? "Upload failed"));
      }
      setUploadResult({
        imported: Number((data as any).imported ?? 0),
        updated: Number((data as any).updated ?? 0),
        skipped: Number((data as any).skipped ?? 0),
        totalRows: Number((data as any).totalRows ?? undefined),
        skipReasons: (data as any).skipReasons ?? undefined,
        message: typeof (data as any).message === "string" ? (data as any).message : undefined,
      });
      await loadContacts();
    } catch (e) {
      console.error(e);
      setUploadResult({
        imported: 0,
        updated: 0,
        skipped: 0,
        error: e instanceof Error ? e.message : "Upload failed",
      });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const downloadTemplate = async () => {
    try {
      const res = await fetch("/api/contact-intelligence/template");
      if (!res.ok) throw new Error("Template download failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "identified-contacts-template.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
      setUploadResult({
        imported: 0,
        updated: 0,
        skipped: 0,
        error: e instanceof Error ? e.message : "Template download failed",
      });
    }
  };

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <UserCheck className="h-7 w-7 text-indigo-400" />
          Identified Contacts
        </h1>
        <p className="text-slate-400 text-sm mt-1">
          Names and categories saved via Telegram (Scenario A & B) or Excel upload
        </p>
      </div>

      <Card className="bg-slate-900 border-slate-800 overflow-hidden">
        <div className="p-4 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-slate-300 font-medium">Bulk identify via Excel</div>
          <div className="flex items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleUpload(f);
              }}
            />
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
              className={cn(
                "inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold border transition-colors",
                uploading
                  ? "bg-slate-800 border-slate-700 text-slate-500 cursor-not-allowed"
                  : "bg-indigo-600/10 border-indigo-500/30 text-indigo-300 hover:bg-indigo-600/20 hover:border-indigo-400/50"
              )}
            >
              {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              Upload Excel/CSV
            </button>
            <button
              type="button"
              onClick={downloadTemplate}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors"
              title="Download a sample Excel template"
            >
              <Download className="w-4 h-4" />
              Template
            </button>
          </div>
          {uploadResult && (
            <div className="w-full text-xs text-slate-400">
              Imported <span className="text-slate-200 font-semibold">{uploadResult.imported}</span> · Updated{" "}
              <span className="text-slate-200 font-semibold">{uploadResult.updated}</span> · Skipped{" "}
              <span className="text-slate-200 font-semibold">{uploadResult.skipped}</span>
              {uploadResult.skipReasons && Object.keys(uploadResult.skipReasons).length > 0 && (
                <span className="text-slate-500">
                  {" "}
                  (reasons:{" "}
                  {Object.entries(uploadResult.skipReasons)
                    .map(([k, v]) => `${k}=${v}`)
                    .join(", ")}
                  )
                </span>
              )}
              {uploadResult.message && <span className="text-amber-400/90"> — {uploadResult.message}</span>}
              {uploadResult.error && <span className="text-rose-400/90"> — {uploadResult.error}</span>}
            </div>
          )}
          <div className="w-full text-[11px] text-slate-500">
            File columns supported: <span className="text-slate-400">Mobile Number</span>, <span className="text-slate-400">Name</span>,{" "}
            <span className="text-slate-400">Category/Type</span>. Phone numbers are normalized (+91/91 prefixes supported).
          </div>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
          </div>
        ) : contacts.length === 0 ? (
          <div className="text-center text-slate-500 py-16">
            No identified contacts yet. Use Contact Intelligence and Telegram to classify contacts.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-slate-800 hover:bg-transparent">
                  <TableHead className="text-slate-400">Employee</TableHead>
                  <TableHead className="text-slate-400">Phone</TableHead>
                  <TableHead className="text-slate-400">Name</TableHead>
                  <TableHead className="text-slate-400">Category</TableHead>
                  <TableHead className="text-slate-400">Saved in phone</TableHead>
                  <TableHead className="text-slate-400">Identified at</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contacts.map((c: any) => (
                  <TableRow key={c._id} className="border-slate-800 hover:bg-slate-800/50">
                    <TableCell className="font-medium text-slate-300">{c.employeeName}</TableCell>
                    <TableCell className="font-mono text-sm text-slate-300">{c.phoneNumber}</TableCell>
                    <TableCell>
                      {c.contactName ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border bg-violet-500/15 text-violet-300 border-violet-500/30">
                          <Tag className="w-3 h-3" />
                          {c.contactName}
                        </span>
                      ) : (
                        <span className="text-slate-500 text-xs">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {c.category ? (
                        <span
                          className={cn(
                            "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border",
                            CATEGORY_COLORS[c.category] ?? "bg-slate-700 text-slate-300 border-slate-600"
                          )}
                        >
                          {c.category}
                        </span>
                      ) : (
                        <span className="text-slate-500 text-xs">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {c.savedInPhone ? (
                        <span className="text-emerald-400 text-xs font-medium">Yes</span>
                      ) : (
                        <span className="text-slate-500 text-xs">No</span>
                      )}
                    </TableCell>
                    <TableCell className="text-slate-400 text-xs">
                      {c.identifiedAt
                        ? format(new Date(c.identifiedAt), "MMM d, yyyy HH:mm")
                        : c.updatedAt
                          ? format(new Date(c.updatedAt), "MMM d, yyyy")
                          : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}
