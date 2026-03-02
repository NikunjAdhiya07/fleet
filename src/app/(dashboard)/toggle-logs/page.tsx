"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Activity, RefreshCw, Clock, ShieldAlert, ShieldCheck } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";

type StatusType = "ON" | "OFF" | "PERMISSION_DENIED" | "PERMISSION_RESTORED";

interface ToggleLog {
  _id: string;
  deviceId: string;
  employeeName: string;
  status: StatusType;
  reason?: string;
  timestamp: string;
}

// Group logs and get the latest per employee
interface EmployeeStatus {
  employeeName: string;
  deviceId: string;
  latestStatus: StatusType;
  latestTimestamp: string;
  latestReason?: string;
  recentLogs: ToggleLog[];
}

const PERMISSION_POLL_INTERVAL_SECONDS = 30;

function getStatusBadge(status: StatusType) {
  switch (status) {
    case "ON":
      return <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/40 hover:bg-emerald-500/20">🟢 App ON</Badge>;
    case "OFF":
      return <Badge className="bg-rose-500/15 text-rose-400 border-rose-500/40 hover:bg-rose-500/20">🔴 App OFF</Badge>;
    case "PERMISSION_DENIED":
      return <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/40 hover:bg-amberald-500/20"><ShieldAlert className="w-3 h-3 mr-1 inline" />Permission Denied</Badge>;
    case "PERMISSION_RESTORED":
      return <Badge className="bg-sky-500/15 text-sky-400 border-sky-500/40 hover:bg-sky-500/20"><ShieldCheck className="w-3 h-3 mr-1 inline" />Permission Restored</Badge>;
  }
}

function NextCheckCountdown() {
  const [secondsLeft, setSecondsLeft] = useState(PERMISSION_POLL_INTERVAL_SECONDS);

  useEffect(() => {
    const interval = setInterval(() => {
      setSecondsLeft((s) => (s <= 1 ? PERMISSION_POLL_INTERVAL_SECONDS : s - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const pct = ((PERMISSION_POLL_INTERVAL_SECONDS - secondsLeft) / PERMISSION_POLL_INTERVAL_SECONDS) * 100;

  return (
    <div className="flex items-center gap-3 text-slate-400 text-sm">
      <Clock className="w-4 h-4 text-indigo-400 shrink-0" />
      <div className="flex flex-col gap-1 min-w-0">
        <span>Next permission check in <span className="text-white font-semibold tabular-nums">{secondsLeft}s</span></span>
        <div className="w-36 h-1.5 rounded-full bg-slate-700 overflow-hidden">
          <div
            className="h-full rounded-full bg-indigo-500 transition-all duration-1000"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </div>
  );
}

export default function ToggleLogsPage() {
  const [logs, setLogs] = useState<ToggleLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());

  const fetchLogs = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/toggle-logs");
      if (res.ok) {
        setLogs(await res.json());
        setLastRefreshed(new Date());
      }
    } catch {}
    finally { setIsLoading(false); }
  }, []);

  useEffect(() => {
    fetchLogs();
    // Auto-refresh every 30 seconds to stay in sync with device polling
    const interval = setInterval(fetchLogs, 30000);
    return () => clearInterval(interval);
  }, [fetchLogs]);

  // Group by employee — latest status per employee at the top
  const employeeMap = new Map<string, EmployeeStatus>();
  for (const log of logs) {
    const key = log.deviceId || log.employeeName;
    if (!employeeMap.has(key)) {
      employeeMap.set(key, {
        employeeName: log.employeeName,
        deviceId: log.deviceId,
        latestStatus: log.status,
        latestTimestamp: log.timestamp,
        latestReason: log.reason,
        recentLogs: [],
      });
    }
    const entry = employeeMap.get(key)!;
    if (entry.recentLogs.length < 5) entry.recentLogs.push(log);
  }
  const employees = Array.from(employeeMap.values());

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h1 className="text-3xl font-bold tracking-tight text-white flex items-center gap-3">
          <Activity className="w-8 h-8 text-indigo-400" />
          App Active Status
        </h1>
        <div className="flex items-center gap-4 flex-wrap">
          <NextCheckCountdown />
          <Button
            variant="outline"
            size="sm"
            onClick={fetchLogs}
            disabled={isLoading}
            className="border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Last refreshed */}
      <p className="text-xs text-slate-500">
        Last refreshed: {format(lastRefreshed, "h:mm:ss a")} · auto-refreshes every 30s
      </p>

      {/* Per-employee summary cards */}
      {employees.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {employees.map((emp) => (
            <Card key={emp.deviceId} className="bg-slate-900 border-slate-800">
              <CardContent className="pt-4 pb-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-white text-sm">{emp.employeeName || "Unknown"}</p>
                    <p className="text-xs text-slate-500 font-mono truncate">{emp.deviceId}</p>
                  </div>
                  {getStatusBadge(emp.latestStatus)}
                </div>
                {emp.latestReason && (
                  <p className="text-xs text-slate-400 italic">{emp.latestReason}</p>
                )}
                <div className="text-xs text-slate-500 flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  Last checked: {formatDistanceToNow(new Date(emp.latestTimestamp), { addSuffix: true })}
                  <span className="text-slate-600">·</span>
                  {format(new Date(emp.latestTimestamp), "h:mm a")}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Full log table */}
      <Card className="bg-slate-900 border-slate-800 text-slate-100">
        <Table>
          <TableHeader className="bg-slate-950/50">
            <TableRow className="border-slate-800">
              <TableHead className="text-slate-400">Employee</TableHead>
              <TableHead className="text-slate-400">Status</TableHead>
              <TableHead className="text-slate-400">Reason / Detail</TableHead>
              <TableHead className="text-slate-400 text-right">Time</TableHead>
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
                  No logs found yet. Install the app and flip the toggle to start tracking.
                </TableCell>
              </TableRow>
            ) : logs.map((log) => (
              <TableRow key={log._id} className="border-slate-800 hover:bg-slate-800/40 transition-colors">
                <TableCell>
                  <p className="font-semibold text-white text-sm">{log.employeeName || "Unknown"}</p>
                  <p className="text-xs text-slate-500 font-mono">{log.deviceId}</p>
                </TableCell>
                <TableCell>{getStatusBadge(log.status)}</TableCell>
                <TableCell className="text-slate-400 text-sm max-w-xs">
                  {log.reason ? (
                    <span className="italic">{log.reason}</span>
                  ) : (
                    <span className="text-slate-600">—</span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <p className="text-slate-300 text-sm">{format(new Date(log.timestamp), "MMM d, h:mm:ss a")}</p>
                  <p className="text-slate-500 text-xs">{formatDistanceToNow(new Date(log.timestamp), { addSuffix: true })}</p>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
