import { round2 } from "./statement-formatting";
import type { AmazonStatementViewModel } from "./statement-view-model";

export type StatementPdfValidationCode =
  | "missing_candidate_snapshot"
  | "unknown_template_version"
  | "gross_mismatch"
  | "fuel_mismatch"
  | "deduction_mismatch"
  | "net_mismatch"
  | "team_allocation_mismatch"
  | "duplicate_revenue_source"
  | "duplicate_fuel_source";

export interface StatementPdfValidationError {
  code: StatementPdfValidationCode;
  message: string;
  details?: Record<string, unknown>;
}

export class StatementPdfValidationFailure extends Error {
  readonly validationErrors: StatementPdfValidationError[];

  constructor(validationErrors: StatementPdfValidationError[]) {
    const codes = validationErrors.map((error) => error.code).join(", ");
    super(`Amazon statement PDF validation failed: ${codes}`);
    this.name = "StatementPdfValidationFailure";
    this.validationErrors = validationErrors;
  }
}

export function validateStatementViewModel(
  model: AmazonStatementViewModel,
  knownTemplateVersions: readonly string[] = [model.templateVersion],
): StatementPdfValidationError[] {
  const errors: StatementPdfValidationError[] = [];
  if (!model.candidateId || !model.documentId) {
    errors.push({ code: "missing_candidate_snapshot", message: "Candidate/document snapshot identifiers are required." });
  }
  if (!knownTemplateVersions.includes(model.templateVersion)) {
    errors.push({ code: "unknown_template_version", message: `Unknown Amazon statement template version: ${model.templateVersion}` });
  }

  const revenueTotal = round2(model.revenueLines.reduce((sum, line) => sum + line.grossAmount, 0));
  if (revenueTotal !== round2(model.summary.grossRevenue)) {
    errors.push({ code: "gross_mismatch", message: "Revenue lines do not reconcile to saved gross total.", details: { revenueTotal, grossRevenue: model.summary.grossRevenue } });
  }

  const fuelLineTotal = round2(model.fuelLines.reduce((sum, line) => sum + line.amount, 0));
  if ((model.fuelLines.length > 0 || round2(model.summary.fuelDeductions) !== 0) && fuelLineTotal !== round2(model.summary.fuelDeductions)) {
    errors.push({ code: "fuel_mismatch", message: "Fuel lines do not reconcile to saved fuel deduction total.", details: { fuelLineTotal, fuelDeductions: model.summary.fuelDeductions } });
  }

  const deductionTotal = round2(model.deductionLines.reduce((sum, line) => sum + line.amount, 0));
  if (deductionTotal !== round2(model.summary.totalDeductions)) {
    errors.push({ code: "deduction_mismatch", message: "Deduction lines do not reconcile to saved total deductions.", details: { deductionTotal, totalDeductions: model.summary.totalDeductions } });
  }

  const driverStatement = model.statementType === "company_driver" || model.statementType === "box_truck_driver";
  const expectedNet = driverStatement
    ? round2(model.summary.calculationBaseAmount - model.summary.totalDeductions)
    : round2(model.summary.grossRevenue - model.summary.totalDeductions);
  if (expectedNet !== round2(model.summary.netAmount)) {
    errors.push({
      code: "net_mismatch",
      message: driverStatement
        ? "Driver net does not reconcile to driver gross pay minus driver deductions."
        : "Saved net does not reconcile to saved gross minus saved deductions.",
      details: {
        statementType: model.statementType,
        grossRevenue: model.summary.grossRevenue,
        calculationBaseAmount: model.summary.calculationBaseAmount,
        totalDeductions: model.summary.totalDeductions,
        expectedNet,
        netAmount: model.summary.netAmount,
      },
    });
  }

  if (model.teamAllocations.length > 0) {
    const teamTotal = round2(model.teamAllocations.reduce((sum, line) => sum + line.amount, 0));
    if (teamTotal !== round2(model.summary.grossRevenue)) {
      errors.push({ code: "team_allocation_mismatch", message: "Team allocations do not reconcile to gross amount.", details: { teamTotal, grossRevenue: model.summary.grossRevenue } });
    }
  }

  const revenueIds = model.revenueLines.map((line) => line.sourceRevenueItemId);
  if (new Set(revenueIds).size !== revenueIds.length) {
    errors.push({ code: "duplicate_revenue_source", message: "A revenue source appears more than once in the PDF view model." });
  }
  const fuelIds = model.fuelLines.map((line) => line.sourceTransactionLineId);
  if (new Set(fuelIds).size !== fuelIds.length) {
    errors.push({ code: "duplicate_fuel_source", message: "A fuel source line appears more than once in the PDF view model." });
  }

  return errors;
}

export function assertValidStatementViewModel(model: AmazonStatementViewModel, knownTemplateVersions: readonly string[]): void {
  const errors = validateStatementViewModel(model, knownTemplateVersions);
  if (errors.length > 0) {
    throw new StatementPdfValidationFailure(errors);
  }
}
