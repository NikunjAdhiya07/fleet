import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/db";
import EmployeeTelegram from "@/models/EmployeeTelegram";
import DeviceCallLog from "@/models/DeviceCallLog";
import CallLog from "@/models/CallLog";
import mongoose from "mongoose";

/**
 * GET — returns a merged list of:
 *   1. All employees from CallLog and DeviceCallLog (who have ever synced a call)
 *   2. All EmployeeTelegram records (admin-added with phone numbers)
 *
 * Each row has: employeeName, phoneNumber (if set), telegramChatId (if linked), registeredAt, _id (if saved)
 * Employees from call logs that are NOT in EmployeeTelegram appear with phoneNumber = null.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role === "driver") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await connectToDatabase();

  const query: any = {};
  if (session.user.role !== "super_admin") {
    query.companyId = new mongoose.Types.ObjectId(session.user.companyId!);
  }

  // 1. Get all unique employee names from DeviceCallLog
  const rawDeviceNames: string[] = await DeviceCallLog.distinct('employeeName', query);
  
  // 2. Get all unique employee names from CallLog
  const rawCallLogNames: string[] = await CallLog.distinct('employeeName', query);

  // Also resolve null employeeNames in CallLog via driverId -> User name
  const aggregationQuery: any[] = [];
  if (session.user.role !== "super_admin") {
    aggregationQuery.push({ $match: { companyId: new mongoose.Types.ObjectId(session.user.companyId!) } });
  }
  aggregationQuery.push(
    { $match: { employeeName: null } },
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
    { $sort: { resolvedName: 1 } }
  );

  const nullNameDriversData = await CallLog.aggregate(aggregationQuery);

  const resolvedNames = nullNameDriversData.map(e => e.resolvedName as string);

  // Merge all names and remove empty/null or just whitespace
  const allNamesList = [...rawDeviceNames, ...rawCallLogNames, ...resolvedNames];
  const callLogNames = new Set(
    allNamesList.filter((n) => n && n.trim() !== '')
  );

  // 3. Get all EmployeeTelegram records
  const telegramRecords = await EmployeeTelegram.find().sort({ employeeName: 1 }).lean() as any[];
  const telegramByName = new Map(telegramRecords.map((r) => [r.employeeName, r]));

  // 4. Merge: start with call log employees, overlay telegram data if exists
  const result: any[] = [];

  for (const name of Array.from(callLogNames).sort()) {
    const tRec = telegramByName.get(name);
    if (tRec) {
      result.push({
        _id: tRec._id.toString(),
        employeeName: tRec.employeeName,
        phoneNumber: tRec.phoneNumber,
        telegramChatId: tRec.telegramChatId ?? null,
        registeredAt: tRec.registeredAt ?? null,
        source: "both",
      });
    } else {
      result.push({
        _id: null,
        employeeName: name,
        phoneNumber: null,
        telegramChatId: null,
        registeredAt: null,
        source: "call_log_only",
      });
    }
  }

  // 5. Also include any EmployeeTelegram records that are NOT in call logs (manually added)
  for (const tRec of telegramRecords) {
    if (!callLogNames.has(tRec.employeeName)) {
      result.push({
        _id: tRec._id.toString(),
        employeeName: tRec.employeeName,
        phoneNumber: tRec.phoneNumber,
        telegramChatId: tRec.telegramChatId ?? null,
        registeredAt: tRec.registeredAt ?? null,
        source: "manual_only",
      });
    }
  }

  return NextResponse.json(result);
}

/** POST — add or update an employee's phone number */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role === "driver") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { employeeName, phoneNumber } = body;
  if (!employeeName || !phoneNumber) {
    return NextResponse.json(
      { error: "employeeName and phoneNumber are required" },
      { status: 400 }
    );
  }

  await connectToDatabase();

  const digits = phoneNumber.replace(/\D/g, "").slice(-10);
  if (digits.length < 10) {
    return NextResponse.json({ error: "Invalid phone number — need at least 10 digits" }, { status: 400 });
  }

  // Upsert — create or update phone number (reset telegram link only if changing number)
  const companyId = session.user.role === "super_admin" ? (body as any).companyId : session.user.companyId;
  const existing = await EmployeeTelegram.findOne({ employeeName });
  let mapping;
  if (existing) {
    const numberChanged = existing.phoneNumber !== digits;
    existing.phoneNumber = digits;
    if (numberChanged) {
      existing.telegramChatId = null;
      existing.registeredAt = null;
    }
    // Update companyId if it was missing (for migration)
    if (!existing.companyId && companyId) {
      existing.companyId = new mongoose.Types.ObjectId(companyId);
    }
    mapping = await existing.save();
  } else {
    if (!companyId) {
      return NextResponse.json({ error: "companyId is required for new employees" }, { status: 400 });
    }
    mapping = await EmployeeTelegram.create({
      employeeName,
      phoneNumber: digits,
      telegramChatId: null,
      registeredAt: null,
      companyId: new mongoose.Types.ObjectId(companyId),
    });
  }

  return NextResponse.json(mapping, { status: 201 });
}

/** PATCH — unlink Telegram (keep employee + phone, clear chatId) */
export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role === "driver") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  await connectToDatabase();
  const updated = await EmployeeTelegram.findByIdAndUpdate(
    id,
    { $set: { telegramChatId: null, registeredAt: null } },
    { new: true }
  );
  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(updated);
}

/** DELETE — remove an EmployeeTelegram record entirely */
export async function DELETE(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role === "driver") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  await connectToDatabase();
  await EmployeeTelegram.findByIdAndDelete(id);
  return NextResponse.json({ success: true });
}
