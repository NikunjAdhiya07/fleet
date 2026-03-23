import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { runFcmWakeForStaleDevices } from "@/lib/fcmWakeServer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const hours = parseInt(searchParams.get("hours") ?? "12", 10) || 12;

  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim()) {
    try {
      const data = await runFcmWakeForStaleDevices(hours);
      return NextResponse.json(data);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[fcm-wake] direct FCM failed:", msg);
      return NextResponse.json(
        { error: `FCM wake failed: ${msg}` },
        { status: 500 }
      );
    }
  }

  const backendUrl = process.env.BACKEND_URL?.trim().replace(/\/$/, "");
  const apiKey = process.env.BACKEND_API_KEY ?? "";

  if (!backendUrl) {
    return NextResponse.json(
      {
        error:
          "Configure FIREBASE_SERVICE_ACCOUNT_JSON (recommended on Vercel) or BACKEND_URL for FCM wake.",
      },
      { status: 500 }
    );
  }

  try {
    const res = await fetch(`${backendUrl}/api/fcm-wake?hours=${hours}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
      },
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok && res.status === 404) {
      return NextResponse.json(
        {
          ...data,
          error:
            data.error ??
            "Backend returned 404 for /api/fcm-wake — set FIREBASE_SERVICE_ACCOUNT_JSON on this app to run wake from Vercel without the Node backend, or fix BACKEND_URL.",
        },
        { status: 502 }
      );
    }

    return NextResponse.json(data, { status: res.status });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Failed to reach backend: ${message}` },
      { status: 502 }
    );
  }
}
