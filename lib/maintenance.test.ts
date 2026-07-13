import { describe, expect, it } from "vitest";
import {
  addDaysISO,
  comparePMAlerts,
  computePM,
  formatPMRemaining,
  formatPMWhichever,
  recommendWetPMInterval,
} from "./maintenance";

const thresholds = { dueSoonMiles: 2_000, dueSoonDays: 7, dueSoonEngineHours: 100 };
const mileageRule = {
  interval_type: "mileage" as const,
  interval_miles: 25_000,
  interval_days: null,
  interval_engine_hours: null,
  last_done_mileage: 100_000,
  last_done_date: null,
  last_done_engine_hours: null,
};

describe("computePM - mileage", () => {
  it("returns neutral without a baseline", () => {
    const pm = computePM({ ...mileageRule, last_done_mileage: null }, 150_000, thresholds);
    expect(pm).toMatchObject({ status: "ok", nextDue: null, remaining: null, label: "-" });
  });

  it("uses the configured 2,000-mile due-soon threshold", () => {
    expect(computePM(mileageRule, 123_000, thresholds).status).toBe("due_soon");
  });

  it("warns when 90% of the interval is consumed", () => {
    const pm = computePM(mileageRule, 122_501, thresholds);
    expect(pm.status).toBe("warning");
    expect(pm.triggeredBy).toBe("miles");
  });

  it("treats exact due as due_now, not overdue", () => {
    const pm = computePM(mileageRule, 125_000, thresholds);
    expect(pm.status).toBe("due_now");
    expect(formatPMRemaining(pm)).toBe("bugün yapılmalı (mil)");
  });

  it("formats overdue distance without a negative remaining label", () => {
    const pm = computePM(mileageRule, 130_000, thresholds);
    expect(pm.status).toBe("overdue");
    expect(pm.remaining).toBe(-5_000);
    expect(formatPMRemaining(pm)).toBe("5,000 mil gecikti");
  });
});

describe("computePM - date", () => {
  const dateRule = {
    interval_type: "date" as const,
    interval_miles: null,
    interval_days: 30,
    interval_engine_hours: null,
    last_done_mileage: null,
    last_done_date: "2026-05-01",
    last_done_engine_hours: null,
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

describe("computePM - combined intervals", () => {
  const combinedRule = {
    interval_type: "mileage" as const,
    interval_miles: 15_000,
    interval_days: 30,
    interval_engine_hours: 500,
    last_done_mileage: 100_000,
    last_done_date: "2026-07-01",
    last_done_engine_hours: 10_000,
  };

  it("tracks separate next-due and remaining values", () => {
    const pm = computePM(combinedRule, 112_000, thresholds, "2026-07-20", 10_200);
    expect(pm.dimensions).toHaveLength(3);
    expect(pm.dimensions.map((item) => item.unit).sort()).toEqual(["days", "engine_hours", "miles"]);
  });

  it("selects the earliest/most urgent dimension", () => {
    const pm = computePM(combinedRule, 112_000, thresholds, "2026-07-29", 10_200);
    expect(pm.status).toBe("due_soon");
    expect(pm.triggeredBy).toBe("days");
    expect(formatPMWhichever(pm)).toContain("ilk dolan sınır");
  });

  it("supports engine-hour due soon and overdue boundaries", () => {
    expect(computePM(combinedRule, 100_000, thresholds, "2026-07-02", 10_400).status).toBe("due_soon");
    const exact = computePM(combinedRule, 100_000, thresholds, "2026-07-02", 10_500);
    expect(exact.status).toBe("due_now");
    expect(exact.triggeredBy).toBe("engine_hours");
    expect(computePM(combinedRule, 100_000, thresholds, "2026-07-02", 10_501).status).toBe("overdue");
  });
});

describe("alert ordering", () => {
  it("sorts by severity and only compares values within the same unit", () => {
    const overdue = computePM(mileageRule, 130_000, thresholds);
    const dateSoon = computePM(
      {
        interval_type: "date" as const,
        interval_miles: null,
        interval_days: 10,
        interval_engine_hours: null,
        last_done_mileage: null,
        last_done_date: "2026-07-01",
        last_done_engine_hours: null,
      },
      0,
      thresholds,
      "2026-07-05",
    );
    expect(comparePMAlerts(overdue, dateSoon)).toBeLessThan(0);
  });
});

describe("duty-cycle Wet PM recommendations", () => {
  it("recommends 25,000 miles for heavy, low MPG, or high idle", () => {
    expect(recommendWetPMInterval({
      dutyCycle: "heavy",
      rolling30DayMpg: 6.2,
      idlePercentage: 10,
      currentIntervalMiles: 50_000,
    })).toMatchObject({ minMiles: 25_000, maxMiles: 25_000 });
  });

  it("recommends 40,000-50,000 miles for short-haul or 5.0-5.9 MPG", () => {
    expect(recommendWetPMInterval({
      dutyCycle: "normal_otr",
      rolling30DayMpg: 5.5,
      idlePercentage: 10,
      currentIntervalMiles: 50_000,
    })).toMatchObject({ minMiles: 40_000, maxMiles: 50_000 });
  });

  it("warns when current oil interval is above 60,000 miles", () => {
    expect(recommendWetPMInterval({
      dutyCycle: "normal_otr",
      rolling30DayMpg: 6.5,
      idlePercentage: 10,
      currentIntervalMiles: 75_000,
    }).warning).toMatch(/oil-analysis/);
  });
});
