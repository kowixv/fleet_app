import "server-only";

import { createHash } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import type { AmazonParseResult } from "../contracts";
import type { AmazonImportFileRecord, AmazonWorkflowActor } from "./workflow-types";
import type { AmazonParsedFileResult } from "./parse-service";

function differenceAmount(expected: number | null | undefined, actual: number | null | undefined): number | null {
  if (expected == null || actual == null) return null;
  return Math.round((expected - actual + Number.EPSILON) * 100) / 100;
}

type RawRowLineageKey = string;

function rawRowLineageKey(row: {
  sourceSheet: string | null;
  sourcePage: number | null;
  sourceGroup: string | null;
  sourceRowNumber: number | null;
}): RawRowLineageKey {
  return [
    row.sourceSheet ?? "",
    row.sourcePage ?? "",
    row.sourceGroup ?? "",
    row.sourceRowNumber ?? "",
  ].join("|");
}

function issueDetailsHash(details: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(details)).digest("hex").slice(0, 16);
}

export async function persistGenericParseArtifacts(args: {
  actor: AmazonWorkflowActor;
  batchId: string;
  file: AmazonImportFileRecord;
  result: AmazonParseResult;
}): Promise<{ rawRowCount: number; issueCount: number; reconciliationCount: number; rawRowIdsByLineage: Map<RawRowLineageKey, string> }> {
  const supabase = await createClient();
  const rawRows = args.result.rows.map((row) => ({
    organization_id: args.actor.organizationId,
    batch_id: args.batchId,
    file_id: args.file.id,
    source_sheet: row.sourceSheet,
    source_page: row.sourcePage,
    source_group: row.sourceGroup,
    source_row_number: row.sourceRowNumber,
    raw_data: row.rawData,
    normalized_data: row.normalizedData,
    parse_status: row.parseStatus,
    parse_warning: row.parseWarning,
  }));
  if (rawRows.length > 0) {
    const { error } = await supabase
      .from("amazon_import_raw_rows")
      .upsert(rawRows, {
        onConflict: "organization_id,batch_id,file_id,source_sheet,source_page,source_group,source_row_number",
        ignoreDuplicates: false,
      });
    if (error) throw new Error(error.message);
  }
  const rawRowIdsByLineage = new Map<RawRowLineageKey, string>();
  if (rawRows.length > 0) {
    const { data: persistedRawRows, error } = await supabase
      .from("amazon_import_raw_rows")
      .select("id, source_sheet, source_page, source_group, source_row_number")
      .eq("organization_id", args.actor.organizationId)
      .eq("batch_id", args.batchId)
      .eq("file_id", args.file.id);
    if (error) throw new Error(error.message);
    for (const row of persistedRawRows ?? []) {
      rawRowIdsByLineage.set(rawRowLineageKey({
        sourceSheet: row.source_sheet,
        sourcePage: row.source_page,
        sourceGroup: row.source_group,
        sourceRowNumber: row.source_row_number,
      }), String(row.id));
    }
  }

  const issues = args.result.issues.map((issue) => {
    const issueKey = [
      args.actor.organizationId,
      args.batchId,
      args.file.id,
      issue.rawRowId ?? "no-row",
      issue.issueCode,
      issue.severity,
      issueDetailsHash(issue.details),
    ].join(":");
    return ({
    organization_id: args.actor.organizationId,
    batch_id: args.batchId,
    file_id: args.file.id,
    raw_row_id: issue.rawRowId,
    issue_code: issue.issueCode,
    severity: issue.severity,
    message: issue.message,
    details: { ...issue.details, issueKey },
    status: "open",
  });
  });
  if (issues.length > 0) {
    const { data: existing, error: existingError } = await supabase
      .from("amazon_import_issues")
      .select("details")
      .eq("organization_id", args.actor.organizationId)
      .eq("batch_id", args.batchId)
      .eq("file_id", args.file.id)
      .eq("status", "open");
    if (existingError) throw new Error(existingError.message);
    const activeKeys = new Set((existing ?? []).map((row) => {
      const details = row.details as Record<string, unknown> | null;
      return typeof details?.issueKey === "string" ? details.issueKey : "";
    }));
    const newIssues = issues.filter((issue) => {
      const details = issue.details as Record<string, unknown>;
      return !activeKeys.has(String(details.issueKey));
    });
    const { error } = newIssues.length > 0
      ? await supabase.from("amazon_import_issues").insert(newIssues)
      : { error: null };
    if (error) throw new Error(error.message);
  }

  const reconciliations = args.result.reconciliations.map((row) => ({
    organization_id: args.actor.organizationId,
    batch_id: args.batchId,
    reconciliation_type: row.reconciliationType,
    expected_amount: row.expectedAmount ?? null,
    actual_amount: row.actualAmount ?? null,
    difference_amount: differenceAmount(row.expectedAmount, row.actualAmount),
    expected_count: row.expectedCount ?? null,
    actual_count: row.actualCount ?? null,
    status: row.expectedAmount != null && row.actualAmount != null && Math.abs(differenceAmount(row.expectedAmount, row.actualAmount) ?? 0) > 0.01
      ? "warning"
      : "passed",
    details: row.details ?? {},
  }));
  if (reconciliations.length > 0) {
    const { error } = await supabase.from("amazon_import_reconciliations").insert(reconciliations);
    if (error) throw new Error(error.message);
  }
  return {
    rawRowCount: rawRows.length,
    issueCount: issues.length,
    reconciliationCount: reconciliations.length,
    rawRowIdsByLineage,
  };
}

