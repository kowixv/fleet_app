import { round2, type ExpenseInput, type SettlementConfig } from "@/lib/settlement/engine";
import type {
  CandidateAdjustmentInput,
  CandidateAdjustmentLine,
  CandidateCalculationConfig,
  CandidateFuelSelection,
  CandidateStatementType,
} from "./candidate-types";
import { candidateIssue, type CandidateIssue } from "./candidate-issues";

export function basisPointsToFraction(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value) || value < 0 || value > 10000) return null;
  return value / 10000;
}

export function buildCandidateSettlementConfig(config: CandidateCalculationConfig): {
  settlementConfig: SettlementConfig;
  issues: CandidateIssue[];
} {
  const issues: CandidateIssue[] = [];
  const driverPayPct = basisPointsToFraction(config.driverPayBasisPoints);
  const companyFeePct = basisPointsToFraction(config.companyFeeBasisPoints);
  const externalCarrierFeePct = basisPointsToFraction(config.externalCarrierFeeBasisPoints);

  if ((config.statementType === "company_driver" || config.statementType === "box_truck_driver" || config.statementType === "managed_investor") && driverPayPct === null) {
    issues.push(candidateIssue("missing_configuration", "blocking", "Driver percentage must be explicitly configured.", { field: "driverPayBasisPoints" }));
  }
  if (config.statementType === "owner_operator" && companyFeePct === null) {
    issues.push(candidateIssue("missing_configuration", "blocking", "Company percentage must be explicitly configured.", { field: "companyFeeBasisPoints" }));
  }

  return {
    settlementConfig: {
      settlementType: config.statementType,
      driverPayPct,
      companyFeePct: companyFeePct ?? 0,
      companyFeeIsOurRevenue: config.companyFeeIsOurRevenue ?? true,
      externalCarrierFeePct: externalCarrierFeePct ?? 0,
      managementCommission: config.managementCommission ?? { type: "none", amount: 0 },
    },
    issues,
  };
}

export function selectedFuelAsExpenses(fuelSelections: CandidateFuelSelection[], statementType: CandidateStatementType): {
  expenses: ExpenseInput[];
  adjustmentLines: CandidateAdjustmentLine[];
  issues: CandidateIssue[];
} {
  const issues: CandidateIssue[] = [];
  const expenses: ExpenseInput[] = [];
  const adjustmentLines: CandidateAdjustmentLine[] = [];

  for (const fuel of fuelSelections.sort((a, b) => a.displayOrder - b.displayOrder)) {
    const expectedLane = statementType === "company_driver" || statementType === "box_truck_driver"
      ? "driver"
      : statementType === "owner_operator"
        ? "owner"
        : "investor";
    if (fuel.groupIsPlaceholder) {
      issues.push(candidateIssue("placeholder_fuel_selected", "blocking", "Placeholder fuel groups cannot be selected.", {}, "fuel", fuel.transactionLineId));
      continue;
    }
    if (fuel.deductionLane !== expectedLane) {
      issues.push(candidateIssue("unresolved_fuel_assignment", "blocking", "Fuel deduction lane must match the approved settlement accounting lane.", { expectedLane, actualLane: fuel.deductionLane }, "fuel", fuel.transactionLineId));
    }
    expenses.push({
      category: fuel.projectedExpense.category,
      amount: round2(fuel.allocatedAmount),
      labelEn: fuel.productType ? `Amazon fuel ${fuel.productType}` : "Amazon fuel",
      labelTr: fuel.productType ? `Amazon fuel ${fuel.productType}` : "Amazon fuel",
    });
    adjustmentLines.push({
      adjustmentType: "fuel",
      label: fuel.productType ? `Fuel ${fuel.productType}` : "Fuel",
      calculationBasis: "selected_source_lines",
      rateBasisPoints: null,
      fixedAmount: null,
      calculatedAmount: round2(fuel.allocatedAmount),
      deductionLane: fuel.deductionLane,
      displayOrder: fuel.displayOrder,
      configurationSource: "selected_fuel_source_line",
      sourceSnapshot: fuel.sourceSnapshot,
    });
  }

  return { expenses, adjustmentLines, issues };
}

export function fixedAdjustmentsAsExpenses(adjustments: CandidateAdjustmentInput[] = []): {
  expenses: ExpenseInput[];
  adjustmentLines: CandidateAdjustmentLine[];
  issues: CandidateIssue[];
} {
  const expenses: ExpenseInput[] = [];
  const adjustmentLines: CandidateAdjustmentLine[] = [];
  const issues: CandidateIssue[] = [];

  for (const adjustment of adjustments.sort((a, b) => a.displayOrder - b.displayOrder)) {
    if (adjustment.calculationBasis === "gross_percentage") {
      issues.push(candidateIssue(
        "missing_configuration",
        "blocking",
        "Gross percentage adjustments must be represented in the settlement config so computeSettlement remains the financial authority.",
        { adjustmentType: adjustment.adjustmentType },
        "adjustment",
      ));
      continue;
    }
    if (adjustment.calculationBasis === "selected_source_lines") continue;
    if (adjustment.fixedAmount === null || adjustment.fixedAmount === undefined) {
      issues.push(candidateIssue("missing_configuration", "blocking", "Fixed adjustment amount is missing.", { adjustmentType: adjustment.adjustmentType }, "adjustment"));
      continue;
    }
    const amount = round2(adjustment.fixedAmount);
    expenses.push({
      category: categoryForAdjustment(adjustment.adjustmentType),
      amount,
      labelEn: adjustment.label,
      labelTr: adjustment.label,
    });
    adjustmentLines.push({
      adjustmentType: adjustment.adjustmentType,
      label: adjustment.label,
      calculationBasis: adjustment.calculationBasis,
      rateBasisPoints: null,
      fixedAmount: amount,
      calculatedAmount: amount,
      deductionLane: adjustment.deductionLane,
      displayOrder: adjustment.displayOrder,
      configurationSource: adjustment.configurationSource,
      sourceSnapshot: adjustment.sourceSnapshot ?? {},
    });
  }

  return { expenses, adjustmentLines, issues };
}

function categoryForAdjustment(type: CandidateAdjustmentInput["adjustmentType"]): string {
  if (type === "eld_safety") return "eld";
  if (type === "miscellaneous") return "misc";
  return type;
}
