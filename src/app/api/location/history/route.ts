import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import connectToDatabase from "@/lib/db";
import LocationPoint from "@/models/LocationPoint";
import { companyIdIn } from "@/lib/companyIdQuery";
import { filterGpsTrack, type RawTrackPoint } from "@/lib/gpsTrackFilter";
import {
  snapRouteToRoads,
  densifyAlongRoute,
  type RouteDoc,
} from "@/lib/googleRoadsMatch";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.companyId && session?.user?.role !== "super_admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const sessionId = searchParams.get("sessionId");
    const deviceId = searchParams.get("deviceId");
    const from = searchParams.get("from");
    const to = searchParams.get("to");

    if (!sessionId && !deviceId) {
      return NextResponse.json({ error: "sessionId or deviceId required" }, { status: 400 });
    }

    await connectToDatabase();

    const query: Record<string, unknown> = {};
    if (session.user.role !== "super_admin") {
      query.companyId = companyIdIn(session.user.companyId!);
    }
    if (sessionId) query.sessionId = sessionId;
    if (deviceId) query.deviceId = deviceId;

    const windowMode = Boolean(from || to);
    if (windowMode) {
      const range: Record<string, Date> = {};
      if (from) range.$gte = new Date(from);
      if (to) range.$lte = new Date(to);
      query.recordedAt = range;
    }

    const points = await LocationPoint.find(query)
      .sort(windowMode ? { recordedAt: 1 } : { sequenceNumber: 1 })
      .limit(5000)
      .lean();

    // Clean the trail before it reaches the trip map and the distance/speed
    // analytics: raw fixes include standstill jitter and low-accuracy outliers
    // that otherwise draw as spikes and inflate the trip distance.
    // The projection carries the whole document through untouched.
    type TrackDoc = RawTrackPoint & { doc: unknown };
    const docs = (points as unknown as Record<string, unknown>[]).flatMap<TrackDoc>((p) => {
      const lat = p.latitude as number | undefined;
      const lng = p.longitude as number | undefined;
      if (typeof lat !== "number" || typeof lng !== "number") return [];
      return [
        {
          doc: p,
          lat,
          lng,
          recordedAt: p.recordedAt as Date,
          speed: p.speedMetersPerSecond as number | undefined,
          accuracyMeters: p.accuracyMeters as number | null | undefined,
          isMockLocation: p.isMockLocation as boolean | null | undefined,
        },
      ];
    });

    // Route history is played back and inspected fix by fix, so it is filtered
    // for fidelity rather than for a tidy live-map line: standstills keep their
    // samples (pinned in place, so the cursor sits still where the vehicle
    // actually stopped) instead of being collapsed to one keepalive every few
    // minutes. That collapse is what left a stop and its departure minutes
    // apart in the trail — read downstream as a logging gap, and drawn as the
    // route jumping straight to wherever the vehicle turned up next.
    const cleaned = filterGpsTrack(docs, {
      maxPoints: 5000,
      stationaryHoldMs: 30_000,
      pinStationary: true,
    });
    // Carry the cleaned position onto the document: pinning moves a standstill
    // fix, and the raw document still holds where it drifted to.
    const cleanedDocs: RouteDoc[] = cleaned.map((p) => ({
      ...(p.doc as RouteDoc),
      latitude: p.lat,
      longitude: p.lng,
      isStationary: p.isStationary === true,
    }));

    // Map-match the trail onto the road network. Cleaned GPS still wanders off
    // the carriageway — through buildings, across the wrong side of a divided
    // road — because each fix carries its own error; joining those fixes with
    // straight lines then makes the route look like it left the road entirely.
    // Snapping fixes both: the points land on the road and the geometry between
    // them follows it. Any failure falls back to the cleaned GPS trail.
    const snap =
      searchParams.get("snap") !== "0" && process.env.FLEET_MAP_SNAP !== "0";

    if (snap && cleaned.length >= 2) {
      try {
        const matched = await snapRouteToRoads(
          deviceId || sessionId || "route",
          cleaned
        );
        if (matched) {
          const densified = densifyAlongRoute(matched, cleanedDocs);
          if (densified.length >= 2) return NextResponse.json(densified);
        }
      } catch (err) {
        console.warn("Route history road matching failed, using raw GPS:", err);
      }
    }

    return NextResponse.json(cleanedDocs);
  } catch (error) {
    console.error("GET /api/location/history error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
