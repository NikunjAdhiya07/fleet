import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import { expireStaleLocationCommands } from "@/lib/locationCommands";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET/POST /api/cron/expire-location-commands
 *
 * Sweeps location commands the device never finished (stuck REQUESTED /
 * DELIVERED / UPLOADING) to EXPIRED. The fleet-map read path sweeps too, so
 * this is the backstop for when nobody has the map open. Secured with
 * CRON_SECRET like the other cron routes.
 */
export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const urlSecret = new URL(req.url).searchParams.get("secret");
  const headerSecret = bearer ?? req.headers.get("x-cron-secret") ?? urlSecret;

  if (cronSecret && headerSecret !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await connectToDatabase();
    const expired = await expireStaleLocationCommands();
    return NextResponse.json({ success: true, expired });
  } catch (error) {
    console.error("[expire-location-commands]", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  return GET(req);
}
