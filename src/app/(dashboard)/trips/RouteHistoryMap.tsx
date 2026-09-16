"use client";

import {
  AdvancedMarker,
  AdvancedMarkerAnchorPoint,
  InfoWindow,
  useMap,
} from "@vis.gl/react-google-maps";
import { useEffect, useMemo, useState } from "react";
import MapShell from "@/components/maps/MapShell";
import { FitBounds, Polyline, type LatLng } from "@/components/maps/overlays";
import {
  type RoutePoint,
  type IdleEvent,
  type ViolationSegment,
  type MaxSpeed,
  speedSegments,
  headingAt,
  speedKmh,
  batteryAt,
  idleEventAt,
  formatDuration,
  formatDurationPrecise,
  VIOLATION_COLOR,
  IDLE_COLOR,
} from "@/lib/routeAnalytics";

export type LocationPoint = RoutePoint;

export type FocusTarget =
  | { type: "point"; idx: number }
  | { type: "idle"; id: string }
  | { type: "violation"; id: string }
  | { type: "max"; idx: number }
  | { type: "bounds" }
  | null;

interface Props {
  points: LocationPoint[];
  playbackIndex?: number | null;
  emptyCenter?: [number, number];
  deviceColor?: string;
  idleEvents?: IdleEvent[];
  violations?: ViolationSegment[];
  maxSpeed?: MaxSpeed | null;
  speedLimitKmh?: number;
  showIdle?: boolean;
  showViolations?: boolean;
  showMaxSpeed?: boolean;
  focus?: FocusTarget;
  onFocusConsumed?: () => void;
}

/** routeAnalytics works in Leaflet's [lat, lng] tuples; Google wants literals. */
const toLatLng = (p: [number, number]): LatLng => ({ lat: p[0], lng: p[1] });

function FocusController({
  focus,
  points,
  idleEvents,
  violations,
  onConsumed,
}: {
  focus: FocusTarget;
  points: LocationPoint[];
  idleEvents: IdleEvent[];
  violations: ViolationSegment[];
  onConsumed?: () => void;
}) {
  const map = useMap();
  useEffect(() => {
    if (!map || !focus) return;
    let target: LatLng | null = null;

    if (focus.type === "point" || focus.type === "max") {
      const p = points[focus.idx];
      if (p) target = { lat: p.latitude, lng: p.longitude };
    } else if (focus.type === "idle") {
      const e = idleEvents.find((x) => x.id === focus.id);
      if (e) target = { lat: e.latitude, lng: e.longitude };
    } else if (focus.type === "violation") {
      const v = violations.find((x) => x.id === focus.id);
      if (v) {
        const p = points[v.peakIdx] || points[v.startIdx];
        if (p) target = { lat: p.latitude, lng: p.longitude };
      }
    } else if (focus.type === "bounds" && points.length > 0) {
      const bounds = new google.maps.LatLngBounds();
      points.forEach((p) => bounds.extend({ lat: p.latitude, lng: p.longitude }));
      map.fitBounds(bounds, 100);
      onConsumed?.();
      return;
    }

    if (target) {
      map.panTo(target);
      if ((map.getZoom() ?? 0) < 16) map.setZoom(16);
    }
    onConsumed?.();
  }, [focus, map, points, idleEvents, violations, onConsumed]);
  return null;
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    day: "2-digit",
    month: "short",
  });
}

/**
 * Direction chevron repeated along the drawn route.
 *
 * Path coordinates are symbol-space (origin at the anchor, -y pointing along the
 * line) and the string form avoids touching `google.maps.SymbolPath` during
 * render, before the Maps library has finished loading.
 */
const DIRECTION_ARROW_PATH = "M 0 -7 L 5 6 L 0 2.5 L -5 6 Z";
/** Pixel spacing between direction arrows — constant on screen at any zoom. */
const DIRECTION_ARROW_REPEAT = "110px";

/**
 * Direction-of-travel arrow, rotated to the heading.
 *
 * The path is drawn so its bounding box is centred in the viewBox: the glyph is
 * anchored on the route point itself, and `rotate` pivots about the box centre,
 * so the arrow stays on the line at every heading instead of swinging off it.
 */
