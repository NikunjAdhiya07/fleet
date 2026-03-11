import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/db";
import DeviceCallLog from "@/models/DeviceCallLog";
import CallLog from "@/models/CallLog";
import IdentifiedContact from "@/models/IdentifiedContact";
import UnknownNumberTracker from "@/models/UnknownNumberTracker";
import IntelligenceCheckpoint from "@/models/IntelligenceCheckpoint";
import { runContactIntelligence } from "@/lib/contactIntelligence";

export const maxDuration = 60;

/**
 * GET /api/contact-intelligence/process
 *
 * Manual trigger (dashboard button only). Processes all new calls since
 * the last checkpoint and runs contact intelligence on each.
 *
 * Note: Automated triggering happens inline in /api/calls when a call is received
 * from the Android app. This endpoint is only for catching any calls that may
 * have been missed (e.g., during downtime).
 */
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  const apiKey = req.headers.get("x-api-key");
  
  const expectedKey = process.env.API_KEY || "change-this-key";
  
  // Allow if valid API key OR if valid admin session
  const isAuthorized = 
    (apiKey && apiKey === expectedKey) || 
    (session && session.user.role !== "driver");

  if (!isAuthorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await connectToDatabase();

    // ── 1. Get the last processed timestamp ──────────────────────────────────
    let checkpoint = await IntelligenceCheckpoint.findOne({ key: "process_cursor" });
    if (!checkpoint) {
      // First ever run — only process calls from the last 24 hours to avoid mass spam on first deploy
      checkpoint = await IntelligenceCheckpoint.create({
        key: "process_cursor",
        lastProcessedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      });
    }

    const since = checkpoint.lastProcessedAt;
    const runAt = new Date(); // Mark start time so we capture everything up to right now

    // ── 2. Find new calls since last checkpoint ───────────────────────────────
    // We must check BOTH DeviceCallLog (Android app) and CallLog (Driver fleet app)
    const [newDeviceCalls, newDriverCalls] = await Promise.all([
      DeviceCallLog.find({ createdAt: { $gt: since } }).lean(),
      CallLog.find({ createdAt: { $gt: since } }).lean()
    ]);

    const newCalls = [...newDeviceCalls, ...newDriverCalls].sort(
      (a: any, b: any) => (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    );

    if (newCalls.length === 0) {
      return NextResponse.json({ success: true, processedCount: 0, message: "No new calls since last run." });
    }

    console.log(`[Intelligence Manual] Processing ${newCalls.length} new call(s) since ${since.toISOString()}`);

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
    await IntelligenceCheckpoint.updateOne({ key: "process_cursor" }, { lastProcessedAt: runAt }, { upsert: true });

    console.log(`[Intelligence Manual] Processed ${processedCount} contact(s). Checkpoint advanced to ${runAt.toISOString()}`);

    return NextResponse.json({ success: true, processedCount });
  } catch (error) {
    console.error("Failed to process intelligence:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
