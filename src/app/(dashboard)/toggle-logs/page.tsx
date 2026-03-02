"use client";

import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, Activity } from "lucide-react";
import { format } from "date-fns";

interface ToggleLog {
  _id: string;
  deviceId: string;
  employeeName: string;
  status: "ON" | "OFF";
  timestamp: string;
}

export default function ToggleLogsPage() {
  const [logs, setLogs] = useState<ToggleLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchLogs();
  }, []);

  const fetchLogs = async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/toggle-logs");
      if (res.ok) setLogs(await res.json());
    } catch {}
    finally { setIsLoading(false); }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h1 className="text-3xl font-bold tracking-tight text-white flex items-center gap-3">
          <Activity className="w-8 h-8 text-indigo-400" />
          App Active Status
        </h1>
      </div>

      <Card className="bg-slate-900 border-slate-800 text-slate-100">
        <Table>
          <TableHeader className="bg-slate-950/50">
            <TableRow className="border-slate-800">
              <TableHead className="text-slate-400">Employee Name</TableHead>
              <TableHead className="text-slate-400">Device ID</TableHead>
              <TableHead className="text-slate-400">Status</TableHead>
              <TableHead className="text-slate-400 text-right">Timestamp</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={4} className="h-32 text-center">
                  <Loader2 className="h-6 w-6 animate-spin mx-auto text-indigo-500" />
                </TableCell>
              </TableRow>
            ) : logs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="h-24 text-center text-slate-500">
                  No toggle logs found.
                </TableCell>
              </TableRow>
            ) : logs.map(log => (
              <TableRow key={log._id} className="border-slate-800 hover:bg-slate-800/40 transition-colors">
                <TableCell className="font-semibold text-white">{log.employeeName}</TableCell>
                <TableCell className="text-slate-400 font-mono">{log.deviceId}</TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={log.status === "ON"
                      ? "border-emerald-500/50 text-emerald-400 bg-emerald-500/10"
                      : "border-rose-500/50 text-rose-400 bg-rose-500/10"}
                  >
                    APP {log.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-right text-slate-300">
                  {format(new Date(log.timestamp), "MMM d, yyyy h:mm a")}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
