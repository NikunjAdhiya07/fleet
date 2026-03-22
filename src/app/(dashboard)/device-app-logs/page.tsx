"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, RefreshCw, Smartphone } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";

interface DeviceAppLogRow {
  _id: string;
  deviceId: string;
  employeeName: string;
  message: string;
  recordedAt: string;
  createdAt: string;
}

export default function DeviceAppLogsPage() {
  const [logs, setLogs] = useState<DeviceAppLogRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filterEmployee, setFilterEmployee] = useState("");
  const [filterDevice, setFilterDevice] = useState("");
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());

  const fetchLogs = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({ limit: "400" });
      if (filterEmployee.trim()) params.set("employeeName", filterEmployee.trim());
      if (filterDevice.trim()) params.set("deviceId", filterDevice.trim());
      const res = await fetch(`/api/device-app-logs?${params}`);
      if (res.ok) {
        setLogs(await res.json());
        setLastRefreshed(new Date());
      }
    } catch {
      /* ignore */
    } finally {
      setIsLoading(false);
    }
  }, [filterEmployee, filterDevice]);

  useEffect(() => {
    fetchLogs();
    const interval = setInterval(fetchLogs, 15000);
    return () => clearInterval(interval);
  }, [fetchLogs]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Smartphone className="h-7 w-7 text-indigo-400" />
            Phone app logs
          </h1>
          <p className="text-slate-400 mt-1 text-sm">
            In-app log lines synced from employee Android devices (same lines as on the phone).
          </p>
        </div>
        <Button
          variant="outline"
          onClick={fetchLogs}
          disabled={isLoading}
          className="border-slate-600 text-slate-200"
        >
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          <span className="ml-2">Refresh</span>
        </Button>
      </div>

      <Card className="bg-slate-900/80 border-slate-800">
        <CardHeader className="pb-2">
          <CardTitle className="text-slate-200 text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col sm:flex-row gap-3">
          <Input
            placeholder="Employee name (exact match)"
            value={filterEmployee}
            onChange={(e) => setFilterEmployee(e.target.value)}
            className="bg-slate-950 border-slate-700 text-white max-w-md"
          />
          <Input
            placeholder="Device ID"
            value={filterDevice}
            onChange={(e) => setFilterDevice(e.target.value)}
            className="bg-slate-950 border-slate-700 text-white max-w-md"
          />
          <Button onClick={fetchLogs} className="bg-indigo-600 hover:bg-indigo-500">
            Apply
          </Button>
        </CardContent>
      </Card>

      <p className="text-xs text-slate-500">
        Last updated {format(lastRefreshed, "PPpp")} · auto-refresh every 15s
      </p>

      <Card className="bg-slate-900/80 border-slate-800 overflow-hidden">
        <CardContent className="p-0">
          <div className="overflow-x-auto max-h-[70vh] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-slate-800 hover:bg-transparent">
                  <TableHead className="text-slate-400 w-40">Recorded (phone)</TableHead>
                  <TableHead className="text-slate-400 w-32">Employee</TableHead>
                  <TableHead className="text-slate-400 w-48">Device</TableHead>
                  <TableHead className="text-slate-400">Message</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && logs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-12 text-slate-500">
                      <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2" />
                      Loading…
                    </TableCell>
                  </TableRow>
                ) : logs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-12 text-slate-500">
                      No device logs yet. Ensure monitoring is ON and network is available.
                    </TableCell>
                  </TableRow>
                ) : (
                  logs.map((row) => (
                    <TableRow key={row._id} className="border-slate-800">
                      <TableCell className="text-slate-300 align-top whitespace-nowrap text-xs">
                        <div>{format(new Date(row.recordedAt), "MMM d, HH:mm:ss")}</div>
                        <div className="text-slate-500">
                          {formatDistanceToNow(new Date(row.recordedAt), { addSuffix: true })}
                        </div>
                      </TableCell>
                      <TableCell className="text-slate-200 align-top text-sm">
                        {row.employeeName}
                      </TableCell>
                      <TableCell className="text-slate-400 align-top font-mono text-xs break-all max-w-[12rem]">
                        {row.deviceId}
                      </TableCell>
                      <TableCell className="text-slate-300 align-top font-mono text-xs whitespace-pre-wrap break-words max-w-xl">
                        {row.message}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
