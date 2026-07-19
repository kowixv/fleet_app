import "server-only";

import { createClient } from "@/lib/supabase/server";
import { isFinancialPaymentRow, matchPaymentTrips, type PaymentSourceRow, type TripSourceRow } from "../matching/payment-trip-matcher";
import { buildAmazonRevenueItems } from "../revenue/revenue-builder";
import { reconcileAmazonRevenue } from "../revenue/revenue-reconciliation";
import { roundMoney, sha256Hex, stableJson } from "../parsers/normalization";
import type { AmazonPaymentDetailFields, AmazonPaymentRowClassification, AmazonParserIssue, AmazonTripsRowFields, AmazonRawRowParseStatus } from "../types";
import { loadAmazonBatchForActor } from "./batch-service";
import { assertWriter } from "./auth";
import { assertWorkflow } from "./workflow-errors";
import type { AmazonWorkflowActor } from "./workflow-types";

type PersistedPaymentSourceRow = PaymentSourceRow & { id: string };
type PersistedTripSourceRow = TripSourceRow & { id: string };

export function matchPaymentTripSources(paymentRows: PaymentSourceRow[], tripRows: TripSourceRow[]) {
  return matchPaymentTrips(paymentRows, tripRows);
}

export function buildCanonicalRevenueFromMatches(args: Parameters<typeof buildAmazonRevenueItems>[0]) {
  return buildAmazonRevenueItems(args);
}