export async function persistNormalizedSources(args: {
  actor: AmazonWorkflowActor;
  batchId: string;
  file: AmazonImportFileRecord;
  parsed: AmazonParsedFileResult;
}): Promise<{ normalizedKind: string; recordCount: number }> {
  const supabase = await createClient();
  const parserIdentity = parserIdentityForParsed(args.parsed, args.file);
  const { data, error } = await supabase.rpc("persist_amazon_source_atomic", {
    p_organization_id: args.actor.organizationId,
    p_batch_id: args.batchId,
    p_file_id: args.file.id,
    p_source_type: args.parsed.sourceType,
    p_parser_name: parserIdentity.parserName,
    p_parser_version: parserIdentity.parserVersion,
    p_schema_signature: parserIdentity.schemaSignature,
    p_raw_rows: rawRowsPayload(args.parsed.generic),
    p_issues: issuesPayload({
      organizationId: args.actor.organizationId,
      batchId: args.batchId,
      fileId: args.file.id,
      result: args.parsed.generic,
    }),
    p_reconciliations: reconciliationsPayload(args.parsed.generic),
    p_normalized: normalizedPayload(args.parsed, args.file),
  });
  if (error) throw new Error(error.message);
  const result = data as { normalizedKind?: string; recordCount?: number } | null;
  return {
    normalizedKind: result?.normalizedKind ?? args.parsed.sourceType,
    recordCount: Number(result?.recordCount ?? 0),
  };
}

function rawRowsPayload(result: AmazonParseResult) {
  return result.rows.map((row) => ({
    source_sheet: row.sourceSheet,
    source_page: row.sourcePage,
    source_group: row.sourceGroup,
    source_row_number: row.sourceRowNumber,
    raw_data: row.rawData,
    normalized_data: row.normalizedData,
    parse_status: row.parseStatus,
    parse_warning: row.parseWarning,
  }));
}

function issuesPayload(args: {
  organizationId: string;
  batchId: string;
  fileId: string;
  result: AmazonParseResult;
}) {
  return args.result.issues.map((issue) => {
    const issueKey = [
      args.organizationId,
      args.batchId,
      args.fileId,
      issue.rawRowId ?? "no-row",
      issue.issueCode,
      issue.severity,
      issueDetailsHash(issue.details),
    ].join(":");
    return {
      issue_code: issue.issueCode,
      severity: issue.severity,
      message: issue.message,
      details: { ...issue.details, issueKey },
    };
  });
}

