import { describe, expect, it } from "vitest";
import { validateFuelSelections } from "./candidate-source-selector";
import type { CandidateFuelSelection } from "./candidate-types";

function fuelSelection(overrides: Partial<CandidateFuelSelection> = {}): CandidateFuelSelection {
  return {
    transactionLineId: "fuel-line-1",
    organizationId: "organization-1",
    sourceRevision: "source-revision-1",
    sourceFingerprint: "source-fingerprint-1",
    transactionDate: "2026-07-11",
    reportPeriodStart: null,
    reportPeriodEnd: null,
    allocatedAmount: 100,
    projectionStatus: "projected",
    deductionLane: "investor",
    projectedExpense: {
      id: "expense-1",
      organizationId: "organization-1",
      date: "2026-07-11",
      category: "fuel",
      amount: 100,
      deductFromSettlement: false,
      deductFromDriver: false,
      deductFromOwner: false,
      deductFromInvestor: true,
    },
    sourceSnapshot: {},
    displayOrder: 1,
    ...overrides,
  };
}

function validate(selection: CandidateFuelSelection) {
  return validateFuelSelections({
    organizationId: "organization-1",
    periodStart: "2026-07-05",
    periodEnd: "2026-07-11",
    fuelInclusionPolicy: "transaction_date_in_period",
    selections: [selection],
  });
}

describe("weekly fuel posting grace", () => {
  it("accepts the final weekly fuel transaction when it posts one day after period end", () => {
    const issues = validate(fuelSelection({
      transactionDate: "2026-07-12",
      projectedExpense: {
        ...fuelSelection().projectedExpense,
        date: "2026-07-12",
      },
    }));

    expect(issues).toEqual([]);
  });

  it("still blocks a fuel transaction more than one day after period end", () => {
    const issues = validate(fuelSelection({
      transactionDate: "2026-07-13",
      projectedExpense: {
        ...fuelSelection().projectedExpense,
        date: "2026-07-13",
      },
    }));

    expect(issues.map((issue) => issue.issueCode)).toContain("source_outside_period");
  });

  it("does not add a grace day before the weekly period starts", () => {
    const issues = validate(fuelSelection({
      transactionDate: "2026-07-04",
      projectedExpense: {
        ...fuelSelection().projectedExpense,
        date: "2026-07-04",
      },
    }));

    expect(issues.map((issue) => issue.issueCode)).toContain("source_outside_period");
  });
});
