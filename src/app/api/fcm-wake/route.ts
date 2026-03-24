import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * FCM wake always runs on the Node/Express backend (firebase-service-account.json or
 * FIREBASE_SERVICE_ACCOUNT_JSON there). This route only proxies with session auth.
 */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const hours = parseInt(searchParams.get("hours") ?? "12", 10) || 12;
  const wakeAll =
    searchParams.get("all") === "1" || searchParams.get("all") === "true";

  const backendUrl = process.env.BACKEND_URL?.trim().replace(/\/$/, "");
  const apiKey = process.env.BACKEND_API_KEY ?? "";

  if (!backendUrl) {
    return NextResponse.json(
      {
        error:
          "Set BACKEND_URL to your Express API base URL (and BACKEND_API_KEY). FCM wake runs on the backend, which must have Firebase credentials (firebase-service-account.json or FIREBASE_SERVICE_ACCOUNT_JSON).",
      },
      { status: 500 }
    );
  }

  const selfOrigin = new URL(req.url).origin;
  if (new URL(backendUrl).origin === selfOrigin) {
    return NextResponse.json(
      {
        error:
          "BACKEND_URL must be your Express/Node server (e.g. Railway, Render, or http://localhost:3000), not this Next.js site — otherwise FCM wake would call itself.",
      },
      { status: 500 }
    );
  }

  try {
    const q = new URLSearchParams({ hours: String(hours) });
    if (wakeAll) q.set("all", "1");
    const res = await fetch(`${backendUrl}/api/fcm-wake?${q}`, {
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
            "Backend has no /api/fcm-wake — deploy the Express server with FCM support or fix BACKEND_URL (must point at Node, not the Next.js site).",
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
