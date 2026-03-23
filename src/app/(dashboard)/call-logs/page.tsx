"use client";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PhoneIncoming, PhoneOutgoing, PhoneMissed, Search, Loader2, Calendar as CalendarIcon, User, ArrowRight, ArrowLeftRight, Plus, BellRing, CheckCircle2, XCircle } from "lucide-react";
import { format, subDays, startOfDay, endOfDay } from "date-fns";
import { useEffect, useState, useMemo, useRef } from "react";
import { cn } from "@/lib/utils";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DateRange } from "react-day-picker";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Info } from "lucide-react";
import {
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  LabelList,
} from "recharts";
import ComparisonPanel from "./ComparisonPanel";

const GraphSkeleton = () => (
  <div className="w-full h-full flex flex-col items-center justify-end pt-8 pb-4 px-2 sm:px-6">
    <div className="flex items-end justify-between w-full h-[80%] gap-1.5 sm:gap-2 px-1 border-b border-slate-800/60 pb-1">
      {[40, 70, 45, 90, 65, 30, 80, 50, 60, 35, 75, 40].map((h, i) => (
        <div key={i} className="w-full bg-slate-800/30 rounded-t flex flex-col justify-end overflow-hidden" style={{ height: `${h}%` }}>
          <div 
            className="w-full bg-indigo-500/20 rounded-t animate-pulse" 
            style={{ height: '100%', animationDelay: `${i * 0.1}s`, animationDuration: '1.5s' }} 
          />
        </div>
      ))}
    </div>
    <div className="w-full mt-8 flex justify-center items-center gap-3">
        <div className="relative flex h-2.5 w-2.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-indigo-500"></span>
        </div>
        <span className="text-sm text-slate-400 font-medium">Crunching the latest call data...</span>
    </div>
  </div>
);

