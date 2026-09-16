import type { RawTrackPoint } from "@/lib/gpsTrackFilter";
import { haversineMeters } from "@/lib/gpsTrackFilter";

export type LatLng = { lat: number; lng: number };

const ROADS_ENDPOINT = "https://roads.googleapis.com/v1/snapToRoads";
/** Roads API hard limit is 100 points per snapToRoads request. */
const CHUNK = 100;
const MATCH_MIN_SPACING_M = 35;
/** Below this total displacement the trail is a standstill, not a route. */
const MIN_MATCHABLE_SPAN_M = 50;
const CACHE_TTL_MS = 25_000;

type CacheEntry = { route: LatLng[]; expires: number };
const routeCache = new Map<string, CacheEntry>();

/**
 * Server-side key. Prefer a dedicated one: the browser key is HTTP-referrer
 * restricted, which the Roads API (a server-to-server call) cannot satisfy.
 */
function roadsApiKey(): string {
  return (
    process.env.GOOGLE_MAPS_SERVER_API_KEY ||
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ||
    ""
  ).trim();
}

export function hasRoadsApiKey(): boolean {
  return roadsApiKey().length > 0;
}

/** Space points so map-matching sees a clean driving trace. */
function thinForMatch(points: RawTrackPoint[], minM = MATCH_MIN_SPACING_M): RawTrackPoint[] {
  if (points.length <= 2) return points;
  const out: RawTrackPoint[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = out[out.length - 1];
    const p = points[i];
    if (haversineMeters(prev.lat, prev.lng, p.lat, p.lng) >= minM) out.push(p);
  }
  const last = points[points.length - 1];
  const prev = out[out.length - 1];
  if (prev !== last) {
    if (haversineMeters(prev.lat, prev.lng, last.lat, last.lng) < 5) {
      out[out.length - 1] = last;
    } else {
      out.push(last);
    }
  }
  return out;
}

/** How far the trail gets from where it started — 0 for a parked device. */
function spanFromStartM(points: RawTrackPoint[]): number {
  const first = points[0];
  let max = 0;
  for (const p of points) {
    const d = haversineMeters(first.lat, first.lng, p.lat, p.lng);
    if (d > max) max = d;
  }
  return max;
}

function cacheKey(deviceId: string, points: RawTrackPoint[]): string {
  const first = points[0];
  const last = points[points.length - 1];
  return [
    deviceId,
    points.length,
    new Date(first.recordedAt).getTime(),
    new Date(last.recordedAt).getTime(),
    last.lat.toFixed(5),
    last.lng.toFixed(5),
  ].join(":");
}

/**
 * One snapped vertex.
 *
 * `originalIndex` ties the vertex back to the GPS fix it came from, so the
 * timestamp, speed and battery of that fix survive map-matching. Vertices the
 * Roads API interpolated to follow the road between two fixes carry `null`.
 */
export interface SnappedRoutePoint {
  lat: number;
  lng: number;
  originalIndex: number | null;
  /**
   * False when this vertex is a raw GPS fix the matcher never placed on a road —
   * a failed chunk, or a fix too far from the matched geometry to reproject.
   * Those are the vertices that can still cut a corner, so they are reported
   * rather than passed off as road geometry.
   */
  snapped: boolean;
  /**
   * The fix was recorded during a standstill and is held at the position it was
   * recorded at. Map-matching is not applied to these: a parked vehicle is not
   * on the carriageway, and sliding it onto one draws movement that never
   * happened.
   */
  stationary?: boolean;
}