function ArrowGlyph({
  color,
  heading,
  size = 28,
}: {
  color: string;
  heading: number;
  size?: number;
}) {
  return (
    <div
      style={{
        width: size,
        height: size,
        transform: `rotate(${heading}deg)`,
        filter: "drop-shadow(0 1px 2px rgba(0,0,0,.45))",
      }}
    >
      <svg width={size} height={size} viewBox="0 0 24 24">
        <path
          d="M12 3 L20 21 L12 17 L4 21 Z"
          fill={color}
          stroke="#fff"
          strokeWidth={1.5}
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

function PinGlyph({
  color,
  glyph,
  size = 26,
}: {
  color: string;
  glyph: string;
  size?: number;
}) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: color,
        border: "2px solid #fff",
        boxShadow: "0 1px 4px rgba(0,0,0,.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#fff",
        fontSize: 11,
        fontWeight: 700,
        fontFamily: "system-ui, sans-serif",
      }}
    >
      {glyph}
    </div>
  );
}

/** Paused glyph shown in place of the arrow while the cursor sits inside a stop. */
function IdleGlyph({ size = 32 }: { size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: IDLE_COLOR,
        border: "3px solid #fff",
        boxShadow: "0 1px 6px rgba(0,0,0,.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#fff",
        fontSize: size * 0.45,
        fontWeight: 700,
      }}
    >
      ⏸
    </div>
  );
}

function batteryTone(pct: number): string {
  if (pct <= 15) return "text-rose-600";
  if (pct <= 35) return "text-amber-600";
  return "text-emerald-600";
}

/**
 * Readout that follows the route cursor. Rendered inside the marker's own DOM
 * rather than an InfoWindow so hovering cannot flicker: the card is a child of
 * the element being hovered, so it never steals the pointer from it.
 */
function CursorHoverCard({
  point,
  battery,
  idle,
  idleElapsedMs,
}: {
  point: LocationPoint;
  battery: number | null;
  idle: IdleEvent | null;
  idleElapsedMs: number;
}) {
  return (
    <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 hidden -translate-x-1/2 group-hover:block">
      <div className="w-max min-w-[168px] rounded-lg bg-slate-900/95 px-2.5 py-2 font-sans text-[11px] leading-tight text-white shadow-lg">
        <DarkRow k="Time" v={fmtTime(point.recordedAt)} />
        <DarkRow k="Speed" v={`${speedKmh(point).toFixed(1)} km/h`} />
        <DarkRow
          k="Battery"
          v={battery != null ? `${battery}%` : "—"}
          tone={battery != null ? batteryTone(battery) : undefined}
        />
        {idle && (
          <DarkRow
            k="Idle"
            v={`${formatDurationPrecise(idleElapsedMs)} of ${formatDurationPrecise(idle.durationMs)}`}
          />
        )}
        {point.accuracyMeters != null && (
          <DarkRow k="Accuracy" v={`±${point.accuracyMeters.toFixed(0)} m`} />
        )}
      </div>
      <div className="mx-auto h-0 w-0 border-x-[5px] border-t-[5px] border-x-transparent border-t-slate-900/95" />
    </div>
  );
}

function DarkRow({ k, v, tone }: { k: string; v: string; tone?: string }) {
  return (
    <div className="flex justify-between gap-3 py-[1px]">
      <span className="text-slate-400">{k}</span>
      <span className={`font-semibold ${tone ?? "text-white"}`}>{v}</span>
    </div>
  );
}

