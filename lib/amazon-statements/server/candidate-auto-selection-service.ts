import "server-only";

import { createClient } from "@/lib/supabase/server";
import { normalizeExternalVehicleIdentifier } from "../contracts";
import type { CandidateAutoSelectionHint } from "../candidates/candidate-auto-selection";
import {
  exactLabelTargetIds,
  splitExactSourceLabels,
  type ExactLabelTarget,
} from "../candidates/exact-label-attribution";
import { normalizeReferenceValue } from "../resolution/resolution-types";

type DbRow = Record<string, unknown>;

export interface CandidateAutoSelectionHints {
  revenue: Map<string, CandidateAutoSelectionHint>;
  fuel: Map<string, CandidateAutoSelectionHint>;
}

export async function loadCandidateAutoSelectionHints(args: {
  organizationId: string;
  batchId: string;
  periodStart: string | null;
  periodEnd: string | null;
  revenueItemIds: string[];
  fuelLineIds: string[];
}): Promise<CandidateAutoSelectionHints> {
  const [revenue, fuel] = await Promise.all([
    loadRevenueHints(args),
    loadFuelHints(args),
  ]);
  return { revenue, fuel };
}

async function loadRevenueHints(args: {
  organizationId: string;
  batchId: string;
  periodStart: string | null;
  periodEnd: string | null;
  revenueItemIds: string[];
}): Promise<Map<string, CandidateAutoSelectionHint>> {
  const result = new Map<string, CandidateAutoSelectionHint>();
  for (const id of args.revenueItemIds) result.set(id, unmatchedHint("no_exact_revenue_attribution"));
  if (args.revenueItemIds.length === 0) return result;

  const supabase = await createClient();
  const [
    sourceResult,
    itemResult,
    driverMappingResult,
    vehicleMappingResult,
    peopleResult,
    vehiclesResult,
  ] = await Promise.all([
    supabase
      .from("amazon_revenue_item_sources")
      .select("revenue_item_id, payment_row_id")
      .eq("organization_id", args.organizationId)
      .in("revenue_item_id", args.revenueItemIds),
    supabase
      .from("amazon_revenue_items")
      .select("id, start_date, end_date")
      .eq("organization_id", args.organizationId)
      .eq("batch_id", args.batchId)
      .in("id", args.revenueItemIds),
    supabase
      .from("amazon_external_driver_identifiers")
      .select("person_id, normalized_value, effective_from, effective_to")
      .eq("organization_id", args.organizationId)
      .eq("provider", "amazon")
      .eq("status", "approved")
      .in("identifier_type", ["driver_display_name", "driver_external_id"]),
    supabase
      .from("amazon_external_vehicle_identifiers")
      .select("vehicle_id, normalized_value, effective_from, effective_to")
      .eq("organization_id", args.organizationId)
      .eq("provider", "amazon")
      .in("identifier_type", ["tractor_vehicle_id", "amazon_unit"]),
    supabase
      .from("people")
      .select("id, full_name")
      .eq("organization_id", args.organizationId)
      .in("type", ["company_driver", "external_carrier_driver", "owner_operator", "investor"]),
    supabase
      .from("vehicles")
      .select("id, unit_number")
      .eq("organization_id", args.organizationId),
  ]);
  for (const query of [
    sourceResult,
    itemResult,
    driverMappingResult,
    vehicleMappingResult,
    peopleResult,
    vehiclesResult,
  ]) {
    if (query.error) throw new Error(query.error.message);
  }

  const sourceRows = (sourceResult.data ?? []) as DbRow[];
  const paymentRowIds = uniqueStrings(sourceRows.map((row) => stringOrNull(row.payment_row_id)));
  if (paymentRowIds.length === 0) return result;

  const matchResult = await supabase
    .from("amazon_import_matches")
    .select("payment_row_id, trip_row_id, status")
    .eq("organization_id", args.organizationId)
    .eq("batch_id", args.batchId)
    .in("payment_row_id", paymentRowIds)
    .in("status", ["exact", "manually_approved"]);
  if (matchResult.error) throw new Error(matchResult.error.message);

  const matchRows = (matchResult.data ?? []) as DbRow[];
  const tripRowIds = uniqueStrings(matchRows.map((row) => stringOrNull(row.trip_row_id)));
  if (tripRowIds.length === 0) return result;

  const [tripResult, tokenResult] = await Promise.all([
    supabase
      .from("amazon_trip_rows")
      .select("id, raw_driver_text, tractor_external_id")
      .eq("organization_id", args.organizationId)
      .eq("batch_id", args.batchId)
      .in("id", tripRowIds),
    supabase
      .from("amazon_trip_driver_tokens")
      .select("trip_row_id, normalized_name")
      .eq("organization_id", args.organizationId)
      .in("trip_row_id", tripRowIds),
  ]);
  if (tripResult.error) throw new Error(tripResult.error.message);
  if (tokenResult.error) throw new Error(tokenResult.error.message);

  const itemById = new Map(((itemResult.data ?? []) as DbRow[]).map((row) => [String(row.id), row]));
  const paymentIdsByRevenue = groupValues(sourceRows, "revenue_item_id", "payment_row_id");
  const tripIdsByPayment = groupValues(matchRows, "payment_row_id", "trip_row_id");
  const tripById = new Map(((tripResult.data ?? []) as DbRow[]).map((row) => [String(row.id), row]));
  const driverTokensByTrip = groupValues((tokenResult.data ?? []) as DbRow[], "trip_row_id", "normalized_name");
  const driverMappings = (driverMappingResult.data ?? []) as DbRow[];
  const vehicleMappings = (vehicleMappingResult.data ?? []) as DbRow[];
  const peopleTargets = labelTargets((peopleResult.data ?? []) as DbRow[], "full_name");
  const vehicleTargets = labelTargets((vehiclesResult.data ?? []) as DbRow[], "unit_number");

  for (const revenueItemId of args.revenueItemIds) {
    const item = itemById.get(revenueItemId);
    const serviceDate = stringOrNull(item?.end_date)
      ?? stringOrNull(item?.start_date)
      ?? args.periodEnd
      ?? args.periodStart;
    const paymentIds = paymentIdsByRevenue.get(revenueItemId) ?? [];
    const tripIds = uniqueStrings(paymentIds.flatMap((paymentId) => tripIdsByPayment.get(paymentId) ?? []));
    const personIds = new Set<string>();
    const vehicleIds = new Set<string>();
    const exactReasons = new Set<string>();

    for (const tripId of tripIds) {
      const trip = tripById.get(tripId);
      const persistedTokens = driverTokensByTrip.get(tripId) ?? [];
      const sourceDriverLabels = persistedTokens.length > 0
        ? persistedTokens
        : splitExactSourceLabels(stringOrNull(trip?.raw_driver_text));

      for (const token of sourceDriverLabels) {
        const normalizedToken = normalizeReferenceValue(token);
        if (!normalizedToken) continue;
        const mappedForToken = new Set<string>();
        for (const mapping of driverMappings) {
          if (normalizeReferenceValue(stringOrNull(mapping.normalized_value)) !== normalizedToken) continue;
          if (!activeOn(mapping, serviceDate)) continue;
          const personId = stringOrNull(mapping.person_id);
          if (personId) mappedForToken.add(personId);
        }
        if (mappedForToken.size > 0) {
          for (const personId of mappedForToken) personIds.add(personId);
          exactReasons.add("approved_driver_mapping");
        } else {
          const directIds = exactLabelTargetIds(token, peopleTargets);
          for (const personId of directIds) personIds.add(personId);
          if (directIds.length > 0) {
            exactReasons.add(persistedTokens.length > 0
              ? "exact_source_driver_label"
              : "exact_raw_trip_driver_text");
          }
        }
      }

      const tractorExternalId = stringOrNull(trip?.tractor_external_id);
      if (!tractorExternalId) continue;
      const normalizedVehicle = normalizeExternalVehicleIdentifier(tractorExternalId);
      const mappedForVehicle = new Set<string>();
      for (const mapping of vehicleMappings) {
        if (normalizeExternalVehicleIdentifier(String(mapping.normalized_value ?? "")) !== normalizedVehicle) continue;
        if (!activeOn(mapping, serviceDate)) continue;
        const vehicleId = stringOrNull(mapping.vehicle_id);
        if (vehicleId) mappedForVehicle.add(vehicleId);
      }
      if (mappedForVehicle.size > 0) {
        for (const vehicleId of mappedForVehicle) vehicleIds.add(vehicleId);
        exactReasons.add("approved_vehicle_mapping");
      } else {
        const directIds = exactLabelTargetIds(tractorExternalId, vehicleTargets);
        for (const vehicleId of directIds) vehicleIds.add(vehicleId);
        if (directIds.length > 0) exactReasons.add("exact_source_unit_label");
      }
    }

    result.set(revenueItemId, attributionHint({
      personIds: [...personIds],
      vehicleIds: [...vehicleIds],
      exactReasons: [...exactReasons],
      ambiguousReasons: [
        ...(personIds.size > 1 ? ["multiple_driver_targets"] : []),
        ...(vehicleIds.size > 1 ? ["multiple_vehicle_targets"] : []),
      ],
      unmatchedReason: "no_exact_revenue_attribution",
    }));
  }

  return result;
}

