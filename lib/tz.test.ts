import { describe, it, expect } from "vitest";
import { endOfDayTs, todayISO, weekRange } from "./tz";

const TZ = "America/Chicago";

describe("endOfDayTs — end of delivery day in the fleet timezone", () => {
  it("uses CDT (UTC-5) in summer, not UTC", () => {
    // 2026-07-03 23:59 CDT == 2026-07-04 04:59 UTC
    expect(endOfDayTs("2026-07-03", TZ)).toBe(Date.UTC(2026, 6, 4, 4, 59, 0));
  });

  it("uses CST (UTC-6) in winter", () => {
    // 2026-01-15 23:59 CST == 2026-01-16 05:59 UTC
    expect(endOfDayTs("2026-01-15", TZ)).toBe(Date.UTC(2026, 0, 16, 5, 59, 0));
  });

  it("handles the spring-forward DST transition day", () => {
    // US DST starts 2026-03-08; by 23:59 the zone is already CDT (UTC-5).
    expect(endOfDayTs("2026-03-08", TZ)).toBe(Date.UTC(2026, 2, 9, 4, 59, 0));
  });

  it("is later than the naive UTC interpretation", () => {
    const naiveUtc = Date.UTC(2026, 6, 3, 23, 59, 0);
    expect(endOfDayTs("2026-07-03", TZ)).toBeGreaterThan(naiveUtc);
  });
});

describe("todayISO — calendar date in the fleet timezone", () => {
  it("rolls back to the previous day when UTC has already advanced", () => {
    // 03:00 UTC on Jul 3 is still 22:00 Jul 2 in Chicago.
    expect(todayISO(new Date(Date.UTC(2026, 6, 3, 3, 0, 0)), TZ)).toBe("2026-07-02");
  });

  it("matches the UTC date mid-day", () => {
    expect(todayISO(new Date(Date.UTC(2026, 6, 3, 18, 0, 0)), TZ)).toBe("2026-07-03");
  });
});

describe("weekRange — Monday–Sunday week in the fleet timezone", () => {
  it("computes the week from the fleet-tz calendar date, not the UTC date", () => {
    // 03:00 UTC Mon Jul 6 is still Sun Jul 5 in Chicago → week Jun 29–Jul 5.
    const r = weekRange(new Date(Date.UTC(2026, 6, 6, 3, 0, 0)), TZ);
    expect(r).toEqual({ start: "2026-06-29", end: "2026-07-05" });
  });

  it("starts on Monday for a mid-week date", () => {
    // Fri Jul 3 (Chicago) → week Mon Jun 29 – Sun Jul 5.
    const r = weekRange(new Date(Date.UTC(2026, 6, 3, 18, 0, 0)), TZ);
    expect(r).toEqual({ start: "2026-06-29", end: "2026-07-05" });
  });

  it("a Monday maps to itself as week start", () => {
    const r = weekRange(new Date(Date.UTC(2026, 6, 6, 18, 0, 0)), TZ);
    expect(r.start).toBe("2026-07-06");
    expect(r.end).toBe("2026-07-12");
  });
});
