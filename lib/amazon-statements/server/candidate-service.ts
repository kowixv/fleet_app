import "server-only";

import { createClient } from "@/lib/supabase/server";
import { compileAmazonStatementCandidate } from "../candidates/candidate-compiler";
import type { CandidateCompilerInput, CandidateCalculationResult, CandidateStatus } from "../candidates/candidate-types";
import type { AmazonWorkflowActor } from "./workflow-types";
import { assertWorkflow } from "./workflow-errors";

export function recomputeAmazonCandidate(input: CandidateCompilerInput): CandidateCalculationResult {
  return compileAmazonStatementCandidate(input);
}

export async function createDraftAmazonCandidate(args: {
  actor: AmazonWorkflowActor;
  batchId: string;
  input: CandidateCompilerInput;
}): Promise<{ candidateId: string; status: CandidateStatus; previewRevision: string }> {
  const calculation = recomputeAmazonCandidate(args.input);
  assertWorkflow(args.input.config.organizationId === args.actor.organizationId, {
    code: "wrong_organization",
    message: "Candidate configuration does not belong to this organization.",
    stage: "compile_candidates",
  });
  assertWorkflow(args.input.config.batchId === args.batchId, {
    code: "wrong_batch",
    message: "Candidate configuration does not belong to this batch.",
    stage: "compile_candidates",
  });
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("amazon_statement_candidates")
    .insert({
      organization_id: args.actor.organizationId,
      batch_id: args.batchId,
      statement_type: calculation.statementType,
      status: calculation.readiness.status === "ready" ? "needs_review" : calculation.readiness.status,
      period_start: args.input.config.periodStart,
      period_end: args.input.config.periodEnd,
      payee_type: args.input.config.payeeType,
      payee_id: args.input.config.payeeId ?? null,
      vehicle_id: args.input.config.vehicleId ?? null,
      team_split_rule_id: args.input.config.teamSplitRule?.ruleId ?? null,
      calculation_rule_version: args.input.config.calculationRuleVersion,
      template_version: args.input.config.templateVersion,
      source_revision: calculation.sourceRevision,
      preview_revision: calculation.previewRevision,
      configuration_snapshot: calculation.configurationSnapshot,
      source_snapshot: calculation.sourceSnapshot,
      calculation_snapshot: calculation.calculationSnapshot,
      gross_amount: calculation.grossAmount,
      percentage_deductions_amount: calculation.percentageDeductionsAmount,
      fixed_deductions_amount: calculation.fixedDeductionsAmount,
      fuel_deductions_amount: calculation.fuelDeductionsAmount,
      other_deductions_amount: calculation.otherDeductionsAmount,
      total_deductions_amount: calculation.totalDeductionsAmount,
      net_amount: calculation.netAmount,
      last_error: readinessErrorSnapshot(calculation),
      created_by: args.actor.id,
    })
    .select("id, status, preview_revision")
    .single();
  if (error) throw new Error(error.message);
  const candidateId = String((data as { id: string }).id);
  await persistCandidateDetails({
    actor: args.actor,
    candidateId,
    input: args.input,
    calculation,
  });
  return {
    candidateId,
    status: (data as { status: CandidateStatus }).status,
    previewRevision: String((data as { preview_revision: string }).preview_revision),
  };
}