async function loadFuelHints(args: {
  organizationId: string;
  batchId: string;
  fuelLineIds: string[];
}): Promise<Map<string, CandidateAutoSelectionHint>> {
  const result = new Map<string, CandidateAutoSelectionHint>();
  for (const id of args.fuelLineIds) result.set(id, unmatchedHint("no_approved_fuel_assignment"));
  if (args.fuelLineIds.length === 0) return result;

  const supabase = await createClient();
  const [lineResult, peopleResult, vehiclesResult] = await Promise.all([
    supabase
      .from("fuel_import_transaction_lines")
      .select("id, transaction_id")
      .eq("organization_id", args.organizationId)
      .in("id", args.fuelLineIds),
    supabase
      .from("people")
      .select("id, full_name")
      .eq("organization_id", args.organizationId)
      .in("type", ["company_driver", "external_carrier_driver", "owner_operator", "investor"]),
    supabase
      .from("vehicles")
      .select("id, unit_number")
      .eq("organization_id", args.organizationId),
  ]);
  for (const query of [lineResult, peopleResult, vehiclesResult]) {
    if (query.error) throw new Error(query.error.message);
  }
  const lineRows = (lineResult.data ?? []) as DbRow[];
  const transactionIds = uniqueStrings(lineRows.map((row) => stringOrNull(row.transaction_id)));
  if (transactionIds.length === 0) return result;

  const transactionResult = await supabase
    .from("fuel_import_transactions")
    .select("id, card_group_id")
    .eq("organization_id", args.organizationId)
    .in("id", transactionIds);
  if (transactionResult.error) throw new Error(transactionResult.error.message);
  const transactionRows = (transactionResult.data ?? []) as DbRow[];
  const cardGroupIds = uniqueStrings(transactionRows.map((row) => stringOrNull(row.card_group_id)));
  if (cardGroupIds.length === 0) return result;

  const [matchResult, cardGroupResult] = await Promise.all([
    supabase
      .from("fuel_import_matches")
      .select("card_group_id, transaction_id, vehicle_id, driver_id, status, match_method")
      .eq("organization_id", args.organizationId)
      .eq("batch_id", args.batchId)
      .in("card_group_id", cardGroupIds)
      .in("status", ["exact", "manually_approved"]),
    supabase
      .from("fuel_import_card_groups")
      .select("id, driver_label_raw, driver_label_normalized, unit_label_raw, unit_label_normalized")
      .eq("organization_id", args.organizationId)
      .in("id", cardGroupIds),
  ]);
  if (matchResult.error) throw new Error(matchResult.error.message);
  if (cardGroupResult.error) throw new Error(cardGroupResult.error.message);

  const transactionById = new Map(transactionRows.map((row) => [String(row.id), row]));
  const cardGroupById = new Map(((cardGroupResult.data ?? []) as DbRow[]).map((row) => [String(row.id), row]));
  const matches = (matchResult.data ?? []) as DbRow[];
  const peopleTargets = labelTargets((peopleResult.data ?? []) as DbRow[], "full_name");
  const vehicleTargets = labelTargets((vehiclesResult.data ?? []) as DbRow[], "unit_number");

  for (const line of lineRows) {
    const lineId = String(line.id);
    const transactionId = String(line.transaction_id);
    const cardGroupId = stringOrNull(transactionById.get(transactionId)?.card_group_id);
    const transactionMatches = matches.filter((match) => stringOrNull(match.transaction_id) === transactionId);
    const groupMatches = matches.filter((match) => !stringOrNull(match.transaction_id) && stringOrNull(match.card_group_id) === cardGroupId);
    const selectedMatches = transactionMatches.length > 0 ? transactionMatches : groupMatches;
    let personIds = uniqueStrings(selectedMatches.map((match) => stringOrNull(match.driver_id)));
    let vehicleIds = uniqueStrings(selectedMatches.map((match) => stringOrNull(match.vehicle_id)));
    const methods = uniqueStrings(selectedMatches.map((match) => stringOrNull(match.match_method)));
    const group = cardGroupId ? cardGroupById.get(cardGroupId) : undefined;

    if (personIds.length === 0 && group) {
      const driverLabel = stringOrNull(group.driver_label_normalized) ?? stringOrNull(group.driver_label_raw);
      personIds = exactLabelTargetIds(driverLabel, peopleTargets);
      if (personIds.length > 0) methods.push("exact_source_driver_label");
    }
    if (vehicleIds.length === 0 && group) {
      const unitLabel = stringOrNull(group.unit_label_normalized) ?? stringOrNull(group.unit_label_raw);
      vehicleIds = exactLabelTargetIds(unitLabel, vehicleTargets);
      if (vehicleIds.length > 0) methods.push("exact_source_unit_label");
    }

    result.set(lineId, attributionHint({
      personIds,
      vehicleIds,
      exactReasons: uniqueStrings(methods).map((method) => `approved_fuel_${method}`),
      ambiguousReasons: [
        ...(personIds.length > 1 ? ["multiple_fuel_driver_targets"] : []),
        ...(vehicleIds.length > 1 ? ["multiple_fuel_vehicle_targets"] : []),
      ],
      unmatchedReason: "no_approved_fuel_assignment",
    }));
  }

  return result;
}

