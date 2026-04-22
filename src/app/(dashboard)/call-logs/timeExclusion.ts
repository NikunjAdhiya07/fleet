export type ExcludedTimeRange = {
  startHour: number; // 0-23
  endHour: number; // 0-23 (exclusive boundary)
};

export function isHourInExcludedRange(hour: number, range: ExcludedTimeRange | null | undefined): boolean {
  if (!range) return false;
  const h = Number(hour);
  const start = Number(range.startHour);
  const end = Number(range.endHour);
  if (!Number.isFinite(h) || !Number.isFinite(start) || !Number.isFinite(end)) return false;
  if (start === end) return false;
  if (start < end) return h >= start && h < end;
  return h >= start || h < end;
}

export function formatHourLabel(h: number): string {
  const hour = ((Number(h) % 24) + 24) % 24;
  const period = hour < 12 ? "AM" : "PM";
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display} ${period}`;
}

export function formatHourRangeLabel(startHour: number): string {
  const s = ((Number(startHour) % 24) + 24) % 24;
  const e = (s + 1) % 24;
  return `${formatHourLabel(s)} – ${formatHourLabel(e)}`;
}

export function isHourExcluded(hour: number, excludedHours: ReadonlyArray<number> | null | undefined): boolean {
  if (!excludedHours || excludedHours.length === 0) return false;
  const h = Number(hour);
  if (!Number.isFinite(h)) return false;
  return excludedHours.includes(h);
}

