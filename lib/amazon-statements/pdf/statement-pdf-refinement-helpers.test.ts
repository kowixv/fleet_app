import { describe, expect, it } from "vitest";
import {
  groupFuelLinesForDisplay,
  normalizeDeductionLabel,
  percentageCardLabels,
} from "./statement-pdf-refinement-helpers";
import type {
  AmazonStatementDeductionLine,
  AmazonStatementFuelLine,
} from "./statement-view-model";

function fuelLine(overrides: Partial<AmazonStatementFuelLine>): AmazonStatementFuelLine {
  return {
    id: String(overrides.id ?? "line"),
    sourceTransactionLineId: String(overrides.sourceTransactionLineId ?? overrides.id ?? "source"),
    displayOrder: overrides.displayOrder ?? 0,
    date: overrides.date ?? "2026-07-07T15:24:00",
    invoice: overrides.invoice ?? "26390",
    merchant: overrides.merchant ?? "LOVES #618 TRAVEL STOP",
    location: overrides.location ?? "Sadieville, KY",
    product: overrides.product ?? "ULSD",
    quantity: overrides.quantity ?? 1,
    chargedPpu: overrides.chargedPpu ?? 4,
    discountAmount: overrides.discountAmount ?? 0,
    amount: overrides.amount ?? 4,
  };
}

function deduction(label: string): AmazonStatementDeductionLine {
  return {
    id: "deduction-1",
    displayOrder: 0,
    type: "external_carrier_fee",
    label,
    calculationBasis: "engine_line",
    amount: 298.84,
  };
}

describe("statement PDF refinements", () => {
  it("groups product lines from the same receipt together and sorts receipts by date", () => {
    const result = groupFuelLinesForDisplay([
      fuelLine({ id: "jul10-def", date: "2026-07-10T22:17:00", invoice: "0097776", product: "DEF", displayOrder: 0 }),
      fuelLine({ id: "jul07-ulsd", product: "ULSD", displayOrder: 3 }),
      fuelLine({ id: "jul08-ulsd", date: "2026-07-08T21:01:00", invoice: "34496", product: "ULSD", displayOrder: 4 }),
      fuelLine({ id: "jul07-def", product: "DEF", displayOrder: 6 }),
    ]);

    expect(result.map((item) => item.line.id)).toEqual([
      "jul07-ulsd",
      "jul07-def",
      "jul08-ulsd",
      "jul10-def",
    ]);
    expect(result.map((item) => item.transactionIndex)).toEqual([0, 0, 1, 2]);
    expect(result.map((item) => item.firstInTransaction)).toEqual([true, false, true, true]);
  });

  it("shows the managed-investor fee using the company-fee wording", () => {
    expect(normalizeDeductionLabel(deduction("External carrier fee (2.5%)"), "managed_investor"))
      .toBe("Company fee (2.5%)");
  });

  it("labels the combined managed-investor percentage card accurately", () => {
    expect(percentageCardLabels("managed_investor")).toEqual({
      en: "DRIVER + COMPANY FEE",
      tr: "SOFOR + SIRKET KESINTISI",
    });
  });
});
