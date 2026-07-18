import { ELIGIBLE_LOAD_STATUSES } from "@/lib/settlement/workflow";
import { candidateIssue, type CandidateIssue } from "./candidate-issues";
import type {
  CandidateCalculationResult,
  CandidateRecordForConversion,
  CandidateRevenueSelection,
  CandidateFuelSelection,
  SettlementConversionPayload,
} from "./candidate-types";

export function prepareSettlementConversionPayload(args: {
  candidate: CandidateRecordForConversion;
  calculation: CandidateCalculationResult;
  revenueSelections: CandidateRevenueSelection[];
  fuelSelections: CandidateFuelSelection[];
  expectedPreviewRevision: string;
  createdBy?: string | null;
}): { ok: true; payload: SettlementConversionPayload } | { ok: false; issues: CandidateIssue[] } {
  const issues: CandidateIssue[] = [];
  if (args.candidate.convertedSettlementId || args.candidate.status === "converted") {
    issues.push(candidateIssue("converted_candidate", "blocking", "Converted candidates cannot be converted again.", {}, "conversion", args.candidate.id));
  }
  if (args.expectedPreviewRevision !== args.calculation.previewRevision || args.expectedPreviewRevision !== args.candidate.previewRevision) {
    issues.push(candidateIssue("stale_preview", "blocking", "Candidate preview revision is stale.", {}, "conversion", args.candidate.id));
  }
  if (!args.calculation.readiness.ready || args.candidate.status !== "ready") {
    issues.push(candidateIssue("not_ready", "blocking", "Candidate must be ready before settlement payload preparation.", { candidateStatus: args.candidate.status }, "conversion", args.candidate.id));
  }

  for (const revenue of args.revenueSelections) {
    if (revenue.organizationId !== args.candidate.organizationId || revenue.projectedLoad.organizationId !== args.candidate.organizationId) {
      issues.push(candidateIssue("invalid_accounting_lane", "blocking", "Revenue source organization does not match candidate organization.", {}, "conversion", revenue.revenueItemId));
    }
    if (!(ELIGIBLE_LOAD_STATUSES as readonly string[]).includes(revenue.projectedLoad.status)) {
      issues.push(candidateIssue("pending_projected_load", "blocking", "Projected load must be delivered or paid before settlement conversion.", { status: revenue.projectedLoad.status }, "conversion", revenue.projectedLoad.id));
    }
    if (revenue.projectedLoad.alreadyLinked) {
      issues.push(candidateIssue("source_already_linked", "blocking", "Projected load is already linked to an active settlement.", {}, "conversion", revenue.projectedLoad.id));
    }
  }
  for (const fuel of args.fuelSelections) {
    if (fuel.organizationId !== args.candidate.organizationId || fuel.projectedExpense.organizationId !== args.candidate.organizationId) {
      issues.push(candidateIssue("invalid_accounting_lane", "blocking", "Fuel source organization does not match candidate organization.", {}, "conversion", fuel.transactionLineId));
    }
    if (!fuel.projectedExpense.deductFromSettlement) {
      issues.push(candidateIssue("non_deductible_projected_expense", "blocking", "Projected expense must be explicitly marked deductible before settlement conversion.", {}, "conversion", fuel.projectedExpense.id));
    }
    if (fuel.projectedExpense.alreadyLinked) {
      issues.push(candidateIssue("source_already_linked", "blocking", "Projected expense is already linked to an active settlement.", {}, "conversion", fuel.projectedExpense.id));
    }
  }

  if (issues.length > 0) return { ok: false, issues };

  const driverId = args.calculation.usageGroup === "driver" ? (args.calculation.calculationSnapshot.payeeId as string) : null;
  const ownerId = args.calculation.usageGroup === "owner" || args.calculation.usageGroup === "investor"
    ? (args.calculation.calculationSnapshot.payeeId as string)
    : null;
  return {
    ok: true,
    payload: {
      candidateId: args.candidate.id,
      previewRevision: args.calculation.previewRevision,
      settlementType: args.calculation.statementType,
      usageGroup: args.calculation.usageGroup,
      vehicleId: args.calculation.calculationSnapshot.vehicleId as string | null,
      driverId,
      ownerId,
      weekStart: args.calculation.calculationSnapshot.periodStart as string,
      weekEnd: args.calculation.calculationSnapshot.periodEnd as string,
      config: {
        ...args.calculation.configurationSnapshot,
        amazon_statement_candidate_id: args.candidate.id,
        amazon_statement_candidate_preview_revision: args.calculation.previewRevision,
      },
      grossRevenue: args.calculation.settlementResult.grossRevenue,
      totalDeductions: args.calculation.settlementResult.totalDeductions,
      ourCommissionEarned: args.calculation.settlementResult.ourCommissionEarned,
      netPay: args.calculation.settlementResult.netPay,
      lineItems: args.calculation.settlementResult.lineItems.map((item, index) => ({
        key: item.key,
        label_en: item.labelEn,
        label_tr: item.labelTr,
        amount: item.amount,
        is_our_revenue: item.isOurRevenue ?? false,
        sort_order: index,
      })),
      selectedLoadIds: args.revenueSelections.map((selection) => selection.projectedLoad.id),
      selectedExpenseIds: args.fuelSelections.map((selection) => selection.projectedExpense.id),
      auditMetadata: {
        amazonStatementCandidateId: args.candidate.id,
        amazonStatementCandidatePreviewRevision: args.calculation.previewRevision,
      },
    },
  };
}
