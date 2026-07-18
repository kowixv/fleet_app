import "server-only";

import { createClient } from "@/lib/supabase/server";
import { prepareSettlementConversionPayload } from "../candidates/candidate-to-settlement";
import type {
  CandidateCalculationResult,
  CandidateFuelSelection,
  CandidateRecordForConversion,
  CandidateRevenueSelection,
} from "../candidates/candidate-types";
import type { AmazonWorkflowActor } from "./workflow-types";
import { assertWorkflow } from "./workflow-errors";

export async function convertAmazonCandidate(args: {
  actor: AmazonWorkflowActor;
  candidate: CandidateRecordForConversion;
  calculation: CandidateCalculationResult;
  revenueSelections: CandidateRevenueSelection[];
  fuelSelections: CandidateFuelSelection[];
  expectedPreviewRevision: string;
  expectedSourceRevision?: string | null;
  expectedConfigurationRevision?: string | null;
}): Promise<{ ok: true; settlementId: string; status: "converted" | "already_converted" }> {
  assertWorkflow(args.candidate.organizationId === args.actor.organizationId, {
    code: "wrong_organization",
    message: "Candidate does not belong to this organization.",
    stage: "convert_candidate",
  });
  const prepared = prepareSettlementConversionPayload({
    candidate: args.candidate,
    calculation: args.calculation,
    revenueSelections: args.revenueSelections,
    fuelSelections: args.fuelSelections,
    expectedPreviewRevision: args.expectedPreviewRevision,
    createdBy: args.actor.id,
  });
  assertWorkflow(prepared.ok, {
    code: "candidate_conversion_blocked",
    message: "Candidate is not eligible for conversion.",
    stage: "convert_candidate",
    details: prepared.ok ? undefined : { issues: prepared.issues.map((issue) => issue.issueCode) },
  });
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("convert_amazon_candidate_atomic", {
    p_candidate_id: args.candidate.id,
    p_expected_preview_revision: args.expectedPreviewRevision,
    p_expected_source_revision: args.expectedSourceRevision ?? args.calculation.sourceRevision,
    p_expected_configuration_revision: args.expectedConfigurationRevision ?? null,
  });
  if (error) throw new Error(error.message);
  const result = data as { settlementId?: string; status?: "converted" | "already_converted" } | null;
  if (!result?.settlementId) throw new Error("Amazon candidate conversion did not return a settlement.");
  return { ok: true, settlementId: result.settlementId, status: result.status ?? "converted" };
}

export async function convertSavedAmazonCandidate(args: {
  actor: AmazonWorkflowActor;
  candidateId: string;
  expectedPreviewRevision: string;
}): Promise<{ ok: true; settlementId: string; status: "converted" | "already_converted" }> {
  const supabase = await createClient();
  const { data: candidate, error: readError } = await supabase
    .from("amazon_statement_candidates")
    .select("id, organization_id, status, preview_revision, source_revision, converted_settlement_id")
    .eq("organization_id", args.actor.organizationId)
    .eq("id", args.candidateId)
    .single();
  if (readError) throw new Error(readError.message);
  const row = candidate as {
    id: string;
    organization_id: string;
    status: string;
    preview_revision: string;
    source_revision: string;
    converted_settlement_id?: string | null;
  };
  assertWorkflow(row.organization_id === args.actor.organizationId, {
    code: "wrong_organization",
    message: "Candidate does not belong to this organization.",
    stage: "convert_candidate",
  });
  if (row.status === "converted" && row.converted_settlement_id) {
    return { ok: true, settlementId: row.converted_settlement_id, status: "already_converted" };
  }
  assertWorkflow(row.status === "ready", {
    code: "candidate_not_ready",
    message: "Only Ready Amazon statement candidates can be converted.",
    stage: "convert_candidate",
  });
  assertWorkflow(row.preview_revision === args.expectedPreviewRevision, {
    code: "stale_preview",
    message: "Candidate preview revision is stale.",
    stage: "convert_candidate",
  });
  const { data, error } = await supabase.rpc("convert_amazon_candidate_atomic", {
    p_candidate_id: args.candidateId,
    p_expected_preview_revision: args.expectedPreviewRevision,
    p_expected_source_revision: row.source_revision,
    p_expected_configuration_revision: null,
  });
  if (error) throw new Error(error.message);
  const result = data as { settlementId?: string; status?: "converted" | "already_converted" } | null;
  if (!result?.settlementId) throw new Error("Amazon candidate conversion did not return a settlement.");
  return { ok: true, settlementId: result.settlementId, status: result.status ?? "converted" };
}