function reconciliationsPayload(result: AmazonParseResult) {
  return result.reconciliations.map((row) => ({
    reconciliation_type: row.reconciliationType,
    expected_amount: row.expectedAmount ?? null,
    actual_amount: row.actualAmount ?? null,
    expected_count: row.expectedCount ?? null,
    actual_count: row.actualCount ?? null,
    status: row.expectedAmount != null && row.actualAmount != null && Math.abs(differenceAmount(row.expectedAmount, row.actualAmount) ?? 0) > 0.01
      ? "warning"
      : "passed",
    details: row.details ?? {},
  }));
}

function parserIdentityForParsed(parsed: AmazonParsedFileResult, file: AmazonImportFileRecord) {
  if (parsed.sourceType === "amazon_payment") {
    return {
      parserName: parsed.payment.detailRows[0]?.parser.name ?? file.parser_name ?? "amazon-payment-xlsx",
      parserVersion: parsed.payment.detailRows[0]?.parser.version ?? file.parser_version ?? "unknown",
      schemaSignature: String(parsed.payment.schemaInspection.signature ?? file.schema_signature ?? "unknown"),
    };
  }
  if (parsed.sourceType === "amazon_trips") {
    return {
      parserName: parsed.trips.rows[0]?.parser.name ?? file.parser_name ?? "amazon-trips-csv",
      parserVersion: parsed.trips.rows[0]?.parser.version ?? file.parser_version ?? "unknown",
      schemaSignature: String(parsed.trips.schemaInspection.signature ?? file.schema_signature ?? "unknown"),
    };
  }
  if (parsed.sourceType === "fuel_card") {
    return {
      parserName: parsed.fuel.parser.name,
      parserVersion: parsed.fuel.parser.version,
      schemaSignature: parsed.fuel.schemaSignature.signature,
    };
  }
  return {
    parserName: file.parser_name ?? "statement-reference",
    parserVersion: file.parser_version ?? "none",
    schemaSignature: file.schema_signature ?? "none",
  };
}