export async function loadPersistedPaymentTripRows(actor: AmazonWorkflowActor, batchId: string): Promise<{
  invoice: { id: string; summaryTotal: number | null; invoiceNumber: string | null } | null;
  paymentRows: PersistedPaymentSourceRow[];
  tripRows: PersistedTripSourceRow[];
}> {
  const supabase = await createClient();
  const [invoice, payment, trips, tokens] = await Promise.all([
    supabase
      .from("amazon_payment_invoices")
      .select("id, invoice_number, summary_total")
      .eq("organization_id", actor.organizationId)
      .eq("batch_id", batchId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("amazon_payment_rows")
      .select("id, file_id, raw_row_id, invoice_id, source_row_number, source_fingerprint, row_classification, trip_id, load_id, start_date, end_date, route_raw, facility_sequence, distance, base_amount, fuel_surcharge_amount, toll_amount, detention_amount, tonu_amount, other_amount, gross_amount, item_type, status, parse_status, source_snapshot, amazon_import_files!amazon_payment_rows_file_same_batch_fk(original_filename, sha256_hash, source_type, parser_name, parser_version, schema_signature)")
      .eq("organization_id", actor.organizationId)
      .eq("batch_id", batchId)
      .order("source_row_number", { ascending: true }),
    supabase
      .from("amazon_trip_rows")
      .select("id, file_id, raw_row_id, source_row_number, source_fingerprint, trip_id, load_id, raw_driver_text, tractor_external_id, operator_type, equipment_type, trip_status, load_status, estimated_distance, facility_sequence, stops, source_snapshot, amazon_import_files!amazon_trip_rows_file_same_batch_fk(original_filename, sha256_hash, source_type, parser_name, parser_version, schema_signature)")
      .eq("organization_id", actor.organizationId)
      .eq("batch_id", batchId)
      .order("source_row_number", { ascending: true }),
    supabase
      .from("amazon_trip_driver_tokens")
      .select("trip_row_id, token_order, raw_name, requires_split_rule")
      .eq("organization_id", actor.organizationId)
      .order("token_order", { ascending: true }),
  ]);
  if (invoice.error) throw new Error(invoice.error.message);
  if (payment.error) throw new Error(payment.error.message);
  if (trips.error) throw new Error(trips.error.message);
  if (tokens.error) throw new Error(tokens.error.message);
  const tokensByTripRowId = new Map<string, Array<{ rawName: string; requiresSplitRule: boolean }>>();
  for (const token of tokens.data ?? []) {
    const tripRowId = String(token.trip_row_id);
    tokensByTripRowId.set(tripRowId, [
      ...(tokensByTripRowId.get(tripRowId) ?? []),
      { rawName: String(token.raw_name ?? ""), requiresSplitRule: token.requires_split_rule === true },
    ]);
  }
  return {
    invoice: invoice.data ? {
      id: String(invoice.data.id),
      invoiceNumber: stringOrNull(invoice.data.invoice_number),
      summaryTotal: nullableNumber(invoice.data.summary_total),
    } : null,
    paymentRows: (payment.data ?? []).map((row) => persistedPaymentRow(row as Record<string, unknown>)),
    tripRows: (trips.data ?? []).map((row) => persistedTripRow(row as Record<string, unknown>, tokensByTripRowId.get(String(row.id)) ?? [])),
  };
}

export async function reconcileAmazonPaymentTripBatch(args: {
  actor: AmazonWorkflowActor;
  batchId: string;
}) {
  assertWriter(args.actor);
  const batch = await loadAmazonBatchForActor(args.actor, args.batchId);
  assertWorkflow(batch.status !== "archived", {
    code: "archived_batch",
    message: "Archived Amazon import batches are read-only.",
    stage: "reconcile_payment",
  });
  assertWorkflow(batch.status === "parsed" || batch.status === "needs_review" || batch.status === "reconciled", {
    code: "batch_not_parsed",
    message: "Parse the required Amazon source files before running reconciliation.",
    stage: "reconcile_payment",
  });

  const source = await loadPersistedPaymentTripRows(args.actor, args.batchId);
  const missingIssues: AmazonParserIssue[] = [];
  if (!source.invoice) {
    missingIssues.push(reconciliationIssue("missing_invoice", "blocking", "Amazon payment invoice summary is missing.", { batchId: args.batchId }));
  }
  if (source.paymentRows.length === 0) {
    missingIssues.push(reconciliationIssue("missing_required_source_rows", "blocking", "No persisted Amazon payment rows are available.", { sourceType: "amazon_payment" }));
  }
  if (source.tripRows.length === 0) {
    missingIssues.push(reconciliationIssue("missing_required_source_rows", "blocking", "No persisted Amazon trip rows are available.", { sourceType: "amazon_trips" }));
  }

  const matching = matchPaymentTrips(source.paymentRows, source.tripRows);
  const revenue = source.invoice
    ? buildAmazonRevenueItems({ invoiceId: source.invoice.id, paymentRows: source.paymentRows, matches: matching.matches })
    : { items: [], issues: [], unassignedRows: source.paymentRows.filter(isFinancialPaymentRow), duplicateSourceContributionCount: 0 };
  const financialRows = source.paymentRows.filter(isFinancialPaymentRow);
  const reconciliation = reconcileAmazonRevenue({
    summaryInvoiceTotal: source.invoice?.summaryTotal ?? null,
    validPaymentRowGrossTotal: roundMoney(financialRows.reduce((sum, row) => sum + (row.normalizedValues.grossPay ?? 0), 0)),
    parentRowCount: financialRows.filter((row) => row.normalizedValues.rowClassification === "trip_parent").length,
    childRowCount: financialRows.filter((row) => row.normalizedValues.rowClassification === "load_child").length,
    standaloneRowCount: financialRows.filter((row) => row.normalizedValues.rowClassification === "standalone_load").length,
    matching,
    revenue,
  });
  const allIssues = [...missingIssues, ...reconciliation.issues];
  const blockingIssueCount = allIssues.filter((issue) => issue.severity === "blocking").length;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("reconcile_amazon_payment_atomic", {
    p_batch_id: args.batchId,
    p_invoice_id: source.invoice?.id ?? null,
    p_matches: matching.matches.map((match) => ({
      payment_row_id: (match.paymentRow as PersistedPaymentSourceRow).id,
      trip_row_id: match.tripRow ? (match.tripRow as PersistedTripSourceRow).id : null,
      match_type: match.matchType,
      match_method: match.matchMethod,
      confidence_score: match.confidenceScore,
      status: match.status,
      reasons: match.reasons,
    })),
    p_revenue_items: revenue.items.map((item) => ({
      client_item_key: item.id,
      invoice_id: item.invoiceId,
      grouping_type: item.groupingType,
      grouping_key: item.groupingKey,
      trip_id: item.tripId,
      primary_load_id: item.primaryLoadId,
      start_date: item.startDate,
      end_date: item.endDate,
      origin_facility_code: item.originFacilityCode,
      destination_facility_code: item.destinationFacilityCode,
      route_resolution_status: item.routeResolutionStatus,
      distance: item.distance,
      base_amount: item.baseAmount,
      fuel_surcharge_amount: item.fuelSurchargeAmount,
      toll_amount: item.tollAmount,
      detention_amount: item.detentionAmount,
      tonu_amount: item.tonuAmount,
      other_amount: item.otherAmount,
      gross_amount: item.grossAmount,
      match_status: item.matchStatus,
      driver_assignment_status: item.driverAssignmentStatus,
      vehicle_assignment_status: item.vehicleAssignmentStatus,
      reconciliation_status: item.reconciliationStatus,
      source_revision: item.sourceRevision,
    })),
    p_revenue_sources: revenue.items.flatMap((item) => item.sources.map((sourceRow) => ({
      client_item_key: item.id,
      grouping_key: item.groupingKey,
      payment_row_id: (sourceRow.paymentRow as PersistedPaymentSourceRow).id,
      contribution_type: sourceRow.contributionType,
    }))),
    p_issues: allIssues.map((issue) => ({
      issue_code: issue.issueCode,
      severity: issue.severity,
      message: issue.message,
      details: issueDetails(args.actor.organizationId, args.batchId, issue),
    })),
    p_reconciliation: {
      expected_count: financialRows.length,
      actual_count: revenue.items.flatMap((item) => item.sources).length,
      details: {
        sourceRevision: sha256Hex(stableJson({
          payment: source.paymentRows.map((row) => row.sourceFingerprint).sort(),
          trips: source.tripRows.map((row) => row.sourceFingerprint).sort(),
          revenue: revenue.items.map((item) => item.sourceRevision).sort(),
        })),
        exactLoadMatches: reconciliation.exactLoadMatches,
        exactTripMatches: reconciliation.exactTripMatches,
        inferredMatches: reconciliation.inferredMatches,
        ambiguousMatches: reconciliation.ambiguousMatches,
        unmatchedFinancialRows: reconciliation.unmatchedFinancialRows,
        canonicalRevenueItemCount: reconciliation.canonicalRevenueItemCount,
        validPaymentRowGrossTotal: reconciliation.validPaymentRowGrossTotal,
        unassignedRevenueTotal: reconciliation.unassignedRevenueTotal,
        blockingIssueCount,
      },
    },
  });
  if (error) throw new Error(error.message);
  return {
    ...(data as Record<string, unknown> | null),
    exactLoadMatches: reconciliation.exactLoadMatches,
    exactTripMatches: reconciliation.exactTripMatches,
    canonicalRevenueItemCount: reconciliation.canonicalRevenueItemCount,
    canonicalRevenueTotal: reconciliation.canonicalRevenueTotal,
    validPaymentRowGrossTotal: reconciliation.validPaymentRowGrossTotal,
    unassignedRevenueTotal: reconciliation.unassignedRevenueTotal,
    blockingIssueCount,
  };
}

function persistedPaymentRow(row: Record<string, unknown>): PersistedPaymentSourceRow {
  const snapshot = sourceSnapshot(row.source_snapshot);
  const normalized = { ...snapshot.normalized } as Partial<AmazonPaymentDetailFields>;
  const file = firstRelated(row.amazon_import_files);
  return {
    id: String(row.id),
    sourceFile: sourceFile(file, "amazon_payment"),
    sourceSheet: typeof snapshot.sourceSheet === "string" ? snapshot.sourceSheet : "Payment Details",
    sourceRowNumber: nullableNumber(row.source_row_number),
    rawValues: snapshot.raw,
    normalizedValues: {
      invoiceNumber: stringOrNull(normalized.invoiceNumber) ?? null,
      blockId: stringOrNull(normalized.blockId) ?? null,
      tripId: stringOrNull(row.trip_id ?? normalized.tripId),
      loadId: stringOrNull(row.load_id ?? normalized.loadId),
      startDate: stringOrNull(row.start_date ?? normalized.startDate),
      endDate: stringOrNull(row.end_date ?? normalized.endDate),
      route: stringOrNull(row.route_raw ?? normalized.route),
      operatorType: stringOrNull(normalized.operatorType),
      equipment: stringOrNull(normalized.equipment),
      distanceMiles: nullableNumber(row.distance ?? normalized.distanceMiles),
      itemType: stringOrNull(row.item_type ?? normalized.itemType),
      programType: stringOrNull(normalized.programType),
      baseRate: nullableNumber(row.base_amount ?? normalized.baseRate),
      fuelSurcharge: nullableNumber(row.fuel_surcharge_amount ?? normalized.fuelSurcharge),
      tolls: nullableNumber(row.toll_amount ?? normalized.tolls),
      detention: nullableNumber(row.detention_amount ?? normalized.detention),
      tonu: nullableNumber(row.tonu_amount ?? normalized.tonu),
      others: nullableNumber(row.other_amount ?? normalized.others),
      grossPay: nullableNumber(row.gross_amount ?? normalized.grossPay),
      comments: stringOrNull(row.status ?? normalized.comments),
      rowClassification: paymentClassification(row.row_classification ?? normalized.rowClassification),
    },
    parser: { name: stringOrNull(file.parser_name) ?? "persisted-payment", version: stringOrNull(file.parser_version) ?? "unknown" },
    schemaSignature: { sourceType: "amazon_payment", signature: stringOrNull(file.schema_signature) ?? "persisted", parser: { name: stringOrNull(file.parser_name) ?? "persisted-payment", version: stringOrNull(file.parser_version) ?? "unknown" } },
    parseStatus: parseStatus(row.parse_status),
    warnings: [],
    blockingIssues: [],
    sourceFingerprint: String(row.source_fingerprint),
  };
}

function persistedTripRow(row: Record<string, unknown>, tokens: Array<{ rawName: string; requiresSplitRule: boolean }>): PersistedTripSourceRow {
  const snapshot = sourceSnapshot(row.source_snapshot);
  const normalized = { ...snapshot.normalized } as Partial<AmazonTripsRowFields>;
  const file = firstRelated(row.amazon_import_files);
  const driverTokens = tokens.map((token) => token.rawName).filter(Boolean);
  return {
    id: String(row.id),
    sourceFile: sourceFile(file, "amazon_trips"),
    sourceSheet: null,
    sourceRowNumber: nullableNumber(row.source_row_number),
    rawValues: snapshot.raw,
    normalizedValues: {
      tripId: stringOrNull(row.trip_id ?? normalized.tripId),
      loadId: stringOrNull(row.load_id ?? normalized.loadId),
      driverNameRaw: stringOrNull(row.raw_driver_text ?? normalized.driverNameRaw),
      driverTokens: driverTokens.length ? driverTokens : Array.isArray(normalized.driverTokens) ? normalized.driverTokens : [],
      requiresTeamAssignmentRule: tokens.some((token) => token.requiresSplitRule) || normalized.requiresTeamAssignmentRule === true,
      tractorVehicleId: stringOrNull(row.tractor_external_id ?? normalized.tractorVehicleId),
      tripStage: stringOrNull(row.trip_status ?? normalized.tripStage),
      loadExecutionStatus: stringOrNull(row.load_status ?? normalized.loadExecutionStatus),
      estimatedDistance: nullableNumber(row.estimated_distance ?? normalized.estimatedDistance),
      equipmentType: stringOrNull(row.equipment_type ?? normalized.equipmentType),
      operatorType: stringOrNull(row.operator_type ?? normalized.operatorType),
      soloTeamIndicator: stringOrNull(normalized.soloTeamIndicator),
      facilitySequence: stringOrNull(normalized.facilitySequence) ?? stringOrNull(row.facility_sequence),
      estimatedCost: nullableNumber(normalized.estimatedCost),
      stops: Array.isArray(normalized.stops) ? normalized.stops : Array.isArray(row.stops) ? row.stops as AmazonTripsRowFields["stops"] : [],
    },
    parser: { name: stringOrNull(file.parser_name) ?? "persisted-trips", version: stringOrNull(file.parser_version) ?? "unknown" },
    schemaSignature: { sourceType: "amazon_trips", signature: stringOrNull(file.schema_signature) ?? "persisted", parser: { name: stringOrNull(file.parser_name) ?? "persisted-trips", version: stringOrNull(file.parser_version) ?? "unknown" } },
    parseStatus: "parsed",
    warnings: [],
    blockingIssues: [],
    sourceFingerprint: String(row.source_fingerprint),
  };
}

function issueDetails(organizationId: string, batchId: string, issue: AmazonParserIssue) {
  const issueKey = [
    organizationId,
    batchId,
    "reconcile_payment",
    issue.issueCode,
    sha256Hex(stableJson(issue.details)).slice(0, 16),
  ].join(":");
  return { ...issue.details, issueKey, lifecycleStage: "reconcile_payment" };
}

function reconciliationIssue(issueCode: string, severity: "warning" | "blocking", message: string, details: Record<string, unknown>): AmazonParserIssue {
  return { fileId: null, rawRowId: null, issueCode, severity, message, details };
}

function sourceSnapshot(value: unknown): { raw: Record<string, unknown>; normalized: Record<string, unknown>; sourceSheet?: unknown } {
  const snapshot = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    raw: snapshot.raw && typeof snapshot.raw === "object" ? snapshot.raw as Record<string, unknown> : {},
    normalized: snapshot.normalized && typeof snapshot.normalized === "object" ? snapshot.normalized as Record<string, unknown> : {},
    sourceSheet: snapshot.sourceSheet,
  };
}

function sourceFile(file: Record<string, unknown>, sourceType: "amazon_payment" | "amazon_trips") {
  return {
    originalFilename: stringOrNull(file.original_filename) ?? "persisted-source",
    sha256Hash: stringOrNull(file.sha256_hash) ?? "0".repeat(64),
    sourceType,
  };
}

function firstRelated(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) return value[0] && typeof value[0] === "object" ? value[0] as Record<string, unknown> : {};
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseStatus(value: unknown): AmazonRawRowParseStatus {
  return value === "pending" || value === "parsed" || value === "warning" || value === "failed" || value === "skipped" ? value : "parsed";
}

function paymentClassification(value: unknown): AmazonPaymentRowClassification {
  return value === "trip_parent" || value === "load_child" || value === "standalone_load" || value === "non_financial" || value === "invalid"
    ? value
    : "invalid";
}