export async function saveEditableAmazonCandidate(args: {
  actor: AmazonWorkflowActor;
  candidateId: string;
  expectedPreviewRevision: string;
  input: CandidateCompilerInput;
}): Promise<{ candidateId: string; status: CandidateStatus; previewRevision: string }> {
  const calculation = recomputeAmazonCandidate(args.input);
  assertWorkflow(args.input.config.organizationId === args.actor.organizationId, {
    code: "wrong_organization",
    message: "Candidate configuration does not belong to this organization.",
    stage: "compile_candidates",
  });
  const supabase = await createClient();
  const { data: candidate, error: readError } = await supabase
    .from("amazon_statement_candidates")
    .select("id, batch_id, status, preview_revision")
    .eq("organization_id", args.actor.organizationId)
    .eq("id", args.candidateId)
    .single();
  if (readError) throw new Error(readError.message);
  const row = candidate as { batch_id: string; status: CandidateStatus; preview_revision: string };
  assertWorkflow(row.status === "draft" || row.status === "needs_review" || row.status === "stale", {
    code: "immutable_candidate",
    message: "Only Draft, Needs Review, or Stale candidates can be edited.",
    stage: "compile_candidates",
  });
  assertWorkflow(row.preview_revision === args.expectedPreviewRevision, {
    code: "stale_preview",
    message: "Candidate preview revision is stale. Refresh before saving.",
    stage: "compile_candidates",
  });
  assertWorkflow(row.batch_id === args.input.config.batchId, {
    code: "wrong_batch",
    message: "Candidate configuration does not belong to this batch.",
    stage: "compile_candidates",
  });
  const nextStatus = calculation.readiness.status === "ready" ? "needs_review" : calculation.readiness.status;
  const { error } = await supabase
    .from("amazon_statement_candidates")
    .update({
      statement_type: calculation.statementType,
      status: nextStatus,
      period_start: args.input.config.periodStart,
      period_end: args.input.config.periodEnd,
      payee_type: args.input.config.payeeType,
      payee_id: args.input.config.payeeId ?? null,
      vehicle_id: args.input.config.vehicleId ?? null,
      team_split_rule_id: args.input.config.teamSplitRule?.ruleId ?? null,
      calculation_rule_version: args.input.config.calculationRuleVersion,
      template_version: args.input.config.templateVersion,
      source_revision: calculation.sourceRevision,
      preview_revision: calculation.previewRevision,
      configuration_snapshot: calculation.configurationSnapshot,
      source_snapshot: calculation.sourceSnapshot,
      calculation_snapshot: calculation.calculationSnapshot,
      gross_amount: calculation.grossAmount,
      percentage_deductions_amount: calculation.percentageDeductionsAmount,
      fixed_deductions_amount: calculation.fixedDeductionsAmount,
      fuel_deductions_amount: calculation.fuelDeductionsAmount,
      other_deductions_amount: calculation.otherDeductionsAmount,
      total_deductions_amount: calculation.totalDeductionsAmount,
      net_amount: calculation.netAmount,
      last_error: readinessErrorSnapshot(calculation),
    })
    .eq("organization_id", args.actor.organizationId)
    .eq("id", args.candidateId)
    .eq("preview_revision", args.expectedPreviewRevision);
  if (error) throw new Error(error.message);
  await replaceCandidateDetails({
    actor: args.actor,
    candidateId: args.candidateId,
    input: args.input,
    calculation,
  });
  return { candidateId: args.candidateId, status: nextStatus, previewRevision: calculation.previewRevision };
}

export async function approveAmazonCandidate(args: {
  actor: AmazonWorkflowActor;
  candidateId: string;
  expectedPreviewRevision: string;
}): Promise<{ ok: true }> {
  const supabase = await createClient();
  const { data: candidate, error: readError } = await supabase
    .from("amazon_statement_candidates")
    .select("id, organization_id, status, preview_revision, last_error")
    .eq("organization_id", args.actor.organizationId)
    .eq("id", args.candidateId)
    .single();
  if (readError) throw new Error(readError.message);
  const row = candidate as { status: CandidateStatus; preview_revision: string; last_error?: unknown };
  assertWorkflow(row.status !== "converted" && row.status !== "archived", {
    code: "immutable_candidate",
    message: "Converted or archived candidates cannot be approved.",
    stage: "approve_candidate",
  });
  assertWorkflow(row.preview_revision === args.expectedPreviewRevision, {
    code: "stale_preview",
    message: "Candidate preview revision is stale.",
    stage: "approve_candidate",
  });
  assertWorkflow(row.status !== "stale", {
    code: "stale_candidate",
    message: "Stale candidates must be recomputed before approval.",
    stage: "approve_candidate",
  });
  assertWorkflow(!hasBlockingReadinessError(row.last_error), {
    code: "candidate_readiness_blocked",
    message: "Candidate has blocking readiness issues and cannot be approved.",
    stage: "approve_candidate",
  });
  const { error } = await supabase
    .from("amazon_statement_candidates")
    .update({ status: "ready", approved_by: args.actor.id, approved_at: new Date().toISOString() })
    .eq("organization_id", args.actor.organizationId)
    .eq("id", args.candidateId)
    .eq("preview_revision", args.expectedPreviewRevision);
  if (error) throw new Error(error.message);
  return { ok: true };
}