function attributionHint(args: {
  personIds: string[];
  vehicleIds: string[];
  exactReasons: string[];
  ambiguousReasons: string[];
  unmatchedReason: string;
}): CandidateAutoSelectionHint {
  const personIds = uniqueStrings(args.personIds);
  const vehicleIds = uniqueStrings(args.vehicleIds);
  if (personIds.length > 1 || vehicleIds.length > 1) {
    return {
      suggestedPersonIds: personIds,
      suggestedVehicleIds: vehicleIds,
      autoSelectionStatus: "ambiguous",
      autoSelectionReasons: args.ambiguousReasons,
    };
  }
  if (personIds.length === 0 && vehicleIds.length === 0) return unmatchedHint(args.unmatchedReason);
  return {
    suggestedPersonIds: personIds,
    suggestedVehicleIds: vehicleIds,
    autoSelectionStatus: "exact",
    autoSelectionReasons: args.exactReasons,
  };
}

function unmatchedHint(reason: string): CandidateAutoSelectionHint {
  return {
    suggestedPersonIds: [],
    suggestedVehicleIds: [],
    autoSelectionStatus: "unmatched",
    autoSelectionReasons: [reason],
  };
}

function activeOn(row: DbRow, date: string | null): boolean {
  if (!date) return true;
  const effectiveFrom = stringOrNull(row.effective_from);
  const effectiveTo = stringOrNull(row.effective_to);
  return (!effectiveFrom || date >= effectiveFrom) && (!effectiveTo || date < effectiveTo);
}

function groupValues(rows: DbRow[], keyField: string, valueField: string): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const row of rows) {
    const key = stringOrNull(row[keyField]);
    const value = stringOrNull(row[valueField]);
    if (!key || !value) continue;
    result.set(key, uniqueStrings([...(result.get(key) ?? []), value]));
  }
  return result;
}

function labelTargets(rows: DbRow[], labelField: string): ExactLabelTarget[] {
  return rows
    .map((row) => ({ id: stringOrNull(row.id), label: stringOrNull(row[labelField]) }))
    .filter((row): row is ExactLabelTarget => Boolean(row.id));
}

function uniqueStrings(values: Array<string | null>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
