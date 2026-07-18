import { computeSettlement, round2, type ExpenseInput, type LoadInput } from "@/lib/settlement/engine";
import { configSnapshot, usageGroupForSettlementType } from "@/lib/settlement/workflow";
import {
  buildCandidateSettlementConfig,
  fixedAdjustmentsAsExpenses,
  selectedFuelAsExpenses,
} from "./candidate-config";
import { candidateIssue, type CandidateIssue } from "./candidate-issues";
import { candidateReadiness, validateCandidateBasics } from "./candidate-readiness";
import { candidateRevision, candidateSourceRevision } from "./candidate-revision";
import { validateFuelSelections, validateRevenueSelections } from "./candidate-source-selector";
import type {
  CandidateAdjustmentLine,
  CandidateCalculationConfig,
  CandidateCalculationResult,
  CandidateCompilerInput,
  CandidateFuelSelection,
  CandidateRevenueSelection,
  TeamAllocation,
} from "./candidate-types";

export function compileAmazonStatementCandidate(input: CandidateCompilerInput): CandidateCalculationResult {
  const fuelSelections = input.fuelSelections ?? [];
  const usageGroup = usageGroupForSettlementType(input.config.statementType);
  if (!usageGroup) throw new Error("Unsupported candidate statement type.");

  const issues: CandidateIssue[] = [
    ...validateCandidateBasics(input.config),
    ...validateRevenueSelections({
      organizationId: input.config.organizationId,
      periodStart: input.config.periodStart,
      periodEnd: input.config.periodEnd,
      selections: input.revenueSelections,
    }),
    ...validateFuelSelections({
      organizationId: input.config.organizationId,
      periodStart: input.config.periodStart,
      periodEnd: input.config.periodEnd,
      fuelInclusionPolicy: input.config.fuelInclusionPolicy ?? "transaction_date_in_period",
      selections: fuelSelections,
    }),
  ];

  if (input.existingSettlementSettingsRevision && input.config.settlementSettingsRevision && input.existingSettlementSettingsRevision !== input.config.settlementSettingsRevision) {
    issues.push(candidateIssue("changed_settlement_settings", "blocking", "Settlement settings changed after the candidate preview.", {}, "candidate"));
  }

  const { settlementConfig, issues: configIssues } = buildCandidateSettlementConfig(input.config);
  issues.push(...configIssues);

  const loadInputs = loadInputsFromRevenue(input.revenueSelections);
  const fixed = fixedAdjustmentsAsExpenses(input.config.fixedAdjustments);
  const fuel = selectedFuelAsExpenses(fuelSelections, input.config.statementType);
  issues.push(...fixed.issues, ...fuel.issues);

  const expenses: ExpenseInput[] = [...fixed.expenses, ...fuel.expenses];
  const settlementResult = computeSettlement({ config: settlementConfig, loads: loadInputs, expenses });
  const gross = settlementResult.grossRevenue;
  const teamAllocations = allocateTeamGross(gross, input.config);
  const adjustmentLines = orderedAdjustmentLines([
    ...enginePercentageLines(input.config, settlementResult),
    ...fixed.adjustmentLines,
    ...fuel.adjustmentLines,
  ]);
  const sourceSnapshot = {
    revenue: input.revenueSelections
      .slice()
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map((selection) => ({
        revenueItemId: selection.revenueItemId,
        loadId: selection.projectedLoad.id,
        allocatedGrossAmount: round2(selection.allocatedGrossAmount),
        sourceRevision: selection.sourceRevision,
        sourceFingerprint: selection.sourceFingerprint ?? null,
        periodOverrideApproved: selection.periodOverrideApproved ?? false,
        periodOverrideReason: selection.periodOverrideReason ?? null,
      })),
    fuel: fuelSelections
      .slice()
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map((selection) => ({
        transactionLineId: selection.transactionLineId,
        expenseId: selection.projectedExpense.id,
        allocatedAmount: round2(selection.allocatedAmount),
        sourceRevision: selection.sourceRevision,
        sourceFingerprint: selection.sourceFingerprint ?? null,
        periodOverrideApproved: selection.periodOverrideApproved ?? false,
        periodOverrideReason: selection.periodOverrideReason ?? null,
      })),
  };
  const configurationSnapshot = configSnapshot(settlementConfig, {
    calculation_rule_version: input.config.calculationRuleVersion,
    template_version: input.config.templateVersion,
    language_mode: input.config.languageMode ?? "en_tr",
    fuel_inclusion_policy: input.config.fuelInclusionPolicy ?? "transaction_date_in_period",
    settlement_settings_revision: input.config.settlementSettingsRevision ?? "none",
    parser_versions: JSON.stringify(input.config.parserVersions ?? {}),
    team_split_rule_id: input.config.teamSplitRule?.ruleId ?? "none",
  });
  const calculationSnapshot = {
    statementType: input.config.statementType,
    periodStart: input.config.periodStart,
    periodEnd: input.config.periodEnd,
    usageGroup,
    payeeType: input.config.payeeType,
    payeeId: input.config.payeeId ?? null,
    vehicleId: input.config.vehicleId ?? null,
    grossAmount: gross,
    totalDeductionsAmount: settlementResult.totalDeductions,
    netAmount: settlementResult.netPay,
    engine: "computeSettlement",
    rounding: "round2",
    calculationRuleVersion: input.config.calculationRuleVersion,
    templateVersion: input.config.templateVersion,
    languageMode: input.config.languageMode ?? "en_tr",
    fuelInclusionPolicy: input.config.fuelInclusionPolicy ?? "transaction_date_in_period",
    lineItems: settlementResult.lineItems,
    adjustmentLines,
    engineInputs: {
      loads: loadInputs,
      expenses,
      config: settlementConfig,
    },
    teamAllocations,
  };
  const sourceRevision = candidateSourceRevision([
    input.config.batchId,
    sourceSnapshot,
    input.config.calculationRuleVersion,
    input.config.templateVersion,
    input.config.languageMode ?? "en_tr",
    input.config.fuelInclusionPolicy ?? "transaction_date_in_period",
    input.config.settlementSettingsRevision ?? null,
  ]);
  const previewRevision = candidateRevision({ configurationSnapshot, sourceSnapshot, calculationSnapshot });
  const readiness = candidateReadiness({
    issues,
    stale: input.existingSettlementSettingsRevision !== undefined
      && input.config.settlementSettingsRevision !== undefined
      && input.existingSettlementSettingsRevision !== input.config.settlementSettingsRevision,
    incomplete: input.revenueSelections.length === 0,
  });

  return {
    statementType: input.config.statementType,
    usageGroup,
    settlementConfig,
    settlementInput: { loads: loadInputs, expenses },
    settlementResult,
    adjustmentLines,
    teamAllocations,
    grossAmount: gross,
    percentageDeductionsAmount: percentageDeductionsFromEngine(input.config, settlementResult),
    fixedDeductionsAmount: fixed.adjustmentLines.reduce((sum, line) => sum + line.calculatedAmount, 0),
    fuelDeductionsAmount: fuel.adjustmentLines.reduce((sum, line) => sum + line.calculatedAmount, 0),
    otherDeductionsAmount: otherDeductionsFromEngine(input.config, settlementResult, fixed.adjustmentLines, fuel.adjustmentLines),
    totalDeductionsAmount: settlementResult.totalDeductions,
    netAmount: settlementResult.netPay,
    configurationSnapshot,
    sourceSnapshot,
    calculationSnapshot,
    sourceRevision,
    previewRevision,
    readiness,
  };
}

