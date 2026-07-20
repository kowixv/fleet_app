"use server";

import { requireAmazonImportActor } from "@/lib/amazon-statements/server/auth";
import { createAmazonImportBatch, transitionAmazonBatch } from "@/lib/amazon-statements/server/batch-service";
import { assertAmazonUploadEnvelope, parseAmazonSourceType } from "@/lib/amazon-statements/server/file-service";
import { approveAmazonCandidate, archiveAmazonCandidate } from "@/lib/amazon-statements/server/candidate-service";
import { convertSavedAmazonCandidate } from "@/lib/amazon-statements/server/conversion-service";
import { reconcileAmazonPaymentTripBatch } from "@/lib/amazon-statements/server/matching-service";
import {
  applyAmazonProjectionForBatch,
  previewReviewedAmazonCandidate,
  saveReviewedAmazonCandidate,
  type CandidateCreateInput,
} from "@/lib/amazon-statements/server/final-workflow-service";
import {
  validateEffectiveDates,
  validateFacilityFields,
  validateReferenceReason,
  validateTeamSplitBasisPoints,
  validateUniqueSelections,
} from "@/lib/amazon-statements/reference-review-validation";
import {
  getReferenceTaskMutationContext,
  resolveOpenIssuesForTask,
} from "@/lib/amazon-statements/server/reference-review-service";
import { createClient } from "@/lib/supabase/server";
import {
  approveExternalDriverMapping,
  approveFuelCardAssignment,
  approveTeamSplitRule,
  approveVehicleAliasMapping,
  archiveVehicleAliasMapping,
  rejectReferenceMapping,
  verifyFacilityMapping,
  type ExternalDriverApprovalInput,
  type FacilityVerificationInput,
  type FuelCardAssignmentApprovalInput,
  type TeamSplitApprovalInput,
  type VehicleAliasApprovalInput,
  type VehicleAliasArchiveInput,
} from "@/lib/amazon-statements/server/reference-service";
import {
  createAmazonImportUpload,
  inspectAmazonImportBatch,
  parseAmazonImportBatch as parseAmazonImportBatchService,
} from "@/lib/amazon-statements/server/workflow-service";
import { workflowFail, workflowOk } from "@/lib/amazon-statements/server/workflow-errors";
import type { AmazonWorkflowResult } from "@/lib/amazon-statements/server/workflow-types";
import { revalidatePath } from "next/cache";

function stringValue(value: FormDataEntryValue | null): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

type RejectReferenceActionInput = {
  batchId: string;
  decisionType: "reject_external_driver_mapping" | "reject_vehicle_alias_mapping" | "reject_facility_mapping" | "reject_fuel_card_assignment" | "archive_team_split_rule";
  reason: string;
  selectedValue?: Record<string, unknown>;
};

type ResolveReferenceActionInput =
  | RejectReferenceActionInput
  | { operation: "approve_external_driver_mapping"; input: ExternalDriverApprovalInput }
  | { operation: "approve_vehicle_alias_mapping"; input: VehicleAliasApprovalInput }
  | { operation: "archive_vehicle_alias_mapping"; input: VehicleAliasArchiveInput }
  | { operation: "verify_facility_mapping"; input: FacilityVerificationInput }
  | { operation: "approve_fuel_card_assignment"; input: FuelCardAssignmentApprovalInput }
  | { operation: "approve_team_split_rule"; input: TeamSplitApprovalInput }
  | ({ operation: "reject_reference" } & RejectReferenceActionInput);

type ResolveReferenceTaskActionInput = {
  batchId: string;
  taskId: string;
  operation: "approve" | "reject" | "archive";
  reason: string;
  expectedSourceRevision?: string | null;
  personId?: string | null;
  vehicleId?: string | null;
  driverId?: string | null;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  countryCode?: string | null;
  timezone?: string | null;
  verificationSource?: string | null;
  members?: Array<{ personId: string; splitBasisPoints: number }>;
};

export async function createAmazonImportBatchAction(input: {
  periodStart?: string | null;
  periodEnd?: string | null;
  notes?: string | null;
}): Promise<AmazonWorkflowResult<{ batchId: string }>> {
  try {
    const actor = await requireAmazonImportActor({ writer: true });
    const batch = await createAmazonImportBatch({
      actor,
      periodStart: input.periodStart ?? null,
      periodEnd: input.periodEnd ?? null,
      notes: input.notes ?? null,
    });
    revalidatePath("/settlements");
    return workflowOk({ batchId: batch.id });
  } catch (error) {
    return workflowFail(error, "create_batch");
  }
}

