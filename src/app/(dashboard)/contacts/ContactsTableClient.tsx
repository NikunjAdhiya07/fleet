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

// Same number written as 07698465970 / +917698465970 / 7698465970 must collapse
// to one key: drop non-digits, then keep the last 10 (subscriber) digits.
function phoneKey(v: unknown) {
  const digits = normDigits(v);
  return digits.length > 10 ? digits.slice(-10) : digits;
}

type MergedContact = {
  key: string;
  contactName: string;
  phoneNumber: string;
  sources: ContactBankRow[];
  lastSyncedAt: string | null;
};

// One entry per (contact name + phone number), no matter how many employees'
// devices it was synced from.
function mergeContacts(contacts: ContactBankRow[]): MergedContact[] {
  const byKey = new Map<string, MergedContact>();

  for (const c of contacts) {
    const pKey = phoneKey(c.phoneNumber);
    const nKey = normText(c.contactName);
    // Without a phone number there is nothing safe to merge on — keep it separate.
    const key = pKey ? `${pKey}|${nKey}` : `id:${c.id}`;

    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        key,
        contactName: c.contactName,
        phoneNumber: c.phoneNumber,
        sources: [c],
        lastSyncedAt: c.syncedAt,
      });
      continue;
    }

    existing.sources.push(c);
    // Prefer the most complete rendering of the number (e.g. +91… over 0…).
    if (normDigits(c.phoneNumber).length > normDigits(existing.phoneNumber).length) {
      existing.phoneNumber = c.phoneNumber;
    }
    if (c.contactName && !existing.contactName) existing.contactName = c.contactName;
    if (c.syncedAt && (!existing.lastSyncedAt || c.syncedAt > existing.lastSyncedAt)) {
      existing.lastSyncedAt = c.syncedAt;
    }
  }

  for (const m of byKey.values()) {
    m.sources.sort((a, b) => a.employeeName.localeCompare(b.employeeName));
  }

  return [...byKey.values()];
}

export function ContactsTableClient({ contacts }: { contacts: ContactBankRow[] }) {
  const [q, setQ] = useState("");

  const merged = useMemo(() => mergeContacts(contacts), [contacts]);

  const filtered = useMemo(() => {
    const nqText = normText(q);
    const nqDigits = normDigits(q);
    const textTokens = nqText ? nqText.split(" ").filter(Boolean) : [];
    const digitTokens = nqDigits ? [nqDigits] : [];
    if (textTokens.length === 0 && digitTokens.length === 0) return merged;

    return merged.filter((c) => {
      const employees = c.sources.map((s) => `${s.employeeName} ${s.deviceId}`).join(" ");
      const phones = c.sources.map((s) => s.phoneNumber).join(" ");
      const hayText = normText(`${employees} ${c.contactName} ${phones}`);
      const hayDigits = normDigits(`${c.sources.map((s) => s.deviceId).join(" ")} ${phones}`);

      // All tokens must match somewhere (more "search-like" than exact phrase match).
      for (const t of textTokens) {
        if (!hayText.includes(t)) return false;
      }
      for (const d of digitTokens) {
        if (!hayDigits.includes(d)) return false;
      }
      return true;
    });
  }, [merged, q]);

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
              <span className="text-slate-300 font-medium">{merged.length}</span>{" "}
              {merged.length !== contacts.length ? (
                <span className="text-slate-600">({contacts.length} synced entries merged)</span>
              ) : null}
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
                <TableRow key={contact.key} className="border-slate-800 hover:bg-slate-800/50">
                  <TableCell className="font-medium text-slate-300 align-top">
                    <div className="space-y-1.5">
                      {contact.sources.map((s) => (
                        <div key={s.id}>
                          {s.employeeName || "—"}
                          <br />
                          <span className="text-xs text-slate-500 font-mono">{s.deviceId}</span>
                        </div>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-slate-300 align-top">
                    {contact.contactName || "—"}
                    {contact.sources.length > 1 ? (
                      <span className="ml-2 rounded bg-slate-800 px-1.5 py-0.5 text-xs text-slate-400">
                        {contact.sources.length} devices
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-slate-300 font-mono align-top">
                    {contact.phoneNumber || "—"}
                  </TableCell>
                  <TableCell className="text-slate-400 text-sm align-top">
                    {contact.lastSyncedAt
                      ? format(new Date(contact.lastSyncedAt), "MMM d, yyyy HH:mm")
                      : "-"}
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