export async function archiveAmazonCandidate(args: {
  actor: AmazonWorkflowActor;
  candidateId: string;
  expectedPreviewRevision?: string | null;
}): Promise<{ ok: true }> {
  const supabase = await createClient();
  let query = supabase
    .from("amazon_statement_candidates")
    .update({ status: "archived" })
    .eq("organization_id", args.actor.organizationId)
    .eq("id", args.candidateId)
    .not("status", "in", "(converted,archived)");
  if (args.expectedPreviewRevision) {
    query = query.eq("preview_revision", args.expectedPreviewRevision);
  }
  const { data, error } = await query.select("id");
  if (error) throw new Error(error.message);
  assertWorkflow((data ?? []).length > 0, {
    code: "candidate_archive_conflict",
    message: "Candidate could not be archived. Refresh and review the current status.",
    stage: "compile_candidates",
  });
  return { ok: true };
}

async function persistCandidateDetails(args: {
  actor: AmazonWorkflowActor;
  candidateId: string;
  input: CandidateCompilerInput;
  calculation: CandidateCalculationResult;
}) {
  const supabase = await createClient();
  const revenueRows = args.input.revenueSelections.map((selection) => ({
    organization_id: args.actor.organizationId,
    candidate_id: args.candidateId,
    revenue_item_id: selection.revenueItemId,
    load_id: selection.projectedLoad.id,
    allocated_gross_amount: selection.allocatedGrossAmount,
    allocation_basis_points: selection.allocationBasisPoints ?? null,
    source_revision: selection.sourceRevision,
    source_snapshot: selection.sourceSnapshot,
    display_order: selection.displayOrder,
    period_override_approved: selection.periodOverrideApproved ?? false,
  }));
  const fuelRows = (args.input.fuelSelections ?? []).map((selection) => ({
    organization_id: args.actor.organizationId,
    candidate_id: args.candidateId,
    transaction_line_id: selection.transactionLineId,
    expense_id: selection.projectedExpense.id,
    allocated_amount: selection.allocatedAmount,
    allocation_basis_points: selection.allocationBasisPoints ?? null,
    source_revision: selection.sourceRevision,
    source_snapshot: selection.sourceSnapshot,
    display_order: selection.displayOrder,
    period_override_approved: selection.periodOverrideApproved ?? false,
  }));
  const adjustmentRows = args.calculation.adjustmentLines.map((line) => ({
    organization_id: args.actor.organizationId,
    candidate_id: args.candidateId,
    adjustment_type: line.adjustmentType,
    label: line.label,
    calculation_basis: line.calculationBasis,
    rate_basis_points: line.rateBasisPoints,
    fixed_amount: line.fixedAmount,
    calculated_amount: line.calculatedAmount,
    deduction_lane: line.deductionLane,
    display_order: line.displayOrder,
    configuration_source: line.configurationSource,
    source_snapshot: line.sourceSnapshot,
  }));
  if (revenueRows.length > 0) {
    const { error } = await supabase.from("amazon_statement_candidate_revenue").insert(revenueRows);
    if (error) throw new Error(error.message);
  }
  if (fuelRows.length > 0) {
    const { error } = await supabase.from("amazon_statement_candidate_fuel_lines").insert(fuelRows);
    if (error) throw new Error(error.message);
  }
  if (adjustmentRows.length > 0) {
    const { error } = await supabase.from("amazon_statement_candidate_adjustments").insert(adjustmentRows);
    if (error) throw new Error(error.message);
  }
}

async function replaceCandidateDetails(args: {
  actor: AmazonWorkflowActor;
  candidateId: string;
  input: CandidateCompilerInput;
  calculation: CandidateCalculationResult;
}) {
  const supabase = await createClient();
  for (const table of [
    "amazon_statement_candidate_adjustments",
    "amazon_statement_candidate_fuel_lines",
    "amazon_statement_candidate_revenue",
  ] as const) {
    const { error } = await supabase
      .from(table)
      .delete()
      .eq("organization_id", args.actor.organizationId)
      .eq("candidate_id", args.candidateId);
    if (error) throw new Error(error.message);
  }
  await persistCandidateDetails(args);
}

function readinessErrorSnapshot(calculation: CandidateCalculationResult): Record<string, unknown> | null {
  const blockingIssues = calculation.readiness.issues.filter((issue) => issue.severity === "blocking");
  const warningIssues = calculation.readiness.issues.filter((issue) => issue.severity === "warning");
  if (blockingIssues.length === 0 && warningIssues.length === 0) return null;
  return {
    blockingIssueCodes: blockingIssues.map((issue) => issue.issueCode),
    warningIssueCodes: warningIssues.map((issue) => issue.issueCode),
  };
}

function hasBlockingReadinessError(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const blocking = (value as { blockingIssueCodes?: unknown }).blockingIssueCodes;
  return Array.isArray(blocking) && blocking.length > 0;
}
