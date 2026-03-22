import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/db";
import DeviceAppLog from "@/models/DeviceAppLog";
import DeviceCallLog from "@/models/DeviceCallLog";
import mongoose from "mongoose";

type LogEntry = { message?: string; recordedAt?: number };

/** POST — Android app (X-API-Key). Batch upload in-app log lines. */
export async function POST(req: Request) {
  try {
    const apiKey = req.headers.get("x-api-key");
    const expectedKey = process.env.API_KEY;
    if (expectedKey && apiKey !== expectedKey) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const deviceId = body.deviceId as string | undefined;
    const employeeName = (body.employeeName as string) || "Unknown";
    const entries = body.entries as LogEntry[] | undefined;

    if (!deviceId || !Array.isArray(entries) || entries.length === 0) {
      return NextResponse.json(
        { error: "Missing deviceId or entries array" },
        { status: 400 }
      );
    }

    const slice = entries.slice(0, 150);
    await connectToDatabase();

    let companyId: mongoose.Types.ObjectId | null = null;
    try {
      const last = await DeviceCallLog.findOne({ deviceId })
        .sort({ timestamp: -1 })
        .select("companyId")
        .lean();
      if (last && (last as any).companyId) {
        companyId = new mongoose.Types.ObjectId(String((last as any).companyId));
      }
    } catch {
      // optional stamp
    }

    const docs = slice
      .map((e) => {
        const message = typeof e.message === "string" ? e.message.trim() : "";
        if (!message) return null;
        const recordedAt =
          typeof e.recordedAt === "number" && !Number.isNaN(e.recordedAt)
            ? new Date(e.recordedAt)
            : new Date();
        return {
          deviceId,
          employeeName,
          message: message.slice(0, 8000),
          recordedAt,
          companyId: companyId ?? undefined,
        };
      })
      .filter(Boolean) as Record<string, unknown>[];

    if (docs.length === 0) {
      return NextResponse.json({ success: true, inserted: 0 });
    }

    await DeviceAppLog.insertMany(docs, { ordered: false });
    return NextResponse.json({ success: true, inserted: docs.length }, { status: 201 });
  } catch (error) {
    console.error("device-app-logs POST:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

/** GET — dashboard (session). */
export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.companyId && session?.user?.role !== "super_admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const limit = Math.min(parseInt(searchParams.get("limit") ?? "200", 10), 500);
    const deviceId = searchParams.get("deviceId");
    const employeeName = searchParams.get("employeeName");

    await connectToDatabase();

    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const andParts: Record<string, unknown>[] = [];
    if (deviceId) andParts.push({ deviceId });
    if (employeeName) {
      andParts.push({
        employeeName: new RegExp(`^${esc(employeeName)}$`, "i"),
      });
    }

    if (session.user.role !== "super_admin") {
      const companyObjectId = new mongoose.Types.ObjectId(session.user.companyId!);
      const deviceIds = await DeviceCallLog.distinct("deviceId", {
        companyId: companyObjectId,
      });
      const idStrings = (deviceIds as string[]).filter(
        (d) => typeof d === "string" && d.length > 0
      );
      andParts.push({
        $or: [
          { companyId: companyObjectId },
          ...(idStrings.length > 0 ? [{ deviceId: { $in: idStrings } }] : []),
        ],
      });
    }

    const query =
      andParts.length === 0
        ? {}
        : andParts.length === 1
          ? andParts[0]
          : { $and: andParts };

    const logs = await DeviceAppLog.find(query)
      .sort({ recordedAt: -1 })
      .limit(limit)
      .lean();

    return NextResponse.json(logs);
  } catch (error) {
    console.error("device-app-logs GET:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
