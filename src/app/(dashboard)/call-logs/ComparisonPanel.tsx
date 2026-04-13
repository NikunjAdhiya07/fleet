"use client";

import { Card } from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { format, subDays, startOfDay, endOfDay } from "date-fns";
import { useEffect, useState, useMemo, useCallback } from "react";
import { cn } from "@/lib/utils";
import { DateRange } from "react-day-picker";
import {
  Calendar as CalendarIcon,
  X,
  Loader2,
  ChevronDown,
} from "lucide-react";
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  LabelList,
} from "recharts";

const PANEL_ACCENTS = [
  {
    bg: "bg-indigo-500",
    border: "border-t-indigo-500",
    label: "text-indigo-400",
    dot: "bg-indigo-500",
  },
  {
    bg: "bg-amber-500",
    border: "border-t-amber-500",
    label: "text-amber-400",
    dot: "bg-amber-500",
  },
  {
    bg: "bg-teal-500",
    border: "border-t-teal-500",
    label: "text-teal-400",
    dot: "bg-teal-500",
  },
  {
    bg: "bg-rose-500",
    border: "border-t-rose-500",
    label: "text-rose-400",
    dot: "bg-rose-500",
  },
];

interface ComparisonPanelProps {
  panelIndex: number;
  initialDateFilter?: "TODAY" | "YESTERDAY" | "CUSTOM";
  onRemove: () => void;
  canRemove: boolean;
}

