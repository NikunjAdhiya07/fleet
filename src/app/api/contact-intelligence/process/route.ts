import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/db";
import DeviceCallLog from "@/models/DeviceCallLog";
import CallLog from "@/models/CallLog";
import IdentifiedContact from "@/models/IdentifiedContact";
import UnknownNumberTracker from "@/models/UnknownNumberTracker";
import EmployeeTelegram from "@/models/EmployeeTelegram";
import IntelligenceCheckpoint from "@/models/IntelligenceCheckpoint";
import { runContactIntelligence } from "@/lib/contactIntelligence";

export const maxDuration = 60;

/**
 * GET /api/contact-intelligence/process
 *
 * Runs two passes:
 *  Pass 1: Process new calls since the last checkpoint
 *  Pass 2: Retry any pending items (needs_category / threshold_reached)
 *          where the employee NOW has Telegram linked
 *
 * Called automatically by AutoProcessor every 10s and manually from dashboard.
 */
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  const apiKey = req.headers.get("x-api-key");
  const expectedKey = process.env.API_KEY || "change-this-key";

  const hasValidApiKey = apiKey && apiKey === expectedKey;
  const hasValidSession = session && session.user?.role !== "driver";
  const isAuthorized = hasValidApiKey || hasValidSession;

  if (!isAuthorized) {
    let reason: string;
    if (apiKey && apiKey !== expectedKey) {
      reason = "Invalid x-api-key (does not match API_KEY env)";
    } else if (session?.user?.role === "driver") {
      reason = "Session role is 'driver'; only non-driver users can call this endpoint";
    } else if (!apiKey && !session) {
      reason = "Missing x-api-key header and no session. Log in or send x-api-key.";
    } else {
      reason = "No valid x-api-key and no valid non-driver session.";
    }
    console.warn("[contact-intelligence/process] 401:", reason);
    return NextResponse.json({ error: "Unauthorized", message: reason }, { status: 401 });
  }

  try {
    await connectToDatabase();

    let processedCount = 0;

    // ── Pass 1: Process new calls since last checkpoint ───────────────────────
    let checkpoint = await IntelligenceCheckpoint.findOne({ key: "process_cursor" });
    if (!checkpoint) {
      checkpoint = await IntelligenceCheckpoint.create({
        key: "process_cursor",
        lastProcessedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      });
    }

    const since = checkpoint.lastProcessedAt;
    const runAt = new Date();

    const [newDeviceCalls, newDriverCalls] = await Promise.all([
      DeviceCallLog.find({ createdAt: { $gt: since } }).lean(),
      CallLog.find({ createdAt: { $gt: since } }).lean()
    ]);

    const newCalls = [...newDeviceCalls, ...newDriverCalls].sort(
      (a: any, b: any) => (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    );

    // Dedupe by (phoneNumber, employeeName) so one call in both DeviceCallLog and CallLog doesn't trigger two messages
    const seenKey = new Set<string>();
    for (const call of newCalls) {
      const { phoneNumber, contactName, employeeName, deviceId } = call as any;
      if (!phoneNumber || !employeeName) continue;
      const key = `${phoneNumber}|${employeeName}`;
      if (seenKey.has(key)) continue;
      seenKey.add(key);

      const identified = await IdentifiedContact.findOne({ phoneNumber, employeeName });
      if (identified?.category && identified?.contactName) continue;

      const tracker = await UnknownNumberTracker.findOne({ phoneNumber, employeeName });
      if (tracker && (tracker.status === "awaiting_name" || tracker.status === "awaiting_category")) continue;

      const resolvedName =
        contactName && contactName !== "Unknown" && contactName !== "" ? contactName : undefined;

      await runContactIntelligence(phoneNumber, resolvedName, employeeName, deviceId || "");
      processedCount++;
    }

    await IntelligenceCheckpoint.updateOne({ key: "process_cursor" }, { lastProcessedAt: runAt }, { upsert: true });

    // ── Pass 2: Retry pending items where employee now has Telegram ───────────
    // Build a set of employees that have a linked Telegram chatId
    const linkedEmployees = await EmployeeTelegram.find({
      telegramChatId: { $ne: null },
    }).select("employeeName").lean();
    const linkedNames = new Set(linkedEmployees.map((e: any) => e.employeeName));

    if (linkedNames.size > 0) {
      // 2a. Scenario A retries: IdentifiedContact with name but no category
      const pendingA = await IdentifiedContact.find({
        employeeName: { $in: Array.from(linkedNames) },
        contactName: { $exists: true, $ne: null },
        $or: [{ category: null }, { category: { $exists: false } }],
      }).lean();

      for (const contact of pendingA) {
        try {
          await runContactIntelligence(
            contact.phoneNumber,
            contact.contactName,
            contact.employeeName,
            (contact as any).deviceId || ""
          );
          processedCount++;
        } catch (e) {
          console.error(`[Retry] Scenario A failed for ${contact.phoneNumber}:`, e);
        }
      }

      // 2b. Scenario B retries: trackers at threshold in 'tracking', or 'awaiting_name' but message never sent (no telegramMessageId)
      const pendingB = await UnknownNumberTracker.find({
        employeeName: { $in: Array.from(linkedNames) },
        $or: [
          { status: "tracking", callCount: { $gte: 5 } },
          { status: "awaiting_name", telegramMessageId: null, nameRequestSentAt: null },
        ],
      }).lean();

      for (const tracker of pendingB) {
        try {
          const callLog = await DeviceCallLog.findOne({
            phoneNumber: tracker.phoneNumber,
            employeeName: tracker.employeeName,
          }).lean() as any;

          const resolvedName =
            callLog?.contactName && callLog.contactName !== "Unknown"
              ? callLog.contactName
              : undefined;

          await runContactIntelligence(
            tracker.phoneNumber,
            resolvedName,
            tracker.employeeName,
            tracker.deviceId || callLog?.deviceId || ""
          );
          processedCount++;
        } catch (e) {
          console.error(`[Retry] Scenario B failed for ${tracker.phoneNumber}:`, e);
        }
      }
    }

    return NextResponse.json({ success: true, processedCount });
  } catch (error) {
    console.error("Failed to process intelligence:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