function loadInputsFromRevenue(selections: CandidateRevenueSelection[]): LoadInput[] {
  return selections
    .slice()
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map((selection) => ({
      id: selection.projectedLoad.id,
      reference: selection.revenueItemId,
      type: "amazon_relay",
      grossAmount: round2(selection.allocatedGrossAmount),
    }));
}

function orderedAdjustmentLines(lines: CandidateAdjustmentLine[]): CandidateAdjustmentLine[] {
  return lines.slice().sort((a, b) => a.displayOrder - b.displayOrder || a.adjustmentType.localeCompare(b.adjustmentType));
}

function enginePercentageLines(config: CandidateCalculationConfig, result: ReturnType<typeof computeSettlement>): CandidateAdjustmentLine[] {
  if (config.statementType === "owner_operator") {
    const companyFee = amountForLineItem(result, "company_fee");
    return [{
      adjustmentType: "company_percentage",
      label: "Company fee",
      calculationBasis: "gross_percentage",
      rateBasisPoints: config.companyFeeBasisPoints ?? null,
      fixedAmount: null,
      calculatedAmount: Math.abs(companyFee),
      deductionLane: "owner",
      displayOrder: 0,
      configurationSource: "statement_policy",
      sourceSnapshot: { engineLineItemKey: "company_fee" },
    }];
  }
  if (config.statementType === "managed_investor") {
    const lines: CandidateAdjustmentLine[] = [];
    const externalCarrierFee = amountForLineItem(result, "external_carrier_fee");
    if (externalCarrierFee !== 0) {
      lines.push({
        adjustmentType: "company_percentage",
        label: "External carrier fee",
        calculationBasis: "gross_percentage",
        rateBasisPoints: config.externalCarrierFeeBasisPoints ?? null,
        fixedAmount: null,
        calculatedAmount: Math.abs(externalCarrierFee),
        deductionLane: "investor",
        displayOrder: 0,
        configurationSource: "statement_policy",
        sourceSnapshot: { engineLineItemKey: "external_carrier_fee" },
      });
    }
    lines.push({
      adjustmentType: "driver_percentage",
      label: "Driver cost",
      calculationBasis: "gross_percentage",
      rateBasisPoints: config.driverPayBasisPoints ?? null,
      fixedAmount: null,
      calculatedAmount: Math.abs(amountForLineItem(result, "driver_pay")),
      deductionLane: "investor",
      displayOrder: 1,
      configurationSource: "statement_policy",
      sourceSnapshot: { engineLineItemKey: "driver_pay" },
    });
    return lines;
  }
  if (config.statementType === "company_driver" || config.statementType === "box_truck_driver") {
    return [{
      adjustmentType: "driver_percentage",
      label: "Driver gross pay",
      calculationBasis: "gross_percentage",
      rateBasisPoints: config.driverPayBasisPoints ?? null,
      fixedAmount: null,
      calculatedAmount: amountForLineItem(result, "driver_pay"),
      deductionLane: "driver",
      displayOrder: 0,
      configurationSource: "statement_policy",
      sourceSnapshot: { engineLineItemKey: "driver_pay", notADeduction: true },
    }];
  }
  return [];
}

