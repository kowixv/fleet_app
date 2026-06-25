import { describe, it, expect } from "vitest";
import { weekRange, computeMissing } from "./bot-intent";

describe("weekRange", () => {
  it("returns the Monday–Sunday containing a midweek date", () => {
    // 2026-06-25 is a Thursday.
    expect(weekRange("this_week", new Date(2026, 5, 25))).toEqual({
      start: "2026-06-22",
      end: "2026-06-28",
    });
  });

  it("returns the current week when the day is Monday", () => {
    expect(weekRange(undefined, new Date(2026, 5, 22))).toEqual({
      start: "2026-06-22",
      end: "2026-06-28",
    });
  });

  it("returns the current week when the day is Sunday", () => {
    expect(weekRange(null, new Date(2026, 5, 28))).toEqual({
      start: "2026-06-22",
      end: "2026-06-28",
    });
  });

  it("shifts back one week for 'last_week' / Turkish 'geçen'", () => {
    expect(weekRange("last_week", new Date(2026, 5, 25))).toEqual({
      start: "2026-06-15",
      end: "2026-06-21",
    });
    expect(weekRange("geçen hafta", new Date(2026, 5, 25))).toEqual({
      start: "2026-06-15",
      end: "2026-06-21",
    });
  });
});

describe("computeMissing", () => {
  it("flags absent and blank required fields", () => {
    expect(computeMissing("add_person", { full_name: "John" })).toEqual(["type"]);
    expect(computeMissing("add_person", { full_name: "  ", type: "" })).toEqual([
      "full_name",
      "type",
    ]);
  });

  it("returns nothing when all required fields are present", () => {
    expect(
      computeMissing("update_vehicle_mileage", { unit_number: "101", mileage: 1000 }),
    ).toEqual([]);
  });

  it("treats intents without a required-field list as complete", () => {
    expect(computeMissing("list_people", {})).toEqual([]);
    expect(computeMissing("add_load", {})).toEqual([]);
  });
});
