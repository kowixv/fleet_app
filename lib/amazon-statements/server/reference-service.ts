import "server-only";

import { createClient } from "@/lib/supabase/server";
import {
  effectiveDateRangeIsValid,
  effectiveDateRangesOverlap,
  normalizeExternalVehicleIdentifier,
} from "../contracts";
import { deterministicTeamKey, normalizeReferenceValue } from "../resolution/resolution-types";
import type { AmazonExternalVehicleIdentifier } from "../types";
import type { AmazonWorkflowActor } from "./workflow-types";
import { assertWorkflow } from "./workflow-errors";

export interface ReferenceReviewInput {
  batchId: string;
  reason: string;
}

export interface VehicleAliasApprovalInput extends ReferenceReviewInput {
  vehicleId: string;
  provider: "amazon" | "octane" | "manual";
  identifierType: "tractor_vehicle_id" | "amazon_unit" | "fuel_unit" | "fuel_card";
  externalValue: string;
  effectiveFrom: string;
  effectiveTo?: string | null;
}

export interface ExternalDriverApprovalInput extends ReferenceReviewInput {
  personId: string;
  provider: "amazon" | "octane" | "manual";
  identifierType: "driver_display_name" | "driver_external_id" | "fuel_driver_label";
  externalValue: string;
  effectiveFrom: string;
  effectiveTo?: string | null;
  confidenceScore?: number | null;
}

export interface FacilityVerificationInput extends ReferenceReviewInput {
  provider: "amazon" | "octane" | "manual";
  facilityCode: string;
  city: string;
  state: string;
  postalCode?: string | null;
  countryCode?: string | null;
  timezone?: string | null;
  effectiveFrom: string;
  effectiveTo?: string | null;
}

export interface TeamSplitApprovalInput extends ReferenceReviewInput {
  provider: "amazon" | "manual";
  driverTokens: string[];
  members: Array<{
    personId: string;
    splitBasisPoints: number;
  }>;
  effectiveFrom: string;
  effectiveTo?: string | null;
}

export interface FuelCardAssignmentApprovalInput extends ReferenceReviewInput {
  vehicleId?: string | null;
  driverId?: string | null;
  fuelCardValue: string;
  effectiveFrom: string;
  effectiveTo?: string | null;
}

export interface VehicleAliasArchiveInput extends ReferenceReviewInput {
  mappingId: string;
  effectiveTo: string;
}

type EffectiveRangeInput = {
  effectiveFrom: string;
  effectiveTo?: string | null;
};

type ReferenceDecisionType =
  | "approve_external_driver_mapping"
  | "reject_external_driver_mapping"
  | "approve_vehicle_alias_mapping"
  | "archive_vehicle_alias_mapping"
  | "reject_vehicle_alias_mapping"
  | "verify_facility_mapping"
  | "reject_facility_mapping"
  | "approve_fuel_card_assignment"
  | "reject_fuel_card_assignment"
  | "approve_team_split_rule"
  | "archive_team_split_rule";

