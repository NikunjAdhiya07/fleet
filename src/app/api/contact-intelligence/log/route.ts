import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/db";
import DeviceCallLog from "@/models/DeviceCallLog";
import IdentifiedContact from "@/models/IdentifiedContact";
import UnknownNumberTracker from "@/models/UnknownNumberTracker";
import EmployeeTelegram from "@/models/EmployeeTelegram";

/**
 * GET /api/contact-intelligence/log
 *
 * Aggregates ALL unique (employeeName, phoneNumber) pairs from DeviceCallLog
 * and computes the intelligence status for each:
 *   - Scenario A: contactName is known (from phone contacts)
 *   - Scenario B: unknown number, tracked by call count
 *
 * Returns a combined status for the Bot Activity Log dashboard.
 */
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role === "driver") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const employeeFilter = searchParams.get("employee");

  await connectToDatabase();

  // ── 1. Aggregate unique (employeeName, phoneNumber) from DeviceCallLog ──
  const matchStage: any = {};
  if (employeeFilter && employeeFilter !== "ALL") {
    matchStage.employeeName = employeeFilter;
  }

  const aggregated = await DeviceCallLog.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: { employeeName: "$employeeName", phoneNumber: "$phoneNumber" },
        callCount: { $sum: 1 },
        // contactName from phone: use "Unknown" as sentinel for unknown contacts
        contactNames: { $addToSet: "$contactName" },
        callTypes: { $push: "$callType" },
        lastCall: { $max: "$timestamp" },
        firstCall: { $min: "$timestamp" },
        deviceId: { $first: "$deviceId" },
        totalDuration: { $sum: "$duration" },
        incomingCount: {
          $sum: { $cond: [{ $eq: ["$callType", "INCOMING"] }, 1, 0] },
        },
        outgoingCount: {
          $sum: { $cond: [{ $eq: ["$callType", "OUTGOING"] }, 1, 0] },
        },
        missedCount: {
          $sum: { $cond: [{ $eq: ["$callType", "MISSED"] }, 1, 0] },
        },
      },
    },
    { $sort: { lastCall: -1 } },
  ]);

  if (aggregated.length === 0) {
    return NextResponse.json({ logs: [], employees: [] });
  }

  // ── 2. Fetch all related records in bulk ──────────────────────────────────
  const allPhones = aggregated.map((r) => r._id.phoneNumber);
  const allEmployees = [...new Set(aggregated.map((r) => r._id.employeeName))];

  const [identifiedContacts, unknownTrackers, telegramEmployees] = await Promise.all([
    IdentifiedContact.find({
      phoneNumber: { $in: allPhones },
    }).lean(),
    UnknownNumberTracker.find({
      phoneNumber: { $in: allPhones },
    }).lean(),
    EmployeeTelegram.find({
      employeeName: { $in: allEmployees },
    }).lean(),
  ]);

  // Build lookup maps
  const identifiedMap = new Map<string, any>();
  for (const ic of identifiedContacts) {
    identifiedMap.set(`${ic.phoneNumber}|${ic.employeeName}`, ic);
  }

  const trackerMap = new Map<string, any>();
  for (const t of unknownTrackers) {
    trackerMap.set(`${t.phoneNumber}|${t.employeeName}`, t);
  }

  const telegramMap = new Map<string, boolean>();
  for (const te of telegramEmployees as any[]) {
    telegramMap.set(te.employeeName, !!te.telegramChatId);
  }

  // ── 3. Build the log entries ──────────────────────────────────────────────
  const logs = aggregated.map((agg) => {
    const phoneNumber: string = agg._id.phoneNumber;
    const employeeName: string = agg._id.employeeName;
    const key = `${phoneNumber}|${employeeName}`;

    // Determine the "best" contact name from phone contacts
    // If any entry has a non-Unknown name, the number is saved in phone contacts
    const knownName = agg.contactNames.find(
      (n: string) => n && n !== "Unknown" && n !== ""
    );
    const isInPhoneContacts = !!knownName;

    const identified = identifiedMap.get(key);
    const tracker = trackerMap.get(key);
    const hasTelegram = telegramMap.get(employeeName) ?? false;

    // ── Determine status ─────────────────────────────────────────────────
    let scenario: "A" | "B";
    let status: string;
    let actionNeeded: string;
    let messageSent: boolean = false;
    let contactName: string = knownName ?? identified?.contactName ?? "";
    let category: string = identified?.category ?? "";

    if (isInPhoneContacts) {
      // Scenario A — Known contact
      scenario = "A";
      if (identified?.category) {
        status = "done";
        actionNeeded = "None — fully classified ✅";
      } else if (identified && !identified.category) {
        status = "awaiting_category";
        actionNeeded = "Awaiting category selection from employee";
        messageSent = true;
      } else {
        status = "needs_category";
        actionNeeded = hasTelegram
          ? "Telegram message should be sent asking for category"
          : "⚠️ No Telegram linked — cannot send";
      }
    } else {
      // Scenario B — Unknown contact
      scenario = "B";
      if (identified?.category) {
        status = "done";
        actionNeeded = "None — fully identified and classified ✅";
      } else if (identified?.contactName && !identified?.category) {
        status = "awaiting_category";
        actionNeeded = "Name received — awaiting category selection";
        messageSent = true;
      } else if (tracker?.status === "awaiting_name") {
        status = "awaiting_name";
        actionNeeded = "Telegram sent — waiting for employee to reply with name";
        messageSent = true;
      } else if (agg.callCount >= 5) {
        status = "threshold_reached";
        actionNeeded = hasTelegram
          ? "5 calls reached — Telegram should trigger name request"
          : "⚠️ 5 calls reached but no Telegram linked for this employee";
      } else {
        status = "tracking";
        actionNeeded = `Tracking (${agg.callCount}/5 calls — ${5 - agg.callCount} more to trigger)`;
      }
    }

    return {
      employeeName,
      phoneNumber,
      contactName,
      category,
      scenario,
      status,
      actionNeeded,
      messageSent,
      callCount: agg.callCount,
      totalDuration: agg.totalDuration,
      incomingCount: agg.incomingCount,
      outgoingCount: agg.outgoingCount,
      missedCount: agg.missedCount,
      lastCall: agg.lastCall,
      firstCall: agg.firstCall,
      hasTelegram,
      trackerStatus: tracker?.status ?? null,
      identifiedAt: identified?.identifiedAt ?? null,
      savedInPhone: identified?.savedInPhone ?? false,
    };
  });

  return NextResponse.json({ logs, employees: allEmployees.sort() });
}
