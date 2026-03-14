"use client";

import { useMemo, useState, useEffect } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  Legend
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { PhoneCall, Clock, CheckCircle2, AlertCircle, PhoneIncoming, PhoneOutgoing, PhoneMissed, Phone, Flame, Trophy, LineChart, User, Calendar as CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DateRange } from "react-day-picker";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";

// --- Types ---
interface EmployeeStat {
  driverId: string;
  employeeName: string;
  totalCalls: number;
  totalDuration: number; // in seconds
  avgDuration: number; // in seconds
  missedCalls: number;
  callBacked?: number;      // missed calls that were called back (outgoing within 24h)
  clientCalledBack?: number; // missed calls where client called again and was received
  resolvedMissed?: number;   // missed calls resolved by either callback or client callback
}

interface CallType {
  name: string;
  value: number;
}

interface BestCallTime {
  timeSlot: string;
  calls: number;
  avgDuration: number;
  hour: number;
}

interface RepeatCaller {
  phoneNumber: string;
  contactName?: string;
  calls: number;
  totalDuration: number;
}

interface AllEmployee {
  driverId: string;
  employeeName: string;
}

interface AnalyticsDashboardProps {
  employeeStats: EmployeeStat[];
  allEmployees: AllEmployee[];
  callTypes: CallType[];
  bestCallTimes: BestCallTime[];
  repeatCallers: RepeatCaller[];
  currentRange: string;
  missedResolutionComputed?: boolean;
}

// Format duration helper (e.g., 65 -> 1m 5s)
const formatDuration = (seconds: number) => {
  if (!seconds) return "0s";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
};

// Colors for the pie chart
const PIE_COLORS = {
  INCOMING: "#3b82f6", // blue-500
  OUTGOING: "#10b981", // emerald-500
  MISSED: "#ef4444",   // red-500
};

// Goals
const DAILY_CALL_GOAL = 100;
const DAILY_TIME_GOAL = 2 * 3600; // 2 hours