export async function approveExternalDriverMapping(args: {
  actor: AmazonWorkflowActor;
  input: ExternalDriverApprovalInput;
}): Promise<{ ok: true }> {
  assertReviewReason(args.input.reason);
  assertEffectiveRange(args.input);
  const normalizedValue = normalizeReferenceValue(args.input.externalValue) ?? "";
  assertWorkflow(normalizedValue !== "", {
    code: "invalid_external_driver_identifier",
    message: "External driver identifier is required.",
    stage: "resolve_references",
  });
  if (args.input.confidenceScore != null) {
    assertWorkflow(args.input.confidenceScore >= 0 && args.input.confidenceScore <= 1, {
      code: "invalid_confidence_score",
      message: "Confidence score must be between 0 and 1.",
      stage: "resolve_references",
    });
  }
  const supabase = await createClient();
  await assertNoApprovedOverlap({
    actor: args.actor,
    table: "amazon_external_driver_identifiers",
    filters: {
      provider: args.input.provider,
      identifier_type: args.input.identifierType,
      normalized_value: normalizedValue,
      status: "approved",
    },
    proposed: args.input,
    conflictCode: "overlapping_driver_mapping",
    conflictMessage: "External driver mapping overlaps an approved effective range.",
  });
  const { error } = await supabase.from("amazon_external_driver_identifiers").insert({
    organization_id: args.actor.organizationId,
    provider: args.input.provider,
    identifier_type: args.input.identifierType,
    external_value: args.input.externalValue,
    normalized_value: normalizedValue,
    person_id: args.input.personId,
    effective_from: args.input.effectiveFrom,
    effective_to: args.input.effectiveTo ?? null,
    status: "approved",
    confidence_score: args.input.confidenceScore ?? null,
    assignment_source: "review_decision",
    approved_by: args.actor.id,
    approved_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
  await recordReviewDecision({
    actor: args.actor,
    batchId: args.input.batchId,
    decisionType: "approve_external_driver_mapping",
    selectedValue: {
      personId: args.input.personId,
      provider: args.input.provider,
      identifierType: args.input.identifierType,
      effectiveFrom: args.input.effectiveFrom,
      effectiveTo: args.input.effectiveTo ?? null,
    },
    reason: args.input.reason,
  });
  return { ok: true };
}

export async function approveVehicleAliasMapping(args: {
  actor: AmazonWorkflowActor;
  input: VehicleAliasApprovalInput;
}): Promise<{ ok: true }> {
  assertReviewReason(args.input.reason);
  assertEffectiveRange(args.input);
  const proposed: Pick<AmazonExternalVehicleIdentifier, "organizationId" | "provider" | "identifierType" | "normalizedValue" | "effectiveFrom" | "effectiveTo"> = {
    organizationId: args.actor.organizationId,
    provider: args.input.provider,
    identifierType: args.input.identifierType,
    normalizedValue: normalizeExternalVehicleIdentifier(args.input.externalValue),
    effectiveFrom: args.input.effectiveFrom,
    effectiveTo: args.input.effectiveTo ?? null,
  };
  assertWorkflow(effectiveDateRangeIsValid(proposed), {
    code: "invalid_effective_dates",
    message: "Effective-to date must be after effective-from date.",
    stage: "resolve_references",
  });
  const supabase = await createClient();
  const { data: existing, error: existingError } = await supabase
    .from("amazon_external_vehicle_identifiers")
    .select("organization_id, provider, identifier_type, normalized_value, effective_from, effective_to")
    .eq("organization_id", args.actor.organizationId)
    .eq("provider", args.input.provider)
    .eq("identifier_type", args.input.identifierType)
    .eq("normalized_value", normalizeExternalVehicleIdentifier(args.input.externalValue));
  if (existingError) throw new Error(existingError.message);
  for (const row of existing ?? []) {
    const current = row as {
      organization_id: string;
      provider: "amazon" | "octane" | "manual";
      identifier_type: "tractor_vehicle_id" | "amazon_unit" | "fuel_unit" | "fuel_card";
      normalized_value: string;
      effective_from: string;
      effective_to: string | null;
    };
    assertWorkflow(!effectiveDateRangesOverlap(proposed, {
      effectiveFrom: current.effective_from,
      effectiveTo: current.effective_to,
    }), {
      code: "overlapping_reference_mapping",
      message: "Vehicle alias mapping overlaps an existing effective range.",
      stage: "resolve_references",
    });
  }
  const { error } = await supabase.from("amazon_external_vehicle_identifiers").insert({
    organization_id: args.actor.organizationId,
    vehicle_id: args.input.vehicleId,
    provider: args.input.provider,
    identifier_type: args.input.identifierType,
    external_value: args.input.externalValue,
    normalized_value: proposed.normalizedValue,
    effective_from: args.input.effectiveFrom,
    effective_to: args.input.effectiveTo ?? null,
  });
  if (error) throw new Error(error.message);
  await recordReviewDecision({
    actor: args.actor,
    batchId: args.input.batchId,
    decisionType: "approve_vehicle_alias_mapping",
    selectedValue: {
      vehicleId: args.input.vehicleId,
      provider: args.input.provider,
      identifierType: args.input.identifierType,
      effectiveFrom: args.input.effectiveFrom,
      effectiveTo: args.input.effectiveTo ?? null,
    },
    reason: args.input.reason,
  });
  return { ok: true };
}

export async function archiveVehicleAliasMapping(args: {
  actor: AmazonWorkflowActor;
  input: VehicleAliasArchiveInput;
}): Promise<{ ok: true }> {
  assertReviewReason(args.input.reason);
  const supabase = await createClient();
  const { data: existing, error: readError } = await supabase
    .from("amazon_external_vehicle_identifiers")
    .select("id, effective_from")
    .eq("organization_id", args.actor.organizationId)
    .eq("id", args.input.mappingId)
    .single();
  if (readError) throw new Error(readError.message);
  const current = existing as { effective_from: string };
  assertWorkflow(Date.parse(args.input.effectiveTo) > Date.parse(current.effective_from), {
    code: "invalid_effective_dates",
    message: "Archive effective date must be after the mapping effective-from date.",
    stage: "resolve_references",
  });
  const { error } = await supabase
    .from("amazon_external_vehicle_identifiers")
    .update({ effective_to: args.input.effectiveTo })
    .eq("organization_id", args.actor.organizationId)
    .eq("id", args.input.mappingId);
  if (error) throw new Error(error.message);
  await recordReviewDecision({
    actor: args.actor,
    batchId: args.input.batchId,
    decisionType: "archive_vehicle_alias_mapping",
    selectedValue: { mappingId: args.input.mappingId, effectiveTo: args.input.effectiveTo },
    reason: args.input.reason,
  });
  return { ok: true };
}

export async function verifyFacilityMapping(args: {
  actor: AmazonWorkflowActor;
  input: FacilityVerificationInput;
}): Promise<{ ok: true }> {
  assertReviewReason(args.input.reason);
  assertEffectiveRange(args.input);
  const normalizedFacilityCode = normalizeReferenceValue(args.input.facilityCode) ?? "";
  assertWorkflow(normalizedFacilityCode !== "" && args.input.city.trim() !== "" && args.input.state.trim() !== "", {
    code: "invalid_facility_mapping",
    message: "Facility code, city and state are required.",
    stage: "resolve_references",
  });
  const supabase = await createClient();
  await assertNoApprovedOverlap({
    actor: args.actor,
    table: "amazon_facility_locations",
    filters: {
      provider: args.input.provider,
      normalized_facility_code: normalizedFacilityCode,
      verification_status: "manually_verified",
    },
    proposed: args.input,
    conflictCode: "overlapping_facility_mapping",
    conflictMessage: "Facility mapping overlaps a verified effective range.",
  });
  const { error } = await supabase.from("amazon_facility_locations").insert({
    organization_id: args.actor.organizationId,
    provider: args.input.provider,
    facility_code: args.input.facilityCode,
    normalized_facility_code: normalizedFacilityCode,
    city: args.input.city.trim(),
    state: args.input.state.trim(),
    postal_code: args.input.postalCode ?? null,
    country_code: args.input.countryCode ?? "US",
    timezone: args.input.timezone ?? null,
    effective_from: args.input.effectiveFrom,
    effective_to: args.input.effectiveTo ?? null,
    verification_status: "manually_verified",
    source: "review_decision",
    verified_by: args.actor.id,
    verified_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
  await recordReviewDecision({
    actor: args.actor,
    batchId: args.input.batchId,
    decisionType: "verify_facility_mapping",
    selectedValue: {
      provider: args.input.provider,
      facilityCode: normalizedFacilityCode,
      effectiveFrom: args.input.effectiveFrom,
      effectiveTo: args.input.effectiveTo ?? null,
    },
    reason: args.input.reason,
  });
  return { ok: true };
}

export async function approveFuelCardAssignment(args: {
  actor: AmazonWorkflowActor;
  input: FuelCardAssignmentApprovalInput;
}): Promise<{ ok: true }> {
  assertReviewReason(args.input.reason);
  assertEffectiveRange(args.input);
  assertWorkflow(Boolean(args.input.vehicleId || args.input.driverId), {
    code: "fuel_assignment_target_required",
    message: "Fuel card assignment requires a vehicle, driver, or both.",
    stage: "resolve_references",
  });
  const externalCardId = normalizeReferenceValue(args.input.fuelCardValue) ?? "";
  assertWorkflow(externalCardId !== "", {
    code: "invalid_fuel_card_identifier",
    message: "Fuel card identifier is required.",
    stage: "resolve_references",
  });
  const supabase = await createClient();
  const cardLastFour = externalCardId.replace(/\D/g, "").slice(-4) || null;
  const { data: card, error: cardError } = await supabase
    .from("fuel_cards")
    .upsert({
      organization_id: args.actor.organizationId,
      provider: "octane",
      external_card_id: externalCardId,
      card_last_four: cardLastFour,
      status: "active",
    }, { onConflict: "organization_id,provider,external_card_id" })
    .select("id")
    .single();
  if (cardError) throw new Error(cardError.message);
  const fuelCardId = String((card as { id: string }).id);
  await assertNoFuelCardAssignmentOverlap({
    actor: args.actor,
    fuelCardId,
    proposed: args.input,
  });
  const { error } = await supabase.from("fuel_card_assignments").insert({
    organization_id: args.actor.organizationId,
    fuel_card_id: fuelCardId,
    vehicle_id: args.input.vehicleId || null,
    driver_id: args.input.driverId || null,
    effective_from: args.input.effectiveFrom,
    effective_to: args.input.effectiveTo ?? null,
    assignment_source: "manual",
    status: "approved",
  });
  if (error) throw new Error(error.message);
  await recordReviewDecision({
    actor: args.actor,
    batchId: args.input.batchId,
    decisionType: "approve_fuel_card_assignment",
    selectedValue: {
      fuelCardId,
      vehicleId: args.input.vehicleId ?? null,
      driverId: args.input.driverId ?? null,
      effectiveFrom: args.input.effectiveFrom,
      effectiveTo: args.input.effectiveTo ?? null,
    },
    reason: args.input.reason,
  });
  return { ok: true };
}

export async function approveTeamSplitRule(args: {
  actor: AmazonWorkflowActor;
  input: TeamSplitApprovalInput;
}): Promise<{ ok: true; ruleId: string }> {
  assertReviewReason(args.input.reason);
  assertEffectiveRange(args.input);
  assertWorkflow(args.input.driverTokens.length >= 2 && args.input.members.length >= 2, {
    code: "invalid_team_split_rule",
    message: "Team split approval requires at least two source drivers and two explicit members.",
    stage: "resolve_references",
  });
  const splitTotal = args.input.members.reduce((sum, member) => sum + member.splitBasisPoints, 0);
  assertWorkflow(splitTotal === 10000, {
    code: "invalid_team_split_total",
    message: "Team split basis points must total exactly 10000.",
    stage: "resolve_references",
  });
  const teamKey = deterministicTeamKey(args.input.driverTokens);
  const supabase = await createClient();
  await assertNoApprovedOverlap({
    actor: args.actor,
    table: "amazon_team_split_rules",
    filters: {
      provider: args.input.provider,
      team_key: teamKey,
      status: "approved",
    },
    proposed: args.input,
    conflictCode: "overlapping_team_split_rule",
    conflictMessage: "Team split rule overlaps an approved effective range.",
  });
  const { data: rule, error: ruleError } = await supabase
    .from("amazon_team_split_rules")
    .insert({
      organization_id: args.actor.organizationId,
      provider: args.input.provider,
      team_key: teamKey,
      effective_from: args.input.effectiveFrom,
      effective_to: args.input.effectiveTo ?? null,
      status: "proposed",
      assignment_source: "review_decision",
    })
    .select("id")
    .single();
  if (ruleError) throw new Error(ruleError.message);
  const ruleId = String((rule as { id: string }).id);
  const memberRows = args.input.members.map((member, index) => ({
    organization_id: args.actor.organizationId,
    team_split_rule_id: ruleId,
    person_id: member.personId,
    member_order: index + 1,
    split_basis_points: member.splitBasisPoints,
  }));
  const { error: memberError } = await supabase.from("amazon_team_split_rule_members").insert(memberRows);
  if (memberError) throw new Error(memberError.message);
  const { error: approveError } = await supabase
    .from("amazon_team_split_rules")
    .update({ status: "approved", approved_by: args.actor.id, approved_at: new Date().toISOString() })
    .eq("organization_id", args.actor.organizationId)
    .eq("id", ruleId)
    .eq("status", "proposed");
  if (approveError) throw new Error(approveError.message);
  await recordReviewDecision({
    actor: args.actor,
    batchId: args.input.batchId,
    decisionType: "approve_team_split_rule",
    selectedValue: {
      ruleId,
      teamKey,
      effectiveFrom: args.input.effectiveFrom,
      effectiveTo: args.input.effectiveTo ?? null,
    },
    reason: args.input.reason,
  });
  return { ok: true, ruleId };
}

export async function rejectReferenceMapping(args: {
  actor: AmazonWorkflowActor;
  batchId: string;
  decisionType: Extract<
    ReferenceDecisionType,
    | "reject_external_driver_mapping"
    | "reject_vehicle_alias_mapping"
    | "reject_facility_mapping"
    | "reject_fuel_card_assignment"
    | "archive_team_split_rule"
  >;
  reason: string;
  selectedValue?: Record<string, unknown>;
}): Promise<{ ok: true }> {
  assertReviewReason(args.reason);
  await recordReviewDecision({
    actor: args.actor,
    batchId: args.batchId,
    decisionType: args.decisionType,
    selectedValue: args.selectedValue ?? {},
    reason: args.reason,
  });
  return { ok: true };
}

async function recordReviewDecision(args: {
  actor: AmazonWorkflowActor;
  batchId: string;
  decisionType: ReferenceDecisionType;
  selectedValue: Record<string, unknown>;
  reason: string;
}) {
  const supabase = await createClient();
  const { error } = await supabase.from("amazon_import_review_decisions").insert({
    organization_id: args.actor.organizationId,
    batch_id: args.batchId,
    decision_type: args.decisionType,
    selected_value: args.selectedValue,
    reason: args.reason,
    decided_by: args.actor.id,
  });
  if (error) throw new Error(error.message);
}

function assertReviewReason(reason: string): void {
  assertWorkflow(reason.trim().length >= 3, {
    code: "review_reason_required",
    message: "A review reason is required.",
    stage: "resolve_references",
  });
}

function assertEffectiveRange(input: EffectiveRangeInput): void {
  assertWorkflow(effectiveDateRangeIsValid({
    effectiveFrom: input.effectiveFrom,
    effectiveTo: input.effectiveTo ?? null,
  }), {
    code: "invalid_effective_dates",
    message: "Effective-to date must be after effective-from date.",
    stage: "resolve_references",
  });
}

async function assertNoApprovedOverlap(args: {
  actor: AmazonWorkflowActor;
  table: "amazon_external_driver_identifiers" | "amazon_facility_locations" | "amazon_team_split_rules";
  filters: Record<string, string>;
  proposed: EffectiveRangeInput;
  conflictCode: string;
  conflictMessage: string;
}): Promise<void> {
  const supabase = await createClient();
  let query = supabase
    .from(args.table)
    .select("effective_from, effective_to")
    .eq("organization_id", args.actor.organizationId);
  for (const [column, value] of Object.entries(args.filters)) {
    query = query.eq(column, value);
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  for (const row of data ?? []) {
    const current = row as { effective_from: string; effective_to: string | null };
    assertWorkflow(!effectiveDateRangesOverlap({
      effectiveFrom: args.proposed.effectiveFrom,
      effectiveTo: args.proposed.effectiveTo ?? null,
    }, {
      effectiveFrom: current.effective_from,
      effectiveTo: current.effective_to,
    }), {
      code: args.conflictCode,
      message: args.conflictMessage,
      stage: "resolve_references",
    });
  }
}

async function assertNoFuelCardAssignmentOverlap(args: {
  actor: AmazonWorkflowActor;
  fuelCardId: string;
  proposed: EffectiveRangeInput;
}): Promise<void> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("fuel_card_assignments")
    .select("effective_from, effective_to")
    .eq("organization_id", args.actor.organizationId)
    .eq("fuel_card_id", args.fuelCardId)
    .eq("status", "approved");
  if (error) throw new Error(error.message);
  for (const row of data ?? []) {
    const current = row as { effective_from: string; effective_to: string | null };
    assertWorkflow(!effectiveDateRangesOverlap({
      effectiveFrom: args.proposed.effectiveFrom,
      effectiveTo: args.proposed.effectiveTo ?? null,
    }, {
      effectiveFrom: current.effective_from,
      effectiveTo: current.effective_to,
    }), {
      code: "overlapping_fuel_card_assignment",
      message: "Fuel card assignment overlaps an approved effective range.",
      stage: "resolve_references",
    });
  }
}
