"use client";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PhoneIncoming, PhoneOutgoing, PhoneMissed, Search, Loader2, Calendar as CalendarIcon, User, ArrowRight } from "lucide-react";
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
    // Avoid re-fetching tags unnecessarily
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

  // We should fetch tags once the page determines the filteredLogs that are visible.
  // Using an effect that triggers on filteredLogs changes ensures tags represent
  // what's visible, and avoids excessive repeated loading.
  
  // Derive unique employee names from logs
  const employeeNames = useMemo(() => {
    const names = new Set<string>();
    logs.forEach((log) => {
      const name = log.employeeName || log.driverId?.userId?.name;
      if (name) names.add(name);
    });
    return Array.from(names).sort();
  }, [logs]);

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

  return (
    <div className="space-y-5 relative">
      {/* Compact stats */}
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
                <TableHead className="text-slate-400">Phone Number</TableHead>
                <TableHead className="text-slate-400">Type</TableHead>
                <TableHead className="text-slate-400">Duration</TableHead>
                <TableHead className="text-slate-400">Date & Time</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && filteredLogs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-32 text-center border-b-0">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto text-indigo-500" />
                  </TableCell>
                </TableRow>
              ) : filteredLogs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-slate-500 border-b-0">
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