export async function registerAmazonImportFileAction(form: FormData): Promise<AmazonWorkflowResult<{
  fileId: string;
  duplicate: boolean;
}>> {
  try {
    const actor = await requireAmazonImportActor({ writer: true });
    const batchId = stringValue(form.get("batchId"));
    const sourceTypeRaw = stringValue(form.get("sourceType"));
    const file = form.get("file");
    if (!batchId) throw new Error("Batch ID is required.");
    const sourceType = parseAmazonSourceType(sourceTypeRaw);
    if (!(file instanceof File)) throw new Error("Import file is required.");
    assertAmazonUploadEnvelope({
      sourceType,
      filename: file.name,
      mimeType: file.type || null,
      sizeBytes: file.size,
    });
    const registered = await createAmazonImportUpload({
      actor,
      upload: {
        batchId,
        sourceType,
        filename: file.name,
        mimeType: file.type || null,
        bytes: new Uint8Array(await file.arrayBuffer()),
      },
    });
    revalidatePath("/settlements");
    return workflowOk({ fileId: registered.fileId, duplicate: registered.duplicate });
  } catch (error) {
    return workflowFail(error, "upload_files");
  }
}

export async function inspectAmazonImportBatchAction(batchId: string) {
  try {
    const actor = await requireAmazonImportActor({ writer: true });
    return workflowOk(await inspectAmazonImportBatch({ actor, batchId }));
  } catch (error) {
    return workflowFail(error, "inspect_files");
  }
}

export async function parseAmazonImportBatchAction(batchId: string) {
  try {
    const actor = await requireAmazonImportActor({ writer: true });
    const result = await parseAmazonImportBatchService({ actor, batchId });
    revalidatePath("/settlements");
    return workflowOk(result);
  } catch (error) {
    return workflowFail(error, "parse_files");
  }
}

export async function reconcileAmazonImportBatchAction(batchId: string) {
  try {
    const actor = await requireAmazonImportActor({ writer: true });
    const result = await reconcileAmazonPaymentTripBatch({ actor, batchId });
    revalidatePath(`/settlements/amazon-imports/${batchId}`);
    revalidatePath("/settlements/amazon-imports");
    return workflowOk(result);
  } catch (error) {
    return workflowFail(error, "reconcile_payment");
  }
}

export async function resolveAmazonReferenceAction(input: ResolveReferenceActionInput) {
  try {
    const actor = await requireAmazonImportActor({ writer: true });
    let result: { ok: true } | { ok: true; ruleId: string };
    if (!("operation" in input) || input.operation === "reject_reference") {
      result = await rejectReferenceMapping({ actor, ...input });
    } else if (input.operation === "approve_external_driver_mapping") {
      result = await approveExternalDriverMapping({ actor, input: input.input });
    } else if (input.operation === "approve_vehicle_alias_mapping") {
      result = await approveVehicleAliasMapping({ actor, input: input.input });
    } else if (input.operation === "archive_vehicle_alias_mapping") {
      result = await archiveVehicleAliasMapping({ actor, input: input.input });
    } else if (input.operation === "verify_facility_mapping") {
      result = await verifyFacilityMapping({ actor, input: input.input });
    } else if (input.operation === "approve_fuel_card_assignment") {
      result = await approveFuelCardAssignment({ actor, input: input.input });
    } else {
      result = await approveTeamSplitRule({ actor, input: input.input });
    }
    revalidatePath("/settlements");
    return workflowOk(result);
  } catch (error) {
    return workflowFail(error, "resolve_references");
  }
}

