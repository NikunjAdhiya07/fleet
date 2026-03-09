import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/db";
import CallLog from "@/models/CallLog";
import IdentifiedContact from "@/models/IdentifiedContact";
import UnknownNumberTracker from "@/models/UnknownNumberTracker";
import IntelligenceCheckpoint from "@/models/IntelligenceCheckpoint";
import { runContactIntelligence } from "@/lib/contactIntelligence";

export const maxDuration = 60;

export async function GET(req: Request) {
  // Support both manual dashboard triggers (via session) and automated Vercel Cron
  const session = await getServerSession(authOptions);
  const isCron = req.headers.get("Authorization") === `Bearer ${process.env.CRON_SECRET}`;

  if (!isCron && (!session || session.user.role === "driver")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await connectToDatabase();

    // ── 1. Get the last processed timestamp ──────────────────────────────────
    let checkpoint = await IntelligenceCheckpoint.findOne({ key: "main" });
    if (!checkpoint) {
      // First ever run — only process calls from the last 24 hours to avoid mass spam on first deploy
      checkpoint = await IntelligenceCheckpoint.create({
        key: "main",
        lastProcessedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      });
    }

    const since = checkpoint.lastProcessedAt;
    const runAt = new Date(); // Mark start time so we capture everything up to right now

    // ── 2. Find new calls since last checkpoint ───────────────────────────────
    const newCalls = await CallLog.find({
      createdAt: { $gt: since },
    })
      .sort({ createdAt: 1 })
      .lean();

    if (newCalls.length === 0) {
      return NextResponse.json({ success: true, processedCount: 0, message: "No new calls since last run." });
    }

    console.log(`[Intelligence Cron] Processing ${newCalls.length} new call(s) since ${since.toISOString()}`);

    let processedCount = 0;

    for (const call of newCalls) {
      const { phoneNumber, contactName, employeeName, deviceId } = call as any;

      if (!phoneNumber || !employeeName) continue;

      // Skip already fully processed (identified with category)
      const identified = await IdentifiedContact.findOne({ phoneNumber, employeeName });
      if (identified?.category && identified?.contactName) continue;

      // Skip if currently awaiting user input
      const tracker = await UnknownNumberTracker.findOne({ phoneNumber, employeeName });
      if (tracker && (tracker.status === "awaiting_name" || tracker.status === "awaiting_category")) continue;

      const resolvedName =
        contactName && contactName !== "Unknown" && contactName !== "" ? contactName : undefined;

      await runContactIntelligence(phoneNumber, resolvedName, employeeName, deviceId || "");
      processedCount++;
    }

    // ── 3. Advance checkpoint to the current time ─────────────────────────────
    await IntelligenceCheckpoint.updateOne({ key: "main" }, { lastProcessedAt: runAt });

    console.log(`[Intelligence Cron] Processed ${processedCount} contact(s). Checkpoint advanced to ${runAt.toISOString()}`);

    return NextResponse.json({ success: true, processedCount });
  } catch (error) {
    console.error("Failed to process intelligence:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
