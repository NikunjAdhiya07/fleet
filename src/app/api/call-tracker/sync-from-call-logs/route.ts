import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import mongoose from "mongoose";

import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/db";
import CallLog from "@/models/CallLog";
import DeviceCallLog from "@/models/DeviceCallLog";
import EmployeeTelegram from "@/models/EmployeeTelegram";
import IdentifiedContact from "@/models/IdentifiedContact";
import { CALL_TRACKER_CATEGORIES, mergeCallTrackerFromSummaries } from "@/lib/callTrackerExcel";

export const runtime = "nodejs";

function normDigits(v: unknown) {
  return String(v ?? "").replace(/\D+/g, "");
}

async function buildCompanyScopedOrQuery(session: any) {
  if (session!.user.role === "super_admin") return undefined;

  const companyObjectId = session!.user.companyId
    ? new mongoose.Types.ObjectId(session!.user.companyId!)
    : null;

  const employeeMappings = await EmployeeTelegram.find().select("employeeName").lean();
  const employeeNames = employeeMappings
    .map((m: any) => m.employeeName)
    .filter((n: any) => typeof n === "string" && n.trim().length > 0);

  const or: any[] = [];
  if (companyObjectId) or.push({ companyId: companyObjectId });
  or.push({ companyId: { $exists: false } }, { companyId: null });
  if (employeeNames.length > 0) or.push({ employeeName: { $in: employeeNames } });
  return or;
}

async function aggregateCounts(model: any, match: any) {
  const res = await model
    .aggregate([
      { $match: match },
      { $group: { _id: "$phoneNumber", callCount: { $sum: 1 } } },
    ])
    .exec();
  return res as Array<{ _id: string; callCount: number }>;
}

async function aggregateLatestKnownNames(model: any, match: any) {
  const res = await model
    .aggregate([
      { $match: { ...match, contactName: { $exists: true, $ne: null, $nin: ["", "Unknown"] } } },
      { $sort: { timestamp: -1 } },
      { $group: { _id: "$phoneNumber", name: { $first: "$contactName" } } },
    ])
    .exec();
  return res as Array<{ _id: string; name: string }>;
}

function normalizeIdentifiedCategory(raw: unknown): string {
  const v = String(raw ?? "").trim();
  if (!v) return "";
  const lower = v.toLowerCase();
  if (lower === "personal") return "Personal";
  if (lower === "staff") return "Staff";
  if (lower === "courier") return "Courier";
  if (v === "Existing Client") return "Existing Client";
  if (v === "New Client") return "New Client";
  return "";
}

async function aggregateLatestIdentifiedByPhone(match: any) {
  // Take latest record per phoneNumber that has either contactName or category.
  const res = await IdentifiedContact.aggregate([
    { $match: match },
    { $sort: { updatedAt: -1, createdAt: -1 } },
    {
      $group: {
        _id: "$phoneNumber",
        name: { $first: "$contactName" },
        category: { $first: "$category" },
      },
    },
  ]).exec();
  return res as Array<{ _id: string; name?: string; category?: string }>;
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.companyId && session?.user?.role !== "super_admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    const body = await req.json().catch(() => ({}));
    const ignoredEmployees: string[] = Array.isArray(body?.ignoredEmployees)
      ? body.ignoredEmployees.filter((v: any) => typeof v === "string" && v.trim().length > 0)
      : [];

    await connectToDatabase();

    // Employee scope for IdentifiedContact (it doesn't have companyId).
    const employeeMappings = await EmployeeTelegram.find().select("employeeName").lean();
    const allowedEmployees = employeeMappings
      .map((m: any) => m.employeeName)
      .filter((n: any) => typeof n === "string" && n.trim().length > 0)
      .filter((n: string) => !ignoredEmployees.includes(n));

    const baseMatch: any = {};
    const or = await buildCompanyScopedOrQuery(session);
    if (or && or.length > 0) baseMatch.$or = or;
    if (startDate || endDate) {
      baseMatch.timestamp = {};
      if (startDate) baseMatch.timestamp.$gte = new Date(startDate);
      if (endDate) baseMatch.timestamp.$lte = new Date(endDate);
    }
    if (ignoredEmployees.length > 0) {
      // Exclude logs for ignored employees, but keep logs that have no employeeName set.
      baseMatch.$and = [
        ...(Array.isArray(baseMatch.$and) ? baseMatch.$and : []),
        { $or: [{ employeeName: { $exists: false } }, { employeeName: { $nin: ignoredEmployees } }] },
      ];
    }

    const identifiedMatch: any = {};
    if (allowedEmployees.length > 0) identifiedMatch.employeeName = { $in: allowedEmployees };

    const [mainCounts, devCounts, mainNames, devNames, identified] = await Promise.all([
      aggregateCounts(CallLog, baseMatch),
      aggregateCounts(DeviceCallLog, baseMatch),
      aggregateLatestKnownNames(CallLog, baseMatch),
      aggregateLatestKnownNames(DeviceCallLog, baseMatch),
      aggregateLatestIdentifiedByPhone(identifiedMatch),
    ]);

    const counts = new Map<string, number>();
    for (const r of mainCounts) counts.set(normDigits(r._id), (counts.get(normDigits(r._id)) ?? 0) + (r.callCount ?? 0));
    for (const r of devCounts) counts.set(normDigits(r._id), (counts.get(normDigits(r._id)) ?? 0) + (r.callCount ?? 0));

    const names = new Map<string, string>();
    // Prefer "main" names first, then device names if missing.
    for (const r of mainNames) {
      const m = normDigits(r._id);
      if (m && r.name) names.set(m, String(r.name));
    }
    for (const r of devNames) {
      const m = normDigits(r._id);
      if (m && r.name && !names.get(m)) names.set(m, String(r.name));
    }

    const categories = new Map<string, string>();
    for (const r of identified) {
      const m = normDigits(r._id);
      if (!m) continue;
      const nm = String(r.name ?? "").trim();
      if (nm && nm !== "Unknown" && !names.get(m)) names.set(m, nm);
      const cat = normalizeIdentifiedCategory(r.category);
      if (cat) categories.set(m, cat);
    }

    const summaries = Array.from(counts.entries())
      .filter(([m]) => Boolean(m))
      .map(([mobileNumber, callCount]) => ({
        mobileNumber,
        callCount,
        name: names.get(mobileNumber) ?? undefined,
        category: categories.get(mobileNumber) ?? undefined,
      }))
      .sort((a, b) => b.callCount - a.callCount);

    const mergedRows = await mergeCallTrackerFromSummaries(summaries);

    return NextResponse.json({
      success: true,
      imported: summaries.length,
      rows: mergedRows,
      categories: CALL_TRACKER_CATEGORIES,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Sync failed" }, { status: 500 });
  }
}