export async function resolveAmazonReferenceTaskAction(input: ResolveReferenceTaskActionInput) {
  try {
    const actor = await requireAmazonImportActor({ writer: true });
    const { view, task, provider, identifierType, externalValue, driverTokens, facilityCode } = await getReferenceTaskMutationContext(input.batchId, input.taskId);
    if (view.archived) throw new Error("This batch is archived and cannot be changed.");
    if (input.expectedSourceRevision && task.sourceRevision && input.expectedSourceRevision !== task.sourceRevision) {
      throw new Error("The source revision changed. Refresh and review the current task.");
    }
    const reasonError = validateReferenceReason(input.reason);
    if (reasonError) throw new Error(reasonError);
    const effectiveFrom = stringValueFromInput(input.effectiveFrom);
    const effectiveTo = stringValueFromInput(input.effectiveTo);
    if (input.operation !== "reject") {
      if (!effectiveFrom) throw new Error("Effective-from is required.");
      const dateError = validateEffectiveDates(effectiveFrom, effectiveTo);
      if (dateError) throw new Error(dateError);
    }
    if (input.operation === "reject" || input.operation === "archive") {
      await rejectReferenceMapping({
        actor,
        batchId: input.batchId,
        decisionType: task.category === "driver"
          ? "reject_external_driver_mapping"
          : task.category === "vehicle"
            ? "reject_vehicle_alias_mapping"
            : task.category === "facility"
              ? "reject_facility_mapping"
              : task.category === "fuel_assignment"
                ? "reject_fuel_card_assignment"
                : "archive_team_split_rule",
        reason: input.reason,
        selectedValue: { taskId: input.taskId, category: task.category, action: input.operation },
      });
      const resolvedCount = await resolveOpenIssuesForTask(input.batchId, task);
      revalidatePath(`/settlements/amazon-imports/${input.batchId}`);
      return workflowOk({ ok: true, resolvedCount });
    }
    await assertKnownReferenceTarget(actor.organizationId, input);
    let result: { ok: true } | { ok: true; ruleId: string };
    if (task.category === "driver") {
      if (!input.personId) throw new Error("Select one internal person.");
      result = await approveExternalDriverMapping({
        actor,
        input: {
          batchId: input.batchId,
          reason: input.reason,
          personId: input.personId,
          provider: provider === "unknown" ? "amazon" : provider,
          identifierType: driverIdentifier(identifierType),
          externalValue,
          effectiveFrom: effectiveFrom ?? "",
          effectiveTo,
          confidenceScore: null,
        },
      });
    } else if (task.category === "vehicle") {
      if (!input.vehicleId) throw new Error("Select one internal vehicle.");
      result = await approveVehicleAliasMapping({
        actor,
        input: {
          batchId: input.batchId,
          reason: input.reason,
          vehicleId: input.vehicleId,
          provider: provider === "unknown" ? "amazon" : provider,
          identifierType: vehicleIdentifier(identifierType),
          externalValue,
          effectiveFrom: effectiveFrom ?? "",
          effectiveTo,
        },
      });
    } else if (task.category === "facility") {
      const facilityValidation = validateFacilityFields({
        city: input.city ?? "",
        state: input.state ?? "",
        countryCode: input.countryCode ?? "US",
        postalCode: input.postalCode,
        timezone: input.timezone,
      });
      if (!facilityValidation.ok) throw new Error(Object.values(facilityValidation.errors)[0] ?? "Facility fields are invalid.");
      if (!input.verificationSource?.trim()) throw new Error("Verification source is required.");
      result = await verifyFacilityMapping({
        actor,
        input: {
          batchId: input.batchId,
          reason: `${input.reason.trim()} Source: ${input.verificationSource.trim()}`,
          provider: provider === "unknown" ? "amazon" : provider,
          facilityCode,
          city: input.city ?? "",
          state: (input.state ?? "").trim().toUpperCase(),
          postalCode: input.postalCode ?? null,
          countryCode: (input.countryCode ?? "US").trim().toUpperCase(),
          timezone: input.timezone ?? null,
          effectiveFrom: effectiveFrom ?? "",
          effectiveTo,
        },
      });
    } else if (task.category === "fuel_assignment") {
      if (task.placeholder) return workflowOk({ ok: true, resolvedCount: 0 });
      if (task.financialBlocked) throw new Error("Fuel financial reconciliation must pass before assignment approval.");
      if (!input.vehicleId && !input.driverId) throw new Error("Select a vehicle, driver, or both.");
      result = await approveFuelCardAssignment({
        actor,
        input: {
          batchId: input.batchId,
          reason: input.reason,
          vehicleId: input.vehicleId ?? null,
          driverId: input.driverId ?? null,
          fuelCardValue: externalValue,
          effectiveFrom: effectiveFrom ?? "",
          effectiveTo,
        },
      });
    } else {
      const members = input.members ?? [];
      const splitError = validateTeamSplitBasisPoints(members.map((member) => member.splitBasisPoints))
        ?? validateUniqueSelections(members.map((member) => member.personId));
      if (splitError) throw new Error(splitError);
      result = await approveTeamSplitRule({
        actor,
        input: {
          batchId: input.batchId,
          reason: input.reason,
          provider: provider === "manual" ? "manual" : "amazon",
          driverTokens,
          members,
          effectiveFrom: effectiveFrom ?? "",
          effectiveTo,
        },
      });
    }
    const resolvedCount = await resolveOpenIssuesForTask(input.batchId, task);
    revalidatePath(`/settlements/amazon-imports/${input.batchId}`);
    revalidatePath(`/settlements/amazon-imports/${input.batchId}/references`);
    return workflowOk({ ...result, resolvedCount });
  } catch (error) {
    return workflowFail(error, "resolve_references");
  }
}

export async function approveAmazonCandidateAction(input: {
  candidateId: string;
  expectedPreviewRevision: string;
}) {
  try {
    const actor = await requireAmazonImportActor({ writer: true });
    const result = await approveAmazonCandidate({ actor, ...input });
    revalidatePath("/settlements");
    return workflowOk(result);
  } catch (error) {
    return workflowFail(error, "approve_candidate");
  }
}

