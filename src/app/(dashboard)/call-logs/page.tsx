"use client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PhoneIncoming, PhoneOutgoing, PhoneMissed, Search, Loader2, Calendar as CalendarIcon, User } from "lucide-react";
import { format, subDays, startOfDay, endOfDay } from "date-fns";
import { useEffect, useState, useMemo, useRef } from "react";
import { cn } from "@/lib/utils";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DateRange } from "react-day-picker";

export default function CallLogsPage() {
  const [logs, setLogs] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [dateFilter, setDateFilter] = useState<"ALL" | "TODAY" | "YESTERDAY" | "CUSTOM">("ALL");
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [selectedEmployee, setSelectedEmployee] = useState<string>("ALL");
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
        setLogs(data);
      }
    } catch (error) {
      console.error("Failed to fetch call logs:", error);
    } finally {
      setIsLoading(false);
    }
  };

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
    log.employeeName || log.driverId?.userId?.name || "Unknown Employee";

  const filteredLogs = logs.filter((log) => {
    const matchesSearch =
      searchQuery === "" || log.phoneNumber.includes(searchQuery);
    const matchesEmployee =
      selectedEmployee === "ALL" || getEmployeeName(log) === selectedEmployee;
    return matchesSearch && matchesEmployee;
  });

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s}s`;
  };

  const CallTypeBadge = ({ callType }: { callType: string }) => {
    if (callType === "INCOMING")
      return (
        <Badge className="bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/20 gap-1">
          <PhoneIncoming className="w-3 h-3" /> Incoming
        </Badge>
      );
    if (callType === "OUTGOING")
      return (
        <Badge className="bg-sky-500/10 text-sky-400 hover:bg-sky-500/20 border border-sky-500/20 gap-1">
          <PhoneOutgoing className="w-3 h-3" /> Outgoing
        </Badge>
      );
    if (callType === "MISSED")
      return (
        <Badge className="bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 border border-rose-500/20 gap-1">
          <PhoneMissed className="w-3 h-3" /> Missed
        </Badge>
      );
    return null;
  };

  return (
    <div className="space-y-5 relative">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">Call Logs</h1>
      </div>

      {/* Stats Row */}
      <div className="grid gap-4 grid-cols-2 sm:grid-cols-4 relative z-10">
        <Card className="bg-slate-900 border-slate-800 text-slate-100 col-span-1">
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-slate-400">Total Calls</CardTitle>
          </CardHeader>
          <CardContent className="pb-4 px-4">
            <div className="text-2xl font-bold">{logs.length}</div>
          </CardContent>
        </Card>
        <Card className="bg-slate-900 border-slate-800 text-slate-100 col-span-1">
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-slate-400">Showing</CardTitle>
          </CardHeader>
          <CardContent className="pb-4 px-4">
            <div className="text-2xl font-bold">{filteredLogs.length}</div>
          </CardContent>
        </Card>
        <Card className="bg-slate-900 border-slate-800 text-slate-100 col-span-1">
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-slate-400">Employees</CardTitle>
          </CardHeader>
          <CardContent className="pb-4 px-4">
            <div className="text-2xl font-bold">{employeeNames.length}</div>
          </CardContent>
        </Card>
        <Card className="bg-slate-900 border-slate-800 text-slate-100 col-span-1">
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-slate-400">Viewing</CardTitle>
          </CardHeader>
          <CardContent className="pb-4 px-4">
            <div className="text-sm font-semibold text-indigo-400 truncate mt-1">
              {selectedEmployee === "ALL" ? "All Employees" : selectedEmployee}
            </div>
          </CardContent>
        </Card>
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
              onClick={() => { setSelectedEmployee("ALL"); scrollToLogs(); }}
              className={cn(
                "px-4 py-2 rounded-full text-xs font-semibold transition-all duration-200",
                selectedEmployee === "ALL"
                  ? "bg-indigo-600 text-white shadow-lg shadow-indigo-500/25 scale-105"
                  : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200"
              )}
            >
              All Employees
            </button>
            {isLoading ? (
              <div className="flex items-center gap-2 px-4 py-2">
                <Loader2 className="h-3 w-3 animate-spin text-slate-500" />
                <span className="text-xs text-slate-500">Loading...</span>
              </div>
            ) : (
              employeeNames.map((name) => (
                <button
                  key={name}
                  onClick={() => { setSelectedEmployee(name); scrollToLogs(); }}
                  className={cn(
                    "px-4 py-2 rounded-full text-xs font-semibold transition-all duration-200 flex items-center gap-2",
                    selectedEmployee === name
                      ? "bg-indigo-600 text-white shadow-lg shadow-indigo-500/25 scale-105"
                      : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200"
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

          {/* Call Type + Date Filters */}
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

        {/* Desktop Table */}
        <div className="hidden sm:block">
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
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto text-indigo-500" />
                  </TableCell>
                </TableRow>
              ) : filteredLogs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-slate-500">
                    No call logs found.
                  </TableCell>
                </TableRow>
              ) : (
                filteredLogs.map((log: any) => (
                  <TableRow key={log._id} className="border-slate-800 hover:bg-slate-800/50">
                    <TableCell className="font-medium text-slate-300">
                      {getEmployeeName(log)}
                    </TableCell>
                    <TableCell className="text-slate-400">
                      {log.contactName || "Unknown"}
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
        <div className="block sm:hidden">
          {isLoading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="text-center text-slate-500 py-12 text-sm">No call logs found.</div>
          ) : (
            <div className="divide-y divide-slate-800">
              {filteredLogs.map((log: any) => (
                <div key={log._id} className="p-4 hover:bg-slate-800/40 transition-colors">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div>
                      <div className="font-semibold text-slate-200 text-sm">
                        {getEmployeeName(log)}
                      </div>
                      <div className="text-slate-500 text-xs mt-0.5">
                        {log.contactName || "Unknown Contact"}
                      </div>
                    </div>
                    <CallTypeBadge callType={log.callType} />
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-slate-300 font-mono text-xs">{log.phoneNumber}</span>
                    <span className="text-slate-500 text-xs">{formatDuration(log.duration)}</span>
                  </div>
                  <div className="text-slate-600 text-xs mt-1.5">
                    {log.timestamp && !isNaN(new Date(log.timestamp).getTime())
                      ? format(new Date(log.timestamp), "MMM dd, yyyy • HH:mm")
                      : "N/A"}
                  </div>
                </div>
              ))}
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
    </div>
  );
}
