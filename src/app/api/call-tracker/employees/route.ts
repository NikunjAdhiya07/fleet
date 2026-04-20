import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import mongoose from "mongoose";

import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/db";
import CallLog from "@/models/CallLog";
import DeviceCallLog from "@/models/DeviceCallLog";
import EmployeeTelegram from "@/models/EmployeeTelegram";

export const runtime = "nodejs";

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

async function distinctEmployeeNames(model: any, match: any) {
  const names = await model.distinct("employeeName", match);
  return (names as any[])
    .map((n) => String(n ?? "").trim())
    .filter((n) => n.length > 0 && n.toLowerCase() !== "unknown");
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.companyId && session?.user?.role !== "super_admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await connectToDatabase();

    const baseMatch: any = {};
    const or = await buildCompanyScopedOrQuery(session);
    if (or && or.length > 0) baseMatch.$or = or;

    const [main, dev] = await Promise.all([
      distinctEmployeeNames(CallLog, baseMatch),
      distinctEmployeeNames(DeviceCallLog, baseMatch),
    ]);

    const merged = Array.from(new Set([...main, ...dev])).sort((a, b) => a.localeCompare(b));
    return NextResponse.json({ employees: merged });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Failed to load employees" }, { status: 500 });
  }
}

