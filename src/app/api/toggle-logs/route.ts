import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/db";
import ToggleLog from "@/models/ToggleLog";

// POST — called by the Android app (authenticated via X-API-Key)
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
      return NextResponse.json({ error: "Missing required fields: deviceId, status" }, { status: 400 });
    }

    const normalizedStatus = String(status).toUpperCase();
    if (!["ON", "OFF", "PERMISSION_DENIED", "PERMISSION_RESTORED"].includes(normalizedStatus)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    await connectToDatabase();

    const toggleLog = await ToggleLog.create({
      deviceId,
      employeeName: employeeName || "Unknown",
      status: normalizedStatus,
      reason: body.reason,
      timestamp: timestamp ? new Date(Number(timestamp)) : new Date(),
    });

    console.log(`🔌 Toggle ${normalizedStatus} | ${employeeName} | ${deviceId}`);
    return NextResponse.json({ success: true, id: toggleLog._id }, { status: 201 });
  } catch (error) {
    console.error("Failed to save toggle log:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.companyId && session?.user?.role !== "super_admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const deviceId = searchParams.get("deviceId");
    const status = searchParams.get("status");

    const query: any = {};
    if (deviceId) {
      query.deviceId = deviceId;
    }
    if (status && status !== "ALL") {
      query.status = status;
    }

    await connectToDatabase();
    
    const logs = await ToggleLog.find(query)
      .sort({ timestamp: -1 })
      .limit(200);

    return NextResponse.json(logs);
  } catch (error) {
    console.error("Failed to fetch toggle logs:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
