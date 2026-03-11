import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/db";
import IntelligenceCheckpoint from "@/models/IntelligenceCheckpoint";
import IdentifiedContact from "@/models/IdentifiedContact";
import UnknownNumberTracker from "@/models/UnknownNumberTracker";

/**
 * POST /api/contact-intelligence/reset-checkpoint
 * Resets the intelligence checkpoint to "now" AND clears all identified contacts
 * and unknown number trackers, so the dashboard and bot start completely fresh.
 */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role === "driver") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await connectToDatabase();

  const now = new Date();

  // 1. Advance checkpoint so only future calls are processed
  await Promise.all([
    IntelligenceCheckpoint.findOneAndUpdate(
      { key: "process_cursor" },
      { lastProcessedAt: now },
      { upsert: true }
    ),
    IntelligenceCheckpoint.findOneAndUpdate(
      { key: "dashboard_cursor" },
      { lastProcessedAt: now },
      { upsert: true }
    )
  ]);

  // 2. Clear all intelligence state — identified contacts + unknown number trackers
  const [deletedIdentified, deletedTrackers] = await Promise.all([
    IdentifiedContact.deleteMany({}),
    UnknownNumberTracker.deleteMany({}),
  ]);

  return NextResponse.json({
    success: true,
    checkpoint: now.toISOString(),
    deletedIdentified: deletedIdentified.deletedCount,
    deletedTrackers: deletedTrackers.deletedCount,
  });
}