export default function CallLogsPage() {
  const [logs, setLogs] = useState<any[]>([]);
  const [tags, setTags] = useState<Record<string, Array<{name: string, savedBy: any[]}>>>({});
  const [intelligenceTags, setIntelligenceTags] = useState<Record<string, { category?: string; contactName?: string }>>({});
  const [totalCount, setTotalCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [dateFilter, setDateFilter] = useState<"ALL" | "TODAY" | "YESTERDAY" | "CUSTOM">("TODAY");
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [selectedEmployee, setSelectedEmployee] = useState<string>("ALL");
  const [isTagModalOpen, setIsTagModalOpen] = useState(false);
  const [selectedPhoneForTags, setSelectedPhoneForTags] = useState<string | null>(null);
  const [isFetchingTags, setIsFetchingTags] = useState(false);
  const logsRef = useRef<HTMLDivElement>(null);
  const [comparisonMode, setComparisonMode] = useState(false);
  const [comparisonPanels, setComparisonPanels] = useState<
    Array<{ id: string; dateFilter: "TODAY" | "YESTERDAY" | "CUSTOM" }>
  >([]);
  const [compareViewMode, setCompareViewMode] = useState<"panels" | "singleGraph">("singleGraph");
  const [selectedCompareEmployees, setSelectedCompareEmployees] = useState<string[]>([]);
  const [compareXAxisMode, setCompareXAxisMode] = useState<"hour" | "date">("hour");
  const [isDesktop, setIsDesktop] = useState(true);
  const [fcmWakeState, setFcmWakeState] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [fcmWakeMsg, setFcmWakeMsg] = useState("");

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 640px)");
    const set = () => setIsDesktop(mq.matches);
    set();
    mq.addEventListener("change", set);
    return () => mq.removeEventListener("change", set);
  }, []);

  const triggerFcmWake = async () => {
    setFcmWakeState("loading");
    setFcmWakeMsg("");
    try {
      const res = await fetch("/api/fcm-wake", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        const { sent = 0, staleDevices = 0, tokensFound = 0 } = data;
        setFcmWakeMsg(`Sent ${sent}/${tokensFound} push(es) to ${staleDevices} stale device(s)`);
        setFcmWakeState("success");
      } else {
        setFcmWakeMsg(data.error ?? "Unknown error");
        setFcmWakeState("error");
      }
    } catch (e: any) {
      setFcmWakeMsg(e.message ?? "Network error");
      setFcmWakeState("error");
    } finally {
      setTimeout(() => setFcmWakeState("idle"), 5000);
    }
  };

  // When in compare mode and employees load, default to all selected if none selected yet
  const employeeNames = useMemo(() => {
    const names = new Set<string>();
    logs.forEach((log) => {
      const name = log.employeeName || log.driverId?.userId?.name;
      if (name) names.add(name);
    });
    return Array.from(names).sort();
  }, [logs]);

  useEffect(() => {
    if (comparisonMode && selectedCompareEmployees.length === 0 && employeeNames.length > 0) {
      setSelectedCompareEmployees(employeeNames);
    }
  }, [comparisonMode, employeeNames, selectedCompareEmployees.length]);

  const toggleComparisonMode = () => {
    if (!comparisonMode) {
      setComparisonPanels([
        { id: "panel-a", dateFilter: "TODAY" },
        { id: "panel-b", dateFilter: "YESTERDAY" },
      ]);
      setSelectedCompareEmployees(employeeNames);
      setCompareXAxisMode("hour");
    }
    setComparisonMode(!comparisonMode);
  };

  const addComparisonPanel = () => {
    if (comparisonPanels.length >= 4) return;
    setComparisonPanels((prev) => [
      ...prev,
      { id: `panel-${Date.now()}`, dateFilter: "TODAY" },
    ]);
  };

  const removeComparisonPanel = (id: string) => {
    setComparisonPanels((prev) => prev.filter((p) => p.id !== id));
  };

  const scrollToLogs = () => {
    // Only auto-scroll on small (mobile) screens
    if (window.innerWidth < 640 && logsRef.current) {
      setTimeout(() => {
        logsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 80);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [typeFilter, dateFilter, dateRange]);

  const fetchLogs = async () => {
    setIsLoading(true);
    try {
      const url = new URL("/api/call-logs", window.location.origin);
      if (typeFilter !== "ALL") url.searchParams.append("callType", typeFilter);

      let start: Date | null = null;
      let end: Date | null = null;

      if (dateFilter === "TODAY") {
        start = startOfDay(new Date());
        end = endOfDay(new Date());
      } else if (dateFilter === "YESTERDAY") {
        const yesterday = subDays(new Date(), 1);
        start = startOfDay(yesterday);
        end = endOfDay(yesterday);
      } else if (dateFilter === "CUSTOM" && dateRange?.from) {
        start = startOfDay(dateRange.from);
        end = dateRange.to ? endOfDay(dateRange.to) : endOfDay(dateRange.from);
      }

      if (start) url.searchParams.append("startDate", start.toISOString());
      if (end) url.searchParams.append("endDate", end.toISOString());

      const res = await fetch(url.toString());
      if (res.ok) {
        const data = await res.json();
        // Handle both older array returns and newer object returns
        if (Array.isArray(data)) {
          setLogs(data);
          setTotalCount(data.length);
        } else {
          setLogs(data.logs || []);
          setTotalCount(data.totalCount || 0);
        }
      }
    } catch (error) {
      console.error("Failed to fetch call logs:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchTags = async (logsToProcess: any[]) => {
    const uniquePhones = [...new Set(logsToProcess.map((log) => log.phoneNumber))];
    if (uniquePhones.length === 0) return;

    try {
      const res = await fetch("/api/contacts/tags/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumbers: uniquePhones }),
      });
      if (res.ok) {
        const data = await res.json();
        setTags((prev) => ({ ...prev, ...data.tags }));
      }
    } catch (error) {
      console.error("Failed to fetch tags:", error);
    }
  };

  const fetchIntelligenceTags = async (logsToProcess: any[]) => {
    const pairs = Array.from(
      new Map(
        logsToProcess.map((log) => {
          const emp = log.employeeName || log.driverId?.userId?.name || "Unknown";
          return [`${log.phoneNumber}|${emp}`, { phoneNumber: log.phoneNumber, employeeName: emp }];
        })
      ).values()
    );
    if (pairs.length === 0) return;
    try {
      const res = await fetch("/api/contact-intelligence/tags-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pairs }),
      });
      if (res.ok) {
        const data = await res.json();
        setIntelligenceTags((prev) => ({ ...prev, ...data.tags }));
      }
    } catch (error) {
      console.error("Failed to fetch intelligence tags:", error);
    }
  };

  // We should fetch tags once the page determines the filteredLogs that are visible.
  // Using an effect that triggers on filteredLogs changes ensures tags represent
  // what's visible, and avoids excessive repeated loading.
  
  // When employee list changes, reset selection if selected employee no longer present
  useEffect(() => {
    if (selectedEmployee !== "ALL" && !employeeNames.includes(selectedEmployee)) {
      setSelectedEmployee("ALL");
    }
  }, [employeeNames]);

  const getEmployeeName = (log: any) =>
    log.employeeName || log.driverId?.userId?.name || "Unknown";

  const rawFilteredLogs = logs.filter((log) => {
    const matchesSearch =
      searchQuery === "" || log.phoneNumber.includes(searchQuery);
    const matchesEmployee =
      selectedEmployee === "ALL" || getEmployeeName(log) === selectedEmployee;
    return matchesSearch && matchesEmployee;
  });

  // Deduplicate logs introduced by an old Android app bug
  const filteredLogs = useMemo(() => {
    const uniqueLogs: any[] = [];
    
    // Sort raw logs descending by timestamp first so the newest in a duplicate cluster comes first
    const sortedRaw = [...rawFilteredLogs].sort((a, b) => {
      const timeA = new Date(a.timestamp).getTime();
      const timeB = new Date(b.timestamp).getTime();
      return timeB - timeA;
    });

    sortedRaw.forEach(log => {
      if (!log.timestamp) {
        uniqueLogs.push(log);
        return;
      }
      
      const logTime = new Date(log.timestamp).getTime();
      const emp = getEmployeeName(log);
      
      // Check if this log matches an existing one in our unique array
      const isDuplicate = uniqueLogs.some(existing => {
        if (existing.phoneNumber !== log.phoneNumber || 
            existing.callType !== log.callType || 
            getEmployeeName(existing) !== emp) {
          return false;
        }
        
        // Time difference within 5 minutes (300000 ms) since some syncs got super delayed
        const existingTime = new Date(existing.timestamp).getTime();
        const isTimeClose = Math.abs(existingTime - logTime) < 300000;
        
        // Duration difference within 30 seconds
        const isDurationClose = Math.abs(existing.duration - log.duration) <= 30;
        
        return isTimeClose && isDurationClose;
      });

      if (!isDuplicate) {
        uniqueLogs.push(log);
      }
    });

    return uniqueLogs;
  }, [rawFilteredLogs]);

  useEffect(() => {
    if (filteredLogs.length > 0) {
      fetchTags(filteredLogs);
      fetchIntelligenceTags(filteredLogs);
    }
  }, [logs, searchQuery, selectedEmployee]);

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s}s`;
  };

  const CallTypeBadge = ({ callType, className }: { callType: string; className?: string }) => {
    if (callType === "INCOMING")
      return (
        <Badge className={cn("bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/20 gap-1.5 rounded-full px-1.5 py-0.5", className)}>
          <PhoneIncoming className="w-3.5 h-3.5" /> Incoming
        </Badge>
      );
    if (callType === "OUTGOING")
      return (
        <Badge className={cn("bg-sky-500/10 text-sky-400 hover:bg-sky-500/20 border border-sky-500/20 gap-1.5 rounded-full px-2.5 py-1", className)}>
          <PhoneOutgoing className="w-3.5 h-3.5" /> Outgoing
        </Badge>
      );
    if (callType === "MISSED")
      return (
        <Badge className={cn("bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 border border-rose-500/20 gap-1.5 rounded-full px-2.5 py-1", className)}>
          <PhoneMissed className="w-3.5 h-3.5" /> Missed
        </Badge>
      );
    return null;
  };

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

  const IdentifiedTag = ({
    log,
    getEmployeeName,
    intelligenceTags,
  }: {
    log: any;
    getEmployeeName: (log: any) => string;
    intelligenceTags: Record<string, { category?: string; contactName?: string }>;
  }) => {
    const key = `${log.phoneNumber}|${getEmployeeName(log)}`;
    const tag = intelligenceTags[key];
    if (!tag) return <span className="text-slate-500 text-xs">—</span>;
    return (
      <div className="flex flex-wrap gap-1">
        {tag.category && (
          <span
            className={cn(
              "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border",
              CATEGORY_COLORS[tag.category] ?? "bg-slate-700 text-slate-300 border-slate-600"
            )}
          >
            {tag.category}
          </span>
        )}
        {tag.contactName && (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border bg-violet-500/15 text-violet-300 border-violet-500/30">
            {tag.contactName}
          </span>
        )}
        {!tag.category && !tag.contactName && <span className="text-slate-500 text-xs">—</span>}
      </div>
    );
  };

  const timeBuckets = useMemo(() => {
    const labels = [];
    for (let hour = 0; hour < 24; hour++) {
      const nextHour = (hour + 1) % 24;
      const formatHour = (h: number) => {
        const period = h < 12 ? "AM" : "PM";
        const display = h % 12 === 0 ? 12 : h % 12;
        return `${display} ${period}`;
      };
      labels.push({
        key: `${hour}`,
        label: `${formatHour(hour)} – ${formatHour(nextHour)}`,
        hour,
      });
    }
    return labels;
  }, []);

  const chartData = useMemo(() => {
    const base = timeBuckets.map((b) => ({
      timeRange: b.label,
      hour: b.hour,
      incoming: 0,
      outgoing: 0,
      missed: 0,
      total: 0,
    }));

    filteredLogs.forEach((log) => {
      if (!log.timestamp) return;
      const date = new Date(log.timestamp);
      if (isNaN(date.getTime())) return;
      const hour = date.getHours();
      const bucket = base[hour];
      if (!bucket) return;
      if (log.callType === "INCOMING") bucket.incoming += 1;
      else if (log.callType === "OUTGOING") bucket.outgoing += 1;
      else if (log.callType === "MISSED") bucket.missed += 1;
      bucket.total += 1;
    });

    // Only keep buckets that actually have calls so the x-axis
    // shows only hours with activity (no empty columns).
    return base.filter((b) => b.total > 0);
  }, [filteredLogs, timeBuckets]);

  // Date range for "by day" chart: derived from selected date range (each day in range = Day 1, Day 2, ...)
  const chartDateRange = useMemo(() => {
    let start: Date;
    let end: Date;
    if (dateFilter === "TODAY") {
      start = startOfDay(new Date());
      end = endOfDay(new Date());
    } else if (dateFilter === "YESTERDAY") {
      const y = subDays(new Date(), 1);
      start = startOfDay(y);
      end = endOfDay(y);
    } else if (dateFilter === "CUSTOM" && dateRange?.from) {
      start = startOfDay(dateRange.from);
      end = dateRange.to ? endOfDay(dateRange.to) : endOfDay(dateRange.from);
    } else {
      end = endOfDay(new Date());
      start = startOfDay(subDays(end, 4));
    }
    const days: { label: string; dateTs: number; dayIndex: number }[] = [];
    const maxDays = 31;
    for (let i = 0; i < maxDays; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      const dayStart = startOfDay(d);
      if (dayStart.getTime() > end.getTime()) break;
      days.push({
        label: format(dayStart, "d MMM"),
        dateTs: dayStart.getTime(),
        dayIndex: i,
      });
    }
    return { start, end, days };
  }, [dateFilter, dateRange]);

  // Logs filtered for single-graph compare (selected employees + date range + call type filter)
  const singleGraphLogs = useMemo(() => {
    if (selectedCompareEmployees.length === 0) return [];
    const empSet = new Set(selectedCompareEmployees);
    let list = logs.filter((log) => empSet.has(getEmployeeName(log)));
    if (typeFilter !== "ALL") {
      list = list.filter((log) => log.callType === typeFilter);
    }
    const { start, end } = chartDateRange;
    list = list.filter((log) => {
      if (!log.timestamp) return false;
      const t = new Date(log.timestamp).getTime();
      return t >= start.getTime() && t <= end.getTime();
    });
    const unique: any[] = [];
    const sorted = [...list].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    sorted.forEach((log) => {
      if (!log.timestamp) {
        unique.push(log);
        return;
      }
      const logTime = new Date(log.timestamp).getTime();
      const emp = getEmployeeName(log);
      const isDup = unique.some((ex) => {
        if (ex.phoneNumber !== log.phoneNumber || ex.callType !== log.callType || getEmployeeName(ex) !== emp) return false;
        return Math.abs(new Date(ex.timestamp).getTime() - logTime) < 300000 && Math.abs(ex.duration - log.duration) <= 30;
      });
      if (!isDup) unique.push(log);
    });
    return unique;
  }, [logs, selectedCompareEmployees, chartDateRange, typeFilter]);

  // Single-graph: grouped bars (one bar per employee per slot), each bar stacked by incoming/outgoing/missed. By hour.
  const singleGraphChartDataByHour = useMemo(() => {
    const empKeys = selectedCompareEmployees;
    if (empKeys.length === 0) return [];
    const base = timeBuckets.map((b) => {
      const row: Record<string, string | number> = { timeRange: b.label, hour: b.hour };
      empKeys.forEach((e) => {
        row[`${e}_incoming`] = 0;
        row[`${e}_outgoing`] = 0;
        row[`${e}_missed`] = 0;
      });
      return row;
    });
    singleGraphLogs.forEach((log) => {
      const date = new Date(log.timestamp);
      if (isNaN(date.getTime())) return;
      const hour = date.getHours();
      const bucket = base[hour];
      if (!bucket) return;
      const emp = getEmployeeName(log);
      if (!empKeys.includes(emp)) return;
      const key = log.callType === "INCOMING" ? `${emp}_incoming` : log.callType === "OUTGOING" ? `${emp}_outgoing` : `${emp}_missed`;
      if (typeof bucket[key] === "number") (bucket[key] as number) += 1;
    });
    return base.filter((b) =>
      empKeys.some((e) => ((b[`${e}_incoming`] as number) || 0) + ((b[`${e}_outgoing`] as number) || 0) + ((b[`${e}_missed`] as number) || 0) > 0)
    );
  }, [singleGraphLogs, timeBuckets, selectedCompareEmployees]);

  // Single-graph: by date (one group per day in range, e.g. "10 Mar", "11 Mar", ...)
  const singleGraphChartDataByDate = useMemo(() => {
    const empKeys = selectedCompareEmployees;
    const { days } = chartDateRange;
    if (empKeys.length === 0 || days.length === 0) return [];
    const base = days.map((d) => {
      const row: Record<string, string | number> = { timeRange: d.label, dayIndex: d.dayIndex, dateTs: d.dateTs };
      empKeys.forEach((e) => {
        row[`${e}_incoming`] = 0;
        row[`${e}_outgoing`] = 0;
        row[`${e}_missed`] = 0;
      });
      return row;
    });
    singleGraphLogs.forEach((log) => {
      const logDate = new Date(log.timestamp);
      if (isNaN(logDate.getTime())) return;
      const logDayStart = startOfDay(logDate).getTime();
      const row = base.find((b) => b.dateTs === logDayStart);
      if (!row) return;
      const emp = getEmployeeName(log);
      if (!empKeys.includes(emp)) return;
      const key = log.callType === "INCOMING" ? `${emp}_incoming` : log.callType === "OUTGOING" ? `${emp}_outgoing` : `${emp}_missed`;
      if (typeof row[key] === "number") (row[key] as number) += 1;
    });
    return base;
  }, [singleGraphLogs, chartDateRange, selectedCompareEmployees]);

  const singleGraphChartData = compareXAxisMode === "date" ? singleGraphChartDataByDate : singleGraphChartDataByHour;

  // Compare chart: same call-type colors as rest of app (green/blue/red). Employees identified by initials on bars.
  const COMPARE_CALL_TYPE_COLORS = { incoming: "#22c55e", outgoing: "#3b82f6", missed: "#ef4444" };

  const getInitials = (name: string) =>
    name
      .split(/\s+/)
      .map((w) => w[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);

  const AnalyticsTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload || payload.length === 0) return null;
    const data = payload[0].payload;

    return (
      <div className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs shadow-lg">
        <div className="font-semibold text-slate-100 mb-1">{label}</div>
        <div className="space-y-0.5">
          <div className="flex items-center justify-between gap-4">
            <span className="text-slate-400">Incoming</span>
            <span className="font-medium text-emerald-400">{data.incoming}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-slate-400">Outgoing</span>
            <span className="font-medium text-sky-400">{data.outgoing}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-slate-400">Missed</span>
            <span className="font-medium text-rose-400">{data.missed}</span>
          </div>
          <div className="mt-1 flex items-center justify-between gap-4 border-t border-slate-800 pt-1.5">
            <span className="text-slate-400">Total</span>
            <span className="font-semibold text-slate-100">{data.total}</span>
          </div>
        </div>
      </div>
    );
  };

  const CompareTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload || payload.length === 0) return null;
    const items = payload.filter((p: any) => typeof p.dataKey === "string" && (p.dataKey.endsWith("_incoming") || p.dataKey.endsWith("_outgoing") || p.dataKey.endsWith("_missed")));
    const byEmployee: Record<string, { incoming: number; outgoing: number; missed: number }> = {};
    items.forEach((p: any) => {
      const key = String(p.dataKey);
      const emp = key.replace(/_incoming$|_outgoing$|_missed$/, "");
      if (!byEmployee[emp]) byEmployee[emp] = { incoming: 0, outgoing: 0, missed: 0 };
      if (key.endsWith("_incoming")) byEmployee[emp].incoming = Number(p.value);
      else if (key.endsWith("_outgoing")) byEmployee[emp].outgoing = Number(p.value);
      else byEmployee[emp].missed = Number(p.value);
    });
    return (
      <div className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs shadow-lg min-w-[180px]">
        <div className="font-semibold text-slate-100 mb-2">{label}</div>
        <div className="space-y-3">
          {Object.entries(byEmployee).map(([emp, { incoming, outgoing, missed }]) => {
            const total = incoming + outgoing + missed;
            return (
              <div key={emp} className="space-y-0.5">
                <div className="font-medium border-b border-slate-700 pb-0.5 text-slate-200">
                  {getInitials(emp)} — {emp}
                </div>
                <div className="flex justify-between gap-4 text-slate-400">
                  <span>Incoming</span>
                  <span className="font-medium text-slate-200">{incoming}</span>
                </div>
                <div className="flex justify-between gap-4 text-slate-400">
                  <span>Outgoing</span>
                  <span className="font-medium text-slate-200">{outgoing}</span>
                </div>
                <div className="flex justify-between gap-4 text-slate-400">
                  <span>Missed</span>
                  <span className="font-medium text-slate-200">{missed}</span>
                </div>
                <div className="flex justify-between gap-4 pt-0.5 border-t border-slate-800 text-slate-300">
                  <span>Total</span>
                  <span className="font-semibold">{total}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-5 relative">
      {/* Compact stats + FCM Wake button */}
      <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm text-slate-400">
        <span className="inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-900/60 px-3 py-1">
          <span className="font-medium text-slate-300">Total Calls:</span>
          <span className="text-slate-100 font-semibold">{totalCount}</span>
        </span>
        <span className="text-slate-600">|</span>
        <span className="inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-900/60 px-3 py-1">
          <span className="font-medium text-slate-300">Showing:</span>
          <span className="text-slate-100 font-semibold">{filteredLogs.length}</span>
        </span>

        {/* FCM Wake-Up button */}
        <div className="ml-auto flex items-center gap-2">
          {fcmWakeMsg && (
            <span className={cn(
              "text-xs px-2 py-1 rounded-full border flex items-center gap-1.5",
              fcmWakeState === "success"
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                : "border-rose-500/30 bg-rose-500/10 text-rose-400"
            )}>
              {fcmWakeState === "success"
                ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                : <XCircle className="w-3.5 h-3.5 shrink-0" />}
              {fcmWakeMsg}
            </span>
          )}
          <button
            id="fcm-wake-btn"
            onClick={triggerFcmWake}
            disabled={fcmWakeState === "loading"}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all duration-200",
              fcmWakeState === "loading"
                ? "bg-slate-800 border-slate-700 text-slate-500 cursor-not-allowed"
                : fcmWakeState === "success"
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                : fcmWakeState === "error"
                ? "bg-rose-500/10 border-rose-500/30 text-rose-400"
                : "bg-indigo-600/10 border-indigo-500/30 text-indigo-400 hover:bg-indigo-600/20 hover:border-indigo-400/50 hover:text-indigo-300"
            )}
          >
            {fcmWakeState === "loading" ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <BellRing className="w-3.5 h-3.5" />
            )}
            {fcmWakeState === "loading" ? "Sending..." : "Wake Devices"}
          </button>
        </div>
      </div>

      {/* Employee Filter Buttons */}
      <div className="relative z-10">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <User className="h-4 w-4 text-slate-400" />
            <span className="text-sm font-medium text-slate-400">Filter by Employee</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => {
                setSelectedEmployee("ALL");
                scrollToLogs();
              }}
              className={cn(
                "px-4 py-2 rounded-full text-xs font-semibold transition-all duration-200",
                selectedEmployee === "ALL"
                  ? "bg-indigo-600 text-white shadow-lg shadow-indigo-500/25 scale-105"
                  : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200"
              )}
            >
              All Employees
            </button>
            {employeeNames.length === 0 && isLoading ? (
              <div className="flex items-center gap-2 px-4 py-2">
                <Loader2 className="h-3 w-3 animate-spin text-slate-500" />
                <span className="text-xs text-slate-500">Loading...</span>
              </div>
            ) : (
              employeeNames.map((name) => (
                <button
                  key={name}
                  onClick={() => {
                    setSelectedEmployee(name);
                    scrollToLogs();
                  }}
                  className={cn(
                    "px-4 py-2 rounded-full text-xs font-semibold transition-all duration-200 flex items-center gap-2",
                    selectedEmployee === name
                      ? "bg-indigo-600 text-white shadow-lg shadow-indigo-500/25 scale-105"
                      : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200",
                    isLoading && "opacity-50 pointer-events-none"
                  )}
                >
                  <span
                    className={cn(
                      "w-2 h-2 rounded-full",
                      selectedEmployee === name ? "bg-white" : "bg-slate-600"
                    )}
                  />
                  {name}
                </button>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Global call/date filters (just under employee filter) */}
      <div className="relative z-10">
        <div className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 sm:px-4 sm:py-3">
          <div className="flex flex-col sm:flex-row gap-3 sm:justify-between">
            {/* Call Type */}
            <div className="flex gap-2 overflow-x-auto pb-1 sm:pb-0 flex-shrink-0">
              {["ALL", "INCOMING", "OUTGOING", "MISSED"].map((type) => (
                <button
                  key={type}
                  onClick={() => setTypeFilter(type)}
                  className={cn(
                    "px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors",
                    typeFilter === type
                      ? "bg-indigo-600 text-white"
                      : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200"
                  )}
                >
                  {type}
                </button>
              ))}
            </div>

            {/* Date Filters */}
            <div className="flex gap-2 overflow-x-auto pb-1 sm:pb-0 items-center">
              {["ALL", "TODAY", "YESTERDAY"].map((df) => (
                <button
                  key={df}
                  onClick={() => setDateFilter(df as any)}
                  className={cn(
                    "px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors",
                    dateFilter === df && dateFilter !== "CUSTOM"
                      ? "bg-emerald-600 text-white"
                      : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200"
                  )}
                >
                  {df === "ALL" ? "All Time" : df === "TODAY" ? "Today" : "Yesterday"}
                </button>
              ))}

              <Popover>
                <PopoverTrigger asChild>
                  <button
                    onClick={() => setDateFilter("CUSTOM")}
                    className={cn(
                      "flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors min-w-[110px]",
                      dateFilter === "CUSTOM"
                        ? "bg-emerald-600 text-white"
                        : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200"
                    )}
                  >
                    <CalendarIcon className="w-3 h-3" />
                    {dateFilter === "CUSTOM" && dateRange?.from ? (
                      dateRange.to ? (
                        <>
                          {format(dateRange.from, "MMM d")} – {format(dateRange.to, "MMM d")}
                        </>
                      ) : (
                        format(dateRange.from, "MMM d, y")
                      )
                    ) : (
                      "Custom Date"
                    )}
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0 border-slate-800 bg-slate-950" align="end">
                  <Calendar
                    initialFocus
                    mode="range"
                    defaultMonth={dateRange?.from}
                    selected={dateRange}
                    onSelect={(range) => {
                      setDateRange(range);
                      if (range?.from) setDateFilter("CUSTOM");
                    }}
                    numberOfMonths={1}
                    className="text-white bg-slate-950 border-slate-800"
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>
        </div>
      </div>

      {/* Call Activity Graph */}
      {!comparisonMode && (
      <Card className="bg-slate-900 border-slate-800 text-slate-100 relative z-10">
        <div className="p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-5">
            <div className="space-y-0.5">
              <p className="text-sm font-medium text-slate-200">Call Activity by Hour</p>
              <p className="text-xs text-slate-500">
                {selectedEmployee === "ALL" ? "All employees" : selectedEmployee} ·{" "}
                {chartData.length > 0 ? "Stacked by call type" : "No calls in selected range"}
              </p>
            </div>
            <button
              onClick={toggleComparisonMode}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200",
                comparisonMode
                  ? "bg-indigo-600 text-white shadow-lg shadow-indigo-500/25"
                  : "bg-slate-800 text-slate-300 hover:bg-indigo-600 hover:text-white"
              )}
            >
              <ArrowLeftRight className="w-3.5 h-3.5" />
              {comparisonMode ? "Exit Compare" : "Compare"}
            </button>
          </div>
          <div className="h-72 sm:h-96 min-h-[320px]">
            {isLoading && filteredLogs.length === 0 ? (
              <GraphSkeleton />
            ) : chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={chartData}
                  margin={{ top: 28, right: 0, left: -20, bottom: 88 }}
                  barCategoryGap="6%"
                >
                  <XAxis
                    dataKey="timeRange"
                    tickLine={false}
                    axisLine={{ stroke: "#1f2937" }}
                    tick={{ fill: "#9ca3af", fontSize: 10, textAnchor: "end" }}
                    interval={0}
                    angle={-45}
                  />
                  <YAxis
                    allowDecimals={false}
                    tickLine={false}
                    axisLine={{ stroke: "#1f2937" }}
                    tick={{ fill: "#9ca3af", fontSize: 10 }}
                    tickCount={10}
                  />
                  <RechartsTooltip content={<AnalyticsTooltip />} />
                  <Bar dataKey="incoming" stackId="calls" fill="#22c55e">
                    <LabelList
                      dataKey="incoming"
                      position="center"
                      fill="#fff"
                      fontSize={10}
                      fontWeight={600}
                      formatter={(value: any) => (value > 0 ? String(value) : "")}
                    />
                  </Bar>
                  <Bar dataKey="outgoing" stackId="calls" fill="#3b82f6">
                    <LabelList
                      dataKey="outgoing"
                      position="center"
                      fill="#fff"
                      fontSize={10}
                      fontWeight={600}
                      formatter={(value: any) => (value > 0 ? String(value) : "")}
                    />
                  </Bar>
                  <Bar dataKey="missed" stackId="calls" fill="#ef4444" radius={[4, 4, 0, 0]}>
                    <LabelList
                      dataKey="missed"
                      position="center"
                      fill="#fff"
                      fontSize={10}
                      fontWeight={600}
                      formatter={(value: any) => (value > 0 ? String(value) : "")}
                    />
                  </Bar>
                  <Line 
                    type="monotone" 
                    dataKey="total" 
                    stroke="transparent" 
                    activeDot={false} 
                    dot={(props: any) => {
                      const { cx, cy, payload } = props;
                      if (!payload || payload.total === 0) return null;
                      return (
                        <text x={cx} y={cy - 8} fill="#e2e8f0" fontSize={11} fontWeight={600} textAnchor="middle">
                          {payload.total}
                        </text>
                      );
                    }} 
                  />
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-slate-500">
                No call activity for the selected filters.
              </div>
            )}
          </div>
        </div>
      </Card>
      )}

      {/* Comparison Mode */}
      {comparisonMode && (
        <div className="space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <ArrowLeftRight className="w-4 h-4 text-indigo-400" />
                <span className="text-sm font-semibold text-slate-200">Comparison Mode</span>
                <span className="text-xs text-slate-500">
                  · {compareViewMode === "singleGraph" ? "Single graph" : `${comparisonPanels.length} panels`}
                </span>
                {/* View mode toggle */}
                <div className="flex rounded-full bg-slate-800 p-0.5">
                  <button
                    onClick={() => setCompareViewMode("singleGraph")}
                    className={cn(
                      "px-3 py-1 rounded-full text-xs font-medium transition-colors",
                      compareViewMode === "singleGraph"
                        ? "bg-indigo-600 text-white"
                        : "text-slate-400 hover:text-slate-200"
                    )}
                  >
                    Single graph
                  </button>
                  <button
                    onClick={() => setCompareViewMode("panels")}
                    className={cn(
                      "px-3 py-1 rounded-full text-xs font-medium transition-colors",
                      compareViewMode === "panels"
                        ? "bg-indigo-600 text-white"
                        : "text-slate-400 hover:text-slate-200"
                    )}
                  >
                    Panels
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {compareViewMode === "panels" && comparisonPanels.length < 4 && (
                  <button
                    onClick={addComparisonPanel}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Panel
                  </button>
                )}
                <button
                  onClick={toggleComparisonMode}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 border border-rose-500/20 transition-colors"
                >
                  Exit Compare
                </button>
              </div>
            </div>
          </div>

          {compareViewMode === "singleGraph" && (
            <Card className="bg-slate-900 border-slate-800 text-slate-100 relative z-10">
              <div className="p-4 sm:p-6 space-y-4">
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <User className="w-4 h-4 text-slate-400 shrink-0" />
                    <span className="text-xs sm:text-sm font-medium text-slate-400">Compare employees (same graph)</span>
                  </div>
                  <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2">
                    <div className="overflow-x-auto overflow-y-hidden pb-1 -mx-1 scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent" style={{ WebkitOverflowScrolling: "touch" }}>
                      <div className="flex gap-1.5 sm:gap-2 min-w-max sm:min-w-0 sm:flex-wrap">
                        {employeeNames.length === 0 && isLoading ? (
                          <span className="text-xs text-slate-500 py-2">Loading...</span>
                        ) : (
                          employeeNames.map((name) => {
                            const isSelected = selectedCompareEmployees.includes(name);
                            return (
                              <button
                                key={name}
                                onClick={() => {
                                  if (isSelected) {
                                    setSelectedCompareEmployees((prev) => prev.filter((n) => n !== name));
                                  } else {
                                    setSelectedCompareEmployees((prev) => [...prev, name].sort());
                                  }
                                }}
                                className={cn(
                                  "px-2 py-1 sm:py-1.5 rounded-full text-[11px] sm:text-xs font-medium transition-all border shrink-0",
                                  isSelected
                                    ? "bg-indigo-600 text-white border-indigo-500"
                                    : "bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700"
                                )}
                              >
                                {name}
                              </button>
                            );
                          })
                        )}
                      </div>
                    </div>
                    {selectedCompareEmployees.length > 0 && (
                      <span className="text-xs text-slate-500 shrink-0">
                        {selectedCompareEmployees.length} selected
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium text-slate-400">X-axis</span>
                  <div className="flex rounded-full bg-slate-800 p-0.5">
                    <button
                      type="button"
                      onClick={() => setCompareXAxisMode("hour")}
                      className={cn(
                        "px-3 py-1 rounded-full text-xs font-medium transition-colors",
                        compareXAxisMode === "hour" ? "bg-emerald-600 text-white" : "text-slate-400 hover:text-slate-200"
                      )}
                    >
                      By hour
                    </button>
                    <button
                      type="button"
                      onClick={() => setCompareXAxisMode("date")}
                      className={cn(
                        "px-3 py-1 rounded-full text-xs font-medium transition-colors",
                        compareXAxisMode === "date" ? "bg-emerald-600 text-white" : "text-slate-400 hover:text-slate-200"
                      )}
                    >
                      By date range
                    </button>
                  </div>
                  {compareXAxisMode === "date" && (
                    <span className="text-[11px] text-slate-500">
                      Use Custom Date above to pick range (e.g. 10 Mar – 15 Mar)
                    </span>
                  )}
                </div>

                <div className="min-h-[340px] h-[50vh] sm:h-[400px] sm:min-h-[360px] max-h-[520px]">
                  {selectedCompareEmployees.length === 0 ? (
                    <div className="flex h-full items-center justify-center text-sm text-slate-500">
                      Select one or more employees to compare in the same graph.
                    </div>
                  ) : singleGraphChartData.length === 0 ? (
                    <div className="flex h-full items-center justify-center text-sm text-slate-500">
                      No call activity for selected employees and date range.
                    </div>
                  ) : (
                    <div className="w-full h-full flex flex-col">
                      <p className="text-[11px] text-slate-500 mb-1 sm:hidden">Swipe horizontally to see all hours</p>
                      <div className="overflow-x-auto w-full flex-1 min-h-0" style={{ WebkitOverflowScrolling: "touch" }}>
                        <div className="h-full min-h-[300px] w-full" style={{ minWidth: Math.max(singleGraphChartData.length * (isDesktop ? 130 : 72), isDesktop ? 520 : 320) }}>
                          <ResponsiveContainer width="100%" height="100%" minHeight={300}>
                      <ComposedChart
                        data={singleGraphChartData}
                        margin={{ top: 32, right: 16, left: 8, bottom: 88 }}
                        barCategoryGap="8%"
                        barGap={0}
                      >
                        <XAxis
                          dataKey="timeRange"
                          tickLine={false}
                          axisLine={{ stroke: "#1f2937" }}
                          tick={{ fill: "#9ca3af", fontSize: 11, textAnchor: "end" }}
                          interval={0}
                          angle={-45}
                        />
                        <YAxis
                          allowDecimals={false}
                          tickLine={false}
                          axisLine={{ stroke: "#1f2937" }}
                          tick={{ fill: "#9ca3af", fontSize: 11 }}
                          tickCount={8}
                          width={28}
                        />
                        <RechartsTooltip content={<CompareTooltip />} />
                        {selectedCompareEmployees.flatMap((emp) => {
                          const initials = getInitials(emp);
                          return [
                            <Bar
                              key={`${emp}_incoming`}
                              dataKey={`${emp}_incoming`}
                              name="Incoming"
                              stackId={emp}
                              fill={COMPARE_CALL_TYPE_COLORS.incoming}
                              radius={[0, 0, 0, 0]}
                            >
                              <LabelList
                                dataKey={`${emp}_incoming`}
                                position="center"
                                fill="#fff"
                                fontSize={9}
                                fontWeight={600}
                                formatter={(value: any) => (value > 0 ? String(value) : "")}
                              />
                              <LabelList
                                dataKey={`${emp}_incoming`}
                                position="bottom"
                                content={(props: any) => {
                                  const payload = props.payload || {};
                                  const total =
                                    (Number(payload[`${emp}_incoming`]) || 0) +
                                    (Number(payload[`${emp}_outgoing`]) || 0) +
                                    (Number(payload[`${emp}_missed`]) || 0);
                                  if (total === 0) return null;
                                  const cx = (props.x || 0) + (props.width || 0) / 2;
                                  const y = (props.y || 0) + (props.height || 0);
                                  return (
                                    <text x={cx} y={y + 14} textAnchor="middle" fill="#f8fafc" fontSize={11} fontWeight={700}>
                                      {initials}
                                    </text>
                                  );
                                }}
                              />
                            </Bar>,
                            <Bar
                              key={`${emp}_outgoing`}
                              dataKey={`${emp}_outgoing`}
                              name="Outgoing"
                              stackId={emp}
                              fill={COMPARE_CALL_TYPE_COLORS.outgoing}
                              radius={[0, 0, 0, 0]}
                            >
                              <LabelList
                                dataKey={`${emp}_outgoing`}
                                position="center"
                                fill="#fff"
                                fontSize={9}
                                fontWeight={600}
                                formatter={(value: any) => (value > 0 ? String(value) : "")}
                              />
                            </Bar>,
                            <Bar
                              key={`${emp}_missed`}
                              dataKey={`${emp}_missed`}
                              name="Missed"
                              stackId={emp}
                              fill={COMPARE_CALL_TYPE_COLORS.missed}
                              radius={[4, 4, 0, 0]}
                            >
                              <LabelList
                                dataKey={`${emp}_missed`}
                                position="center"
                                fill="#fff"
                                fontSize={9}
                                fontWeight={600}
                                formatter={(value: any) => (value > 0 ? String(value) : "")}
                              />
                              <LabelList
                                dataKey={`${emp}_missed`}
                                position="top"
                                content={(props: any) => {
                                  const payload = props.payload || {};
                                  const total =
                                    (Number(payload[`${emp}_incoming`]) || 0) +
                                    (Number(payload[`${emp}_outgoing`]) || 0) +
                                    (Number(payload[`${emp}_missed`]) || 0);
                                  if (total === 0) return null;
                                  const cx = (props.x || 0) + (props.width || 0) / 2;
                                  const y = props.y ?? 0;
                                  return (
                                    <text x={cx} y={y - 6} textAnchor="middle" fill="#94a3b8" fontSize={11} fontWeight={600}>
                                      {total}
                                    </text>
                                  );
                                }}
                              />
                            </Bar>,
                          ];
                        })}
                      </ComposedChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                {selectedCompareEmployees.length > 0 && (
                  <div className="pt-3 border-t border-slate-800 space-y-3">
                    <div>
                      <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Employees (initials on bars)</div>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                        {selectedCompareEmployees.map((emp) => (
                          <div key={emp} className="flex items-center gap-1.5">
                            <span className="text-xs font-semibold text-slate-400">{getInitials(emp)}</span>
                            <span className="text-xs text-slate-300">= {emp}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Segment colors (call type)</div>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
                        <span className="flex items-center gap-1.5">
                          <span className="w-3 h-2 rounded-sm bg-emerald-500" />
                          Incoming
                        </span>
                        <span className="flex items-center gap-1.5">
                          <span className="w-3 h-2 rounded-sm bg-sky-500" />
                          Outgoing
                        </span>
                        <span className="flex items-center gap-1.5">
                          <span className="w-3 h-2 rounded-sm bg-rose-500" />
                          Missed
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </Card>
          )}

          {compareViewMode === "panels" && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {comparisonPanels.map((panel, index) => (
                <ComparisonPanel
                  key={panel.id}
                  panelIndex={index}
                  initialDateFilter={panel.dateFilter}
                  onRemove={() => removeComparisonPanel(panel.id)}
                  canRemove={comparisonPanels.length > 2}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Filters & Search */}
      <div ref={logsRef} className="scroll-mt-4">
      <Card className="bg-slate-900 border-slate-800 text-slate-100 relative z-10">
        <div className="p-3 sm:p-4 border-b border-slate-800 flex flex-col gap-3">
          {/* Search */}
          <div className="relative w-full">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
            <Input
              placeholder="Search by phone number..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 bg-slate-950 border-slate-700 text-white w-full"
            />
          </div>
        </div>

        {/* Desktop Table */}
        <div className="hidden sm:block relative min-h-[200px]">
          {isLoading && filteredLogs.length > 0 && (
            <div className="absolute inset-0 z-20 bg-slate-950/40 backdrop-blur-[1px] flex items-center justify-center rounded-b-xl border-t border-slate-800 transition-all duration-300">
              <div className="flex bg-slate-900 border border-slate-700 px-4 py-2.5 rounded-full shadow-xl items-center gap-3">
                <Loader2 className="w-4 h-4 animate-spin text-indigo-500" />
                <span className="text-sm font-medium text-slate-200">Updating results...</span>
              </div>
            </div>
          )}
          <Table>
            <TableHeader className="bg-slate-950/50">
              <TableRow className="border-slate-800 hover:bg-transparent">
                <TableHead className="text-slate-400">Employee</TableHead>
                <TableHead className="text-slate-400">Contact</TableHead>
                <TableHead className="text-slate-400">Identified</TableHead>
                <TableHead className="text-slate-400">Phone Number</TableHead>
                <TableHead className="text-slate-400">Type</TableHead>
                <TableHead className="text-slate-400">Duration</TableHead>
                <TableHead className="text-slate-400">Date & Time</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && filteredLogs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-32 text-center border-b-0">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto text-indigo-500" />
                  </TableCell>
                </TableRow>
              ) : filteredLogs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center text-slate-500 border-b-0">
                    No call logs found matching your filters.
                  </TableCell>
                </TableRow>
              ) : (
                filteredLogs.map((log: any) => (
                  <TableRow key={log._id} className="border-slate-800 hover:bg-slate-800/50">
                    <TableCell className="font-medium text-slate-300">
                      {getEmployeeName(log)}
                    </TableCell>
                    <TableCell className="text-slate-400">
                      <div className="flex flex-col gap-1 items-start">
                        <span>{log.contactName || "Unknown"}</span>
                        {/* Tags Display Desktop */}
                        {tags[log.phoneNumber] && tags[log.phoneNumber].length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-0.5">
                            {tags[log.phoneNumber].map((t: any, idx: number) => (
                              <button 
                                key={idx} 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedPhoneForTags(log.phoneNumber);
                                  setIsTagModalOpen(true);
                                }}
                                className="text-[10px] px-1.5 py-0 border border-slate-700 bg-slate-900/50 text-slate-400 hover:bg-slate-800 transition-colors rounded-full"
                              >
                                {t.name}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-slate-400">
                      <IdentifiedTag log={log} getEmployeeName={getEmployeeName} intelligenceTags={intelligenceTags} />
                    </TableCell>
                    <TableCell className="text-slate-300 font-mono text-sm">
                      {log.phoneNumber}
                    </TableCell>
                    <TableCell>
                      <CallTypeBadge callType={log.callType} />
                    </TableCell>
                    <TableCell className="text-slate-400">{formatDuration(log.duration)}</TableCell>
                    <TableCell className="text-slate-400">
                      {log.timestamp && !isNaN(new Date(log.timestamp).getTime())
                        ? format(new Date(log.timestamp), "MMM dd, yyyy HH:mm")
                        : "N/A"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Mobile Card List */}
        <div className="block sm:hidden relative min-h-[200px]">
          {isLoading && filteredLogs.length > 0 && (
            <div className="absolute inset-0 z-20 bg-slate-950/40 backdrop-blur-[1px] flex items-center justify-center rounded-b-xl border-t border-slate-800 transition-all duration-300">
              <div className="flex bg-slate-900 border border-slate-700 px-4 py-2.5 rounded-full shadow-xl items-center gap-3">
                <Loader2 className="w-4 h-4 animate-spin text-indigo-500" />
                <span className="text-sm font-medium text-slate-200">Updating...</span>
              </div>
            </div>
          )}
          {isLoading && filteredLogs.length === 0 ? (
            <div className="flex items-center justify-center h-48 border-t border-slate-800">
              <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="text-center text-slate-500 py-16 text-sm border-t border-slate-800">No call logs found matching your filters.</div>
          ) : (
            <div className="divide-y divide-slate-800/50 border-t border-slate-800/50">
              {filteredLogs.map((log: any) => {
                const employee = getEmployeeName(log);
                const displayContactName = log.contactName && log.contactName !== "Unknown" ? log.contactName : log.phoneNumber;
                const logTags = tags[log.phoneNumber] || [];
                const maxVisibleTags = 2;
                const visibleTags = logTags.slice(0, maxVisibleTags);
                const overflowTagCount = logTags.length - maxVisibleTags;
                const intelKey = `${log.phoneNumber}|${employee}`;
                const intelTag = intelligenceTags[intelKey];

                return (
                  <div key={log._id} className="p-2.5 hover:bg-slate-800/40 transition-colors w-full flex flex-col gap-1 min-h-0">
                    {/* Row 1: Contact · Employee (single line) + Badge + Duration */}
                    <div className="flex items-center justify-between gap-2 min-w-0">
                      <span className="text-sm font-semibold text-white truncate flex-1 min-w-0">
                        {displayContactName}
                        <span className="text-slate-500 font-normal"> · {employee}</span>
                      </span>
                      <span className="flex items-center gap-1.5 shrink-0">
                        <CallTypeBadge callType={log.callType} className="border-0 text-[10px] px-1.5 py-0.5 font-medium" />
                        <span className="text-[11px] text-slate-400 font-medium tabular-nums">{formatDuration(log.duration)}</span>
                      </span>
                    </div>
                    {/* Row 2: Phone + Date (single line) */}
                    <div className="flex items-center justify-between gap-2 min-w-0">
                      <span className="text-xs font-medium text-slate-300 font-mono truncate min-w-0">{log.phoneNumber}</span>
                      <span className="text-sm text-slate-400 shrink-0 font-medium">
                        {log.timestamp && !isNaN(new Date(log.timestamp).getTime())
                          ? format(new Date(log.timestamp), "MMM d · HH:mm")
                          : "N/A"}
                      </span>
                    </div>
                    {/* Identified: Scenario A category or Scenario B name */}
                    {(intelTag?.category || intelTag?.contactName) && (
                      <div className="flex flex-wrap gap-1">
                        {intelTag.category && (
                          <span
                            className={cn(
                              "inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border",
                              CATEGORY_COLORS[intelTag.category] ?? "bg-slate-700 text-slate-300 border-slate-600"
                            )}
                          >
                            {intelTag.category}
                          </span>
                        )}
                        {intelTag.contactName && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border bg-violet-500/15 text-violet-300 border-violet-500/30">
                            {intelTag.contactName}
                          </span>
                        )}
                      </div>
                    )}
                    {/* Row 3: Tags in one row, overflow as +N — tap to open tag modal */}
                    {logTags.length > 0 && (
                      <div className="flex items-center gap-1 overflow-hidden min-w-0">
                        <div className="flex items-center gap-1 min-w-0 overflow-hidden">
                          {visibleTags.map((t: any, idx: number) => (
                            <button
                              type="button"
                              key={idx}
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedPhoneForTags(log.phoneNumber);
                                setIsTagModalOpen(true);
                              }}
                              className="text-[10px] px-1.5 py-0.5 border border-slate-700 bg-slate-900/50 text-slate-400 hover:bg-slate-800 transition-colors rounded-full whitespace-nowrap shrink-0"
                            >
                              {t.name}
                            </button>
                          ))}
                          {overflowTagCount > 0 && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedPhoneForTags(log.phoneNumber);
                                setIsTagModalOpen(true);
                              }}
                              className="text-[10px] px-1.5 py-0.5 border border-slate-600 bg-slate-800/60 text-slate-400 hover:bg-slate-800 rounded-full shrink-0 font-medium"
                            >
                              +{overflowTagCount}
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer count */}
        {!isLoading && filteredLogs.length > 0 && (
          <div className="px-4 py-3 border-t border-slate-800 text-xs text-slate-500">
            Showing <span className="text-slate-300 font-medium">{filteredLogs.length}</span> record{filteredLogs.length !== 1 ? "s" : ""}
            {selectedEmployee !== "ALL" && (
              <> for <span className="text-indigo-400 font-medium">{selectedEmployee}</span></>
            )}
          </div>
        )}
      </Card>
      </div>

      {/* Info Modal for Mobile Views */}
      <Dialog open={isTagModalOpen} onOpenChange={setIsTagModalOpen}>
        <DialogContent className="max-w-sm rounded-2xl bg-slate-950 border-slate-800 mx-4 w-[calc(100%-2rem)]">
          <DialogHeader className="mb-2">
            <DialogTitle className="text-lg font-bold text-white flex items-center gap-2">
              <Info className="w-5 h-5 text-indigo-400" />
              Contact Tags
            </DialogTitle>
            <div className="text-sm text-slate-400 font-mono mt-1 tracking-tight">
              {selectedPhoneForTags}
            </div>
          </DialogHeader>
          
          <div className="flex flex-col px-1 pb-2">
            <div className="text-sm font-semibold text-slate-300 mb-3 uppercase tracking-widest text-[11px] opacity-80">
              Saved By Employees As
            </div>
            {selectedPhoneForTags && tags[selectedPhoneForTags] && tags[selectedPhoneForTags].length > 0 ? (
              <div className="space-y-4">
                {tags[selectedPhoneForTags].map((tag: any, i: number) => (
                  <div key={i} className="flex flex-col gap-1.5 bg-slate-900/40 p-3 rounded-xl border border-slate-800/50">
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                      <span className="text-sm font-bold text-slate-200">{tag.name}</span>
                    </div>
                    {tag.savedBy && tag.savedBy.length > 0 && (
                      <div className="pl-3.5 space-y-1 mt-1">
                        {tag.savedBy.map((sb: any, idx: number) => (
                          <div key={idx} className="flex items-center justify-between text-[11px]">
                            <span className="text-slate-400 flex items-center gap-1.5">
                              <User className="w-3 h-3 text-slate-500" />
                              {sb.employeeName}
                            </span>
                            {sb.timestamp && (
                              <span className="text-slate-500 font-mono tracking-tight">
                                {format(new Date(sb.timestamp), "MMM dd, yyyy")}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-slate-500 italic py-2 text-center">
                No tags found
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
