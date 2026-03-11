"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import {
  ScrollText,
  RefreshCw,
  Trash2,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Info,
  ChevronDown,
  ChevronRight,
  PlayCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type BotLog = {
  _id: string;
  level: "info" | "warn" | "error" | "success";
  step: string;
  message: string;
  data?: any;
  employeeName?: string;
  phoneNumber?: string;
  createdAt: string;
};

const levelConfig = {
  info:    { icon: Info,          color: "text-sky-400",     bg: "bg-sky-400/10",     border: "border-sky-400/20",     label: "INFO"    },
  warn:    { icon: AlertTriangle, color: "text-amber-400",   bg: "bg-amber-400/10",   border: "border-amber-400/20",   label: "WARN"    },
  error:   { icon: XCircle,      color: "text-rose-400",    bg: "bg-rose-400/10",    border: "border-rose-400/20",    label: "ERROR"   },
  success: { icon: CheckCircle2, color: "text-emerald-400", bg: "bg-emerald-400/10", border: "border-emerald-400/20", label: "OK"      },
};

export default function BotLogsPage() {
  const [logs, setLogs] = useState<BotLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<string>("ALL");

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/bot-logs?limit=200");
      if (res.ok) setLogs(await res.json());
    } finally {
      setLoading(false);
    }
  };

  const processNow = async () => {
    setProcessing(true);
    try {
      const res = await fetch("/api/contact-intelligence/process");
      const data = await res.json();
      if (data.success) {
        alert(`Processed ${data.processedCount} calls.`);
        await fetchLogs();
      } else {
        alert(`Error: ${data.error || "Unknown error"}`);
      }
    } catch (e) {
      alert("Failed to run process.");
    } finally {
      setProcessing(false);
    }
  };

  const clearLogs = async () => {
    if (!confirm("Clear all bot logs?")) return;
    setClearing(true);
    try {
      await fetch("/api/bot-logs", { method: "DELETE" });
      setLogs([]);
    } finally {
      setClearing(false);
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  useEffect(() => { fetchLogs(); }, []);

  const employees = ["ALL", ...Array.from(new Set(logs.map((l) => l.employeeName).filter(Boolean)))];
  const filtered = filter === "ALL" ? logs : logs.filter((l) => l.employeeName === filter);

  const counts = {
    total: logs.length,
    error: logs.filter((l) => l.level === "error").length,
    warn: logs.filter((l) => l.level === "warn").length,
    success: logs.filter((l) => l.level === "success").length,
  };

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white flex items-center gap-3">
            <ScrollText className="h-8 w-8 text-indigo-400" />
            Bot Activity Logs
          </h1>
          <p className="text-slate-400 mt-1 text-sm">
            Real-time step-by-step log of the Telegram intelligence pipeline. Persisted in MongoDB.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={processNow}
            disabled={processing || loading}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm transition-colors disabled:opacity-50"
          >
            {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
            Process Now
          </button>
          <button
            onClick={fetchLogs}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm transition-colors disabled:opacity-50"
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            Refresh
          </button>
          <button
            onClick={clearLogs}
            disabled={clearing || logs.length === 0}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-rose-600/20 hover:bg-rose-600/40 text-rose-400 text-sm transition-colors disabled:opacity-50"
          >
            {clearing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            Clear
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "Total",   value: counts.total,   color: "text-slate-300" },
          { label: "Errors",  value: counts.error,   color: "text-rose-400"  },
          { label: "Warnings",value: counts.warn,    color: "text-amber-400" },
          { label: "Success", value: counts.success, color: "text-emerald-400" },
        ].map(({ label, value, color }) => (
          <Card key={label} className="bg-slate-900 border-slate-800">
            <CardContent className="pt-4 pb-4 px-4">
              <div className="text-xs text-slate-400 mb-1">{label}</div>
              <div className={cn("text-2xl font-bold", color)}>{value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filter by employee */}
      {employees.length > 1 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-slate-500">Filter by employee:</span>
          {employees.map((name) => (
            <button
              key={name}
              onClick={() => setFilter(name ?? "ALL")}
              className={cn(
                "px-3 py-1 rounded-full text-xs font-medium transition-colors",
                filter === name
                  ? "bg-indigo-600 text-white"
                  : "bg-slate-800 text-slate-400 hover:bg-slate-700"
              )}
            >
              {name}
            </button>
          ))}
        </div>
      )}

      {/* Log list */}
      <Card className="bg-slate-900 border-slate-800">
        <CardHeader className="pb-3">
          <CardTitle className="text-base text-slate-200">
            Log Entries {filter !== "ALL" && <span className="text-slate-500 text-sm font-normal">— {filter}</span>}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center h-40">
              <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center text-slate-500 py-16 text-sm">
              <ScrollText className="h-10 w-10 mx-auto mb-3 opacity-30" />
              No logs yet. Trigger a call from the Android app to see activity here.
            </div>
          ) : (
            <div className="divide-y divide-slate-800/60">
              {filtered.map((log) => {
                const cfg = levelConfig[log.level];
                const Icon = cfg.icon;
                const isExpanded = expandedIds.has(log._id);
                const hasData = log.data && Object.keys(log.data).length > 0;

                return (
                  <div
                    key={log._id}
                    className={cn("px-4 py-3 hover:bg-slate-800/30 transition-colors", cfg.bg)}
                  >
                    <div className="flex items-start gap-3">
                      <Icon className={cn("h-4 w-4 mt-0.5 flex-shrink-0", cfg.color)} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={cn("text-xs font-bold font-mono", cfg.color)}>{cfg.label}</span>
                          <span className="text-xs font-mono bg-slate-800 px-1.5 py-0.5 rounded text-slate-400">{log.step}</span>
                          {log.employeeName && (
                            <span className="text-xs text-slate-500">{log.employeeName}</span>
                          )}
                          {log.phoneNumber && (
                            <span className="text-xs font-mono text-slate-600">{log.phoneNumber}</span>
                          )}
                          <span className="text-xs text-slate-600 ml-auto whitespace-nowrap">
                            {format(new Date(log.createdAt), "HH:mm:ss")}
                          </span>
                        </div>
                        <p className="text-sm text-slate-300 mt-1 leading-snug">{log.message}</p>
                        {hasData && (
                          <button
                            onClick={() => toggleExpand(log._id)}
                            className="flex items-center gap-1 mt-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors"
                          >
                            {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                            {isExpanded ? "Hide" : "Show"} data
                          </button>
                        )}
                        {isExpanded && hasData && (
                          <pre className="mt-2 text-xs bg-slate-950 border border-slate-800 rounded-lg p-3 text-slate-300 overflow-x-auto whitespace-pre-wrap max-h-48">
                            {JSON.stringify(log.data, null, 2)}
                          </pre>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