export default function RouteHistoryMap({
  points,
  playbackIndex = null,
  emptyCenter = [20.5937, 78.9629],
  deviceColor = "#6366f1",
  idleEvents = [],
  violations = [],
  maxSpeed = null,
  speedLimitKmh = 0,
  showIdle = true,
  showViolations = true,
  showMaxSpeed = true,
  focus = null,
  onFocusConsumed,
}: Props) {
  const [openInfo, setOpenInfo] = useState<string | null>(null);

  const routeKey = useMemo(
    () =>
      points.length
        ? `${points[0].recordedAt}|${points.length}|${points[points.length - 1].recordedAt}`
        : "",
    [points]
  );

  const latlngs = useMemo<LatLng[]>(
    () => points.map((p) => ({ lat: p.latitude, lng: p.longitude })),
    [points]
  );

  const center = latlngs[0] || { lat: emptyCenter[0], lng: emptyCenter[1] };
  const first = points[0];
  const last = points[points.length - 1];

  const isPlaying = playbackIndex != null;
  const clampedIdx =
    isPlaying && points.length > 0
      ? Math.min(Math.max(playbackIndex!, 0), points.length - 1)
      : null;

  // During playback, only draw segments up to the cursor.
  const visiblePoints = useMemo(
    () => (clampedIdx != null ? points.slice(0, clampedIdx + 1) : points),
    [points, clampedIdx]
  );
  const segments = useMemo(() => speedSegments(visiblePoints), [visiblePoints]);
  const ghostSegments = useMemo(
    () => (isPlaying ? speedSegments(points) : []),
    [isPlaying, points]
  );

  const cursor = clampedIdx != null ? points[clampedIdx] : null;
  const cursorHeading = clampedIdx != null ? headingAt(points, clampedIdx) : 0;
  const staticArrowIdx = points.length > 1 ? points.length - 1 : 0;
  const staticHeading = headingAt(points, staticArrowIdx);

  /** The marker index the hover readout describes — playback cursor or route end. */
  const readoutIdx = clampedIdx ?? staticArrowIdx;
  const readoutPoint = points[readoutIdx] ?? null;
  const readoutBattery = useMemo(
    () => (points.length ? batteryAt(points, readoutIdx) : null),
    [points, readoutIdx]
  );
  const cursorIdle = useMemo(
    () => (clampedIdx != null ? idleEventAt(idleEvents, clampedIdx) : null),
    [idleEvents, clampedIdx]
  );
  const cursorIdleElapsedMs =
    cursorIdle && cursor
      ? Math.max(
          0,
          new Date(cursor.recordedAt).getTime() - new Date(cursorIdle.startTime).getTime()
        )
      : 0;

  // Arrows ride the drawn path itself, so their direction comes from the route
  // geometry and stays correct through and after every stop.
  const arrowPath = useMemo(
    () => visiblePoints.map((p) => ({ lat: p.latitude, lng: p.longitude })),
    [visiblePoints]
  );
  const directionIcons = useMemo(
    () => [
      {
        icon: {
          path: DIRECTION_ARROW_PATH,
          fillColor: deviceColor,
          fillOpacity: 1,
          strokeColor: "#ffffff",
          strokeWeight: 1.2,
          scale: 1,
        },
        offset: "0",
        repeat: DIRECTION_ARROW_REPEAT,
      },
    ],
    [deviceColor]
  );

  const violationPolylines = showViolations ? violations : [];

  return (
    <MapShell defaultCenter={center} defaultZoom={points.length ? 14 : 5}>
      {latlngs.length > 0 && (
        <FitBounds
          points={latlngs}
          enabled
          fitOnceKey={routeKey}
          padding={100}
          maxZoom={16}
        />
      )}
      <FocusController
        focus={focus}
        points={points}
        idleEvents={idleEvents}
        violations={violations}
        onConsumed={onFocusConsumed}
      />

      {points.length > 0 && (
        <>
          {/* Ghost full route while playing */}
          {isPlaying &&
            ghostSegments.map((seg, i) => (
              <Polyline
                key={`g-${i}`}
                path={seg.positions.map(toLatLng)}
                strokeColor={seg.color}
                strokeWeight={3}
                strokeOpacity={0.2}
              />
            ))}

          {/* Device-color underlay — one unbroken line so the route always reads
              as continuous even where the speed bands change or a stop sits. */}
          <Polyline
            path={latlngs.slice(0, (clampedIdx ?? latlngs.length - 1) + 1)}
            strokeColor={deviceColor}
            strokeWeight={7}
            strokeOpacity={0.35}
          />

          {/* Speed-colored route */}
          {segments.map((seg, i) =>
            seg.isGap ? (
              // Logging gap: the vehicle travelled untracked, so show the join
              // dashed rather than implying a surveyed leg.
              <Polyline
                key={`s-${i}`}
                path={seg.positions.map(toLatLng)}
                strokeColor={seg.color}
                strokeWeight={0}
                strokeOpacity={0}
                icons={[
                  {
                    icon: { path: "M 0,-1 0,1", strokeOpacity: 0.7, strokeWeight: 4, scale: 3 },
                    offset: "0",
                    repeat: "14px",
                  },
                ]}
              />
            ) : (
              <Polyline
                key={`s-${i}`}
                path={seg.positions.map(toLatLng)}
                strokeColor={seg.color}
                strokeWeight={5}
                strokeOpacity={0.92}
              />
            )
          )}

          {/* Direction-of-travel arrows spaced along the whole drawn route */}
          {arrowPath.length > 1 && (
            <Polyline
              path={arrowPath}
              strokeOpacity={0}
              strokeWeight={0}
              icons={directionIcons}
              zIndex={3}
            />
          )}

          {/* Speeding segments highlight */}
          {violationPolylines.map((v) => (
            <Polyline
              key={v.id}
              path={v.positions.map(toLatLng)}
              strokeColor={VIOLATION_COLOR}
              strokeWeight={7}
              strokeOpacity={0.55}
              onClick={() => setOpenInfo(`v:${v.id}`)}
            />
          ))}

          {violationPolylines.map((v) =>
            openInfo === `v:${v.id}` ? (
              <InfoWindow
                key={`vi-${v.id}`}
                position={toLatLng(v.positions[Math.floor(v.positions.length / 2)])}
                onCloseClick={() => setOpenInfo(null)}
              >
                <div className="min-w-[180px] font-sans text-xs">
                  <p className="mb-1 font-bold text-rose-700">Speed violation</p>
                  <Row k="Peak" v={`${v.peakKmh.toFixed(1)} km/h`} />
                  {speedLimitKmh > 0 && <Row k="Limit" v={`${speedLimitKmh} km/h`} />}
                  <Row k="Start" v={fmtTime(v.startTime)} />
                  <Row k="End" v={fmtTime(v.endTime)} />
                  <Row k="Duration" v={formatDuration(v.durationMs)} />
                </div>
              </InfoWindow>
            ) : null
          )}

          {/* Start */}
          {first && (
            <>
              <AdvancedMarker
                position={{ lat: first.latitude, lng: first.longitude }}
                title={`Trip start · ${fmtTime(first.recordedAt)}`}
                onClick={() => setOpenInfo("start")}
              >
                <PinGlyph color="#10b981" glyph="S" size={28} />
              </AdvancedMarker>
              {openInfo === "start" && (
                <InfoWindow
                  position={{ lat: first.latitude, lng: first.longitude }}
                  onCloseClick={() => setOpenInfo(null)}
                >
                  <div className="font-sans text-xs">
                    <p className="mb-1 font-bold text-emerald-700">Trip start</p>
                    <Row k="Time" v={fmtTime(first.recordedAt)} />
                    <Row
                      k="Coords"
                      v={`${first.latitude.toFixed(5)}, ${first.longitude.toFixed(5)}`}
                    />
                  </div>
                </InfoWindow>
              )}
            </>
          )}

          {/* End */}
          {points.length > 1 && last && (
            <>
              <AdvancedMarker
                position={{ lat: last.latitude, lng: last.longitude }}
                title={`Trip end · ${fmtTime(last.recordedAt)}`}
                onClick={() => setOpenInfo("end")}
              >
                <PinGlyph color="#ef4444" glyph="E" size={28} />
              </AdvancedMarker>
              {openInfo === "end" && (
                <InfoWindow
                  position={{ lat: last.latitude, lng: last.longitude }}
                  onCloseClick={() => setOpenInfo(null)}
                >
                  <div className="font-sans text-xs">
                    <p className="mb-1 font-bold text-rose-700">Trip end</p>
                    <Row k="Time" v={fmtTime(last.recordedAt)} />
                    <Row
                      k="Coords"
                      v={`${last.latitude.toFixed(5)}, ${last.longitude.toFixed(5)}`}
                    />
                  </div>
                </InfoWindow>
              )}
            </>
          )}

          {/* Idle markers */}
          {showIdle &&
            idleEvents.map((e) => (
              <span key={e.id}>
                <AdvancedMarker
                  position={{ lat: e.latitude, lng: e.longitude }}
                  title={`Idle ${formatDuration(e.durationMs)}`}
                  onClick={() => setOpenInfo(`idle:${e.id}`)}
                >
                  <PinGlyph color={IDLE_COLOR} glyph="⏸" size={26} />
                </AdvancedMarker>
                {openInfo === `idle:${e.id}` && (
                  <InfoWindow
                    position={{ lat: e.latitude, lng: e.longitude }}
                    onCloseClick={() => setOpenInfo(null)}
                  >
                    <div className="min-w-[180px] font-sans text-xs">
                      <p className="mb-1 font-bold text-purple-700">Idle / Stopped</p>
                      <Row k="Duration" v={`Idle for ${formatDurationPrecise(e.durationMs)}`} />
                      {batteryAt(points, e.startIdx) != null && (
                        <Row k="Battery" v={`${batteryAt(points, e.startIdx)}%`} />
                      )}
                      <Row k="Start" v={fmtTime(e.startTime)} />
                      <Row k="End" v={fmtTime(e.endTime)} />
                      <Row
                        k="Location"
                        v={`${e.latitude.toFixed(5)}, ${e.longitude.toFixed(5)}`}
                      />
                    </div>
                  </InfoWindow>
                )}
              </span>
            ))}

          {/* Max speed */}
          {showMaxSpeed && maxSpeed && maxSpeed.kmh > 0 && (
            <>
              <AdvancedMarker
                position={{ lat: maxSpeed.latitude, lng: maxSpeed.longitude }}
                title={`Max ${maxSpeed.kmh.toFixed(0)} km/h`}
                onClick={() => setOpenInfo("max")}
              >
                <PinGlyph color="#f59e0b" glyph="⚡" size={26} />
              </AdvancedMarker>
              {openInfo === "max" && (
                <InfoWindow
                  position={{ lat: maxSpeed.latitude, lng: maxSpeed.longitude }}
                  onCloseClick={() => setOpenInfo(null)}
                >
                  <div className="min-w-[180px] font-sans text-xs">
                    <p className="mb-1 font-bold text-amber-700">Maximum speed</p>
                    <Row k="Speed" v={`${maxSpeed.kmh.toFixed(1)} km/h`} />
                    <Row k="Time" v={fmtTime(maxSpeed.time)} />
                    <Row
                      k="Location"
                      v={`${maxSpeed.latitude.toFixed(5)}, ${maxSpeed.longitude.toFixed(5)}`}
                    />
                  </div>
                </InfoWindow>
              )}
            </>
          )}

          {/* Violation peak markers */}
          {showViolations &&
            violations.map((v) => {
              const p = points[v.peakIdx];
              if (!p) return null;
              return (
                <span key={`vm-${v.id}`}>
                  <AdvancedMarker
                    position={{ lat: p.latitude, lng: p.longitude }}
                    title={`${v.peakKmh.toFixed(0)} km/h over limit`}
                    onClick={() => setOpenInfo(`vp:${v.id}`)}
                  >
                    <PinGlyph color={VIOLATION_COLOR} glyph="!" size={24} />
                  </AdvancedMarker>
                  {openInfo === `vp:${v.id}` && (
                    <InfoWindow
                      position={{ lat: p.latitude, lng: p.longitude }}
                      onCloseClick={() => setOpenInfo(null)}
                    >
                      <div className="min-w-[180px] font-sans text-xs">
                        <p className="mb-1 font-bold text-rose-700">Speed violation</p>
                        <Row k="Actual" v={`${v.peakKmh.toFixed(1)} km/h`} />
                        {speedLimitKmh > 0 && <Row k="Expected" v={`${speedLimitKmh} km/h`} />}
                        <Row k="Time" v={fmtTime(v.startTime)} />
                        <Row k="Duration" v={formatDuration(v.durationMs)} />
                      </div>
                    </InfoWindow>
                  )}
                </span>
              );
            })}

          {/* Playback / live cursor — speed, time and battery on hover */}
          {readoutPoint && (
            <>
              <AdvancedMarker
                position={{ lat: readoutPoint.latitude, lng: readoutPoint.longitude }}
                // Centre the glyph on its coordinate. The default bottom-centre
                // anchor floats the arrow above the route; centring puts it on
                // the line, so it reads as the vehicle's actual position.
                anchorPoint={AdvancedMarkerAnchorPoint.CENTER}
                title={[
                  `${speedKmh(readoutPoint).toFixed(0)} km/h`,
                  fmtTime(readoutPoint.recordedAt),
                  readoutBattery != null ? `${readoutBattery}% battery` : null,
                  cursorIdle ? `idle ${formatDurationPrecise(cursorIdleElapsedMs)}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                zIndex={cursor ? 1000 : 500}
                onClick={() => setOpenInfo("cursor")}
              >
                <div className="group relative flex items-center justify-center">
                  <CursorHoverCard
                    point={readoutPoint}
                    battery={readoutBattery}
                    idle={cursorIdle}
                    idleElapsedMs={cursorIdleElapsedMs}
                  />
                  {cursorIdle ? (
                    <IdleGlyph size={30} />
                  ) : (
                    <ArrowGlyph
                      color={deviceColor}
                      heading={cursor ? cursorHeading : staticHeading}
                      size={cursor ? 32 : 30}
                    />
                  )}
                </div>
              </AdvancedMarker>
              {openInfo === "cursor" && (
                <InfoWindow
                  position={{ lat: readoutPoint.latitude, lng: readoutPoint.longitude }}
                  onCloseClick={() => setOpenInfo(null)}
                >
                  <PointDetails
                    p={readoutPoint}
                    battery={readoutBattery}
                    idle={cursorIdle}
                    idleElapsedMs={cursorIdleElapsedMs}
                  />
                </InfoWindow>
              )}
            </>
          )}
        </>
      )}
    </MapShell>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3 py-0.5">
      <span className="text-slate-500">{k}</span>
      <span className="font-medium text-slate-800">{v}</span>
    </div>
  );
}

function PointDetails({
  p,
  battery = null,
  idle = null,
  idleElapsedMs = 0,
}: {
  p: LocationPoint;
  battery?: number | null;
  idle?: IdleEvent | null;
  idleElapsedMs?: number;
}) {
  const level = p.batteryPercent ?? battery;
  return (
    <div className="min-w-[190px] font-sans text-xs">
      <p className="mb-1.5 font-bold text-slate-900">
        GPS point
        {p.isMockLocation && (
          <span className="ml-1 text-[10px] font-semibold uppercase text-rose-600">mock</span>
        )}
      </p>
      <Row k="Time" v={fmtTime(p.recordedAt)} />
      <Row k="Speed" v={`${speedKmh(p).toFixed(1)} km/h`} />
      {level != null && <Row k="Battery" v={`${level}%`} />}
      {idle && (
        <Row
          k="Idle"
          v={`${formatDurationPrecise(idleElapsedMs)} of ${formatDurationPrecise(idle.durationMs)}`}
        />
      )}
      {p.accuracyMeters != null && <Row k="Accuracy" v={`±${p.accuracyMeters.toFixed(0)} m`} />}
      {p.bearingDegrees != null && <Row k="Bearing" v={`${p.bearingDegrees.toFixed(0)}°`} />}
      <Row k="Coords" v={`${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)}`} />
    </div>
  );
}
