import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import Screenshot from "@/models/Screenshot";
import { uploadToBunny } from "@/lib/bunnycdn";

/**
 * POST /api/screenshots
 * Receives a raw JPEG body from the Android app, uploads to BunnyCDN,
 * and stores metadata in MongoDB.
 *
 * Headers:
 *   X-API-Key        – auth
 *   X-Device-Id      – device identifier
 *   X-Employee-Name  – employee name
 *   X-Timestamp      – capture timestamp (ms since epoch)
 *   Content-Type     – image/jpeg
 */
export async function POST(req: Request) {
  const apiKey = req.headers.get("x-api-key");
  const expectedKey = process.env.API_KEY;
  if (expectedKey && apiKey !== expectedKey) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const deviceId = req.headers.get("x-device-id") || "unknown";
    const employeeName = req.headers.get("x-employee-name") || "Unknown";
    const timestampStr = req.headers.get("x-timestamp");
    const timestamp = timestampStr ? new Date(Number(timestampStr)) : new Date();

    const arrayBuffer = await req.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.length === 0) {
      return NextResponse.json({ error: "Empty body" }, { status: 400 });
    }

    // Build a unique file path: screenshots/<deviceId>/<YYYY-MM-DD>/<timestamp>.jpg
    const dateStr = timestamp.toISOString().slice(0, 10);
    const fileName = `${timestamp.getTime()}_${deviceId}.jpg`;
    const storagePath = `screenshots/${deviceId}/${dateStr}/${fileName}`;

    const { cdnUrl } = await uploadToBunny(storagePath, buffer, "image/jpeg");

    await connectToDatabase();
    const doc = await Screenshot.create({
      deviceId,
      employeeName,
      timestamp,
      cdnUrl,
      fileSize: buffer.length,
    });

    console.log(
      `📸 Screenshot | ${employeeName} | ${deviceId} | ${(buffer.length / 1024).toFixed(0)}KB | ${cdnUrl}`
    );

    return NextResponse.json(
      { success: true, id: doc._id, cdnUrl },
      { status: 201 }
    );
  } catch (error: any) {
    console.error("Failed to save screenshot:", error?.message ?? error);
    return NextResponse.json(
      { error: "Internal Server Error", detail: error?.message },
      { status: 500 }
    );
  }
}