function percentageDeductionsFromEngine(config: CandidateCalculationConfig, result: ReturnType<typeof computeSettlement>): number {
  if (config.statementType === "owner_operator") {
    return Math.abs(amountForLineItem(result, "company_fee"));
  }
  if (config.statementType === "managed_investor") {
    return round2(Math.abs(amountForLineItem(result, "driver_pay")) + Math.abs(amountForLineItem(result, "external_carrier_fee")));
  }
  return 0;
}

function otherDeductionsFromEngine(
  config: CandidateCalculationConfig,
  result: ReturnType<typeof computeSettlement>,
  fixedLines: CandidateAdjustmentLine[],
  fuelLines: CandidateAdjustmentLine[],
): number {
  const known = round2(
    percentageDeductionsFromEngine(config, result)
    + fixedLines.reduce((sum, line) => sum + line.calculatedAmount, 0)
    + fuelLines.reduce((sum, line) => sum + line.calculatedAmount, 0),
  );
  return round2(result.totalDeductions - known);
}

function amountForLineItem(result: ReturnType<typeof computeSettlement>, key: string): number {
  return result.lineItems.find((line) => line.key === key)?.amount ?? 0;
}

export function allocateTeamGross(gross: number, config: CandidateCalculationConfig): TeamAllocation[] {
  if (!config.teamRequired || !config.teamSplitRule) return [];
  const members = config.teamSplitRule.members.slice().sort((a, b) => a.personId.localeCompare(b.personId));
  const allocations = members.map((member) => ({
    personId: member.personId,
    basisPoints: member.basisPoints,
    amount: round2(gross * (member.basisPoints / 10000)),
  }));
  const residual = round2(gross - allocations.reduce((sum, allocation) => round2(sum + allocation.amount), 0));
  if (allocations.length > 0 && residual !== 0) {
    allocations[0] = { ...allocations[0], amount: round2(allocations[0].amount + residual) };
  }
  return allocations;
}
