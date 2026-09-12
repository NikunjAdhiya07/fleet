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
      // Two separate clocks, deliberately. The GPS fix time says when the
      // vehicle last moved; the heartbeat says when we last heard from the
      // phone at all. Collapsing them is what let a parked vehicle read as
      // "Live" — the app used to store an invented fix every five minutes just
      // to keep this number moving. It no longer does, so a stopped vehicle has
      // a stale fix time and a fresh heartbeat, and that pair is what tells
      // "parked" apart from "we have lost this device".
      const fixMs = s.lastRecordedAt ? new Date(s.lastRecordedAt).getTime() : null;
      const heardMs = s.lastReceivedAt ? new Date(s.lastReceivedAt).getTime() : null;
      const ageMinutes = fixMs != null ? (now - fixMs) / 60000 : null;
      const heardMinutes = heardMs != null ? (now - heardMs) / 60000 : null;
      const reason = blockedReason(s);

      let freshness: "fresh" | "parked" | "stale" | "old" | "unavailable" = "unavailable";
      if (ageMinutes !== null && ageMinutes < 3) {
        freshness = "fresh";
      } else if (!reason && heardMinutes !== null && heardMinutes < 15) {
        // Phone is reporting in, the wheels just are not turning.
        freshness = "parked";
      } else if (ageMinutes !== null && ageMinutes < 15) {
        freshness = "stale";
      } else if (ageMinutes !== null || heardMinutes !== null) {
        freshness = "old";
      }
      return {
        ...s,
        // Always a string (or undefined) — never the raw { id, registration } object.
        vehicle: vehicleLabel(s.vehicle),
        ageMinutes,
        heardMinutes,
        freshness,
        // The device now heartbeats its real capability state, so a stale pin
        // can say *why* it is stale instead of leaving the operator to guess
        // between "parked", "no signal" and "location switched off".
        blockedReason: reason,
      };
    });

    // Most recently heard from first, so a parked-but-healthy device does not
    // sink below one we lost days ago just because its fix time is older.
    const lastActivity = (s: any) =>
      Math.max(
        s.lastRecordedAt ? new Date(s.lastRecordedAt).getTime() : 0,
        s.lastReceivedAt ? new Date(s.lastReceivedAt).getTime() : 0
      );
    enriched.sort((a: any, b: any) => lastActivity(b) - lastActivity(a));

    return NextResponse.json(enriched);
  } catch (error) {
    console.error("GET /api/fleet-map error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
