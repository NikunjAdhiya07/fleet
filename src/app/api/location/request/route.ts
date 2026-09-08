import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/db";
import LocationCommand from "@/models/LocationCommand";
import {
  COMMAND_TIMEOUT_MS,
  expireStaleLocationCommands,
  getRecentLocationCommands,
} from "@/lib/locationCommands";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/location/request?minutes=60&deviceId=a,b
 *
 * Recent commands with their live status, so the fleet map can show a real
 * "waiting" vs "device not responding" state instead of a spinner that never
 * resolves. Stale pending commands are swept to EXPIRED on every read.
 */
export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.companyId && session?.user?.role !== "super_admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(req.url);
    const minutes = Math.min(Number(url.searchParams.get("minutes")) || 60, 24 * 60);
    const deviceIds = url.searchParams
      .get("deviceId")
      ?.split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    await connectToDatabase();
    const commands = await getRecentLocationCommands(minutes, deviceIds);

    return NextResponse.json({ commands, timeoutMs: COMMAND_TIMEOUT_MS });
  } catch (error) {
    console.error("GET /api/location/request error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.companyId && session?.user?.role !== "super_admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { deviceId, type, sessionId } = body;

    if (!deviceId || !type) {
      return NextResponse.json({ error: "deviceId and type are required" }, { status: 400 });
    }

    const validTypes = ["location_upload", "location_latest", "location_live_mode", "location_stop_live_mode", "location_start_tracking", "location_stop_tracking"];
    if (!validTypes.includes(type)) {
      return NextResponse.json({ error: "Invalid type" }, { status: 400 });
    }

    await connectToDatabase();

    // A new command supersedes whatever is still hanging for this device, so the
    // UI never mixes a fresh request with a dead one.
    await expireStaleLocationCommands([deviceId]);

    const expiresAt = new Date(Date.now() + COMMAND_TIMEOUT_MS);

    const command = await LocationCommand.create({
      deviceId,
      type,
      sessionId,
      status: "REQUESTED",
      expiresAt,
    });

    // Forward to Express backend for FCM delivery
    const backendUrl = process.env.BACKEND_URL?.trim().replace(/\/$/, "");
    const apiKey = process.env.BACKEND_API_KEY ?? "";

    if (backendUrl) {
      try {
        await fetch(`${backendUrl}/api/location/request-upload`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": apiKey,
          },
          body: JSON.stringify({ deviceId, type, sessionId, commandId: command._id }),
        });
      } catch {
        // Non-fatal — command is stored, device will poll
      }
    }

    return NextResponse.json(command, { status: 201 });
  } catch (error) {
    console.error("POST /api/location/request error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
