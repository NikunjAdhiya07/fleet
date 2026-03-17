import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/db";
import BotLog from "@/models/BotLog";

/**
 * POST /api/bot-log (from Android app — X-API-Key auth)
 * Creates a bot log entry when call sync keeps failing so admins see it in Bot Logs.
 */
export async function POST(req: Request) {
  const apiKey = req.headers.get("x-api-key");
  const expectedKey = process.env.API_KEY;
  if (expectedKey && apiKey !== expectedKey) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { deviceId, employeeName, level, step, message, data } = body;

    if (!step || !message) {
      return NextResponse.json(
        { error: "Missing required fields: step, message" },
        { status: 400 }
      );
    }

    const levelVal = ["info", "warn", "error", "success"].includes(level) ? level : "error";

    await connectToDatabase();
    const log = await BotLog.create({
      level: levelVal,
      step: String(step),
      message: String(message),
      data: data ?? null,
      employeeName: employeeName ?? null,
      phoneNumber: null,
    });

    console.log(`[BotLog][${levelVal.toUpperCase()}][${step}] ${message}`, { deviceId, employeeName });
    return NextResponse.json({ success: true, id: log._id }, { status: 201 });
  } catch (error) {
    console.error("Failed to create bot log:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

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