function normalizedPayload(parsed: AmazonParsedFileResult, file: AmazonImportFileRecord) {
  if (parsed.sourceType === "statement_reference") return {};
  if (parsed.sourceType === "amazon_payment") {
    const summary = parsed.payment.summary;
    return {
      invoice: {
        invoice_number: summary.invoiceNumber ?? `file-${file.id}`,
        invoice_date: summary.invoiceDate,
        period_start: summary.workPeriodStart,
        period_end: summary.workPeriodEnd,
        payment_date: summary.paymentDate,
        payment_status: summary.paymentStatus,
        carrier_identifier: summary.carrierIdentifier,
        summary_total: summary.invoiceTotal,
        source_snapshot: summary,
      },
      payment_rows: parsed.payment.detailRows.map((row) => ({
        source_sheet: row.sourceSheet,
        source_page: null,
        source_group: null,
        source_row_number: row.sourceRowNumber,
        source_fingerprint: row.sourceFingerprint,
        row_classification: row.normalizedValues.rowClassification,
        trip_id: row.normalizedValues.tripId,
        load_id: row.normalizedValues.loadId,
        start_date: row.normalizedValues.startDate,
        end_date: row.normalizedValues.endDate,
        route_raw: row.normalizedValues.route,
        distance: row.normalizedValues.distanceMiles,
        base_amount: row.normalizedValues.baseRate,
        fuel_surcharge_amount: row.normalizedValues.fuelSurcharge,
        toll_amount: row.normalizedValues.tolls,
        detention_amount: row.normalizedValues.detention,
        tonu_amount: row.normalizedValues.tonu,
        other_amount: row.normalizedValues.others,
        gross_amount: row.normalizedValues.grossPay,
        item_type: row.normalizedValues.itemType,
        status: row.normalizedValues.comments,
        parse_status: row.parseStatus,
        source_snapshot: { raw: row.rawValues, normalized: row.normalizedValues },
      })),
    };
  }
  if (parsed.sourceType === "amazon_trips") {
    return {
      trip_rows: parsed.trips.rows.map((row) => ({
        source_sheet: row.sourceSheet,
        source_page: null,
        source_group: null,
        source_row_number: row.sourceRowNumber,
        source_fingerprint: row.sourceFingerprint,
        trip_id: row.normalizedValues.tripId,
        load_id: row.normalizedValues.loadId,
        raw_driver_text: row.normalizedValues.driverNameRaw,
        tractor_external_id: row.normalizedValues.tractorVehicleId,
        operator_type: row.normalizedValues.operatorType,
        equipment_type: row.normalizedValues.equipmentType,
        trip_status: row.normalizedValues.tripStage,
        load_status: row.normalizedValues.loadExecutionStatus,
        estimated_distance: row.normalizedValues.estimatedDistance,
        facility_sequence: row.normalizedValues.facilitySequence,
        stops: row.normalizedValues.stops,
        source_snapshot: { raw: row.rawValues, normalized: row.normalizedValues },
      })),
      driver_tokens: parsed.trips.rows.flatMap((row) =>
        row.normalizedValues.driverTokens.map((token, index) => ({
          source_fingerprint: row.sourceFingerprint,
          token_order: index + 1,
          raw_name: token,
          normalized_name: token.trim().replace(/\s+/g, " ").toUpperCase(),
          is_team_assignment: row.normalizedValues.driverTokens.length > 1,
          requires_split_rule: row.normalizedValues.requiresTeamAssignmentRule,
        })),
      ),
    };
  }
  return {
    report: {
      provider: parsed.fuel.provider,
      carrier_identifier: parsed.fuel.carrierIdentifier,
      period_start: parsed.fuel.periodStart,
      period_end: parsed.fuel.periodEnd,
      generated_at: parsed.fuel.generatedAt,
      reported_transaction_count: parsed.fuel.reportedTransactionCount,
      reported_total_amount: parsed.fuel.reportedTotalAmount,
      reported_total_quantity: parsed.fuel.reportedTotalQuantity,
      reported_discount_amount: parsed.fuel.reportedDiscountAmount,
      source_snapshot: parsed.fuel.sourceSnapshot,
    },
    card_groups: parsed.fuel.cardGroups.map((group) => ({
      source_group_number: group.sourceGroupNumber,
      card_external_id: group.cardExternalId,
      card_last_four: group.cardLastFour,
      driver_label_raw: group.driverLabelRaw,
      driver_label_normalized: group.driverLabelNormalized,
      unit_label_raw: group.unitLabelRaw,
      unit_label_normalized: group.unitLabelNormalized,
      reported_transaction_count: group.reportedTransactionCount,
      reported_total_amount: group.reportedTotalAmount,
      reported_total_quantity: group.reportedTotalQuantity,
      reported_discount_amount: group.reportedDiscountAmount,
      is_placeholder_group: group.isPlaceholderGroup,
      source_page_start: group.sourcePageStart,
      source_page_end: group.sourcePageEnd,
      source_snapshot: group.sourceSnapshot,
    })),
    transactions: parsed.fuel.cardGroups.flatMap((group) => group.transactions.map((transaction) => ({
      source_group_number: group.sourceGroupNumber,
      source_transaction_fingerprint: transaction.sourceTransactionFingerprint,
      transaction_at: transaction.transactionAt,
      invoice_number: transaction.invoiceNumber,
      merchant_raw: transaction.merchantRaw,
      city_raw: transaction.cityRaw,
      state_raw: transaction.stateRaw,
      odometer_raw: transaction.odometerRaw,
      fees_amount: transaction.feesAmount,
      source_page: transaction.sourcePage,
      source_row_number: transaction.sourceRowNumber,
      source_snapshot: transaction.sourceSnapshot,
    }))),
    product_lines: parsed.fuel.cardGroups.flatMap((group) => group.transactions.flatMap((transaction) =>
      transaction.productLines.map((line) => ({
        source_transaction_fingerprint: transaction.sourceTransactionFingerprint,
        source_line_order: line.sourceLineOrder,
        product_type_raw: line.productTypeRaw,
        product_type_normalized: line.productTypeNormalized,
        quantity: line.quantity,
        retail_unit_price: line.retailUnitPrice,
        charged_unit_price: line.chargedUnitPrice,
        discount_per_unit: line.discountPerUnit,
        discount_amount: line.discountAmount,
        deal_type: line.dealType,
        charged_amount: line.chargedAmount,
        source_snapshot: line.sourceSnapshot,
      })),
    )),
  };
}

