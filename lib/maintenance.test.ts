import { describe, it, expect } from "vitest";
import { computePM } from "./maintenance";

const base = {
  interval_type: "mileage" as const,
  interval_miles: 25_000,
  interval_days: null,
  last_done_mileage: 100_000,
  last_done_date: null,
};

describe("computePM — mileage rules", () => {
  it("returns the neutral result when last_done_mileage is unknown", () => {
    // A 150k-mile truck with no baseline must NOT be fabricated into "overdue".
    const pm = computePM({ ...base, last_done_mileage: null }, 150_000);
    expect(pm.status).toBe("ok");
    expect(pm.nextDue).toBeNull();
    expect(pm.remaining).toBeNull();
    expect(pm.label).toBe("—");
  });

  it("flags overdue when past the interval", () => {
    const pm = computePM(base, 130_000);
    expect(pm.status).toBe("overdue");
    expect(pm.remaining).toBe(-5_000);
  });

  it("flags due_soon within the threshold", () => {
    const pm = computePM(base, 123_000, 2_500);
    expect(pm.status).toBe("due_soon");
    expect(pm.remaining).toBe(2_000);
  });

  it("flags due_now within 20% of the threshold", () => {
    const pm = computePM(base, 124_600, 2_500);
    expect(pm.status).toBe("due_now");
    expect(pm.remaining).toBe(400);
  });

  it("is ok when far from due", () => {
    const pm = computePM(base, 110_000);
    expect(pm.status).toBe("ok");
    expect(pm.remaining).toBe(15_000);
  });
});

describe("computePM — date rules", () => {
  it("returns the neutral result when last_done_date is unknown", () => {
    const pm = computePM(
      { interval_type: "date", interval_miles: null, interval_days: 90, last_done_mileage: null, last_done_date: null },
      0,
    );
    expect(pm.status).toBe("ok");
    expect(pm.label).toBe("—");
  });

  it("flags overdue when the interval has passed", () => {
    const now = new Date("2026-07-03T12:00:00Z");
    const pm = computePM(
      { interval_type: "date", interval_miles: null, interval_days: 30, last_done_mileage: null, last_done_date: "2026-05-01" },
      0,
      2_500,
      now,
    );
    expect(pm.status).toBe("overdue");
  });
});
