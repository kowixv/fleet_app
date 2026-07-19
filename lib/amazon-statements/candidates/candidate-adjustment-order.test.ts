import { describe, expect, it } from "vitest";
import { orderedAdjustmentLines } from "./candidate-compiler";
import type { CandidateAdjustmentLine } from "./candidate-types";

function line(
  adjustmentType: CandidateAdjustmentLine["adjustmentType"],
  displayOrder: number,
  label: string = adjustmentType,
): CandidateAdjustmentLine {
  return {
    adjustmentType,
    label,
    calculationBasis: adjustmentType === "fuel" ? "selected_source_lines" : "fixed_amount",
    rateBasisPoints: null,
    fixedAmount: adjustmentType === "fuel" ? null : 100,
    calculatedAmount: 100,
    deductionLane: "investor",
    displayOrder,
    configurationSource: "test",
    sourceSnapshot: {},
  };
}

describe("candidate adjustment display order", () => {
  it("normalizes colliding managed-investor driver and fuel orders", () => {
    const result = orderedAdjustmentLines([
      line("driver_percentage", 1, "Driver cost"),
      line("fuel", 1, "Fuel ULSD"),
      line("fuel", 2, "Fuel DEF"),
      line("insurance", 10, "Insurance"),
      line("eld_safety", 11, "ELD/Safety"),
    ]);

    expect(result.map((item) => item.label)).toEqual([
      "Driver cost",
      "Fuel ULSD",
      "Fuel DEF",
      "Insurance",
      "ELD/Safety",
    ]);
    expect(result.map((item) => item.displayOrder)).toEqual([0, 1, 2, 3, 4]);
    expect(new Set(result.map((item) => item.displayOrder)).size).toBe(result.length);
  });

  it("does not mutate the input adjustment rows", () => {
    const input = [line("fuel", 1), line("driver_percentage", 1)];
    orderedAdjustmentLines(input);
    expect(input.map((item) => item.displayOrder)).toEqual([1, 1]);
  });
});