export default function AnalyticsDashboard({
  employeeStats,
  allEmployees,
  callTypes,
  bestCallTimes,
  repeatCallers,
  currentRange,
  missedResolutionComputed = false,
}: AnalyticsDashboardProps) {
  
  const [selectedEmployee, setSelectedEmployee] = useState<string>("ALL");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const handleRangeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newRange = e.target.value;
    const params = new URLSearchParams(searchParams.toString());
    params.set("range", newRange);
    router.push(`${pathname}?${params.toString()}`);
  };

  const customStart = searchParams.get("startDate");
  const customEnd = searchParams.get("endDate");
  const [customDateRange, setCustomDateRange] = useState<DateRange | undefined>(() => {
    if (currentRange === "custom" && customStart && customEnd) {
      return { from: new Date(customStart), to: new Date(customEnd) };
    }
    return undefined;
  });
  const [customPickerOpen, setCustomPickerOpen] = useState(false);

  useEffect(() => {
    if (currentRange === "custom" && customStart && customEnd) {
      setCustomDateRange({ from: new Date(customStart), to: new Date(customEnd) });
    }
  }, [currentRange, customStart, customEnd]);

  const rangeLabel = useMemo(() => {
    if (currentRange === "custom" && customStart && customEnd) {
      try {
        const from = format(new Date(customStart), "MMM d, yyyy");
        const to = format(new Date(customEnd), "MMM d, yyyy");
        return from === to ? from : `${from} – ${to}`;
      } catch {
        return "Custom range";
      }
    }
    switch (currentRange) {
      case "this_hour": return "This Hour";
      case "today": return "Today";
      case "yesterday": return "Yesterday";
      case "last_7_days": return "Last 7 Days";
      case "last_30_days": return "Last 30 Days";
      case "this_week": return "This Week";
      case "last_week": return "Last Week";
      case "this_month": return "This Month";
      case "last_month": return "Last Month";
      case "custom": return "Custom range";
      case "all_time": return "All Time";
      default: return "Today";
    }
  }, [currentRange, customStart, customEnd]);

  // Derive unique employee names — prefer allEmployees (everyone in company) but fall back to stats-derived list
  const employeeNames = useMemo(() => {
    if (allEmployees && allEmployees.length > 0) {
      return Array.from(new Set(allEmployees.map(e => e.employeeName))).sort();
    }
    return Array.from(new Set(employeeStats.map(e => e.employeeName))).sort();
  }, [allEmployees, employeeStats]);

  // Aggregate Globals honoring the selected Employee
  const { totalCalls, totalTalkTime, activeEmployees, missedCalls } = useMemo(() => {
    let tCalls = 0;
    let tTalkTime = 0;
    let tMissed = 0;
    let aEmployees = 0;

    employeeStats.forEach(e => {
      if (selectedEmployee === "ALL" || e.employeeName === selectedEmployee) {
        if (e.totalCalls > 0) aEmployees++;
        tCalls += e.totalCalls;
        tTalkTime += e.totalDuration;
        tMissed += e.missedCalls;
      }
    });

    return { totalCalls: tCalls, totalTalkTime: tTalkTime, activeEmployees: aEmployees, missedCalls: tMissed };
  }, [employeeStats, selectedEmployee]);

  const avgDuration = totalCalls > 0 ? totalTalkTime / totalCalls : 0;
  const overallGoalCompletion = activeEmployees > 0 ? Math.min(100, Math.round((totalCalls / (activeEmployees * DAILY_CALL_GOAL)) * 100)) : 0;

  // Sorted Employee Leaderboard (Filtered)
  const leaderboard = useMemo(() => {
    let filtered = employeeStats;
    if (selectedEmployee !== "ALL") {
      filtered = employeeStats.filter(e => e.employeeName === selectedEmployee);
    }
    return [...filtered].sort((a, b) => b.totalCalls - a.totalCalls);
  }, [employeeStats, selectedEmployee]);

  // Filtered stats for tables
  const filteredEmployeeStats = useMemo(() => {
    if (selectedEmployee === "ALL") return employeeStats;
    return employeeStats.filter(e => e.employeeName === selectedEmployee);
  }, [employeeStats, selectedEmployee]);

  // Marketing Insights Logic (Using unfiltered data usually best for insight panel unless explicitly stated, but we will leave it as is for now)
  const bestConvertingTime = [...bestCallTimes].sort((a, b) => b.avgDuration - a.avgDuration)[0];
  const outgoingCalls = callTypes.find(c => c.name === 'OUTGOING')?.value || 0;
  const incomingCalls = callTypes.find(c => c.name === 'INCOMING')?.value || 0;
  const repeatCallersCount = repeatCallers.length;

  return (
    <div className="space-y-6">

      {/* ── FILTERS ── */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col md:flex-row gap-6">
        {/* Employee Filter */}
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-3">
            <User className="h-4 w-4 text-slate-300" />
            <span className="text-sm font-bold text-slate-200">Filter Dashboard by Employee</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setSelectedEmployee("ALL")}
            className={cn(
              "px-4 py-2 rounded-full text-xs font-semibold transition-all duration-200",
              selectedEmployee === "ALL"
                ? "bg-indigo-600 text-white shadow-lg shadow-indigo-500/25 scale-105"
                : "bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white"
            )}
          >
            All Employees
          </button>
          {employeeNames.map((name) => (
            <button
              key={name}
              onClick={() => setSelectedEmployee(name)}
              className={cn(
                "px-4 py-2 rounded-full text-xs font-semibold transition-all duration-200 flex items-center gap-2",
                selectedEmployee === name
                  ? "bg-indigo-600 text-white shadow-lg shadow-indigo-500/25 scale-105"
                  : "bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white"
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
          ))}
        </div>
        </div>

        {/* Date Range Filter */}
        <div className="flex flex-col gap-3 min-w-0 sm:min-w-[240px]">
          <div className="flex items-center gap-2">
            <CalendarIcon className="h-4 w-4 text-slate-300 shrink-0" />
            <span className="text-sm font-bold text-slate-200">Date Range</span>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <select
              value={currentRange}
              onChange={(e) => {
                const v = e.target.value;
                const params = new URLSearchParams(searchParams.toString());
                if (v !== "custom") {
                  setCustomPickerOpen(false);
                  params.set("range", v);
                  params.delete("startDate");
                  params.delete("endDate");
                  router.push(`${pathname}?${params.toString()}`);
                } else {
                  params.set("range", "custom");
                  router.push(`${pathname}?${params.toString()}`);
                  setCustomPickerOpen(true);
                }
              }}
              className="flex-1 min-w-0 bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer font-medium"
            >
              <optgroup label="Quick">
                <option value="this_hour">This Hour</option>
                <option value="today">Today</option>
                <option value="yesterday">Yesterday</option>
              </optgroup>
              <optgroup label="Week">
                <option value="this_week">This Week</option>
                <option value="last_week">Last Week</option>
                <option value="last_7_days">Last 7 Days</option>
              </optgroup>
              <optgroup label="Month">
                <option value="this_month">This Month</option>
                <option value="last_month">Last Month</option>
                <option value="last_30_days">Last 30 Days</option>
              </optgroup>
              <optgroup label="Other">
                <option value="custom">Custom range…</option>
                <option value="all_time">All Time</option>
              </optgroup>
            </select>
            {currentRange === "custom" && (
              <Popover open={customPickerOpen} onOpenChange={setCustomPickerOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "justify-start text-left font-normal bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700 hover:text-white",
                      !customDateRange?.from && "text-slate-500"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {customDateRange?.from ? (
                      customDateRange.to ? (
                        <>
                          {format(customDateRange.from, "MMM d, yyyy")} – {format(customDateRange.to, "MMM d, yyyy")}
                        </>
                      ) : (
                        format(customDateRange.from, "MMM d, yyyy")
                      )
                    ) : (
                      "Pick dates"
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0 border-slate-800 bg-slate-950" align="end">
                  <Calendar
                    mode="range"
                    defaultMonth={customDateRange?.from ?? new Date()}
                    selected={customDateRange}
                    onSelect={setCustomDateRange}
                    numberOfMonths={2}
                    className="text-white border-0 rounded-lg"
                  />
                  <div className="flex items-center justify-end gap-2 p-3 border-t border-slate-800">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-slate-400 hover:text-white"
                      onClick={() => setCustomPickerOpen(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      className="bg-indigo-600 hover:bg-indigo-700"
                      disabled={!customDateRange?.from}
                      onClick={() => {
                        if (customDateRange?.from) {
                          const params = new URLSearchParams(searchParams.toString());
                          params.set("range", "custom");
                          params.set("startDate", customDateRange.from.toISOString().slice(0, 10));
                          params.set("endDate", (customDateRange.to ?? customDateRange.from).toISOString().slice(0, 10));
                          router.push(`${pathname}?${params.toString()}`);
                          setCustomPickerOpen(false);
                        }
                      }}
                    >
                      Apply
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>
            )}
          </div>
        </div>
      </div>
      
      {/* ── RECOMMENDED TOP CARDS (Globals) ── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-xs font-bold text-slate-300">Total Calls ({rangeLabel})</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="text-2xl font-bold flex items-center gap-2 text-white">
              <PhoneCall className="h-5 w-5 text-indigo-400" />
              {totalCalls}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-900 border-slate-800">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-xs font-bold text-slate-300">Total Talk Time</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="text-2xl font-bold flex items-center gap-2 text-white">
              <Clock className="h-5 w-5 text-emerald-400" />
              {formatDuration(totalTalkTime)}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-900 border-slate-800">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-xs font-bold text-slate-300">Avg Call Duration</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="text-2xl font-bold flex items-center gap-2 text-white">
              <CheckCircle2 className="h-5 w-5 text-amber-400" />
              {formatDuration(avgDuration)}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-900 border-slate-800">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-xs font-bold text-slate-300">Missed Calls</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="text-2xl font-bold flex items-center gap-2 text-white">
              <PhoneMissed className="h-5 w-5 text-rose-400" />
              {missedCalls}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-900 border-slate-800">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-xs font-bold text-slate-300">Active Employees</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="text-2xl font-bold flex items-center gap-2 text-white">
              <Trophy className="h-5 w-5 text-fuchsia-400" />
              {activeEmployees}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-900 border-slate-800">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-xs font-bold text-slate-300">Goal Progress</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="text-2xl font-bold flex items-center gap-2 text-white">
              <LineChart className="h-5 w-5 text-cyan-400" />
              {overallGoalCompletion}%
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* ── LEFT COLUMN ── */}
        <div className="xl:col-span-2 space-y-6">
          
          {/* 1. Employee Performance Dashboard */}
          <Card className="bg-slate-900 border-slate-800">
            <CardHeader>
              <CardTitle className="text-slate-100">1. Employee Performance</CardTitle>
              <CardDescription className="text-slate-400">Activity summary for {rangeLabel}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left text-slate-200">
                  <thead className="text-xs uppercase bg-slate-800 text-slate-300">
                    <tr>
                      <th className="px-4 py-3 rounded-tl-lg">Employee</th>
                      <th className="px-4 py-3">Calls</th>
                      <th className="px-4 py-3">Talk Time</th>
                      <th className="px-4 py-3">Avg Duration</th>
                      <th className="px-4 py-3 rounded-tr-lg">Missed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredEmployeeStats.map((emp) => (
                      <tr key={emp.driverId} className="border-b border-slate-800 hover:bg-slate-800/50">
                        <td className="px-4 py-3 font-medium text-white">{emp.employeeName}</td>
                        <td className="px-4 py-3 text-indigo-400 font-bold">{emp.totalCalls}</td>
                        <td className="px-4 py-3 text-slate-300">{formatDuration(emp.totalDuration)}</td>
                        <td className="px-4 py-3 text-slate-300">{formatDuration(emp.avgDuration)}</td>
                        <td className="px-4 py-3 text-rose-400 font-medium">{emp.missedCalls}</td>
                      </tr>
                    ))}
                    {filteredEmployeeStats.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-4 py-6 text-center text-slate-500">No data available.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* 2 & 3. Goals Tracking */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card className="bg-slate-900 border-slate-800">
              <CardHeader>
                <CardTitle className="text-slate-100">2. Call Count Goal</CardTitle>
                <CardDescription className="text-slate-400">Target: {DAILY_CALL_GOAL} calls/day</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {filteredEmployeeStats.map(emp => {
                  const progress = Math.min(100, Math.round((emp.totalCalls / DAILY_CALL_GOAL) * 100));
                  return (
                    <div key={emp.driverId} className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span className="font-bold text-white">{emp.employeeName}</span>
                        <span className="text-slate-300 font-medium">{emp.totalCalls} / {DAILY_CALL_GOAL} ({progress}%)</span>
                      </div>
                      <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden">
                        <div 
                          className={cn("h-full rounded-full transition-all duration-500", 
                            progress >= 90 ? "bg-emerald-500" : progress >= 60 ? "bg-amber-500" : "bg-rose-500")}
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            <Card className="bg-slate-900 border-slate-800">
              <CardHeader>
                <CardTitle className="text-slate-100">3. Talk Time Goal</CardTitle>
                <CardDescription className="text-slate-400">Target: {formatDuration(DAILY_TIME_GOAL)}/day</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {filteredEmployeeStats.map(emp => {
                  const progress = Math.min(100, Math.round((emp.totalDuration / DAILY_TIME_GOAL) * 100));
                  return (
                    <div key={emp.driverId} className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span className="font-bold text-white">{emp.employeeName}</span>
                        <span className="text-slate-300 font-medium">{formatDuration(emp.totalDuration)} / 2h ({progress}%)</span>
                      </div>
                      <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden">
                        <div 
                          className={cn("h-full rounded-full transition-all duration-500", 
                            progress >= 90 ? "bg-indigo-500" : progress >= 50 ? "bg-cyan-500" : "bg-slate-600")}
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </div>

          {/* 6. Best Calling Time */}
          <Card className="bg-slate-900 border-slate-800">
            <CardHeader>
              <CardTitle>6. Best Calling Time Analytics</CardTitle>
              <CardDescription>Call volume clustered by hour</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[250px] w-full mt-4">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={bestCallTimes} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                    <XAxis dataKey="timeSlot" stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
                    <RechartsTooltip 
                      contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', borderRadius: '8px', color: '#f8fafc' }}
                      itemStyle={{ color: '#818cf8' }}
                      cursor={{fill: '#1e293b', opacity: 0.4}}
                    />
                    <Bar dataKey="calls" fill="#6366f1" radius={[4, 4, 0, 0]} name="Total Calls" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* 8. Repeat Callers Table */}
          <Card className="bg-slate-900 border-slate-800">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>8. Repeat Caller / Lead Detection</CardTitle>
                <CardDescription>High-intent leads that called multiple times</CardDescription>
              </div>
              <Flame className="h-6 w-6 text-orange-500" />
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left text-slate-300">
                  <thead className="text-xs uppercase bg-slate-800 text-slate-400">
                    <tr>
                      <th className="px-4 py-3 rounded-tl-lg">Phone / Name</th>
                      <th className="px-4 py-3 text-center">Calls</th>
                      <th className="px-4 py-3 text-right rounded-tr-lg">Total Talk Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {repeatCallers.map((caller) => (
                      <tr key={caller.phoneNumber} className="border-b border-slate-800 hover:bg-slate-800/50">
                        <td className="px-4 py-3 font-medium text-white">
                          {caller.contactName || caller.phoneNumber}
                          {!caller.contactName && <div className="text-xs text-slate-500 mt-0.5">Unknown Contact</div>}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="inline-flex items-center justify-center bg-orange-500/10 text-orange-500 px-2.5 py-0.5 rounded-full font-bold">
                            {caller.calls}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">{formatDuration(caller.totalDuration)}</td>
                      </tr>
                    ))}
                    {repeatCallers.length === 0 && (
                      <tr><td colSpan={3} className="py-6 text-center text-slate-500">No repeat callers detected.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ── RIGHT COLUMN ── */}
        <div className="space-y-6">
          
          {/* 4. Call Type Breakdown */}
          <Card className="bg-slate-900 border-slate-800">
            <CardHeader>
              <CardTitle className="text-slate-100">4. Call Type Breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[200px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={callTypes}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={80}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {callTypes.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={PIE_COLORS[entry.name as keyof typeof PIE_COLORS] || '#8884d8'} />
                      ))}
                    </Pie>
                    <RechartsTooltip 
                      contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', borderRadius: '8px' }}
                      itemStyle={{ color: '#f8fafc' }}
                    />
                    <Legend 
                      verticalAlign="bottom" height={36} 
                      formatter={(value) => <span className="text-slate-100 font-medium text-sm">{value}</span>}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* 7. Missed Call Performance */}
          <Card className="bg-slate-900 border-slate-800">
            <CardHeader>
              <CardTitle className="text-slate-100">7. Missed Call Performance</CardTitle>
              <CardDescription className="text-slate-400">
                Missed calls and how many were resolved (call-backed or client called back within 24h)
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {filteredEmployeeStats.map(emp => {
                  const missRate = emp.totalCalls > 0 ? (emp.missedCalls / emp.totalCalls) * 100 : 0;
                  const callBacked = emp.callBacked ?? 0;
                  const clientCalledBack = emp.clientCalledBack ?? 0;
                  const resolvedMissed = emp.resolvedMissed ?? 0;
                  const unresolvedMissed = emp.missedCalls - resolvedMissed;
                  return (
                    <div key={'missed-' + emp.driverId} className="border-b border-slate-800 pb-3 last:border-0 last:pb-0">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-sm font-bold text-white">{emp.employeeName}</div>
                          <div className="text-xs text-slate-400 font-medium">{emp.missedCalls} Missed</div>
                        </div>
                        <div className={cn("text-sm font-bold", missRate > 10 ? "text-rose-500" : "text-emerald-500")}>
                          {missRate.toFixed(1)}% Rate
                        </div>
                      </div>
                      {missedResolutionComputed && emp.missedCalls > 0 && (
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                          {callBacked > 0 && (
                            <span className="text-emerald-400">Call-backed: {callBacked}</span>
                          )}
                          {clientCalledBack > 0 && (
                            <span className="text-sky-400">Client called back: {clientCalledBack}</span>
                          )}
                          {resolvedMissed > 0 && (
                            <span className="text-slate-300">Resolved: {resolvedMissed}</span>
                          )}
                          {unresolvedMissed > 0 && (
                            <span className="text-rose-400 font-medium">Unresolved: {unresolvedMissed}</span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                {filteredEmployeeStats.length === 0 && (
                  <div className="text-sm text-slate-500 text-center py-4">No data available.</div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* 9. Employee Leaderboard */}
          <Card className="bg-gradient-to-br from-indigo-900/40 to-slate-900 border-indigo-500/20">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-slate-100">
                <Trophy className="h-5 w-5 text-yellow-500" />
                9. Leaderboard
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {leaderboard.slice(0, 5).map((emp, index) => (
                  <div key={'lead-' + emp.driverId} className="flex items-center gap-4">
                    <div className={cn(
                      "w-8 h-8 rounded-full flex items-center justify-center font-bold shadow-sm",
                      index === 0 ? "bg-amber-400 text-amber-900 ring-2 ring-amber-400/30" :
                      index === 1 ? "bg-slate-300 text-slate-800 bg-opacity-90" :
                      index === 2 ? "bg-amber-700/80 text-amber-100" :
                      "bg-slate-700 text-slate-300"
                    )}>
                      {index + 1}
                    </div>
                    <div className="flex-1">
                      <div className="text-sm font-bold text-white">{emp.employeeName}</div>
                      <div className="text-xs text-slate-300 font-medium">{emp.totalCalls} calls • {formatDuration(emp.totalDuration)}</div>
                    </div>
                  </div>
                ))}
                {leaderboard.length === 0 && (
                  <div className="text-sm text-slate-500 text-center py-4">No data available.</div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* 10. Marketing Insights */}
          <Card className="bg-slate-900 border-slate-800">
            <CardHeader>
              <CardTitle className="text-emerald-400 flex items-center gap-2">
                <AlertCircle className="h-5 w-5" />
                10. Insights Panel
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3 text-sm text-slate-200">
                <li className="flex gap-2">
                  <span className="text-emerald-500 mt-0.5">•</span>
                  <span>
                    Calls during <b className="text-white">{bestConvertingTime?.timeSlot || "N/A"}</b> tend to last the longest, averaging <b className="text-white">{formatDuration(bestConvertingTime?.avgDuration || 0)}</b>. Consider scheduling campaigns then.
                  </span>
                </li>
                <li className="flex gap-2">
                  <span className="text-emerald-500 mt-0.5">•</span>
                  <span>
                    You have <b className="text-white">{outgoingCalls}</b> outgoing vs <b className="text-white">{incomingCalls}</b> incoming calls. {outgoingCalls > incomingCalls ? "Outreach is strong." : "High inbound traffic."}
                  </span>
                </li>
                <li className="flex gap-2">
                  <span className="text-emerald-500 mt-0.5">•</span>
                  <span>
                    Identified <b className="text-white">{repeatCallersCount}</b> leads as repeat callers. Engaging with them could boost conversions.
                  </span>
                </li>
              </ul>
            </CardContent>
          </Card>
          
        </div>
      </div>
    </div>
  );
}
