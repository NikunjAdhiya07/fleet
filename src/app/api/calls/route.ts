import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import DeviceCallLog from "@/models/DeviceCallLog";

// POST — called by the Android app (authenticated via X-API-Key)
export async function POST(req: Request) {
  try {
    const apiKey = req.headers.get("x-api-key");
    const expectedKey = process.env.API_KEY;
    if (expectedKey && apiKey !== expectedKey) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { phoneNumber, contactName, callType, duration, timestamp, deviceId, employeeName } = body;

    const missingFields: string[] = [];
    if (!phoneNumber) missingFields.push("phoneNumber");
    if (!callType) missingFields.push("callType");
    if (!deviceId) missingFields.push("deviceId");

    if (missingFields.length > 0) {
      return NextResponse.json(
        { error: `Missing or empty required fields: ${missingFields.join(", ")}` },
        { status: 400 }
      );
    }

    await connectToDatabase();

    const callLog = await DeviceCallLog.create({
      phoneNumber,
      contactName: contactName || "Unknown",
      callType: String(callType).toUpperCase(),
      duration: duration || 0,
      timestamp: timestamp ? new Date(Number(timestamp)) : new Date(),
      deviceId,
      employeeName: employeeName || "Unknown",
      syncedAt: new Date(),
    });

    console.log(`📞 ${callType} | ${employeeName} | ${phoneNumber} | ${duration}s`);
    return NextResponse.json({ success: true, id: callLog._id }, { status: 201 });
  } catch (error: any) {
    console.error("Failed to save call log:", error);
    // Ignore duplicate key errors gracefully
    if (error.code === 11000) {
      return NextResponse.json({ success: true, message: "Duplicate, skipped" }, { status: 200 });
    }
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
