/**
 * Fleet-timezone date helpers.
 *
 * The server runs in UTC (Vercel) but the fleet operates in a US timezone, so
 * naive `new Date("YYYY-MM-DDT23:59:00")` parsing shifts "end of delivery day"
 * 5-8 hours early and week windows drift at the boundaries. Everything
 * schedule-related must go through these helpers instead.
 *
 * Pure functions (no I/O) — unit-tested in lib/tz.test.ts.
 */

export const FLEET_TZ = process.env.FLEET_TIMEZONE ?? "America/Chicago";

/** UTC offset (ms) of `tz` at the given UTC instant. */
function tzOffsetMs(tz: string, utcMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(
    get("year"), get("month") - 1, get("day"),
    get("hour") % 24, get("minute"), get("second"),
  );
  return asUtc - utcMs;
}

/** Epoch ms of `dateStr` (YYYY-MM-DD) at 23:59:00 in the fleet timezone. */
export function endOfDayTs(dateStr: string, tz: string = FLEET_TZ): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  const naiveUtc = Date.UTC(y, m - 1, d, 23, 59, 0);
  // Two passes so DST transitions on the target day resolve correctly.
  let offset = tzOffsetMs(tz, naiveUtc);
  offset = tzOffsetMs(tz, naiveUtc - offset);
  return naiveUtc - offset;
}

/** Today's calendar date (YYYY-MM-DD) in the fleet timezone. */
export function todayISO(now: Date = new Date(), tz: string = FLEET_TZ): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Monday–Sunday week containing `now`, as fleet-timezone calendar dates. */
export function weekRange(
  now: Date = new Date(),
  tz: string = FLEET_TZ,
): { start: string; end: string } {
  const [y, m, d] = todayISO(now, tz).split("-").map(Number);
  // A pure calendar date has a well-defined weekday; UTC math is safe here.
  const today = Date.UTC(y, m - 1, d);
  const diffToMon = (new Date(today).getUTCDay() + 6) % 7; // 0 Mon .. 6 Sun
  const start = today - diffToMon * 86_400_000;
  const end = start + 6 * 86_400_000;
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return { start: iso(start), end: iso(end) };
}