async function persistPaymentSources(args: {
  actor: AmazonWorkflowActor;
  batchId: string;
  file: AmazonImportFileRecord;
  parsed: Extract<AmazonParsedFileResult, { sourceType: "amazon_payment" }>;
  rawRowIdsByLineage: Map<RawRowLineageKey, string>;
}) {
  const supabase = await createClient();
  const summary = args.parsed.payment.summary;
  const invoiceNumber = summary.invoiceNumber ?? `file-${args.file.id}`;
  const { data: invoice, error: invoiceError } = await supabase
    .from("amazon_payment_invoices")
    .upsert({
      organization_id: args.actor.organizationId,
      batch_id: args.batchId,
      file_id: args.file.id,
      invoice_number: invoiceNumber,
      invoice_date: summary.invoiceDate,
      period_start: summary.workPeriodStart,
      period_end: summary.workPeriodEnd,
      payment_date: summary.paymentDate,
      payment_status: summary.paymentStatus,
      carrier_identifier: summary.carrierIdentifier,
      summary_total: summary.invoiceTotal,
      parser_version: args.parsed.payment.detailRows[0]?.parser.version ?? args.file.parser_version ?? "unknown",
      schema_signature: String(args.parsed.payment.schemaInspection.signature ?? args.file.schema_signature ?? "unknown"),
      source_snapshot: summary,
    }, { onConflict: "organization_id,file_id,invoice_number" })
    .select("id")
    .single();
  if (invoiceError) throw new Error(invoiceError.message);
  const invoiceId = String((invoice as { id: string }).id);
  const rows = args.parsed.payment.detailRows.map((row) => ({
    organization_id: args.actor.organizationId,
    batch_id: args.batchId,
    file_id: args.file.id,
    raw_row_id: args.rawRowIdsByLineage.get(rawRowLineageKey({
      sourceSheet: row.sourceSheet,
      sourcePage: null,
      sourceGroup: null,
      sourceRowNumber: row.sourceRowNumber,
    })) ?? null,
    invoice_id: invoiceId,
    source_row_number: row.sourceRowNumber,
    source_fingerprint: row.sourceFingerprint,
    row_classification: row.normalizedValues.rowClassification,
    trip_id: row.normalizedValues.tripId,
    load_id: row.normalizedValues.loadId,
    start_date: row.normalizedValues.startDate,
    end_date: row.normalizedValues.endDate,
    route_raw: row.normalizedValues.route,
    distance: row.normalizedValues.distanceMiles,
    base_amount: row.normalizedValues.baseRate,
    fuel_surcharge_amount: row.normalizedValues.fuelSurcharge,
    toll_amount: row.normalizedValues.tolls,
    detention_amount: row.normalizedValues.detention,
    tonu_amount: row.normalizedValues.tonu,
    other_amount: row.normalizedValues.others,
    gross_amount: row.normalizedValues.grossPay,
    item_type: row.normalizedValues.itemType,
    status: row.normalizedValues.comments,
    parse_status: row.parseStatus,
    source_snapshot: { raw: row.rawValues, normalized: row.normalizedValues },
  }));
  if (rows.length > 0) {
    const { error } = await supabase.from("amazon_payment_rows").upsert(rows, {
      onConflict: "organization_id,file_id,source_fingerprint",
    });
    if (error) throw new Error(error.message);
  }
  return { normalizedKind: "amazon_payment", recordCount: rows.length + 1 };
}

