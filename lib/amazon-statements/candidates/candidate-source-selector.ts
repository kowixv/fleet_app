import { round2 } from "@/lib/settlement/engine";
import type { CandidateFuelSelection, CandidateRevenueSelection, FuelInclusionPolicy } from "./candidate-types";
import { candidateIssue, type CandidateIssue } from "./candidate-issues";

const FUEL_POSTING_GRACE_DAYS = 1;

export function validateRevenueSelections(args: {
  organizationId: string;
  periodStart: string;
  periodEnd: string;
  selections: CandidateRevenueSelection[];
}): CandidateIssue[] {
  const issues: CandidateIssue[] = [];
  const sourceIds = new Set<string>();
  const loadIds = new Set<string>();
  for (const selection of args.selections) {
    if (sourceIds.has(selection.revenueItemId)) {
      issues.push(candidateIssue("duplicate_revenue_source", "blocking", "Revenue source is selected more than once.", {}, "revenue", selection.revenueItemId));
    }
    sourceIds.add(selection.revenueItemId);
    if (loadIds.has(selection.projectedLoad.id)) {
      issues.push(candidateIssue("duplicate_revenue_source", "blocking", "Projected load is selected more than once.", {}, "revenue", selection.projectedLoad.id));
    }
    loadIds.add(selection.projectedLoad.id);
    if (selection.organizationId !== args.organizationId || selection.projectedLoad.organizationId !== args.organizationId) {
      issues.push(candidateIssue("invalid_accounting_lane", "blocking", "Revenue source belongs to a different organization.", {}, "revenue", selection.revenueItemId));
    }
    if (selection.expectedSourceRevision && selection.expectedSourceRevision !== selection.sourceRevision) {
      issues.push(candidateIssue("source_revision_changed", "blocking", "Revenue source revision changed after preview.", {}, "revenue", selection.revenueItemId));
    }
    if (selection.projectionStatus && selection.projectionStatus !== "projected") {
      issues.push(candidateIssue("projection_conflict", "blocking", "Revenue projection is not active.", { projectionStatus: selection.projectionStatus }, "revenue", selection.revenueItemId));
    }
    if (round2(selection.allocatedGrossAmount) !== round2(selection.projectedLoad.grossAmount)) {
      issues.push(candidateIssue("financial_mismatch", "blocking", "Revenue allocation does not match the projected load gross amount.", {}, "revenue", selection.revenueItemId));
    }
    if (selection.sourceDate && (selection.sourceDate < args.periodStart || selection.sourceDate > args.periodEnd)) {
      if (!selection.periodOverrideApproved) {
        issues.push(candidateIssue("source_outside_period", "blocking", "Revenue source date is outside the candidate period.", { sourceDate: selection.sourceDate }, "revenue", selection.revenueItemId));
      } else if (!selection.periodOverrideReason?.trim()) {
        issues.push(candidateIssue("source_outside_period", "blocking", "Approved out-of-period revenue selection must preserve an audit reason.", { sourceDate: selection.sourceDate }, "revenue", selection.revenueItemId));
      }
    }
  }
  return issues;
}

export function validateFuelSelections(args: {
  organizationId: string;
  periodStart: string;
  periodEnd: string;
  fuelInclusionPolicy: FuelInclusionPolicy;
  selections: CandidateFuelSelection[];
}): CandidateIssue[] {
  const issues: CandidateIssue[] = [];
  const sourceIds = new Set<string>();
  const expenseIds = new Set<string>();
  for (const selection of args.selections) {
    if (sourceIds.has(selection.transactionLineId)) {
      issues.push(candidateIssue("duplicate_fuel_source", "blocking", "Fuel source line is selected more than once.", {}, "fuel", selection.transactionLineId));
    }
    sourceIds.add(selection.transactionLineId);
    if (expenseIds.has(selection.projectedExpense.id)) {
      issues.push(candidateIssue("duplicate_fuel_source", "blocking", "Projected fuel expense is selected more than once.", {}, "fuel", selection.projectedExpense.id));
    }
    expenseIds.add(selection.projectedExpense.id);
    if (selection.organizationId !== args.organizationId || selection.projectedExpense.organizationId !== args.organizationId) {
      issues.push(candidateIssue("invalid_accounting_lane", "blocking", "Fuel source belongs to a different organization.", {}, "fuel", selection.transactionLineId));
    }
    if (selection.expectedSourceRevision && selection.expectedSourceRevision !== selection.sourceRevision) {
      issues.push(candidateIssue("source_revision_changed", "blocking", "Fuel source revision changed after preview.", {}, "fuel", selection.transactionLineId));
    }
    if (selection.projectionStatus && selection.projectionStatus !== "projected") {
      issues.push(candidateIssue("projection_conflict", "blocking", "Fuel projection is not active.", { projectionStatus: selection.projectionStatus }, "fuel", selection.transactionLineId));
    }
    if (round2(selection.allocatedAmount) !== round2(selection.projectedExpense.amount)) {
      issues.push(candidateIssue("financial_mismatch", "blocking", "Fuel allocation does not match the projected expense amount.", {}, "fuel", selection.transactionLineId));
    }
    if (!fuelDateAllowed(selection, args)) {
      if (!selection.periodOverrideApproved) {
        issues.push(candidateIssue("source_outside_period", "blocking", "Fuel source date is outside the selected fuel inclusion policy.", {
          policy: args.fuelInclusionPolicy,
          periodStart: args.periodStart,
          periodEnd: args.periodEnd,
          postingGraceDays: args.fuelInclusionPolicy === "transaction_date_in_period" ? FUEL_POSTING_GRACE_DAYS : 0,
        }, "fuel", selection.transactionLineId));
      } else if (!selection.periodOverrideReason?.trim()) {
        issues.push(candidateIssue("source_outside_period", "blocking", "Approved out-of-period fuel selection must preserve an audit reason.", { policy: args.fuelInclusionPolicy }, "fuel", selection.transactionLineId));
      }
    }
  }
  return issues;
}

function fuelDateAllowed(selection: CandidateFuelSelection, args: { periodStart: string; periodEnd: string; fuelInclusionPolicy: FuelInclusionPolicy }) {
  if (args.fuelInclusionPolicy === "manual_reviewed_selection") return true;
  if (args.fuelInclusionPolicy === "fuel_report_period") {
    return Boolean(selection.reportPeriodStart && selection.reportPeriodEnd && selection.reportPeriodStart <= args.periodEnd && selection.reportPeriodEnd >= args.periodStart);
  }
  const date = selection.transactionDate ?? selection.projectedExpense.date ?? null;
  if (!date) return false;

  // Weekly fuel-card reports can post the final transaction on the calendar day
  // immediately after the statement week. Keep the weekly source intact while
  // still blocking older or materially future-dated transactions.
  const allowedEnd = addIsoDays(args.periodEnd, FUEL_POSTING_GRACE_DAYS);
  return date >= args.periodStart && date <= allowedEnd;
}

function addIsoDays(value: string, days: number): string {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}