export default function ComparisonPanel({
  panelIndex,
  initialDateFilter = "TODAY",
  onRemove,
  canRemove,
}: ComparisonPanelProps) {
  const [dateFilter, setDateFilter] = useState<
    "TODAY" | "YESTERDAY" | "CUSTOM"
  >(initialDateFilter);
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [employee, setEmployee] = useState("ALL");
  const [logs, setLogs] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const accent = PANEL_ACCENTS[panelIndex % PANEL_ACCENTS.length];
  const panelLabel = String.fromCharCode(65 + panelIndex);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const url = new URL("/api/call-logs", window.location.origin);
      let start: Date | null = null;
      let end: Date | null = null;

      if (dateFilter === "TODAY") {
        start = startOfDay(new Date());
        end = endOfDay(new Date());
      } else if (dateFilter === "YESTERDAY") {
        start = startOfDay(subDays(new Date(), 1));
        end = endOfDay(subDays(new Date(), 1));
      } else if (dateFilter === "CUSTOM" && dateRange?.from) {
        start = startOfDay(dateRange.from);
        end = dateRange.to
          ? endOfDay(dateRange.to)
          : endOfDay(dateRange.from);
      }

      if (start) url.searchParams.append("startDate", start.toISOString());
      if (end) url.searchParams.append("endDate", end.toISOString());

      const res = await fetch(url.toString());
      if (res.ok) {
        const data = await res.json();
        setLogs(Array.isArray(data) ? data : data.logs || []);
      }
    } catch (error) {
      console.error("Comparison fetch failed:", error);
    } finally {
      setIsLoading(false);
    }
  }, [dateFilter, dateRange]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const getEmployeeName = (log: any) =>
    log.employeeName || log.driverId?.userId?.name || "Unknown";

  const employeeNames = useMemo(() => {
    const names = new Set<string>();
    logs.forEach((log) => {
      const name = getEmployeeName(log);
      if (name && name !== "Unknown") names.add(name);
    });
    return Array.from(names).sort();
  }, [logs]);

  useEffect(() => {
    if (employee !== "ALL" && !employeeNames.includes(employee)) {
      setEmployee("ALL");
    }
  }, [employeeNames, employee]);

  const filteredLogs = useMemo(() => {
    let filtered = logs;
    if (employee !== "ALL") {
      filtered = filtered.filter(
        (log) => getEmployeeName(log) === employee
      );
    }
    const unique: any[] = [];
    const sorted = [...filtered].sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
    sorted.forEach((log) => {
      if (!log.timestamp) {
        unique.push(log);
        return;
      }
      const logTime = new Date(log.timestamp).getTime();
      const emp = getEmployeeName(log);
      const isDup = unique.some((ex) => {
        if (
          ex.phoneNumber !== log.phoneNumber ||
          ex.callType !== log.callType ||
          getEmployeeName(ex) !== emp
        )
          return false;
        return (
          Math.abs(new Date(ex.timestamp).getTime() - logTime) < 300000 &&
          Math.abs(ex.duration - log.duration) <= 30
        );
      });
      if (!isDup) unique.push(log);
    });
    return unique;
  }, [logs, employee]);

  const timeBuckets = useMemo(() => {
    const labels = [];
    for (let hour = 0; hour < 24; hour++) {
      const nextHour = (hour + 1) % 24;
      const fmtH = (h: number) =>
        `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "AM" : "PM"}`;
      labels.push({
        label: `${fmtH(hour)} – ${fmtH(nextHour)}`,
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
      const d = new Date(log.timestamp);
      if (isNaN(d.getTime())) return;
      const bucket = base[d.getHours()];
      if (!bucket) return;
      if (log.callType === "INCOMING") bucket.incoming++;
      else if (log.callType === "OUTGOING") bucket.outgoing++;
      else if (log.callType === "MISSED") bucket.missed++;
      bucket.total++;
    });
    return base.filter((b) => b.total > 0);
  }, [filteredLogs, timeBuckets]);

  const stats = useMemo(
    () => ({
      total: filteredLogs.length,
      incoming: filteredLogs.filter((l) => l.callType === "INCOMING").length,
      outgoing: filteredLogs.filter((l) => l.callType === "OUTGOING").length,
      missed: filteredLogs.filter((l) => l.callType === "MISSED").length,
      totalDuration: filteredLogs.reduce(
        (sum, l) => sum + (l.duration || 0),
        0
      ),
    }),
    [filteredLogs]
  );

  const formatTotalDuration = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  };

  const PanelTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const data = payload[0].payload;
    return (
      <div className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs shadow-lg">
        <div className="font-semibold text-slate-100 mb-1">{label}</div>
        <div className="space-y-0.5">
          <div className="flex justify-between gap-4">
            <span className="text-slate-400">Incoming</span>
            <span className="text-emerald-400 font-medium">
              {data.incoming}
            </span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-slate-400">Outgoing</span>
            <span className="text-sky-400 font-medium">{data.outgoing}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-slate-400">Missed</span>
            <span className="text-rose-400 font-medium">{data.missed}</span>
          </div>
          <div className="mt-1 flex justify-between gap-4 border-t border-slate-800 pt-1.5">
            <span className="text-slate-400">Total</span>
            <span className="text-slate-100 font-semibold">{data.total}</span>
          </div>
        </div>
      </div>
    );
  };

  const getDateLabel = () => {
    if (dateFilter === "TODAY") return "Today";
    if (dateFilter === "YESTERDAY") return "Yesterday";
    if (dateFilter === "CUSTOM" && dateRange?.from) {
      return dateRange.to
        ? `${format(dateRange.from, "MMM d")} – ${format(dateRange.to, "MMM d")}`
        : format(dateRange.from, "MMM d, y");
    }
    return "Select Date";
  };

  return (
    <Card
      className={cn(
        "bg-slate-900 border-slate-800 text-slate-100 overflow-hidden border-t-2",
        accent.border
      )}
    >
      <div className="p-4 space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={cn("w-2.5 h-2.5 rounded-full", accent.dot)} />
            <span className="text-sm font-bold text-slate-200">
              Panel {panelLabel}
            </span>
            <span className="text-slate-700">·</span>
            <span className={cn("text-xs font-medium", accent.label)}>
              {getDateLabel()}
            </span>
          </div>
          {canRemove && (
            <button
              onClick={onRemove}
              className="p-1 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-slate-800 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Compact filters */}
        <div className="flex flex-wrap gap-1.5 items-center">
          {(["TODAY", "YESTERDAY"] as const).map((df) => (
            <button
              key={df}
              onClick={() => setDateFilter(df)}
              className={cn(
                "px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors",
                dateFilter === df
                  ? "bg-emerald-600 text-white"
                  : "bg-slate-800 text-slate-400 hover:bg-slate-700"
              )}
            >
              {df === "TODAY" ? "Today" : "Yesterday"}
            </button>
          ))}

          <Popover>
            <PopoverTrigger asChild>
              <button
                onClick={() => setDateFilter("CUSTOM")}
                className={cn(
                  "flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors",
                  dateFilter === "CUSTOM"
                    ? "bg-emerald-600 text-white"
                    : "bg-slate-800 text-slate-400 hover:bg-slate-700"
                )}
              >
                <CalendarIcon className="w-3 h-3" />
                {dateFilter === "CUSTOM" && dateRange?.from
                  ? dateRange.to
                    ? `${format(dateRange.from, "MMM d")} – ${format(dateRange.to, "MMM d")}`
                    : format(dateRange.from, "MMM d")
                  : "Custom"}
              </button>
            </PopoverTrigger>
            <PopoverContent
              className="w-fit p-0 border-slate-800 bg-slate-950"
              align="start"
            >
              <Calendar
                initialFocus
                mode="range"
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

          <span className="text-slate-700 text-xs">|</span>

          {/* Employee dropdown */}
          <Popover>
            <PopoverTrigger asChild>
              <button className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors max-w-[150px]">
                <span className="truncate">
                  {employee === "ALL" ? "All Employees" : employee}
                </span>
                <ChevronDown className="w-3 h-3 shrink-0 text-slate-500" />
              </button>
            </PopoverTrigger>
            <PopoverContent
              className="w-48 p-1 border-slate-800 bg-slate-950"
              align="start"
            >
              <div className="max-h-48 overflow-y-auto space-y-0.5">
                <button
                  onClick={() => setEmployee("ALL")}
                  className={cn(
                    "w-full text-left px-3 py-1.5 rounded-md text-xs transition-colors",
                    employee === "ALL"
                      ? "bg-indigo-600 text-white"
                      : "text-slate-300 hover:bg-slate-800"
                  )}
                >
                  All Employees
                </button>
                {employeeNames.map((name) => (
                  <button
                    key={name}
                    onClick={() => setEmployee(name)}
                    className={cn(
                      "w-full text-left px-3 py-1.5 rounded-md text-xs transition-colors",
                      employee === name
                        ? "bg-indigo-600 text-white"
                        : "text-slate-300 hover:bg-slate-800"
                    )}
                  >
                    {name}
                  </button>
                ))}
                {employeeNames.length === 0 && (
                  <div className="px-3 py-2 text-xs text-slate-500 italic">
                    {isLoading ? "Loading..." : "No employees found"}
                  </div>
                )}
              </div>
            </PopoverContent>
          </Popover>
        </div>

        {/* Stats row */}
        <div className="flex flex-wrap gap-1.5 text-[11px]">
          <span className="px-2 py-0.5 rounded-full bg-slate-800/80 text-slate-300 font-semibold">
            {stats.total} calls
          </span>
          <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400">
            {stats.incoming} in
          </span>
          <span className="px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-400">
            {stats.outgoing} out
          </span>
          <span className="px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-400">
            {stats.missed} missed
          </span>
          <span className="px-2 py-0.5 rounded-full bg-slate-800/60 text-slate-400">
            {formatTotalDuration(stats.totalDuration)} talk time
          </span>
        </div>

        {/* Chart */}
        <div className="h-52 sm:h-60">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center h-full gap-2">
              <Loader2 className="w-5 h-5 animate-spin text-indigo-500" />
              <span className="text-[11px] text-slate-500">Loading data...</span>
            </div>
          ) : chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={chartData}
                margin={{ top: 20, right: 0, left: -24, bottom: 60 }}
                barCategoryGap="8%"
              >
                <XAxis
                  dataKey="timeRange"
                  tickLine={false}
                  axisLine={{ stroke: "#1f2937" }}
                  tick={{ fill: "#9ca3af", fontSize: 9 }}
                  interval={0}
                  angle={-45}
                  textAnchor="end"
                />
                <YAxis
                  allowDecimals={false}
                  tickLine={false}
                  axisLine={{ stroke: "#1f2937" }}
                  tick={{ fill: "#9ca3af", fontSize: 9 }}
                />
                <RechartsTooltip content={<PanelTooltip />} />
                <Bar dataKey="incoming" stackId="calls" fill="#22c55e">
                  <LabelList
                    dataKey="incoming"
                    position="center"
                    fill="#fff"
                    fontSize={9}
                    fontWeight={600}
                    formatter={(v: any) => (v > 0 ? String(v) : "")}
                  />
                </Bar>
                <Bar dataKey="outgoing" stackId="calls" fill="#3b82f6">
                  <LabelList
                    dataKey="outgoing"
                    position="center"
                    fill="#fff"
                    fontSize={9}
                    fontWeight={600}
                    formatter={(v: any) => (v > 0 ? String(v) : "")}
                  />
                </Bar>
                <Bar
                  dataKey="missed"
                  stackId="calls"
                  fill="#ef4444"
                  radius={[3, 3, 0, 0]}
                >
                  <LabelList
                    dataKey="missed"
                    position="center"
                    fill="#fff"
                    fontSize={9}
                    fontWeight={600}
                    formatter={(v: any) => (v > 0 ? String(v) : "")}
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
                      <text
                        x={cx}
                        y={cy - 6}
                        fill="#e2e8f0"
                        fontSize={10}
                        fontWeight={600}
                        textAnchor="middle"
                      >
                        {payload.total}
                      </text>
                    );
                  }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-slate-500">
              No call activity for selected filters.
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
