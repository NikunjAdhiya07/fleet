"use client";

import { useMemo, useState } from "react";
import { format } from "date-fns";
import { Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type ContactBankRow = {
  id: string;
  employeeName: string;
  deviceId: string;
  contactName: string;
  phoneNumber: string;
  syncedAt: string | null;
};

function normText(v: unknown) {
  return String(v ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normDigits(v: unknown) {
  return String(v ?? "").replace(/\D+/g, "");
}

export function ContactsTableClient({ contacts }: { contacts: ContactBankRow[] }) {
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const nqText = normText(q);
    const nqDigits = normDigits(q);
    const textTokens = nqText ? nqText.split(" ").filter(Boolean) : [];
    const digitTokens = nqDigits ? [nqDigits] : [];
    if (textTokens.length === 0 && digitTokens.length === 0) return contacts;

    return contacts.filter((c) => {
      const hayText = normText(`${c.employeeName} ${c.deviceId} ${c.contactName} ${c.phoneNumber}`);
      const hayDigits = normDigits(`${c.deviceId} ${c.phoneNumber}`);

      // All tokens must match somewhere (more "search-like" than exact phrase match).
      for (const t of textTokens) {
        if (!hayText.includes(t)) return false;
      }
      for (const d of digitTokens) {
        if (!hayDigits.includes(d)) return false;
      }
      return true;
    });
  }, [contacts, q]);

  return (
    <div className="rounded-md border border-slate-800 bg-slate-900 overflow-hidden">
      <div className="max-h-[70vh] overflow-y-auto">
        <div className="sticky top-0 z-10 border-b border-slate-800 bg-slate-900/95 backdrop-blur supports-[backdrop-filter]:bg-slate-900/75 px-3 py-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative w-full sm:max-w-md">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search employee, device, name, phone…"
                className="pl-9 bg-slate-950/40 border-slate-800 text-slate-200 placeholder:text-slate-500"
              />
            </div>
            <div className="text-xs text-slate-500">
              Showing <span className="text-slate-300 font-medium">{filtered.length}</span> of{" "}
              <span className="text-slate-300 font-medium">{contacts.length}</span>
            </div>
          </div>
        </div>

        <Table>
          <TableHeader>
            <TableRow className="border-slate-800 hover:bg-slate-800/50">
              <TableHead className="text-slate-400">Employee / Device</TableHead>
              <TableHead className="text-slate-400">Contact Name</TableHead>
              <TableHead className="text-slate-400">Phone Number</TableHead>
              <TableHead className="text-slate-400">Last Synced</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow className="border-slate-800 hover:bg-slate-800/50">
                <TableCell colSpan={4} className="h-24 text-center text-slate-500">
                  No matching contacts.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((contact) => (
                <TableRow key={contact.id} className="border-slate-800 hover:bg-slate-800/50">
                  <TableCell className="font-medium text-slate-300">
                    {contact.employeeName}
                    <br />
                    <span className="text-xs text-slate-500 font-mono">{contact.deviceId}</span>
                  </TableCell>
                  <TableCell className="text-slate-300">{contact.contactName || "—"}</TableCell>
                  <TableCell className="text-slate-300 font-mono">{contact.phoneNumber || "—"}</TableCell>
                  <TableCell className="text-slate-400 text-sm">
                    {contact.syncedAt ? format(new Date(contact.syncedAt), "MMM d, yyyy HH:mm") : "-"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