async function matchChunkDetailed(
  points: RawTrackPoint[]
): Promise<SnappedRoutePoint[] | null> {
  if (points.length < 2) return null;

  const key = roadsApiKey();
  if (!key) return null;

  const path = points.map((p) => `${p.lat},${p.lng}`).join("|");
  const url =
    `${ROADS_ENDPOINT}?interpolate=true` +
    `&path=${encodeURIComponent(path)}` +
    `&key=${encodeURIComponent(key)}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8_000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      // 403 here almost always means the Roads API is not enabled on the key,
      // or the key is referrer-restricted. Log once per failure, then fall back.
      console.warn(`Roads API snapToRoads failed: ${res.status} ${res.statusText}`);
      return null;
    }

    const data = (await res.json()) as {
      snappedPoints?: {
        location?: { latitude?: number; longitude?: number };
        originalIndex?: number;
      }[];
      error?: { message?: string };
    };
    if (data.error) {
      console.warn(`Roads API error: ${data.error.message}`);
      return null;
    }
    if (!data.snappedPoints?.length) return null;

    const route: SnappedRoutePoint[] = [];
    for (const sp of data.snappedPoints) {
      const lat = sp.location?.latitude;
      const lng = sp.location?.longitude;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const originalIndex =
        typeof sp.originalIndex === "number" && sp.originalIndex >= 0
          ? sp.originalIndex
          : null;
      // Collapse repeated geometry, but never at the cost of an anchor: a
      // vertex that carries an originalIndex is the only place a real fix's
      // time and speed can be attached.
      const prev = route[route.length - 1];
      if (prev && prev.lat === lat && prev.lng === lng && originalIndex == null) continue;
      route.push({ lat: lat as number, lng: lng as number, originalIndex, snapped: true });
    }
    return route.length >= 2 ? route : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function matchChunk(points: RawTrackPoint[]): Promise<LatLng[] | null> {
  const detailed = await matchChunkDetailed(points);
  return detailed ? detailed.map((p) => ({ lat: p.lat, lng: p.lng })) : null;
}

/**
 * Snap a filtered GPS trail onto the road network (Google Roads API).
 * Returns null if matching fails — caller should fall back to raw GPS.
 */
export async function snapTrackToRoads(
  deviceId: string,
  points: RawTrackPoint[]
): Promise<LatLng[] | null> {
  if (points.length < 2) return null;
  if (!hasRoadsApiKey()) return null;

  // A trail that never leaves its own error radius is a parked vehicle, not a
  // journey. Map-matching a jitter cluster snaps it onto the nearest road and
  // invents a leg along it — exactly the artifact this pipeline exists to
  // remove. Leave the cluster where the GPS put it.
  if (spanFromStartM(points) < MIN_MATCHABLE_SPAN_M) return null;

  const key = cacheKey(deviceId, points);
  const hit = routeCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.route;

  const thinned = thinForMatch(points);
  if (thinned.length < 2) return null;

  const snapped: LatLng[] = [];

  for (let start = 0; start < thinned.length; start += CHUNK - 1) {
    const chunk = thinned.slice(start, start + CHUNK);
    if (chunk.length < 2) break;
    const matched = await matchChunk(chunk);
    const piece = matched ?? chunk.map((p) => ({ lat: p.lat, lng: p.lng }));

    if (snapped.length === 0) {
      snapped.push(...piece);
    } else {
      // Skip overlapping first vertex from chunk window.
      snapped.push(...piece.slice(1));
    }
    if (start + CHUNK >= thinned.length) break;
  }

  if (snapped.length < 2) return null;

  routeCache.set(key, { route: snapped, expires: Date.now() + CACHE_TTL_MS });

  // Bound memory on warm serverless instances.
  if (routeCache.size > 200) {
    const now = Date.now();
    for (const [k, v] of routeCache) {
      if (v.expires < now) routeCache.delete(k);
    }
  }

  return snapped;
}

// ─── Index-preserving matching, for Route History ────────────────────────────

/** Matched history is immutable, so it can be cached far longer than a live trail. */
const HISTORY_CACHE_TTL_MS = 10 * 60_000;
/**
 * Ceiling on vertices sent for matching. Each 100 of them is one Roads API
 * request, so a day-long trail is thinned harder rather than fanning out into
 * hundreds of calls.
 */
const MAX_MATCH_POINTS = 2_000;
/**
 * Keep a fix regardless of how close it is when this long has passed. A parked
 * vehicle's keepalive fixes are all in the same spot, and dropping them on
 * spacing alone would erase the stop the idle detector needs to find.
 */
const MATCH_MIN_GAP_MS = 60_000;

type HistoryCacheEntry = { route: SnappedRoutePoint[]; expires: number };
const historyCache = new Map<string, HistoryCacheEntry>();

interface ThinnedRef {
  p: RawTrackPoint;
  /** Index of this fix in the caller's array. */
  idx: number;
}

/**
 * Thin for matching while remembering where each survivor came from, so the
 * snapped result can be tied back to the original fixes.
 */
function thinWithIndex(points: RawTrackPoint[], minM: number): ThinnedRef[] {
  if (points.length <= 2) return points.map((p, idx) => ({ p, idx }));

  const out: ThinnedRef[] = [{ p: points[0], idx: 0 }];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = out[out.length - 1];
    const p = points[i];
    const far = haversineMeters(prev.p.lat, prev.p.lng, p.lat, p.lng) >= minM;
    const stale =
      new Date(p.recordedAt).getTime() - new Date(prev.p.recordedAt).getTime() >=
      MATCH_MIN_GAP_MS;
    if (far || stale) out.push({ p, idx: i });
  }
  out.push({ p: points[points.length - 1], idx: points.length - 1 });
  return out;
}

/** Interval above which the vehicle travelled untracked rather than sampled. */
const GAP_MS = 5 * 60_000;
/** Below this displacement a long interval is a stop, not a coverage gap. */
const GAP_MIN_MOVE_M = 60;

/**
 * Break the trail where logging stopped.
 *
 * The route map draws these joins dashed precisely because nobody knows what
 * road was taken; matching straight through one would replace that honest
 * "unknown" with a confidently drawn — and possibly wrong — road route.
 */
function splitAtGaps(thinned: ThinnedRef[]): ThinnedRef[][] {
  const runs: ThinnedRef[][] = [];
  let current: ThinnedRef[] = [];

  for (const ref of thinned) {
    const prev = current[current.length - 1];
    if (prev) {
      const dtMs =
        new Date(ref.p.recordedAt).getTime() - new Date(prev.p.recordedAt).getTime();
      const dist = haversineMeters(prev.p.lat, prev.p.lng, ref.p.lat, ref.p.lng);
      if (dtMs >= GAP_MS && dist > GAP_MIN_MOVE_M) {
        runs.push(current);
        current = [];
      }
    }
    current.push(ref);
  }
  if (current.length) runs.push(current);
  return runs;
}

/** Metres per degree of latitude — the local projection used for reprojection. */
const M_PER_DEG_LAT = 111_320;
/**
 * A restored fix further than this from the road its leg followed is not a
 * point on that road, so it keeps its raw position rather than being dragged
 * onto geometry it never belonged to.
 */
const MAX_REPROJECT_M = 200;

/** Cumulative distance along a polyline, vertex by vertex. */
function alongDistances(path: SnappedRoutePoint[]): number[] {
  const along = [0];
  for (let i = 1; i < path.length; i++) {
    along.push(
      along[i - 1] +
        haversineMeters(path[i - 1].lat, path[i - 1].lng, path[i].lat, path[i].lng)
    );
  }
  return along;
}

/**
 * Nearest point on `path` to `p`, in a flat local projection.
 *
 * Returns where it lands, how far along the path that is, and how far `p` sat
 * from the road — the last being the test for whether the fix belongs there.
 */
function projectOntoPath(
  p: { lat: number; lng: number },
  path: SnappedRoutePoint[],
  along: number[]
): { lat: number; lng: number; along: number; offsetM: number } | null {
  if (path.length < 2) return null;
  const kx = Math.cos((path[0].lat * Math.PI) / 180) * M_PER_DEG_LAT;
  const ky = M_PER_DEG_LAT;
  if (!Number.isFinite(kx) || kx === 0) return null;

  const px = p.lng * kx;
  const py = p.lat * ky;
  let best: { lat: number; lng: number; along: number; offsetM: number } | null = null;

  for (let i = 1; i < path.length; i++) {
    const ax = path[i - 1].lng * kx;
    const ay = path[i - 1].lat * ky;
    const dx = path[i].lng * kx - ax;
    const dy = path[i].lat * ky - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
    const cx = ax + dx * t;
    const cy = ay + dy * t;
    const offsetM = Math.hypot(px - cx, py - cy);
    if (!best || offsetM < best.offsetM) {
      best = {
        lat: cy / ky,
        lng: cx / kx,
        along: along[i - 1] + (along[i] - along[i - 1]) * t,
        offsetM,
      };
    }
  }
  return best;
}

/**
 * Fill in fixes the Roads API left out of its answer.
 *
 * Matching routinely returns fewer anchors than it was given — it declines the
 * fixes it is least sure of, which are exactly the ones sitting furthest off
 * the carriageway. Those fixes still happened, so dropping them would shorten
 * stops and punch holes in playback; but reinserting them at their raw position
 * is what makes an otherwise road-matched route dart off the road and back,
 * cutting through buildings on the way.
 *
 * So a restored fix is projected onto the road geometry of the leg it falls in,
 * and takes its place in that leg by distance travelled rather than ahead of it.
 * Only a fix with no surrounding geometry, or one too far from it to plausibly
 * belong, keeps its raw position — and is marked unsnapped when it does.
 */
function restoreMissingAnchors(
  matched: SnappedRoutePoint[],
  thinned: ThinnedRef[]
): SnappedRoutePoint[] {
  const out: SnappedRoutePoint[] = [];
  let next = 0;
  // Geometry is held back until the fix that closes its leg is known, because
  // only then is it known which road the restored fixes should land on.
  let fillers: SnappedRoutePoint[] = [];
  /** Last emitted vertex known to sit on the road — the leg's start. */
  let legStart: SnappedRoutePoint | null = null;

  const raw = (ref: ThinnedRef): SnappedRoutePoint => ({
    lat: ref.p.lat,
    lng: ref.p.lng,
    originalIndex: ref.idx,
    snapped: false,
    stationary: ref.p.isStationary === true,
  });

  /** Emit one leg: its road geometry plus any fix the matcher declined. */
  const flushLeg = (limit: number, closing: SnappedRoutePoint | null) => {
    const missing: ThinnedRef[] = [];
    while (next < thinned.length && thinned[next].idx < limit) missing.push(thinned[next++]);

    const leg = legStart ? [legStart, ...fillers, ...(closing ? [closing] : [])] : [];
    if (missing.length === 0 || leg.length < 2) {
      out.push(...fillers, ...missing.map(raw));
      fillers = [];
      return;
    }

    const along = alongDistances(leg);
    // Place both the road geometry and the restored fixes on one axis — how far
    // along the leg each sits — so they interleave in travel order.
    const placed: { at: number; pt: SnappedRoutePoint }[] = fillers.map((f, i) => ({
      at: along[i + 1],
      pt: f,
    }));

    let floor = 0;
    for (const ref of missing) {
      // A standstill fix is already where it belongs; projecting it would slide
      // the stop along the road and invent movement through it.
      if (ref.p.isStationary) {
        placed.push({ at: floor, pt: raw(ref) });
        continue;
      }
      const hit = projectOntoPath(ref.p, leg, along);
      if (!hit || hit.offsetM > MAX_REPROJECT_M) {
        placed.push({ at: floor, pt: raw(ref) });
        continue;
      }
      // Fixes are already in time order, so a projection may not walk back down
      // the leg — that would draw the route doubling over itself.
      floor = Math.max(hit.along, floor);
      placed.push({
        at: floor,
        pt: { lat: hit.lat, lng: hit.lng, originalIndex: ref.idx, snapped: true },
      });
    }

    placed.sort((a, b) => a.at - b.at);
    out.push(...placed.map((x) => x.pt));
    fillers = [];
  };

  for (const entry of matched) {
    if (entry.originalIndex == null) {
      fillers.push(entry);
      continue;
    }
    flushLeg(entry.originalIndex, entry);
    if (next < thinned.length && thinned[next].idx === entry.originalIndex) next++;
    out.push(entry);
    legStart = entry;
  }
  // Trailing geometry has no closing fix. It still guides any fix restored after
  // it; whatever is left over cannot be timed, and densify drops it.
  flushLeg(Infinity, null);
  return out;
}

/**
 * Map-match a route-history trail, keeping each fix tied to its snapped
 * position and adding the road geometry that runs between the fixes.
 *
 * This is what stops a history route cutting across buildings: consecutive
 * fixes are joined by the road the vehicle actually drove rather than by a
 * straight line, and each fix is moved onto that road.
 *
 * Returns null when matching is unavailable or fails, so callers fall back to
 * the raw GPS trail.
 */
export async function snapRouteToRoads(
  cacheId: string,
  points: RawTrackPoint[]
): Promise<SnappedRoutePoint[] | null> {
  if (points.length < 2) return null;
  if (!hasRoadsApiKey()) return null;
  if (spanFromStartM(points) < MIN_MATCHABLE_SPAN_M) return null;

  const key = `hist:${cacheKey(cacheId, points)}`;
  const hit = historyCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.route;

  // Widen the spacing until the trail fits the request budget.
  let spacing = MATCH_MIN_SPACING_M;
  let thinned = thinWithIndex(points, spacing);
  while (thinned.length > MAX_MATCH_POINTS && spacing < 1_000) {
    spacing *= 2;
    thinned = thinWithIndex(points, spacing);
  }
  if (thinned.length < 2) return null;

  const merged: SnappedRoutePoint[] = [];
  let lastAnchor = -1;

  // Each run is matched on its own. Across a logging gap the vehicle drove
  // untracked, so there is no trace to match — interpolating there would invent
  // a road route nobody recorded and hide the gap the map draws dashed.
  for (const run of splitAtGaps(thinned)) {
    if (run.length < 2) {
      for (const ref of run) {
        merged.push({ lat: ref.p.lat, lng: ref.p.lng, originalIndex: ref.idx, snapped: false });
        lastAnchor = ref.idx;
      }
      continue;
    }

    // Geometry only means something between two fixes of the same run, so none
    // is kept until this run has placed its first fix.
    let anchoredInRun = false;

    for (let start = 0; start < run.length - 1; start += CHUNK - 1) {
      const chunk = run.slice(start, start + CHUNK);
      if (chunk.length < 2) break;

      const matched = await matchChunkDetailed(chunk.map((t) => t.p));
      // A chunk that fails to match keeps its raw fixes, so one bad window
      // degrades to a straight leg instead of losing the rest of the route.
      const piece: SnappedRoutePoint[] =
        matched ??
        chunk.map((t, i) => ({
          lat: t.p.lat,
          lng: t.p.lng,
          originalIndex: i,
          snapped: false,
        }));

      for (const entry of piece) {
        const globalIdx =
          entry.originalIndex != null ? chunk[entry.originalIndex]?.idx ?? null : null;
        if (globalIdx == null) {
          if (anchoredInRun) merged.push({ ...entry, originalIndex: null });
          continue;
        }
        // Chunks overlap by one fix so the legs join; drop the repeat, and with
        // it any geometry the next window redraws before that fix.
        if (globalIdx <= lastAnchor) continue;
        // A fix recorded at a standstill keeps where it was recorded. The
        // matcher would otherwise pull the whole stop onto the nearest road and
        // spread it along it, which is the drift this is here to prevent.
        const ref = chunk[entry.originalIndex!];
        const parked = ref.p.isStationary === true;
        merged.push({
          lat: parked ? ref.p.lat : entry.lat,
          lng: parked ? ref.p.lng : entry.lng,
          originalIndex: globalIdx,
          snapped: parked ? false : entry.snapped,
          stationary: parked,
        });
        lastAnchor = globalIdx;
        anchoredInRun = true;
      }
    }
  }

  if (merged.length < 2) return null;

  // Restore against every recorded fix, not just the ones thinning kept for the
  // matcher. Thinning exists to keep the request count down; dropping the fixes
  // it skipped from the result as well is what left the drawn route stepping
  // between widely spaced samples and skipping the recorded positions between
  // them. They are all put back here, each on the road geometry of its own leg.
  const allRefs: ThinnedRef[] = points.map((p, idx) => ({ p, idx }));
  const route = restoreMissingAnchors(merged, allRefs);
  historyCache.set(key, { route, expires: Date.now() + HISTORY_CACHE_TTL_MS });
  if (historyCache.size > 100) {
    const now = Date.now();
    for (const [k, v] of historyCache) if (v.expires < now) historyCache.delete(k);
  }
  return route;
}

/** A stored location fix, carried through map-matching untouched apart from its position. */
export type RouteDoc = Record<string, unknown>;

/**
 * Rebuild the trail from its map-matched geometry.
 *
 * Every fix keeps its own document — time, speed, battery, accuracy — but moves
 * to where the road actually is, and the road geometry the Roads API filled in
 * between two fixes becomes points of its own. Those fillers get a timestamp
 * and speed interpolated across the leg, so playback, idle detection and the
 * distance total all read them the same way they read a real fix;
 * `isInterpolated` marks them for anything that must only count surveyed samples.
 */
export function densifyAlongRoute(
  snapped: SnappedRoutePoint[],
  docs: RouteDoc[]
): RouteDoc[] {
  const out: RouteDoc[] = [];
  /** Filler geometry waiting for the fix that closes its leg. */
  let pending: SnappedRoutePoint[] = [];
  let prevAnchor: { doc: RouteDoc; lat: number; lng: number } | null = null;

  const timeOf = (d: RouteDoc) => new Date(d.recordedAt as string | Date).getTime();
  const speedOf = (d: RouteDoc) =>
    typeof d.speedMetersPerSecond === "number" ? d.speedMetersPerSecond : 0;

  for (const s of snapped) {
    if (s.originalIndex == null) {
      // Geometry before the first fix has no leg to belong to.
      if (prevAnchor) pending.push(s);
      continue;
    }

    const doc = docs[s.originalIndex];
    if (!doc) {
      pending = [];
      continue;
    }

    // A fix timed before the one already drawn can only be a clock or ordering
    // fault; drawing it would send the route back on itself.
    if (prevAnchor && timeOf(doc) < timeOf(prevAnchor.doc)) {
      pending = [];
      continue;
    }

    if (prevAnchor && pending.length > 0) {
      // Spread the leg's elapsed time over the filler points by how far along
      // the road each one sits, so an interpolated point never implies a jump.
      const legs: number[] = [];
      let cursor = { lat: prevAnchor.lat, lng: prevAnchor.lng };
      let total = 0;
      for (const f of [...pending, { lat: s.lat, lng: s.lng }]) {
        total += haversineMeters(cursor.lat, cursor.lng, f.lat, f.lng);
        legs.push(total);
        cursor = { lat: f.lat, lng: f.lng };
      }

      const t0 = timeOf(prevAnchor.doc);
      const t1 = timeOf(doc);
      const v0 = speedOf(prevAnchor.doc);
      const v1 = speedOf(doc);
      const anchorDoc = prevAnchor.doc;

      pending.forEach((f, i) => {
        const frac = total > 0 ? legs[i] / total : (i + 1) / (pending.length + 1);
        out.push({
          pointId: `interp-${s.originalIndex}-${i}`,
          sessionId: anchorDoc.sessionId,
          latitude: f.lat,
          longitude: f.lng,
          recordedAt: new Date(t0 + (t1 - t0) * frac).toISOString(),
          speedMetersPerSecond: v0 + (v1 - v0) * frac,
          isInterpolated: true,
          isRoadSnapped: true,
        });
      });
    }

    pending = [];
    out.push({
      ...doc,
      latitude: s.lat,
      longitude: s.lng,
      rawLatitude: doc.latitude,
      rawLongitude: doc.longitude,
      isRoadSnapped: s.snapped,
      isStationary: s.stationary === true,
    });
    prevAnchor = { doc, lat: s.lat, lng: s.lng };
  }

  return out;
}

/** Run map-match for many devices with limited concurrency. */
export async function snapTracksToRoads(
  tracks: { deviceId: string; points: RawTrackPoint[] }[],
  concurrency = 3
): Promise<Map<string, LatLng[]>> {
  const out = new Map<string, LatLng[]>();
  if (!hasRoadsApiKey()) return out;

  let i = 0;

  async function worker() {
    while (i < tracks.length) {
      const idx = i++;
      const t = tracks[idx];
      const route = await snapTrackToRoads(t.deviceId, t.points);
      if (route) out.set(t.deviceId, route);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, Math.max(tracks.length, 1)) }, () => worker())
  );
  return out;
}