export async function applyAmazonProjectionAction(input: {
  batchId: string;
  expectedRevenuePreviewRevision: string;
  expectedFuelPreviewRevision: string;
}) {
  try {
    const actor = await requireAmazonImportActor({ writer: true });
    const result = await applyAmazonProjectionForBatch({ actor, ...input });
    revalidatePath(`/settlements/amazon-imports/${input.batchId}`);
    return workflowOk(result);
  } catch (error) {
    return workflowFail(error, "apply_projection");
  }
}

export async function createAmazonCandidateAction(input: CandidateCreateInput) {
  try {
    const actor = await requireAmazonImportActor({ writer: true });
    const result = await saveReviewedAmazonCandidate({ actor, input });
    revalidatePath(`/settlements/amazon-imports/${input.batchId}`);
    return workflowOk(result);
  } catch (error) {
    return workflowFail(error, "compile_candidates");
  }
}

export async function previewAmazonCandidateAction(input: CandidateCreateInput) {
  try {
    const actor = await requireAmazonImportActor({ writer: true });
    const result = await previewReviewedAmazonCandidate({ actor, input });
    return workflowOk(result);
  } catch (error) {
    return workflowFail(error, "compile_candidates");
  }
}

export async function recomputeAmazonCandidateAction(input: {
  candidateId: string;
  expectedPreviewRevision: string;
}) {
  try {
    const actor = await requireAmazonImportActor({ writer: true });
    await archiveAmazonCandidate({ actor, candidateId: input.candidateId, expectedPreviewRevision: input.expectedPreviewRevision });
    revalidatePath("/settlements");
    return workflowOk({ ok: true, status: "archived_for_recompute" });
  } catch (error) {
    return workflowFail(error, "compile_candidates");
  }
}

export async function archiveAmazonCandidateAction(input: {
  candidateId: string;
  expectedPreviewRevision?: string | null;
}) {
  try {
    const actor = await requireAmazonImportActor({ writer: true });
    const result = await archiveAmazonCandidate({ actor, ...input });
    revalidatePath("/settlements");
    return workflowOk(result);
  } catch (error) {
    return workflowFail(error, "compile_candidates");
  }
}

export async function convertAmazonCandidateAction(input: {
  candidateId: string;
  expectedPreviewRevision: string;
}) {
  try {
    const actor = await requireAmazonImportActor({ writer: true });
    const result = await convertSavedAmazonCandidate({ actor, ...input });
    revalidatePath("/settlements");
    return workflowOk(result);
  } catch (error) {
    return workflowFail(error, "convert_candidate");
  }
}

export async function archiveAmazonImportBatchAction(batchId: string) {
  try {
    const actor = await requireAmazonImportActor({ writer: true });
    const batch = await transitionAmazonBatch({ actor, batchId, to: "archived", operation: "archive_batch" });
    revalidatePath("/settlements");
    return workflowOk({ batchId: batch.id, status: batch.status });
  } catch (error) {
    return workflowFail(error);
  }
}

export async function retryAmazonImportBatchAction(batchId: string) {
  try {
    const actor = await requireAmazonImportActor({ writer: true });
    const batch = await transitionAmazonBatch({ actor, batchId, to: "uploaded", operation: "retry_failed" });
    revalidatePath(`/settlements/amazon-imports/${batchId}`);
    return workflowOk({ batchId: batch.id, status: batch.status });
  } catch (error) {
    return workflowFail(error);
  }
}

function stringValueFromInput(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function assertKnownReferenceTarget(organizationId: string, input: ResolveReferenceTaskActionInput) {
  const supabase = await createClient();
  if (input.personId || input.driverId) {
    const ids = [input.personId, input.driverId].filter((value): value is string => Boolean(value));
    const { data, error } = await supabase
      .from("people")
      .select("id")
      .eq("organization_id", organizationId)
      .in("id", ids);
    if (error) throw new Error(error.message);
    if ((data ?? []).length !== new Set(ids).size) throw new Error("Selected person is no longer available.");
  }
  if (input.vehicleId) {
    const { data, error } = await supabase
      .from("vehicles")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("id", input.vehicleId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("Selected vehicle is no longer available.");
  }
}

function driverIdentifier(value: string): ExternalDriverApprovalInput["identifierType"] {
  if (value === "driver_external_id" || value === "fuel_driver_label") return value;
  return "driver_display_name";
}

function vehicleIdentifier(value: string): VehicleAliasApprovalInput["identifierType"] {
  if (value === "amazon_unit" || value === "fuel_unit" || value === "fuel_card") return value;
  return "tractor_vehicle_id";
}