async function persistTripSources(args: {
  actor: AmazonWorkflowActor;
  batchId: string;
  file: AmazonImportFileRecord;
  parsed: Extract<AmazonParsedFileResult, { sourceType: "amazon_trips" }>;
  rawRowIdsByLineage: Map<RawRowLineageKey, string>;
}) {
  const supabase = await createClient();
  const rows = args.parsed.trips.rows.map((row) => ({
    organization_id: args.actor.organizationId,
    batch_id: args.batchId,
    file_id: args.file.id,
    raw_row_id: args.rawRowIdsByLineage.get(rawRowLineageKey({
      sourceSheet: row.sourceSheet,
      sourcePage: null,
      sourceGroup: null,
      sourceRowNumber: row.sourceRowNumber,
    })) ?? null,
    source_row_number: row.sourceRowNumber,
    source_fingerprint: row.sourceFingerprint,
    trip_id: row.normalizedValues.tripId,
    load_id: row.normalizedValues.loadId,
    raw_driver_text: row.normalizedValues.driverNameRaw,
    tractor_external_id: row.normalizedValues.tractorVehicleId,
    operator_type: row.normalizedValues.operatorType,
    equipment_type: row.normalizedValues.equipmentType,
    trip_status: row.normalizedValues.tripStage,
    load_status: row.normalizedValues.loadExecutionStatus,
    estimated_distance: row.normalizedValues.estimatedDistance,
    facility_sequence: row.normalizedValues.facilitySequence,
    stops: row.normalizedValues.stops,
    source_snapshot: { raw: row.rawValues, normalized: row.normalizedValues },
  }));
  if (rows.length > 0) {
    const { error } = await supabase.from("amazon_trip_rows").upsert(rows, {
      onConflict: "organization_id,file_id,source_fingerprint",
    });
    if (error) throw new Error(error.message);
  }
  const { data: persistedTrips, error: tripsReadError } = await supabase
    .from("amazon_trip_rows")
    .select("id, source_fingerprint")
    .eq("organization_id", args.actor.organizationId)
    .eq("batch_id", args.batchId)
    .eq("file_id", args.file.id);
  if (tripsReadError) throw new Error(tripsReadError.message);
  const tripIdByFingerprint = new Map((persistedTrips ?? []).map((row) => [
    String(row.source_fingerprint),
    String(row.id),
  ]));
  const driverTokens = args.parsed.trips.rows.flatMap((row) => {
    const tripRowId = tripIdByFingerprint.get(row.sourceFingerprint);
    return tripRowId
      ? row.normalizedValues.driverTokens.map((token, index) => ({
          organization_id: args.actor.organizationId,
          trip_row_id: tripRowId,
          token_order: index + 1,
          raw_name: token,
          normalized_name: token.trim().replace(/\s+/g, " ").toUpperCase(),
          is_team_assignment: row.normalizedValues.driverTokens.length > 1,
          requires_split_rule: row.normalizedValues.requiresTeamAssignmentRule,
        }))
      : [];
  });
  if (driverTokens.length > 0) {
    const { error } = await supabase.from("amazon_trip_driver_tokens").upsert(driverTokens, {
      onConflict: "organization_id,trip_row_id,token_order",
    });
    if (error) throw new Error(error.message);
  }
  return { normalizedKind: "amazon_trips", recordCount: rows.length + driverTokens.length };
}

