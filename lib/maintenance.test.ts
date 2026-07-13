import { describe, expect, it } from "vitest";
import { addDaysISO, comparePMAlerts, computePM, formatPMRemaining } from "./maintenance";

const thresholds = { dueSoonMiles: 2_000, dueSoonDays: 7 };
const mileageRule = {
  interval_type: "mileage" as const,
  interval_miles: 25_000,
  interval_days: null,
  last_done_mileage: 100_000,
  last_done_date: null,
};

describe("computePM — mileage", () => {
  it("returns neutral without a baseline", () => {
    const pm = computePM({ ...mileageRule, last_done_mileage: null }, 150_000, thresholds);
    expect(pm).toMatchObject({ status: "ok", nextDue: null, remaining: null, label: "—" });
  });

  it("uses the configured 2,000-mile warning threshold", () => {
    expect(computePM(mileageRule, 123_000, thresholds).status).toBe("due_soon");
    expect(computePM(mileageRule, 122_999, thresholds).status).toBe("ok");
  });

  it("treats exact due as due_now, not overdue", () => {
    const pm = computePM(mileageRule, 125_000, thresholds);
    expect(pm.status).toBe("due_now");
    expect(formatPMRemaining(pm)).toBe("Şimdi yapılmalı");
  });

  it("formats overdue distance without a negative 'remaining' label", () => {
    const pm = computePM(mileageRule, 130_000, thresholds);
    expect(pm.status).toBe("overdue");
    expect(pm.remaining).toBe(-5_000);
    expect(formatPMRemaining(pm)).toBe("5,000 mi gecikti");
  });
});

describe("computePM — date", () => {
  const dateRule = {
    interval_type: "date" as const,
    interval_miles: null,
    interval_days: 30,
    last_done_mileage: null,
    last_done_date: "2026-05-01",
  };

  it("uses timezone-independent calendar arithmetic", () => {
    expect(addDaysISO("2026-05-01", 30)).toBe("2026-05-31");
    expect(computePM(dateRule, 0, thresholds, "2026-05-24")).toMatchObject({
      status: "due_soon",
      nextDue: "2026-05-31",
      remaining: 7,
    });
  });

  it("treats exact due date as due_now", () => {
    expect(computePM(dateRule, 0, thresholds, "2026-05-31").status).toBe("due_now");
  });

  it("marks a past due date overdue", () => {
    const pm = computePM(dateRule, 0, thresholds, "2026-06-02");
    expect(pm.status).toBe("overdue");
    expect(formatPMRemaining(pm)).toBe("2 gün gecikti");
  });
});

describe("alert ordering", () => {
  it("sorts by severity and only compares values within the same unit", () => {
    const overdue = computePM(mileageRule, 130_000, thresholds);
    const dateSoon = computePM(
      { interval_type: "date", interval_miles: null, interval_days: 10, last_done_mileage: null, last_done_date: "2026-07-01" },
      0,
      thresholds,
      "2026-07-05",
    );
    expect(comparePMAlerts(overdue, dateSoon)).toBeLessThan(0);
  });
});
