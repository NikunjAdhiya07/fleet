import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/db";
import CallLog from "@/models/CallLog";
import mongoose from "mongoose";
import AnalyticsDashboard from "./AnalyticsDashboard";

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: { [key: string]: string | string[] | undefined };
}) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.companyId && session?.user?.role !== "super_admin") {
    return (
      <div className="flex h-full items-center justify-center text-slate-400">
        <div>Please assign a company to your admin account to view analytics.</div>
      </div>
    );
  }

  await connectToDatabase();

  // Determine date range
  const range = (searchParams?.range as string) || "today";
  const startParam = searchParams?.startDate as string | undefined;
  const endParam = searchParams?.endDate as string | undefined;
  let startDate: Date | null = null;
  let endDate: Date | null = null;
  const now = new Date();

  switch (range) {
    case "this_hour":
      startDate = new Date(now);
      startDate.setMinutes(0, 0, 0);
      endDate = new Date(now);
      endDate.setMinutes(59, 59, 999);
      break;
    case "today":
      startDate = new Date(now);
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date(now);
      endDate.setHours(23, 59, 59, 999);
      break;
    case "yesterday": {
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      startDate = new Date(yesterday);
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date(yesterday);
      endDate.setHours(23, 59, 59, 999);
      break;
    }
    case "last_7_days":
      endDate = new Date(now);
      endDate.setHours(23, 59, 59, 999);
      startDate = new Date(now);
      startDate.setDate(startDate.getDate() - 6);
      startDate.setHours(0, 0, 0, 0);
      break;
    case "last_30_days":
      endDate = new Date(now);
      endDate.setHours(23, 59, 59, 999);
      startDate = new Date(now);
      startDate.setDate(startDate.getDate() - 29);
      startDate.setHours(0, 0, 0, 0);
      break;
    case "this_week": {
      const day = now.getDay();
      const mondayOffset = day === 0 ? -6 : 1 - day;
      startDate = new Date(now);
      startDate.setDate(now.getDate() + mondayOffset);
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date(now);
      endDate.setHours(23, 59, 59, 999);
      break;
    }
    case "last_week": {
      const day = now.getDay();
      const mondayOffset = day === 0 ? -6 : 1 - day;
      startDate = new Date(now);
      startDate.setDate(now.getDate() + mondayOffset - 7);
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + 6);
      endDate.setHours(23, 59, 59, 999);
      break;
    }
    case "this_month":
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      break;
    case "last_month":
      startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      endDate = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
      break;
    case "custom":
      if (startParam && endParam) {
        startDate = new Date(startParam);
        endDate = new Date(endParam);
        endDate.setHours(23, 59, 59, 999);
      }
      break;
    case "all_time":
    default:
      // Leave null for all time
      break;
  }

  // Build company filter — super_admin sees everything
  const companyFilter: any = {};
  if (session?.user?.role !== "super_admin") {
    companyFilter.$or = [
      { companyId: new mongoose.Types.ObjectId(session!.user.companyId!) },
      { companyId: { $exists: false } },
    ];
  }

  const dateQuery = { ...companyFilter };
  if (startDate && endDate) {
    dateQuery.timestamp = { $gte: startDate, $lte: endDate };
  }
  
  const allTimeQuery = { ...companyFilter };

  // ── 0. ALL unique employee names who have EVER synced (for filter buttons) ──
  // Group by employeeName string (set on every modern CallLog record)
  const allEmployeesData = await CallLog.aggregate([
    { $match: allTimeQuery },
    {
      $group: {
        _id: "$employeeName",
      },
    },
    // Filter out null/empty names; we'll fall back to driverId lookup for those below
    { $match: { _id: { $ne: null } } },
    { $sort: { _id: 1 } },
  ]);

  // For records that had a null employeeName, resolve via Driver → User
  const nullNameDriversData = await CallLog.aggregate([
    { $match: { ...allTimeQuery, employeeName: null } },
    { $group: { _id: "$driverId" } },
    {
      $lookup: {
        from: "drivers",
        localField: "_id",
        foreignField: "_id",
        as: "driverInfo",
      },
    },
    {
      $lookup: {
        from: "users",
        localField: "driverInfo.userId",
        foreignField: "_id",
        as: "userInfo",
      },
    },
    {
      $project: {
        resolvedName: { $arrayElemAt: ["$userInfo.name", 0] },
      },
    },
    { $match: { resolvedName: { $ne: null } } },
    { $sort: { resolvedName: 1 } },
  ]);

  const allEmployeeNames = new Set<string>([
    ...allEmployeesData.map((e) => e._id as string),
    ...nullNameDriversData.map((e) => e.resolvedName as string),
  ]);

  const allEmployees = Array.from(allEmployeeNames)
    .filter(Boolean)
    .sort()
    .map((name) => ({ driverId: name, employeeName: name }));

  // ── 1. Employee Performance for CURRENT RANGE ──
  // Group by employeeName string (simplest correct approach)
  const employeeStatsData = await CallLog.aggregate([
    { $match: dateQuery },
    {
      $group: {
        _id: "$employeeName",
        driverId: { $first: "$driverId" },
        totalCalls: { $sum: 1 },
        totalDuration: { $sum: "$duration" },
        missedCalls: {
          $sum: { $cond: [{ $eq: ["$callType", "MISSED"] }, 1, 0] },
        },
      },
    },
  ]);

  // For records grouped with null employeeName, resolve name via driverId → Driver → User
  const resolvedStatsPromises = employeeStatsData.map(async (stat) => {
    let name = stat._id as string | null;
    if (!name && stat.driverId) {
      // Resolve via Driver → User join
      const resolved = await CallLog.aggregate([
        {
          $match: {
            ...dateQuery,
            driverId: stat.driverId,
            employeeName: null,
          },
        },
        { $limit: 1 },
        {
          $lookup: {
            from: "drivers",
            localField: "driverId",
            foreignField: "_id",
            as: "driverInfo",
          },
        },
        {
          $lookup: {
            from: "users",
            localField: "driverInfo.userId",
            foreignField: "_id",
            as: "userInfo",
          },
        },
        {
          $project: {
            resolvedName: { $arrayElemAt: ["$userInfo.name", 0] },
          },
        },
      ]);
      name = resolved[0]?.resolvedName || "Unknown";
    }
    return {
      driverId: name || "unknown",
      employeeName: name || "Unknown",
      totalCalls: stat.totalCalls as number,
      totalDuration: stat.totalDuration as number,
      avgDuration: stat.totalCalls > 0 ? stat.totalDuration / stat.totalCalls : 0,
      missedCalls: stat.missedCalls as number,
    };
  });

  const employeeStatsFromRange = (await Promise.all(resolvedStatsPromises)).filter(
    (e) => e.employeeName !== "Unknown" || e.totalCalls > 0
  );

  // Merge in employees who have synced before but made 0 calls in this range
  const rangeNames = new Set(employeeStatsFromRange.map((e) => e.driverId));
  const zeroStatEmployees = allEmployees
    .filter((e) => !rangeNames.has(e.driverId))
    .map((e) => ({
      driverId: e.driverId,
      employeeName: e.employeeName,
      totalCalls: 0,
      totalDuration: 0,
      avgDuration: 0,
      missedCalls: 0,
    }));

  const employeeStats = [...employeeStatsFromRange, ...zeroStatEmployees];

  // ── 2. Call Types Breakdown (Pie Chart) — current range ──
  const callTypesData = await CallLog.aggregate([
    { $match: dateQuery },
    { $group: { _id: "$callType", count: { $sum: 1 } } },
  ]);

  const callTypes = callTypesData.map((type) => ({
    name: type._id as string,
    value: type.count as number,
  }));

  // ── 3. Best Calling Time (Bar Chart) — current range ──
  const callTimeData = await CallLog.aggregate([
    { $match: dateQuery },
    {
      $project: {
        hour: { $hour: { date: "$timestamp", timezone: "+05:30" } },
        duration: 1,
      },
    },
    {
      $group: {
        _id: "$hour",
        calls: { $sum: 1 },
        totalDuration: { $sum: "$duration" },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  const bestCallTimes = callTimeData.map((slot) => {
    const h = slot._id as number;
    let label = h < 12 ? `${h} AM` : h === 12 ? "12 PM" : `${h - 12} PM`;
    return {
      timeSlot: label,
      calls: slot.calls as number,
      avgDuration: slot.calls > 0 ? slot.totalDuration / slot.calls : 0,
      hour: h,
    };
  });

  // ── 4. Repeat Caller / Lead Detection — current range ──
  const repeatCallersData = await CallLog.aggregate([
    { $match: dateQuery },
    {
      $group: {
        _id: "$phoneNumber",
        calls: { $sum: 1 },
        totalDuration: { $sum: "$duration" },
        contactName: { $first: "$contactName" },
      },
    },
    { $match: { calls: { $gte: 2 } } },
    { $sort: { calls: -1, totalDuration: -1 } },
    { $limit: 10 },
  ]);

  const repeatCallers = repeatCallersData.map((caller) => ({
    phoneNumber: caller._id as string,
    contactName: caller.contactName as string,
    calls: caller.calls as number,
    totalDuration: caller.totalDuration as number,
  }));

  // ── Missed call resolution: call-backed & client-called-back (within 24h) ──
  const missedResolutionByEmployee: Record<string, { callBacked: number; clientCalledBack: number; resolved: number }> = {};
  if (startDate && endDate) {
    const endDateExtended = new Date(endDate.getTime() + 24 * 60 * 60 * 1000);
    const dateQueryExtended = {
      ...companyFilter,
      timestamp: { $gte: startDate, $lte: endDateExtended },
    };
    const rawLogs = await CallLog.aggregate([
      { $match: dateQueryExtended },
      { $project: { driverId: 1, employeeName: 1, phoneNumber: 1, callType: 1, timestamp: 1 } },
      { $lookup: { from: "drivers", localField: "driverId", foreignField: "_id", as: "driver" } },
      { $unwind: { path: "$driver", preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: "users",
          localField: "driver.userId",
          foreignField: "_id",
          as: "user",
        },
      },
      {
        $project: {
          phoneNumber: 1,
          callType: 1,
          timestamp: 1,
          employeeName: {
            $ifNull: ["$employeeName", { $arrayElemAt: ["$user.name", 0] }],
          },
        },
      },
    ]);
    const allLogs = rawLogs.map((r: any) => ({
      phoneNumber: String(r.phoneNumber),
      employeeName: r.employeeName ? String(r.employeeName) : "Unknown",
      callType: r.callType,
      timestamp: new Date(r.timestamp),
    }));
    const missedInRange = allLogs.filter(
      (l) =>
        l.callType === "MISSED" &&
        l.timestamp >= startDate &&
        l.timestamp <= endDate
    );
    for (const missed of missedInRange) {
      const windowEnd = new Date(missed.timestamp.getTime() + 24 * 60 * 60 * 1000);
      const followUps = allLogs.filter(
        (l) =>
          l.phoneNumber === missed.phoneNumber &&
          l.employeeName === missed.employeeName &&
          l.timestamp > missed.timestamp &&
          l.timestamp <= windowEnd &&
          (l.callType === "OUTGOING" || l.callType === "INCOMING")
      );
      const callBacked = followUps.some((f) => f.callType === "OUTGOING");
      const clientCalledBack = followUps.some((f) => f.callType === "INCOMING");
      const resolved = callBacked || clientCalledBack;
      const name = missed.employeeName;
      if (!missedResolutionByEmployee[name]) {
        missedResolutionByEmployee[name] = { callBacked: 0, clientCalledBack: 0, resolved: 0 };
      }
      if (callBacked) missedResolutionByEmployee[name].callBacked += 1;
      if (clientCalledBack) missedResolutionByEmployee[name].clientCalledBack += 1;
      if (resolved) missedResolutionByEmployee[name].resolved += 1;
    }
  }

  // Merge resolution counts into employee stats
  const employeeStatsWithResolution = employeeStats.map((emp) => ({
    ...emp,
    callBacked: missedResolutionByEmployee[emp.employeeName]?.callBacked ?? 0,
    clientCalledBack: missedResolutionByEmployee[emp.employeeName]?.clientCalledBack ?? 0,
    resolvedMissed: missedResolutionByEmployee[emp.employeeName]?.resolved ?? 0,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-white mb-2">Analytics</h1>
        <p className="text-slate-400">Call insights and employee performance metrics</p>
      </div>

      <AnalyticsDashboard
        employeeStats={employeeStatsWithResolution}
        allEmployees={allEmployees}
        callTypes={callTypes}
        bestCallTimes={bestCallTimes}
        repeatCallers={repeatCallers}
        currentRange={range}
        missedResolutionComputed={!!(startDate && endDate)}
      />
    </div>
  );
}
