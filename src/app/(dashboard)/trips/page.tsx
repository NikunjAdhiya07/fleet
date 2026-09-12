"use client";

import { useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from "react";
import {
  Loader2,
  Route,
  MapPin,
  Play,
  Pause,
  Download,
  Printer,
  Gauge,
  Clock,
  Ruler,
  Flag,
  Menu,
  Search,
  X,
  List,
  ChevronDown,
  ChevronUp,
  Minus,
  AlertTriangle,
  Zap,
  PauseCircle,
  Filter,
  BatteryMedium,
} from "lucide-react";
import { format } from "date-fns";
import dynamic from "next/dynamic";
import { useSidebar } from "@/components/layout/SidebarContext";
import {
  SPEED_BANDS,
  detectIdleEvents,
  detectViolations,
  maxSpeedPoint,
  tripStats,
  formatDuration,
  formatDurationPrecise,
  deviceColor,
  batteryAt,
  batteryStats,
  idleEventAt,
  idleMsUpTo,
  type MaxSpeed,
  type TripStats,
} from "@/lib/routeAnalytics";
import type { FocusTarget } from "./RouteHistoryMap";

const RouteHistoryMap = dynamic(() => import("./RouteHistoryMap"), { ssr: false });

interface LocationSession {
  _id: string;
  sessionId: string;
  deviceId: string;
  status: "ACTIVE" | "COMPLETED" | "INTERRUPTED";
  startedAt: string;
  stoppedAt?: string;
  totalPoints: number;
  firstPointAt?: string;
  lastPointAt?: string;
}

interface LocationPoint {
  pointId: string;
  sessionId: string;
  sequenceNumber: number;
  latitude: number;
  longitude: number;
  recordedAt: string;
  speedMetersPerSecond?: number;
  accuracyMeters?: number;
  bearingDegrees?: number;
  altitudeMeters?: number;
  batteryPercent?: number;
  provider?: string;
  isMockLocation?: boolean;
  /** Road geometry filled in between two fixes, not a surveyed sample. */
  isInterpolated?: boolean;
  isRoadSnapped?: boolean;
}

interface FleetDevice {
  deviceId: string;
  employeeName?: string;
  vehicle?: string | { id?: string; registration?: string };
}

type EventFilter = "all" | "idle" | "violations" | "stops" | "trips" | "max";

const STATUS_CHIP: Record<string, string> = {
  ACTIVE: "bg-emerald-500 text-white",
  COMPLETED: "bg-indigo-500 text-white",
  INTERRUPTED: "bg-amber-500 text-white",
};

const SPEED_LIMIT_KEY = "fleet.route.speedLimit.";

const PLAYBACK_SPEEDS = [0.5, 1, 2, 4] as const;
/** Half speed by default — 1× stepped through a day's route too fast to follow. */
const DEFAULT_PLAYBACK_SPEED = 0.5;
/** Frame interval at 1×; slower rates stretch it instead of taking part-steps. */
const PLAYBACK_TICK_MS = 60;

function vehicleLabel(vehicle: FleetDevice["vehicle"]): string | undefined {
  if (!vehicle) return undefined;
  if (typeof vehicle === "string") return vehicle;
  return vehicle.registration || vehicle.id;
}

function deviceDisplayName(d: FleetDevice): string {
  return d.employeeName?.trim() || vehicleLabel(d.vehicle) || d.deviceId;
}

async function reverseGeocode(lat: number, lng: number): Promise<string> {
  const fallback = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!key) return fallback;
  try {
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}` +
        `&result_type=street_address|premise|route|neighborhood&key=${key}`,
      { headers: { Accept: "application/json" } }
    );
    if (!res.ok) return fallback;
    const data = await res.json();
    return data.results?.[0]?.formatted_address || fallback;
  } catch {
    return fallback;
  }
}

function loadSpeedLimit(deviceId: string | null): number {
  if (!deviceId || typeof window === "undefined") return 60;
  const raw = localStorage.getItem(SPEED_LIMIT_KEY + deviceId);
  const n = raw != null ? Number(raw) : 60;
  return Number.isFinite(n) && n > 0 ? n : 60;
}

export default function RouteHistoryPage() {
  const { open } = useSidebar();
  const [devices, setDevices] = useState<FleetDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [deviceQuery, setDeviceQuery] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);

  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [startTime, setStartTime] = useState("00:00");
  const [endTime, setEndTime] = useState("23:59");
  const [formError, setFormError] = useState("");
  const [speedLimitKmh, setSpeedLimitKmh] = useState(60);

  const [isLoading, setIsLoading] = useState(false);
  const [hasQueried, setHasQueried] = useState(false);
  const [points, setPoints] = useState<LocationPoint[]>([]);
  const [sessions, setSessions] = useState<LocationSession[]>([]);
  const [selectedSubTrip, setSelectedSubTrip] = useState<string | null>(null);

  const [startPlace, setStartPlace] = useState("");
  const [endPlace, setEndPlace] = useState("");

  const [playbackIndex, setPlaybackIndex] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(DEFAULT_PLAYBACK_SPEED);

  // Collapsible panels
  const [filtersMinimized, setFiltersMinimized] = useState(false);
  const [statsMinimized, setStatsMinimized] = useState(false);
  const [timelineMinimized, setTimelineMinimized] = useState(false);
  const [tripsMinimized, setTripsMinimized] = useState(false);
  const [legendOpen, setLegendOpen] = useState(true);

  const [eventFilter, setEventFilter] = useState<EventFilter>("all");
  const [focus, setFocus] = useState<FocusTarget>(null);

  const searchWrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/fleet-map");
        if (res.ok && !cancelled) setDevices(await res.json());
      } catch {
        /* ignore */
      }
    };
    load();
    const id = setInterval(load, 8000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!searchWrapRef.current?.contains(e.target as Node)) setPickerOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    setSpeedLimitKmh(loadSpeedLimit(selectedDeviceId));
  }, [selectedDeviceId]);

  const persistSpeedLimit = (v: number) => {
    setSpeedLimitKmh(v);
    if (selectedDeviceId && typeof window !== "undefined") {
      localStorage.setItem(SPEED_LIMIT_KEY + selectedDeviceId, String(v));
    }
  };

  const filteredDevices = useMemo(() => {
    const q = deviceQuery.trim().toLowerCase();
    const list = [...devices].sort((a, b) =>
      deviceDisplayName(a).localeCompare(deviceDisplayName(b))
    );
    if (!q) return list;
    return list.filter((d) => {
      const vehicle = vehicleLabel(d.vehicle) || "";
      const hay = `${d.employeeName || ""} ${vehicle} ${d.deviceId}`.toLowerCase();
      return hay.includes(q);
    });
  }, [devices, deviceQuery]);

  const selectedDevice = devices.find((d) => d.deviceId === selectedDeviceId) || null;
  const selectedLabel = selectedDevice ? deviceDisplayName(selectedDevice) : "";
  const accent = selectedDeviceId ? deviceColor(selectedDeviceId) : "#6366f1";

  const displayedPoints = useMemo(
    () => (selectedSubTrip ? points.filter((p) => p.sessionId === selectedSubTrip) : points),
    [points, selectedSubTrip]
  );

  const idleEvents = useMemo(
    () => detectIdleEvents(displayedPoints),
    [displayedPoints]
  );
  const violations = useMemo(
    () => detectViolations(displayedPoints, speedLimitKmh),
    [displayedPoints, speedLimitKmh]
  );
  const maxSpd: MaxSpeed | null = useMemo(
    () => maxSpeedPoint(displayedPoints),
    [displayedPoints]
  );
  const stats: TripStats | null = useMemo(
    () => tripStats(displayedPoints, idleEvents),
    [displayedPoints, idleEvents]
  );

  const showIdle = eventFilter === "all" || eventFilter === "idle" || eventFilter === "stops";
  const showViolations = eventFilter === "all" || eventFilter === "violations";
  const showMaxSpeed = eventFilter === "all" || eventFilter === "max";

  type TimelineItem = {
    id: string;
    kind: "start" | "end" | "idle" | "violation" | "max" | "trip";
    time: string;
    title: string;
    subtitle: string;
    focus: FocusTarget;
  };

  const timeline: TimelineItem[] = useMemo(() => {
    if (displayedPoints.length === 0) return [];
    const items: TimelineItem[] = [];
    const first = displayedPoints[0];
    const last = displayedPoints[displayedPoints.length - 1];

    items.push({
      id: "start",
      kind: "start",
      time: first.recordedAt,
      title: "Trip start",
      subtitle: format(new Date(first.recordedAt), "HH:mm:ss"),
      focus: { type: "point", idx: 0 },
    });

    for (const e of idleEvents) {
      items.push({
        id: e.id,
        kind: "idle",
        time: e.startTime,
        title: `Idle · ${formatDuration(e.durationMs)}`,
        subtitle: `${format(new Date(e.startTime), "HH:mm")} – ${format(new Date(e.endTime), "HH:mm")}`,
        focus: { type: "idle", id: e.id },
      });
    }

    for (const v of violations) {
      items.push({
        id: v.id,
        kind: "violation",
        time: v.startTime,
        title: `Speeding · ${v.peakKmh.toFixed(0)} km/h`,
        subtitle: `Limit ${speedLimitKmh} · ${formatDuration(v.durationMs)}`,
        focus: { type: "violation", id: v.id },
      });
    }

    if (maxSpd && maxSpd.kmh > 0) {
      items.push({
        id: "max",
        kind: "max",
        time: maxSpd.time,
        title: `Max speed · ${maxSpd.kmh.toFixed(0)} km/h`,
        subtitle: format(new Date(maxSpd.time), "HH:mm:ss"),
        focus: { type: "max", idx: maxSpd.idx },
      });
    }

    if (displayedPoints.length > 1) {
      items.push({
        id: "end",
        kind: "end",
        time: last.recordedAt,
        title: "Trip end",
        subtitle: format(new Date(last.recordedAt), "HH:mm:ss"),
        focus: { type: "point", idx: displayedPoints.length - 1 },
      });
    }

    for (const s of sessions) {
      items.push({
        id: `trip-${s.sessionId}`,
        kind: "trip",
        time: s.startedAt,
        title: `Trip · ${s.status}`,
        subtitle: format(new Date(s.startedAt), "MMM dd, HH:mm"),
        focus: { type: "bounds" },
      });
    }

    items.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

    return items.filter((it) => {
      if (eventFilter === "all") return true;
      if (eventFilter === "idle" || eventFilter === "stops") return it.kind === "idle";
      if (eventFilter === "violations") return it.kind === "violation";
      if (eventFilter === "max") return it.kind === "max";
      if (eventFilter === "trips") return it.kind === "trip" || it.kind === "start" || it.kind === "end";
      return true;
    });
  }, [displayedPoints, idleEvents, violations, maxSpd, sessions, speedLimitKmh, eventFilter]);

  const resetPlayback = () => {
    setIsPlaying(false);
    setPlaybackIndex(null);
    setSpeed(DEFAULT_PLAYBACK_SPEED);
  };

  const viewRoute = useCallback(async () => {
    if (!selectedDeviceId) {
      setFormError("Select a device first.");
      setPickerOpen(true);
      return;
    }
    const from = new Date(`${date}T${startTime}:00`);
    const to = new Date(`${date}T${endTime}:59`);
    if (from.getTime() >= to.getTime()) {
      setFormError("Start time must be before end time.");
      return;
    }
    setFormError("");
    setIsLoading(true);
    setHasQueried(true);
    setSelectedSubTrip(null);
    resetPlayback();
    setStartPlace("");
    setEndPlace("");
    setPoints([]);
    setSessions([]);
    setStatsMinimized(false);
    setTimelineMinimized(false);

    try {
      const params = new URLSearchParams({
        deviceId: selectedDeviceId,
        from: from.toISOString(),
        to: to.toISOString(),
      });
      const [ptsRes, sesRes] = await Promise.all([
        fetch(`/api/location/history?${params}`),
        fetch(
          `/api/location/sessions?deviceId=${encodeURIComponent(selectedDeviceId)}&from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}&limit=200`
        ),
      ]);

      const pts: LocationPoint[] = ptsRes.ok ? await ptsRes.json() : [];
      setPoints(pts);

      if (sesRes.ok) {
        const all: LocationSession[] = await sesRes.json();
        const overlap = all.filter((s) => {
          const sStart = new Date(s.startedAt).getTime();
          const sEnd = s.stoppedAt ? new Date(s.stoppedAt).getTime() : Date.now();
          return sStart <= to.getTime() && sEnd >= from.getTime();
        });
        setSessions(overlap);
      }

      if (pts.length > 0) {
        const first = pts[0];
        const last = pts[pts.length - 1];
        reverseGeocode(first.latitude, first.longitude).then(setStartPlace);
        reverseGeocode(last.latitude, last.longitude).then(setEndPlace);
      }
    } catch {
      setPoints([]);
    } finally {
      setIsLoading(false);
    }
  }, [selectedDeviceId, date, startTime, endTime]);

  useEffect(() => {
    resetPlayback();
  }, [selectedSubTrip]);

  useEffect(() => {
    if (!isPlaying || displayedPoints.length < 2) return;
    // Sub-1× rates slow the tick rather than shrinking the step: a fractional
    // step would land the cursor between samples, and every consumer indexes
    // `displayedPoints` directly.
    const baseStep = Math.max(1, Math.ceil(displayedPoints.length / 300));
    const step = speed >= 1 ? baseStep * speed : baseStep;
    const tickMs = speed >= 1 ? PLAYBACK_TICK_MS : Math.round(PLAYBACK_TICK_MS / speed);
    const id = setInterval(() => {
      setPlaybackIndex((idx) => {
        const next = (idx ?? 0) + step;
        if (next >= displayedPoints.length - 1) return displayedPoints.length - 1;
        return next;
      });
    }, tickMs);
    return () => clearInterval(id);
  }, [isPlaying, speed, displayedPoints.length]);

  useEffect(() => {
    if (playbackIndex != null && playbackIndex >= displayedPoints.length - 1) {
      setIsPlaying(false);
    }
  }, [playbackIndex, displayedPoints.length]);

  const togglePlay = () => {
    if (displayedPoints.length < 2) return;
    if (isPlaying) {
      setIsPlaying(false);
      return;
    }
    if (playbackIndex == null || playbackIndex >= displayedPoints.length - 1) {
      setPlaybackIndex(0);
    }
    setIsPlaying(true);
  };

  const exportCsv = () => {
    if (displayedPoints.length === 0) return;
    const header = "sequence,recordedAt,latitude,longitude,speed_kmh,battery_percent,accuracy_m";
    // Road-geometry fillers exist to draw the route, not to be reported as
    // readings, so the export stays a list of what the device actually logged.
    const rows = displayedPoints
      .filter((p) => !p.isInterpolated)
      .map((p) =>
        [
          p.sequenceNumber,
          new Date(p.recordedAt).toISOString(),
          p.latitude,
          p.longitude,
          p.speedMetersPerSecond != null ? (p.speedMetersPerSecond * 3.6).toFixed(1) : "",
          p.batteryPercent ?? "",
          p.accuracyMeters ?? "",
        ].join(",")
      );
    const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `route-${selectedDeviceId?.slice(0, 8)}-${date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const playbackTime =
    playbackIndex != null && displayedPoints[playbackIndex]
      ? format(new Date(displayedPoints[playbackIndex].recordedAt), "HH:mm:ss")
      : displayedPoints[0]
        ? format(new Date(displayedPoints[0].recordedAt), "HH:mm:ss")
        : "--:--:--";

  // Readouts that track the scrubber, so idle and battery stay truthful at
  // every position rather than only in the whole-trip totals.
  const cursorIdx = playbackIndex ?? 0;
  const cursorBattery = useMemo(
    () => (displayedPoints.length ? batteryAt(displayedPoints, cursorIdx) : null),
    [displayedPoints, cursorIdx]
  );
  const activeIdle = useMemo(
    () => idleEventAt(idleEvents, cursorIdx),
    [idleEvents, cursorIdx]
  );
  const activeIdleElapsedMs =
    activeIdle && displayedPoints[cursorIdx]
      ? Math.max(
          0,
          new Date(displayedPoints[cursorIdx].recordedAt).getTime() -
            new Date(activeIdle.startTime).getTime()
        )
      : 0;
  const idleSoFarMs = useMemo(
    () => idleMsUpTo(idleEvents, displayedPoints, cursorIdx),
    [idleEvents, displayedPoints, cursorIdx]
  );
  const battery = useMemo(() => batteryStats(displayedPoints), [displayedPoints]);

  /**
   * Idle stretches painted onto the scrubber track, so the stops in a route are
   * visible before you scrub onto them.
   */
  const idleTrackGradient = useMemo(() => {
    const n = displayedPoints.length;
    if (n < 2 || idleEvents.length === 0) return undefined;
    const stops: string[] = [];
    let at = 0;
    for (const e of idleEvents) {
      const from = (e.startIdx / (n - 1)) * 100;
      const to = (e.endIdx / (n - 1)) * 100;
      if (to <= at) continue;
      stops.push(`transparent ${at}%`, `transparent ${Math.max(at, from)}%`);
      stops.push(`#d8b4fe ${Math.max(at, from)}%`, `#d8b4fe ${to}%`);
      at = to;
    }
    if (stops.length === 0) return undefined;
    stops.push(`transparent ${at}%`, "transparent 100%");
    return `linear-gradient(to right, ${stops.join(", ")})`;
  }, [displayedPoints.length, idleEvents]);

  const hasRoute = displayedPoints.length > 0 && !!stats;

  const pickDevice = (d: FleetDevice) => {
    setSelectedDeviceId(d.deviceId);
    setDeviceQuery(deviceDisplayName(d));
    setPickerOpen(false);
    setFormError("");
  };

  const kindIcon = (kind: TimelineItem["kind"]) => {
    switch (kind) {
      case "start":
        return <Flag className="h-3.5 w-3.5 text-emerald-500" />;
      case "end":
        return <Flag className="h-3.5 w-3.5 text-rose-500" />;
      case "idle":
        return <PauseCircle className="h-3.5 w-3.5 text-purple-500" />;
      case "violation":
        return <AlertTriangle className="h-3.5 w-3.5 text-rose-600" />;
      case "max":
        return <Zap className="h-3.5 w-3.5 text-amber-500" />;
      case "trip":
        return <Route className="h-3.5 w-3.5 text-indigo-500" />;
    }
  };

  return (
    <div className="relative h-full w-full overflow-hidden bg-slate-200">
      <RouteHistoryMap
        points={displayedPoints}
        playbackIndex={playbackIndex}
        deviceColor={accent}
        idleEvents={idleEvents}
        violations={violations}
        maxSpeed={maxSpd}
        speedLimitKmh={speedLimitKmh}
        showIdle={showIdle}
        showViolations={showViolations}
        showMaxSpeed={showMaxSpeed}
        focus={focus}
        onFocusConsumed={() => setFocus(null)}
      />

      {isLoading && (
        <div className="absolute inset-0 z-[500] flex items-center justify-center bg-black/10">
          <div className="flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-lg">
            <Loader2 className="h-4 w-4 animate-spin text-indigo-600" />
            Loading route…
          </div>
        </div>
      )}

      {/* ─── Left column ─── */}
      <div className="absolute left-3 top-3 z-[1100] flex w-[min(calc(100%-1.5rem),24rem)] flex-col gap-2 sm:left-4 sm:top-4">
        {/* Search */}
        <div ref={searchWrapRef} className="relative">
          <div className="flex items-center gap-1 rounded-full bg-white pl-2 pr-2 shadow-[0_2px_8px_rgba(0,0,0,0.18)]">
            <button
              type="button"
              onClick={() => open()}
              className="rounded-full p-2.5 text-slate-600 hover:bg-slate-100 sm:hidden"
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            <Search className="ml-1 hidden h-4 w-4 shrink-0 text-slate-400 sm:block" />
            <input
              value={deviceQuery}
              onChange={(e) => {
                setDeviceQuery(e.target.value);
                setPickerOpen(true);
                if (!e.target.value) setSelectedDeviceId(null);
              }}
              onFocus={() => setPickerOpen(true)}
              placeholder="Search by name or vehicle…"
              className="h-12 min-w-0 flex-1 bg-transparent text-[15px] text-slate-800 outline-none placeholder:text-slate-400"
            />
            {deviceQuery ? (
              <button
                type="button"
                onClick={() => {
                  setDeviceQuery("");
                  setSelectedDeviceId(null);
                  setPickerOpen(true);
                }}
                className="rounded-full p-2 text-slate-400 hover:bg-slate-100"
                aria-label="Clear"
              >
                <X className="h-4 w-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setPickerOpen((v) => !v)}
                className="rounded-full p-2 text-slate-500 hover:bg-slate-100"
                aria-label="Device list"
              >
                <List className="h-4 w-4" />
              </button>
            )}
          </div>

          {pickerOpen && (
            <div className="mt-2 max-h-[min(42vh,20rem)] overflow-y-auto rounded-2xl bg-white py-1 shadow-[0_4px_16px_rgba(0,0,0,0.18)]">
              {filteredDevices.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-slate-500">
                  {devices.length === 0 ? "No devices yet" : "No matches"}
                </div>
              ) : (
                filteredDevices.map((d) => {
                  const vehicle = vehicleLabel(d.vehicle);
                  const active = selectedDeviceId === d.deviceId;
                  const color = deviceColor(d.deviceId);
                  return (
                    <button
                      key={d.deviceId}
                      type="button"
                      onClick={() => pickDevice(d)}
                      className={`flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-slate-50 ${
                        active ? "bg-indigo-50/70" : ""
                      }`}
                    >
                      <span
                        className="mt-1 inline-block h-3 w-3 shrink-0 rounded-full ring-2 ring-white"
                        style={{ background: color }}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-slate-900">
                          {deviceDisplayName(d)}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-slate-500">
                          {[vehicle && vehicle !== deviceDisplayName(d) ? vehicle : null, `ID ${d.deviceId.slice(0, 8)}…`]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          )}
        </div>

        {/* Filters panel (collapsible) */}
        <CollapsiblePanel
          title="Route History"
          minimized={filtersMinimized}
          onToggle={() => setFiltersMinimized((v) => !v)}
          accent={accent}
        >
          <div className="grid grid-cols-3 gap-2">
            <label className="col-span-3 sm:col-span-1">
              <span className="mb-1 block text-[11px] font-medium text-slate-500">Date</span>
              <input
                type="date"
                value={date}
                max={today}
                onChange={(e) => setDate(e.target.value)}
                className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 px-2 text-sm text-slate-800 outline-none focus:border-indigo-400"
              />
            </label>
            <label>
              <span className="mb-1 block text-[11px] font-medium text-slate-500">Start</span>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 px-2 text-sm text-slate-800 outline-none focus:border-indigo-400"
              />
            </label>
            <label>
              <span className="mb-1 block text-[11px] font-medium text-slate-500">End</span>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 px-2 text-sm text-slate-800 outline-none focus:border-indigo-400"
              />
            </label>
          </div>

          <label className="mt-2 block">
            <span className="mb-1 block text-[11px] font-medium text-slate-500">
              Speed limit (km/h)
            </span>
            <input
              type="number"
              min={10}
              max={200}
              step={5}
              value={speedLimitKmh}
              onChange={(e) => persistSpeedLimit(Number(e.target.value) || 60)}
              className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 px-2 text-sm text-slate-800 outline-none focus:border-indigo-400"
            />
          </label>

          <button
            type="button"
            onClick={viewRoute}
            disabled={isLoading}
            className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-full text-sm font-semibold text-white shadow hover:brightness-110 disabled:opacity-60"
            style={{ background: accent }}
          >
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Route className="h-4 w-4" />}
            View route
          </button>

          {formError && <p className="mt-2 text-xs text-rose-600">{formError}</p>}
        </CollapsiblePanel>

        {/* Stats panel */}
        {hasRoute && (
          <CollapsiblePanel
            title={selectedLabel || "Trip stats"}
            subtitle={selectedDeviceId ? `ID ${selectedDeviceId.slice(0, 12)}…` : undefined}
            minimized={statsMinimized}
            onToggle={() => setStatsMinimized((v) => !v)}
            accent={accent}
            actions={
              <>
                <IconBtn title="Export CSV" onClick={exportCsv}>
                  <Download className="h-4 w-4" />
                </IconBtn>
                <IconBtn title="Print / PDF" onClick={() => window.print()}>
                  <Printer className="h-4 w-4" />
                </IconBtn>
              </>
            }
          >
            <div className="grid grid-cols-2 gap-2 text-xs">
              <Stat icon={<Ruler className="h-3 w-3" />} label="Distance" value={`${stats!.distanceKm.toFixed(2)} km`} />
              <Stat icon={<Clock className="h-3 w-3" />} label="Driving" value={formatDuration(stats!.drivingMs)} />
              <Stat icon={<PauseCircle className="h-3 w-3" />} label="Idle" value={formatDuration(stats!.idleMs)} />
              <Stat icon={<Gauge className="h-3 w-3" />} label="Avg / Max" value={`${stats!.avgKmh.toFixed(0)} / ${stats!.maxKmh.toFixed(0)}`} />
              <Stat icon={<MapPin className="h-3 w-3" />} label="Stops" value={`${stats!.stops}`} />
              <Stat icon={<AlertTriangle className="h-3 w-3" />} label="Violations" value={`${violations.length}`} />
              {battery && (
                <Stat
                  icon={<BatteryMedium className="h-3 w-3" />}
                  label="Battery"
                  value={`${battery.startPercent}% → ${battery.endPercent}%`}
                  hint={`Low ${battery.minPercent}% · ${
                    battery.dropPercent > 0 ? `-${battery.dropPercent}` : `+${-battery.dropPercent}`
                  }% over the route`}
                />
              )}
            </div>

            <div className="mt-2 space-y-1.5 border-t border-slate-100 pt-2 text-xs">
              <p className="flex items-start gap-1.5 text-slate-600">
                <Flag className="mt-0.5 h-3 w-3 shrink-0 text-emerald-500" />
                <span className="line-clamp-2" title={startPlace}>
                  {startPlace || "Resolving start…"}
                </span>
              </p>
              <p className="flex items-start gap-1.5 text-slate-600">
                <Flag className="mt-0.5 h-3 w-3 shrink-0 text-rose-500" />
                <span className="line-clamp-2" title={endPlace}>
                  {endPlace || "Resolving end…"}
                </span>
              </p>
            </div>
          </CollapsiblePanel>
        )}

        {/* Event timeline */}
        {hasRoute && (
          <CollapsiblePanel
            title="Events"
            subtitle={`${timeline.length}`}
            minimized={timelineMinimized}
            onToggle={() => setTimelineMinimized((v) => !v)}
            accent={accent}
          >
            <div className="mb-2 flex flex-wrap gap-1">
              {(
                [
                  ["all", "All"],
                  ["idle", "Idle"],
                  ["violations", "Speeding"],
                  ["max", "Max"],
                  ["trips", "Trips"],
                ] as [EventFilter, string][]
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setEventFilter(key)}
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                    eventFilter === key
                      ? "text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                  style={eventFilter === key ? { background: accent } : undefined}
                >
                  {key === "all" && <Filter className="h-3 w-3" />}
                  {label}
                </button>
              ))}
            </div>

            <div className="max-h-[min(32vh,16rem)] space-y-1 overflow-y-auto">
              {timeline.length === 0 ? (
                <p className="py-4 text-center text-xs text-slate-400">No events for this filter</p>
              ) : (
                timeline.map((it) => (
                  <button
                    key={it.id}
                    type="button"
                    onClick={() => {
                      if (it.kind === "trip") {
                        const sid = it.id.replace(/^trip-/, "");
                        setSelectedSubTrip(sid);
                      }
                      setFocus(it.focus);
                    }}
                    className="flex w-full items-start gap-2 rounded-xl px-2 py-2 text-left hover:bg-slate-50"
                  >
                    <span className="mt-0.5">{kindIcon(it.kind)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium text-slate-800">
                        {it.title}
                      </span>
                      <span className="block truncate text-[11px] text-slate-500">{it.subtitle}</span>
                    </span>
                  </button>
                ))
              )}
            </div>
          </CollapsiblePanel>
        )}
      </div>

      {/* ─── Right: trips list ─── */}
      {hasQueried && sessions.length > 0 && (
        <div className="absolute right-3 top-3 z-[1100] w-[min(calc(100%-1.5rem),18rem)] sm:right-4 sm:top-4">
          <CollapsiblePanel
            title={`Trips (${sessions.length})`}
            minimized={tripsMinimized}
            onToggle={() => setTripsMinimized((v) => !v)}
            accent={accent}
          >
            <div className="max-h-[min(50vh,22rem)] space-y-1 overflow-y-auto">
              <button
                type="button"
                onClick={() => {
                  setSelectedSubTrip(null);
                  setFocus({ type: "bounds" });
                }}
                className={`w-full rounded-xl px-3 py-2 text-left text-xs ${
                  selectedSubTrip === null
                    ? "font-semibold text-white"
                    : "text-slate-600 hover:bg-slate-50"
                }`}
                style={selectedSubTrip === null ? { background: accent } : undefined}
              >
                All trips · {points.length} pts
              </button>
              {sessions.map((s) => {
                const sPts = points.filter((p) => p.sessionId === s.sessionId).length;
                const active = selectedSubTrip === s.sessionId;
                return (
                  <button
                    key={s._id}
                    type="button"
                    onClick={() => {
                      setSelectedSubTrip(s.sessionId);
                      setFocus({ type: "bounds" });
                    }}
                    className={`w-full rounded-xl border px-3 py-2 text-left transition-colors ${
                      active ? "border-transparent text-white" : "border-transparent hover:bg-slate-50"
                    }`}
                    style={active ? { background: accent } : undefined}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={`truncate text-xs font-medium ${active ? "text-white" : "text-slate-900"}`}>
                        {selectedLabel || s.deviceId}
                      </span>
                      {!active && (
                        <span
                          className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                            STATUS_CHIP[s.status] || "bg-slate-400 text-white"
                          }`}
                        >
                          {s.status}
                        </span>
                      )}
                    </div>
                    <p className={`mt-1 text-[11px] ${active ? "text-white/80" : "text-slate-500"}`}>
                      {format(new Date(s.startedAt), "MMM dd, HH:mm")}
                      {s.stoppedAt && ` – ${format(new Date(s.stoppedAt), "HH:mm")}`}
                    </p>
                    <p className={`mt-0.5 text-[11px] ${active ? "text-white/70" : "text-slate-400"}`}>
                      {sPts || s.totalPoints} pts
                    </p>
                  </button>
                );
              })}
            </div>
          </CollapsiblePanel>
        </div>
      )}

      {/* ─── Speed legend (bottom-left) ─── */}
      {hasRoute && (
        <div className="absolute bottom-20 left-3 z-[1100] sm:bottom-24 sm:left-4">
          <div className="overflow-hidden rounded-2xl bg-white shadow-[0_2px_10px_rgba(0,0,0,0.16)]">
            <button
              type="button"
              onClick={() => setLegendOpen((v) => !v)}
              className="flex w-full items-center justify-between gap-3 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              <span>Speed legend</span>
              {legendOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
            </button>
            {legendOpen && (
              <div className="space-y-1.5 border-t border-slate-100 px-3 py-2">
                {SPEED_BANDS.map((b) => (
                  <div key={b.band} className="flex items-center gap-2 text-[11px] text-slate-600">
                    <span className="h-2.5 w-6 rounded-full" style={{ background: b.color }} />
                    <span>
                      {b.label}
                      {b.maxKmh !== Infinity
                        ? b.band === "idle"
                          ? ` (< ${b.maxKmh} km/h)`
                          : ` (< ${b.maxKmh} km/h)`
                        : " (≥ 70 km/h)"}
                    </span>
                  </div>
                ))}
                <div className="flex items-center gap-2 border-t border-slate-100 pt-1.5 text-[11px] text-slate-600">
                  <span className="h-2.5 w-6 rounded-full" style={{ background: accent }} />
                  <span>Device accent</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── Playback bar ─── */}
      {hasRoute && displayedPoints.length > 1 && (
        <div className="absolute bottom-3 left-1/2 z-[1100] w-[min(720px,calc(100%-1.5rem))] -translate-x-1/2 sm:bottom-4">
          <div className="flex items-center gap-3 rounded-full bg-white px-3 py-2 shadow-[0_2px_12px_rgba(0,0,0,0.2)]">
            <button
              type="button"
              onClick={togglePlay}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white hover:brightness-110"
              style={{ background: accent }}
              aria-label={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </button>
            <span className="w-16 shrink-0 font-mono text-xs tabular-nums text-slate-600">
              {playbackTime}
            </span>

            <div className="relative min-w-0 flex-1">
              {idleTrackGradient && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full"
                  style={{ backgroundImage: idleTrackGradient }}
                />
              )}
              <input
                type="range"
                min={0}
                max={Math.max(0, displayedPoints.length - 1)}
                value={playbackIndex ?? 0}
                onChange={(e) => {
                  setIsPlaying(false);
                  setPlaybackIndex(Number(e.target.value));
                }}
                className="relative w-full bg-transparent"
                style={{ accentColor: accent }}
              />
            </div>

            {/* Live idle + battery readouts, alongside the existing time/speed */}
            <div className="hidden shrink-0 items-center gap-1.5 sm:flex">
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold tabular-nums ${
                  activeIdle ? "bg-purple-100 text-purple-700" : "bg-slate-100 text-slate-500"
                }`}
                title={
                  activeIdle
                    ? `Stopped here for ${formatDurationPrecise(activeIdle.durationMs)} · ${formatDurationPrecise(idleSoFarMs)} idle so far`
                    : `${formatDurationPrecise(idleSoFarMs)} idle so far · ${formatDurationPrecise(stats!.idleMs)} total`
                }
              >
                <PauseCircle className="h-3 w-3" />
                {activeIdle
                  ? formatDurationPrecise(activeIdleElapsedMs)
                  : formatDurationPrecise(idleSoFarMs)}
              </span>
              {cursorBattery != null && (
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold tabular-nums ${
                    cursorBattery <= 15
                      ? "bg-rose-100 text-rose-700"
                      : cursorBattery <= 35
                        ? "bg-amber-100 text-amber-700"
                        : "bg-emerald-100 text-emerald-700"
                  }`}
                  title={
                    battery
                      ? `Battery ${cursorBattery}% · route ${battery.startPercent}% → ${battery.endPercent}% (low ${battery.minPercent}%)`
                      : `Battery ${cursorBattery}%`
                  }
                >
                  <BatteryMedium className="h-3 w-3" />
                  {cursorBattery}%
                </span>
              )}
            </div>

            <div className="flex shrink-0 gap-1">
              {PLAYBACK_SPEEDS.map((sp) => (
                <button
                  key={sp}
                  type="button"
                  onClick={() => setSpeed(sp)}
                  className={`rounded-full px-2 py-1 text-xs font-semibold ${
                    speed === sp ? "text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                  style={speed === sp ? { background: accent } : undefined}
                >
                  {sp}×
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {!isLoading && hasQueried && !hasRoute && (
        <div className="pointer-events-none absolute inset-x-0 bottom-16 z-[1000] flex justify-center px-4">
          <div className="rounded-2xl bg-white px-4 py-3 text-center shadow-lg">
            <p className="text-sm font-medium text-slate-800">No GPS points in this interval</p>
            <p className="mt-0.5 text-xs text-slate-500">Try another device, day, or time range.</p>
          </div>
        </div>
      )}

      {!isLoading && !hasQueried && (
        <div className="pointer-events-none absolute inset-x-0 bottom-8 z-[1000] flex justify-center px-4">
          <div className="rounded-full bg-white/95 px-4 py-2 text-xs font-medium text-slate-600 shadow">
            Search by name, set the interval, then View route
          </div>
        </div>
      )}
    </div>
  );
}

function CollapsiblePanel({
  title,
  subtitle,
  minimized,
  onToggle,
  children,
  actions,
  accent,
}: {
  title: string;
  subtitle?: string;
  minimized: boolean;
  onToggle: () => void;
  children: ReactNode;
  actions?: ReactNode;
  accent?: string;
}) {
  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-[0_2px_10px_rgba(0,0,0,0.16)]">
      <div className="flex items-center gap-2 px-3 py-2">
        {accent && (
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: accent }} />
        )}
        <button
          type="button"
          onClick={onToggle}
          className="min-w-0 flex-1 text-left"
        >
          <p className="truncate text-xs font-semibold uppercase tracking-wide text-slate-500">
            {title}
          </p>
          {subtitle && (
            <p className="truncate font-mono text-[10px] text-slate-400">{subtitle}</p>
          )}
        </button>
        <div className="flex shrink-0 items-center gap-0.5">
          {actions}
          <button
            type="button"
            onClick={onToggle}
            className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label={minimized ? "Expand" : "Minimize"}
            title={minimized ? "Expand" : "Minimize"}
          >
            {minimized ? <ChevronDown className="h-4 w-4" /> : <Minus className="h-4 w-4" />}
          </button>
        </div>
      </div>
      {!minimized && <div className="border-t border-slate-100 p-3">{children}</div>}
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  hint,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl bg-slate-50 px-2.5 py-2" title={hint}>
      <p className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-slate-400">
        {icon}
        {label}
      </p>
      <p className="mt-0.5 text-sm font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function IconBtn({
  children,
  onClick,
  title,
}: {
  children: ReactNode;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="rounded-full p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
    >
      {children}
    </button>
  );
}
