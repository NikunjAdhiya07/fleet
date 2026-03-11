import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/db";
import BotLog from "@/models/BotLog";

/**
 * GET /api/bot-logs
 * Returns recent intelligence pipeline logs stored in MongoDB.
 * Useful on Vercel where stdout logs are not accessible.
 */
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role === "driver") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "100"), 500);

  await connectToDatabase();
  const logs = await BotLog.find({}).sort({ createdAt: -1 }).limit(limit).lean();

  return NextResponse.json(logs);
}

/**
 * DELETE /api/bot-logs
 * Clears all logs.
 */
export async function DELETE() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role === "driver") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await connectToDatabase();
  await BotLog.deleteMany({});
  return NextResponse.json({ success: true });
}
