/** GPS trail cleanup for live fleet-map polylines. */

export interface RawTrackPoint {
  lat: number;
  lng: number;
  recordedAt: Date | string;
  speed?: number;
  accuracyMeters?: number | null;
  isMockLocation?: boolean | null;
  /**
   * The fix belongs to a standstill and has been pinned to that stop's position.
   * Set by `pinStationary`; consumers use it to leave the point where it was
   * recorded rather than moving it onto a road.
   */
  isStationary?: boolean;
}

const EARTH_R = 6_371_000;
/** Past this gap the device was asleep or out of coverage — motion is unknown. */
const GAP_RESET_MS = 120_000;
/** Consecutive rejections after which the reference point is the suspect. */
const MAX_CONSECUTIVE_OUTLIERS = 5;

export function haversineMeters(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number
): number {
  const lat1 = (aLat * Math.PI) / 180;
  const lat2 = (bLat * Math.PI) / 180;
  const dLat = lat2 - lat1;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return EARTH_R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export interface TrackFilterOptions {
  /** Drop fixes worse than this (meters). Default 35 — above this a fix is wifi/cell assisted. */
  maxAccuracyM?: number;
  /** Reject segment if implied speed exceeds this (m/s). Default 45 (~162 km/h). */
  maxSpeedMps?: number;
  /**
   * How much further than the reported speed allows a segment may reach before
   * it is treated as an outlier. Default 1.25 (+ the pair's error radius).
   */
  speedToleranceFactor?: number;
  /** Collapse points closer than this (meters). Default 12. */
  minMoveM?: number;
  /**
   * A displacement only counts as travel once it clears this multiple of the
   * fix's own error radius. Default 1 — a 44 m step reported with ±49 m
   * accuracy is indistinguishable from standing still.
   */
  accuracyMoveFactor?: number;
  /** Reported speed at or above this (m/s) confirms real movement. Default 2 (~7 km/h). */
  movingSpeedMps?: number;
  /**
   * A slow reported speed is only believed from a fix at least this tight
   * (meters). Default 20 — a smeared fix reports drift as creeping motion.
   */
  trustedSpeedAccuracyM?: number;
  /** While stationary, keep at most one point per this many ms. Default 5min. */
  stationaryHoldMs?: number;
  /** Out-and-back excursion longer than this is a spike, not travel (meters). Default 35. */
  spikeExcursionM?: number;
  /** Soft cap of points kept per device after filtering. Default 1500. */
  maxPoints?: number;
  /**
   * Pin every standstill to one position instead of letting its fixes drift.
   *
   * A parked device keeps reporting, and those fixes wander within their own
   * error radius — which draws as the vehicle creeping around while it is
   * demonstrably stopped. Pinning keeps every fix (so the stop keeps its real
   * duration and playback dwells through it) but gives them all the position of
   * the tightest fix in the stop, so the cursor sits still where it actually
   * stopped. Off by default: the live map collapses standstills instead.
   */
  pinStationary?: boolean;
}

/** A run of standstill fixes must span at least this long to be pinned. */
const STATIONARY_MIN_MS = 45_000;

/**
 * Clean a chronologically sorted GPS trail:
 * drop mock / low-accuracy fixes, reject teleport jumps, collapse near-duplicates.
 */
export function filterGpsTrack<T extends RawTrackPoint>(
  points: T[],
  opts: TrackFilterOptions = {}
): T[] {
  const maxAccuracyM = opts.maxAccuracyM ?? 35;
  const maxSpeedMps = opts.maxSpeedMps ?? 45;
  const speedToleranceFactor = opts.speedToleranceFactor ?? 1.25;
  const minMoveM = opts.minMoveM ?? 12;
  const accuracyMoveFactor = opts.accuracyMoveFactor ?? 1;
  const movingSpeedMps = opts.movingSpeedMps ?? 2;
  const trustedSpeedAccuracyM = opts.trustedSpeedAccuracyM ?? 20;
  const stationaryHoldMs = opts.stationaryHoldMs ?? 5 * 60_000;
  const spikeExcursionM = opts.spikeExcursionM ?? 35;
  const maxPoints = opts.maxPoints ?? 1500;

  const cleaned: T[] = [];
  // A bad fix that gets accepted becomes the reference for everything after it.
  // After this many consecutive rejections the reference is the likelier
  // culprit (a resumed trip, a coverage gap), so re-anchor on the new fix.
  let consecutiveOutliers = 0;

  for (const p of points) {
    if (p.lat == null || p.lng == null) continue;
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
    if (p.isMockLocation) continue;
    if (p.accuracyMeters != null && p.accuracyMeters > maxAccuracyM) continue;

    const t = new Date(p.recordedAt).getTime();
    if (!Number.isFinite(t)) continue;

    const prev = cleaned[cleaned.length - 1];
    if (!prev) {
      cleaned.push(p);
      continue;
    }

    const prevT = new Date(prev.recordedAt).getTime();
    const dtMs = Math.max(0, t - prevT);
    const dist = haversineMeters(prev.lat, prev.lng, p.lat, p.lng);

    // Same instant twice — a re-uploaded / duplicated fix, not a segment.
    if (dtMs === 0 && dist < minMoveM) continue;

    // The error radius the pair shares: neither endpoint is known better than this.
    const noiseM = Math.max(
      minMoveM,
      accuracyMoveFactor * Math.max(prev.accuracyMeters ?? 0, p.accuracyMeters ?? 0)
    );

    // Outlier gates — skip the bad fix and keep the previous good one as the
    // reference. Both are budgets on how far the vehicle could actually have
    // travelled since that reference.
    if (dtMs > 0) {
      const dtSec = dtMs / 1000;
      const teleport = dist / dtSec > maxSpeedMps && dist > 80;

      // The device reports its own Doppler speed, which is measured, where the
      // implied speed is two smeared positions differenced. So the segment may
      // only reach as far as that speed allows, plus the pair's error radius:
      // 85 m in 3.7 s from a device reporting 27 km/h is multipath, not a
      // manoeuvre. Skipped across long gaps, where the device was asleep or out
      // of coverage and genuinely did travel between the two fixes.
      // A missing speed is unknown, not zero — an older client that never sent
      // one must not have its whole trail read as an impossible crawl.
      const hasReported = p.speed != null || prev.speed != null;
      const reportedMps = Math.max(p.speed ?? 0, prev.speed ?? 0);
      const reachableM = reportedMps * dtSec * speedToleranceFactor + noiseM;
      const overshoot = hasReported && dtMs < GAP_RESET_MS && dist > reachableM;

      if (teleport || overshoot) {
        if (++consecutiveOutliers < MAX_CONSECUTIVE_OUTLIERS) continue;
        consecutiveOutliers = 0;
        cleaned.push(p);
        continue;
      }
      consecutiveOutliers = 0;
    } else if (dist > 80) {
      continue;
    }

    // Collapse stationary / near-duplicate noise. A parked vehicle reports every
    // 20s, so gating on the interval alone let the whole standstill through —
    // only a real move, or a long-stop keepalive, produces a new point.
    // A moving fix only has to clear the fixed minimum; anything else has to
    // clear its own error radius. "Moving" needs a tight fix as well as speed:
    // a smeared fix over a parked vehicle reports its drift as a 5 km/h crawl.
    const moving =
      Math.max(p.speed ?? 0, prev.speed ?? 0) >= movingSpeedMps &&
      (p.accuracyMeters ?? 0) <= trustedSpeedAccuracyM;
    const gate = moving ? minMoveM : noiseM;
    if (dist < gate && dtMs < stationaryHoldMs) continue;

    cleaned.push(p);
  }

  const deSpiked = removeSpikes(cleaned, spikeExcursionM, minMoveM);
  // Pinning supersedes the tail collapse: it holds every standstill still,
  // including the last one, without throwing away the fixes that time it.
  const settled = opts.pinStationary
    ? pinStationaryRuns(deSpiked, movingSpeedMps, minMoveM)
    : collapseParkedTail(deSpiked, movingSpeedMps, minMoveM);

  if (settled.length <= maxPoints) return settled;

  // Uniform downsample while keeping first and last.
  const out: T[] = [settled[0]];
  const step = (settled.length - 1) / (maxPoints - 1);
  for (let i = 1; i < maxPoints - 1; i++) {
    out.push(settled[Math.round(i * step)]);
  }
  out.push(settled[settled.length - 1]);
  return out;
}

/**
 * Drop out-and-back excursions — the "spider web" legs on the fleet map.
 *
 * A bad fix moves away and the next good fix comes straight back, so the
 * neighbours of the outlier are close to each other. The implied speed can stay
 * under the teleport threshold (500m over a 20s parked sample is only 25 m/s),
 * which is why this needs its own geometric test.
 */
function removeSpikes<T extends RawTrackPoint>(
  points: T[],
  excursionM: number,
  minMoveM: number
): T[] {
  if (points.length < 3) return points;

  const out: T[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = out[out.length - 1];
    const cur = points[i];
    const next = points[i + 1];

    const outbound = haversineMeters(prev.lat, prev.lng, cur.lat, cur.lng);
    const back = haversineMeters(cur.lat, cur.lng, next.lat, next.lng);
    const through = haversineMeters(prev.lat, prev.lng, next.lat, next.lng);

    // Went out and came back to near where it started: not a path, an error.
    // The return tolerance scales with the excursion, so a 40 m dogleg ending
    // 5 m from its start is caught the same way a 500 m one is.
    if (
      outbound > excursionM &&
      back > excursionM &&
      through < Math.max(minMoveM * 2, 0.35 * (outbound + back))
    ) {
      continue;
    }
    out.push(cur);
  }
  out.push(points[points.length - 1]);
  return out;
}

/**
 * Hold every standstill at one position.
 *
 * Unlike `collapseParkedTail`, which throws the stop's fixes away, this keeps
 * all of them — the stop's duration, and the samples playback walks through
 * while it waits there — and only rewrites where they sit. That matters for
 * route history twice over: the cursor stops dead at the recorded spot instead
 * of wandering, and the stop stays densely sampled, so the departure is never
 * separated from it by a hole big enough to be read as a logging gap.
 *
 * Only a run that is genuinely a standstill is pinned: every fix in it reports
 * a stopped speed, it spans real time, and it all fits inside the error radius
 * of its own tightest fix. A slow crawl fails that last test and is left alone.
 */
function pinStationaryRuns<T extends RawTrackPoint>(
  points: T[],
  movingSpeedMps: number,
  minMoveM: number
): T[] {
  if (points.length < 2) return points;
  const out = [...points];
  const timeOf = (p: T) => new Date(p.recordedAt).getTime();

  let i = 0;
  while (i < out.length) {
    // Unknown speed is not a stopped speed, so a client that never reports one
    // never has its trail pinned in place.
    if ((out[i].speed ?? Infinity) >= movingSpeedMps) {
      i++;
      continue;
    }

    let end = i;
    while (end + 1 < out.length && (out[end + 1].speed ?? Infinity) < movingSpeedMps) end++;

    const run = out.slice(i, end + 1);
    if (run.length >= 2 && timeOf(run[run.length - 1]) - timeOf(run[0]) >= STATIONARY_MIN_MS) {
      // Tightest fix in the run is the best estimate of where it actually stopped.
      const anchor = run.reduce((best, p) =>
        (p.accuracyMeters ?? Infinity) < (best.accuracyMeters ?? Infinity) ? p : best
      );
      const spread = Math.max(
        ...run.map((p) => haversineMeters(anchor.lat, anchor.lng, p.lat, p.lng))
      );
      const driftRadius = Math.max(minMoveM * 4, 2 * (anchor.accuracyMeters ?? 0));
      if (spread <= driftRadius) {
        for (let k = i; k <= end; k++) {
          out[k] = { ...out[k], lat: anchor.lat, lng: anchor.lng, isStationary: true };
        }
      }
    }
    i = end + 1;
  }
  return out;
}

/**
 * Collapse the drift a parked vehicle accumulates at the end of a trip.
 *
 * Once stopped, the phone keeps emitting fixes whose accuracy decays (multipath
 * off nearby buildings), so the trail crawls away from the parking spot and then
 * snaps back — the triangle drawn at the marker. Every one of those fixes is the
 * same place, so the tail collapses to a single point: the tightest fix in it,
 * carrying the latest timestamp so "last seen" stays honest.
 */
function collapseParkedTail<T extends RawTrackPoint>(
  points: T[],
  movingSpeedMps: number,
  minMoveM: number
): T[] {
  if (points.length < 3) return points;

  // Unknown speed is not a parked speed, so a client that never reports one
  // never has its tail collapsed.
  let start = points.length;
  while (start > 0 && (points[start - 1].speed ?? Infinity) < movingSpeedMps) start--;

  const tail = points.slice(start);
  if (tail.length < 2) return points;

  // Tightest fix in the tail is the best estimate of where it actually stopped.
  const anchor = tail.reduce((best, p) =>
    (p.accuracyMeters ?? Infinity) < (best.accuracyMeters ?? Infinity) ? p : best
  );

  // Only a genuinely small cluster is drift; a slow crawl through a car park is
  // a real path and must survive.
  const spread = Math.max(
    ...tail.map((p) => haversineMeters(anchor.lat, anchor.lng, p.lat, p.lng))
  );
  const driftRadius = Math.max(minMoveM * 4, 2 * (anchor.accuracyMeters ?? 0));
  if (spread > driftRadius) return points;

  const last = tail[tail.length - 1];
  return [
    ...points.slice(0, start),
    { ...last, lat: anchor.lat, lng: anchor.lng, accuracyMeters: anchor.accuracyMeters },
  ];
}
