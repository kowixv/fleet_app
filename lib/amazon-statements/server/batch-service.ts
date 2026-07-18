import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { AmazonImportBatchStatus } from "../types";
import { assertWorkflow } from "./workflow-errors";
import type { AmazonBatchRecord, AmazonTransitionRule, AmazonWorkflowActor, AmazonWorkflowStage } from "./workflow-types";

export const AMAZON_BATCH_TRANSITIONS: readonly AmazonTransitionRule[] = [
  { from: "uploaded", to: "parsing", operation: "parse_files" },
  { from: "parsing", to: "parsed", operation: "persist_normalized_sources" },
  { from: "parsed", to: "needs_review", operation: "resolve_references" },
  { from: "parsed", to: "needs_review", operation: "persist_normalized_sources" },
  { from: "parsed", to: "reconciled", operation: "reconcile_payment" },
  { from: "needs_review", to: "reconciled", operation: "resolve_references" },
  { from: "reconciled", to: "ready", operation: "compile_candidates" },
  { from: "uploaded", to: "failed", operation: "parse_files" },
  { from: "parsing", to: "failed", operation: "parse_files" },
  { from: "parsed", to: "failed", operation: "persist_normalized_sources" },
  { from: "needs_review", to: "archived", operation: "archive_batch" },
  { from: "reconciled", to: "archived", operation: "archive_batch" },
  { from: "ready", to: "archived", operation: "archive_batch" },
  { from: "failed", to: "uploaded", operation: "retry_failed" },
] as const;

export function canTransitionAmazonBatch(args: {
  from: AmazonImportBatchStatus;
  to: AmazonImportBatchStatus;
  operation: AmazonWorkflowStage | "retry_failed" | "archive_batch";
  hasBlockingIssues?: boolean;
  financialReconciled?: boolean;
}): boolean {
  if (args.from === "archived") return false;
  const rule = AMAZON_BATCH_TRANSITIONS.some((transition) =>
    transition.from === args.from && transition.to === args.to && transition.operation === args.operation
  );
  if (!rule) return false;
  if (args.to === "ready" && (!args.financialReconciled || args.hasBlockingIssues)) return false;
  return true;
}

export function assertAmazonBatchTransition(args: {
  from: AmazonImportBatchStatus;
  to: AmazonImportBatchStatus;
  operation: AmazonWorkflowStage | "retry_failed" | "archive_batch";
  hasBlockingIssues?: boolean;
  financialReconciled?: boolean;
}): void {
  assertWorkflow(canTransitionAmazonBatch(args), {
    code: "invalid_batch_transition",
    message: `Amazon import batch cannot transition from ${args.from} to ${args.to} through ${args.operation}.`,
    stage: typeof args.operation === "string" && args.operation !== "retry_failed" && args.operation !== "archive_batch" ? args.operation : undefined,
    details: {
      from: args.from,
      to: args.to,
      operation: args.operation,
      hasBlockingIssues: args.hasBlockingIssues ?? false,
      financialReconciled: args.financialReconciled ?? false,
    },
  });
}

export async function createAmazonImportBatch(input: {
  actor: AmazonWorkflowActor;
  periodStart?: string | null;
  periodEnd?: string | null;
  notes?: string | null;
}): Promise<AmazonBatchRecord> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("amazon_import_batches")
    .insert({
      organization_id: input.actor.organizationId,
      created_by: input.actor.id,
      period_start: input.periodStart ?? null,
      period_end: input.periodEnd ?? null,
      notes: input.notes ?? null,
      status: "uploaded",
    })
    .select("id, organization_id, status, parser_bundle_version, period_start, period_end, updated_at")
    .single();
  if (error) throw new Error(error.message);
  return data as AmazonBatchRecord;
}

export async function loadAmazonBatchForActor(actor: AmazonWorkflowActor, batchId: string): Promise<AmazonBatchRecord> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("amazon_import_batches")
    .select("id, organization_id, status, parser_bundle_version, period_start, period_end, updated_at")
    .eq("id", batchId)
    .eq("organization_id", actor.organizationId)
    .single();
  if (error) throw new Error(error.message);
  return data as AmazonBatchRecord;
}

export async function transitionAmazonBatch(input: {
  actor: AmazonWorkflowActor;
  batchId: string;
  to: AmazonImportBatchStatus;
  operation: AmazonWorkflowStage | "retry_failed" | "archive_batch";
  hasBlockingIssues?: boolean;
  financialReconciled?: boolean;
}): Promise<AmazonBatchRecord> {
  const current = await loadAmazonBatchForActor(input.actor, input.batchId);
  assertAmazonBatchTransition({
    from: current.status,
    to: input.to,
    operation: input.operation,
    hasBlockingIssues: input.hasBlockingIssues,
    financialReconciled: input.financialReconciled,
  });
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("transition_amazon_import_batch_atomic", {
    p_batch_id: input.batchId,
    p_expected_status: current.status,
    p_next_status: input.to,
    p_operation: input.operation,
    p_expected_updated_at: (current as AmazonBatchRecord & { updated_at?: string | null }).updated_at ?? null,
    p_has_blocking_issues: input.hasBlockingIssues ?? false,
    p_financial_reconciled: input.financialReconciled ?? false,
  });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  return row as AmazonBatchRecord;
}
