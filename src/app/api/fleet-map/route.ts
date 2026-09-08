import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/db";
import DeviceLocationState from "@/models/DeviceLocationState";
import { companyIdIn } from "@/lib/companyIdQuery";
import { vehicleLabel } from "@/lib/vehicleLabel";

export const dynamic = "force-dynamic";

/**
 * A driver-actionable explanation for a device that is not recording, or null
 * when nothing is wrong. Derived from what the phone reports about itself —
 * before the device sent heartbeats these fields were written once at session
 * start and always said "TRACKING", so they were not worth reading.
 */
function blockedReason(s: {
  trackingStatus?: string;
  gpsEnabled?: boolean;
  permissionStatus?: string;
}): string | null {
  if (s.permissionStatus === "DENIED" || s.trackingStatus === "PERMISSION_DENIED") {
    return "Location permission is off on the phone";
  }
  if (s.gpsEnabled === false || s.trackingStatus === "GPS_OFF") {
    return "Phone Location (GPS) is switched off";
  }
  if (s.trackingStatus === "BACKGROUND_DENIED" || s.permissionStatus === "FOREGROUND") {
    return "Location access is not set to \"Allow all the time\"";
  }
  if (s.trackingStatus === "NO_FIX") {
    return "App is running but getting no GPS fix";
  }
  if (s.trackingStatus === "IDLE") return "Route ended — press Start to resume";
  return null;
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.companyId && session?.user?.role !== "super_admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await connectToDatabase();

    const query: Record<string, unknown> = {};
    if (session.user.role !== "super_admin") {
      query.companyId = companyIdIn(session.user.companyId!);
    }

    const states = await DeviceLocationState.find(query).lean();

    const now = Date.now();
    const enriched = states.map((s: any) => {
      // Prefer GPS fix time over upload/heartbeat time so "Live" means the pin moved recently.
      const fixMs = s.lastRecordedAt
        ? new Date(s.lastRecordedAt).getTime()
        : s.lastReceivedAt
          ? new Date(s.lastReceivedAt).getTime()
          : null;
      const ageMinutes = fixMs != null ? (now - fixMs) / 60000 : null;
      let freshness: "fresh" | "stale" | "old" | "unavailable" = "unavailable";
      if (ageMinutes !== null) {
        if (ageMinutes < 3) freshness = "fresh";
        else if (ageMinutes < 15) freshness = "stale";
        else freshness = "old";
      }
      return {
        ...s,
        // Always a string (or undefined) — never the raw { id, registration } object.
        vehicle: vehicleLabel(s.vehicle),
        ageMinutes,
        freshness,
        // The device now heartbeats its real capability state, so a stale pin
        // can say *why* it is stale instead of leaving the operator to guess
        // between "parked", "no signal" and "location switched off".
        blockedReason: blockedReason(s),
      };
    });

    // Newest GPS fix first so active devices surface at the top of pickers.
    enriched.sort((a: any, b: any) => {
      const am = a.lastRecordedAt
        ? new Date(a.lastRecordedAt).getTime()
        : a.lastReceivedAt
          ? new Date(a.lastReceivedAt).getTime()
          : 0;
      const bm = b.lastRecordedAt
        ? new Date(b.lastRecordedAt).getTime()
        : b.lastReceivedAt
          ? new Date(b.lastReceivedAt).getTime()
          : 0;
      return bm - am;
    });

    return NextResponse.json(enriched);
  } catch (error) {
    console.error("GET /api/fleet-map error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
