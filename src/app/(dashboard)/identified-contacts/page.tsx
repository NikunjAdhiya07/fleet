"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, UserCheck, Tag } from "lucide-react";
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

  useEffect(() => {
    (async () => {
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
    })();
  }, []);

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <UserCheck className="h-7 w-7 text-indigo-400" />
          Identified Contacts
        </h1>
        <p className="text-slate-400 text-sm mt-1">
          Names and categories saved via Telegram (Scenario A & B)
        </p>
      </div>

      <Card className="bg-slate-900 border-slate-800 overflow-hidden">
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