async function persistFuelSources(args: {
  actor: AmazonWorkflowActor;
  batchId: string;
  file: AmazonImportFileRecord;
  parsed: Extract<AmazonParsedFileResult, { sourceType: "fuel_card" }>;
}) {
  const supabase = await createClient();
  const report = args.parsed.fuel;
  const { data, error } = await supabase
    .from("fuel_import_reports")
    .upsert({
      organization_id: args.actor.organizationId,
      batch_id: args.batchId,
      file_id: args.file.id,
      provider: report.provider,
      carrier_identifier: report.carrierIdentifier,
      period_start: report.periodStart,
      period_end: report.periodEnd,
      generated_at: report.generatedAt,
      reported_transaction_count: report.reportedTransactionCount,
      reported_total_amount: report.reportedTotalAmount,
      reported_total_quantity: report.reportedTotalQuantity,
      reported_discount_amount: report.reportedDiscountAmount,
      parser_name: report.parser.name,
      parser_version: report.parser.version,
      schema_signature: report.schemaSignature.signature,
      source_snapshot: report.sourceSnapshot,
    }, { onConflict: "organization_id,file_id" })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  const reportId = String((data as { id: string }).id);
  const groups = report.cardGroups.map((group) => ({
    organization_id: args.actor.organizationId,
    report_id: reportId,
    source_group_number: group.sourceGroupNumber,
    card_external_id: group.cardExternalId,
    card_last_four: group.cardLastFour,
    driver_label_raw: group.driverLabelRaw,
    driver_label_normalized: group.driverLabelNormalized,
    unit_label_raw: group.unitLabelRaw,
    unit_label_normalized: group.unitLabelNormalized,
    reported_transaction_count: group.reportedTransactionCount,
    reported_total_amount: group.reportedTotalAmount,
    reported_total_quantity: group.reportedTotalQuantity,
    reported_discount_amount: group.reportedDiscountAmount,
    is_placeholder_group: group.isPlaceholderGroup,
    source_page_start: group.sourcePageStart,
    source_page_end: group.sourcePageEnd,
    source_snapshot: group.sourceSnapshot,
  }));
  if (groups.length > 0) {
    const { error: groupError } = await supabase.from("fuel_import_card_groups").upsert(groups, {
      onConflict: "organization_id,report_id,source_group_number",
    });
    if (groupError) throw new Error(groupError.message);
  }
  const { data: persistedGroups, error: groupsReadError } = await supabase
    .from("fuel_import_card_groups")
    .select("id, source_group_number")
    .eq("organization_id", args.actor.organizationId)
    .eq("report_id", reportId);
  if (groupsReadError) throw new Error(groupsReadError.message);
  const groupIdByNumber = new Map((persistedGroups ?? []).map((group) => [
    Number(group.source_group_number),
    String(group.id),
  ]));
  const transactions = report.cardGroups.flatMap((group) => {
    const groupId = groupIdByNumber.get(group.sourceGroupNumber);
    return groupId
      ? group.transactions.map((transaction) => ({
          organization_id: args.actor.organizationId,
          report_id: reportId,
          card_group_id: groupId,
          source_transaction_fingerprint: transaction.sourceTransactionFingerprint,
          transaction_at: transaction.transactionAt,
          invoice_number: transaction.invoiceNumber,
          merchant_raw: transaction.merchantRaw,
          city_raw: transaction.cityRaw,
          state_raw: transaction.stateRaw,
          odometer_raw: transaction.odometerRaw,
          fees_amount: transaction.feesAmount,
          source_page: transaction.sourcePage,
          source_row_number: transaction.sourceRowNumber,
          source_snapshot: transaction.sourceSnapshot,
        }))
      : [];
  });
  if (transactions.length > 0) {
    const { error: transactionError } = await supabase.from("fuel_import_transactions").upsert(transactions, {
      onConflict: "organization_id,report_id,source_transaction_fingerprint",
    });
    if (transactionError) throw new Error(transactionError.message);
  }
  const { data: persistedTransactions, error: transactionsReadError } = await supabase
    .from("fuel_import_transactions")
    .select("id, source_transaction_fingerprint")
    .eq("organization_id", args.actor.organizationId)
    .eq("report_id", reportId);
  if (transactionsReadError) throw new Error(transactionsReadError.message);
  const transactionIdByFingerprint = new Map((persistedTransactions ?? []).map((transaction) => [
    String(transaction.source_transaction_fingerprint),
    String(transaction.id),
  ]));
  const lines = report.cardGroups.flatMap((group) => group.transactions.flatMap((transaction) => {
    const transactionId = transactionIdByFingerprint.get(transaction.sourceTransactionFingerprint);
    return transactionId
      ? transaction.productLines.map((line) => ({
          organization_id: args.actor.organizationId,
          transaction_id: transactionId,
          source_line_order: line.sourceLineOrder,
          product_type_raw: line.productTypeRaw,
          product_type_normalized: line.productTypeNormalized,
          quantity: line.quantity,
          retail_unit_price: line.retailUnitPrice,
          charged_unit_price: line.chargedUnitPrice,
          discount_per_unit: line.discountPerUnit,
          discount_amount: line.discountAmount,
          deal_type: line.dealType,
          charged_amount: line.chargedAmount,
          source_snapshot: line.sourceSnapshot,
        }))
      : [];
  }));
  if (lines.length > 0) {
    const { error: lineError } = await supabase.from("fuel_import_transaction_lines").upsert(lines, {
      onConflict: "organization_id,transaction_id,source_line_order",
    });
    if (lineError) throw new Error(lineError.message);
  }
  return {
    normalizedKind: "fuel_card",
    recordCount: 1 + groups.length + transactions.length + lines.length,
  };
}
