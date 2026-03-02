import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import ToggleLog from "@/models/ToggleLog";

// POST — called by the Android app (authenticated via X-API-Key)
// This mirrors the Express backend's /api/status endpoint so either server URL works.
export async function POST(req: Request) {
  try {
    const apiKey = req.headers.get("x-api-key");
    const expectedKey = process.env.API_KEY;
    if (expectedKey && apiKey !== expectedKey) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { deviceId, employeeName, status, timestamp } = body;

    if (!deviceId || !status) {
      return NextResponse.json(
        { error: "Missing required fields: deviceId, status" },
        { status: 400 }
      );
    }

    const normalizedStatus = String(status).toUpperCase();
    if (!["ON", "OFF"].includes(normalizedStatus)) {
      return NextResponse.json({ error: "status must be ON or OFF" }, { status: 400 });
    }

    await connectToDatabase();

    const toggleLog = await ToggleLog.create({
      deviceId,
      employeeName: employeeName || "Unknown",
      status: normalizedStatus,
      timestamp: timestamp ? new Date(Number(timestamp)) : new Date(),
    });

    console.log(`🔌 Toggle ${normalizedStatus} | ${employeeName} | ${deviceId}`);
    return NextResponse.json({ success: true, id: toggleLog._id }, { status: 201 });
  } catch (error) {
    console.error("Failed to save toggle log:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
