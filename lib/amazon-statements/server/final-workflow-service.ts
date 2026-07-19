import "server-only";

import { createClient } from "@/lib/supabase/server";
import { projectionSourceFingerprint } from "../projection/projection-revision";
import type { ExistingProjection, FuelProjectionItem, RevenueProjectionItem } from "../projection/projection-types";
import { applyAmazonProjection, previewAmazonProjection } from "./projection-service";
import { createDraftAmazonCandidate, recomputeAmazonCandidate, saveEditableAmazonCandidate } from "./candidate-service";
import type {
  CandidateAdjustmentInput,
  CandidateCalculationConfig,
  CandidateCalculationResult,
  CandidateFuelSelection,
  CandidateRevenueSelection,
} from "../candidates/candidate-types";
import type { AmazonWorkflowActor } from "./workflow-types";
import { assertWorkflow } from "./workflow-errors";

export type CandidateCreateInput = {
  batchId: string;
  candidateId?: string | null;
  expectedPreviewRevision?: string | null;
  statementType: CandidateCalculationConfig["statementType"];
  periodStart: string;
  periodEnd: string;
  payeeType: CandidateCalculationConfig["payeeType"];
  payeeId?: string | null;
  vehicleId?: string | null;
  companyFeeBasisPoints?: number | null;
  driverPayBasisPoints?: number | null;
  externalCarrierFeeBasisPoints?: number | null;
  fuelInclusionPolicy?: CandidateCalculationConfig["fuelInclusionPolicy"] | "no_fuel";
  templateVersion: string;
  languageMode?: "en" | "tr" | "en_tr";
  selectedRevenueItemIds?: string[];
  selectedFuelLineIds?: string[];
  teamSplitRuleId?: string | null;
  fixedAdjustments?: CandidateAdjustmentInput[];
};

export interface CandidateEditorView {
  batchId: string;
  candidateId: string | null;
  mode: "create" | "edit" | "readonly";
  status: string;
  canEdit: boolean;
  statementType: CandidateCalculationConfig["statementType"] | null;
  payeeType: CandidateCalculationConfig["payeeType"] | null;
  payeeId: string | null;
  vehicleId: string | null;
  fuelInclusionPolicy: NonNullable<CandidateCalculationConfig["fuelInclusionPolicy"]> | "no_fuel";
  templateVersion: string;
  languageMode: "en" | "tr" | "en_tr";
  periodStart: string | null;
  periodEnd: string | null;
  previewRevision: string | null;
  selectedRevenueItemIds: string[];
  selectedFuelLineIds: string[];
  options: {
    people: Array<{ id: string; label: string; type: string }>;
    vehicles: Array<{ id: string; label: string; vehicleType: string; ownershipType: string; ownerId: string | null }>;
    templates: Array<{ version: string; label: string }>;
    languages: Array<{ value: "en" | "tr" | "en_tr"; label: string }>;
  };
  revenueSources: Array<{
    revenueItemId: string;
    loadId: string;
    serviceDateRange: string;
    routeDisplay: string;
    unitDisplay: string;
    miles: number | null;
    baseAmount: number;
    fuelSurchargeAmount: number;
    tollAmount: number;
    detentionAmount: number;
    tonuAmount: number;
    otherAmount: number;
    grossAmount: number;
    projectionStatus: string;
    settlementEligible: boolean;
    sourceRevisionStatus: "current";
  }>;
  fuelSources: Array<{
    transactionLineId: string;
    expenseId: string;
    transactionDate: string | null;
    maskedTransactionReference: string;
    product: string;
    quantity: number | null;
    chargedAmount: number;
    discountAmount: number | null;
    assignmentStatus: string;
    deductionReady: boolean;
    placeholder: boolean;
    sourceRevisionStatus: "current";
  }>;
  calculation: CandidateCalculationSummary | null;
}

export interface CandidateCalculationSummary {
  status: string;
  gross: number;
  percentageDeductions: number;
  fixedDeductions: number;
  fuelDeductions: number;
  otherDeductions: number;
  totalDeductions: number;
  net: number;
  previewRevision: string;
  sourceRevision: string;
  lineItems: Array<{ key: string; label: string; amount: number; isOurRevenue: boolean }>;
  blockers: string[];
  warnings: string[];
}

export async function previewAmazonProjectionForBatch(args: {
  actor: AmazonWorkflowActor;
  batchId: string;
}) {
  const projectionInput = await buildProjectionInputForBatch(args);
  return {
    ...previewAmazonProjection(projectionInput),
    revenueItems: projectionInput.revenueItems,
    fuelItems: projectionInput.fuelItems,
  };
}

export async function applyAmazonProjectionForBatch(args: {
  actor: AmazonWorkflowActor;
  batchId: string;
  expectedRevenuePreviewRevision: string;
  expectedFuelPreviewRevision: string;
}) {
  const projectionInput = await buildProjectionInputForBatch(args);
  return applyAmazonProjection({
    actor: args.actor,
    batchId: args.batchId,
    expectedRevenuePreviewRevision: args.expectedRevenuePreviewRevision,
    expectedFuelPreviewRevision: args.expectedFuelPreviewRevision,
    ...projectionInput,
  });
}

export async function previewReviewedAmazonCandidate(args: {
  actor: AmazonWorkflowActor;
  input: CandidateCreateInput;
}): Promise<CandidateCalculationSummary> {
  const compilerInput = await buildCandidateCompilerInput(args);
  return candidateCalculationSummary(recomputeAmazonCandidate(compilerInput));
}

export async function saveReviewedAmazonCandidate(args: {
  actor: AmazonWorkflowActor;
  input: CandidateCreateInput;
}) {
  const compilerInput = await buildCandidateCompilerInput(args);
  if (args.input.candidateId) {
    assertWorkflow(Boolean(args.input.expectedPreviewRevision), {
      code: "expected_revision_required",
      message: "Expected preview revision is required to save candidate edits.",
      stage: "compile_candidates",
    });
    return saveEditableAmazonCandidate({
      actor: args.actor,
      candidateId: args.input.candidateId,
      expectedPreviewRevision: args.input.expectedPreviewRevision ?? "",
      input: compilerInput,
    });
  }
  return createDraftAmazonCandidate({
    actor: args.actor,
    batchId: args.input.batchId,
    input: compilerInput,
  });
}

export async function getAmazonCandidateEditorForUi(args: {
  actor: AmazonWorkflowActor;
  batchId: string;
  candidateId?: string | null;
}): Promise<CandidateEditorView> {
  const supabase = await createClient();
  const [batch, people, vehicles, revenueRows, fuelRows, candidate, candidateRevenue, candidateFuel] = await Promise.all([
    supabase.from("amazon_import_batches").select("id, organization_id, status, period_start, period_end").eq("organization_id", args.actor.organizationId).eq("id", args.batchId).single(),
    supabase.from("people").select("id, full_name, type").eq("organization_id", args.actor.organizationId).order("full_name"),
    supabase.from("vehicles").select("id, unit_number, vehicle_type, ownership_type, owner_id").eq("organization_id", args.actor.organizationId).order("unit_number"),
    projectedRevenueRows(args.actor.organizationId, args.batchId),
    projectedFuelRows(args.actor.organizationId, args.batchId),
    args.candidateId
      ? supabase.from("amazon_statement_candidates").select("id, status, statement_type, payee_type, payee_id, vehicle_id, period_start, period_end, template_version, preview_revision, configuration_snapshot, calculation_snapshot").eq("organization_id", args.actor.organizationId).eq("batch_id", args.batchId).eq("id", args.candidateId).single()
      : Promise.resolve({ data: null, error: null }),
    args.candidateId
      ? supabase.from("amazon_statement_candidate_revenue").select("revenue_item_id").eq("organization_id", args.actor.organizationId).eq("candidate_id", args.candidateId)
      : Promise.resolve({ data: [], error: null }),
    args.candidateId
      ? supabase.from("amazon_statement_candidate_fuel_lines").select("transaction_line_id").eq("organization_id", args.actor.organizationId).eq("candidate_id", args.candidateId)
      : Promise.resolve({ data: [], error: null }),
  ]);
  for (const result of [batch, people, vehicles, revenueRows, fuelRows, candidate, candidateRevenue, candidateFuel]) {
    if (result.error) throw new Error(result.error.message);
  }
  if (!batch.data) throw new Error("Amazon import batch is not available.");
  const status = candidate.data ? String(candidate.data.status) : "draft";
  const configurationSnapshot = safeSnapshot(candidate.data?.configuration_snapshot);
  const calculationSnapshot = safeSnapshot(candidate.data?.calculation_snapshot);
  return {
    batchId: args.batchId,
    candidateId: args.candidateId ?? null,
    mode: args.candidateId ? status === "converted" || status === "archived" ? "readonly" : "edit" : "create",
    status,
    canEdit: args.actor.access === "writer" && status !== "converted" && status !== "archived" && String(batch.data.status) !== "archived",
    statementType: validStatementType(candidate.data?.statement_type) ?? validStatementType(calculationSnapshot.statementType),
    payeeType: validPayeeType(candidate.data?.payee_type) ?? validPayeeType(calculationSnapshot.payeeType),
    payeeId: stringOrNull(candidate.data?.payee_id ?? calculationSnapshot.payeeId),
    vehicleId: stringOrNull(candidate.data?.vehicle_id ?? calculationSnapshot.vehicleId),
    fuelInclusionPolicy: validFuelPolicy(configurationSnapshot.fuel_inclusion_policy ?? calculationSnapshot.fuelInclusionPolicy),
    templateVersion: stringOrNull(candidate.data?.template_version ?? configurationSnapshot.template_version) ?? "amazon-statement-v1",
    languageMode: validLanguage(configurationSnapshot.language_mode ?? calculationSnapshot.languageMode),
    periodStart: candidate.data?.period_start ?? batch.data.period_start ?? null,
    periodEnd: candidate.data?.period_end ?? batch.data.period_end ?? null,
    previewRevision: candidate.data?.preview_revision ?? null,
    selectedRevenueItemIds: (candidateRevenue.data ?? []).map((row) => String(row.revenue_item_id)),
    selectedFuelLineIds: (candidateFuel.data ?? []).map((row) => String(row.transaction_line_id)),
    options: {
      people: (people.data ?? []).map((person) => ({ id: String(person.id), label: String(person.full_name ?? "Person"), type: String(person.type ?? "") })),
      vehicles: (vehicles.data ?? []).map((vehicle) => ({
        id: String(vehicle.id),
        label: String(vehicle.unit_number ?? "Unit"),
        vehicleType: String(vehicle.vehicle_type ?? ""),
        ownershipType: String(vehicle.ownership_type ?? ""),
        ownerId: stringOrNull(vehicle.owner_id),
      })),
      templates: [{ version: "amazon-statement-v1", label: "Amazon statement v1" }],
      languages: [
        { value: "en", label: "English" },
        { value: "tr", label: "Turkish" },
        { value: "en_tr", label: "English + Turkish" },
      ],
    },
    revenueSources: revenueSourceViews(revenueRows.data ?? []),
    fuelSources: fuelSourceViews(fuelRows.data ?? []),
    calculation: candidate.data ? calculationSummaryFromSnapshot(candidate.data.calculation_snapshot, status, candidate.data.preview_revision) : null,
  };
}

async function buildCandidateCompilerInput(args: {
  actor: AmazonWorkflowActor;
  input: CandidateCreateInput;
}) {
  const { batchId } = args.input;
  const supabase = await createClient();
  const { data: batch, error: batchError } = await supabase
    .from("amazon_import_batches")
    .select("id, organization_id, status")
    .eq("organization_id", args.actor.organizationId)
    .eq("id", batchId)
    .single();
  if (batchError) throw new Error(batchError.message);
  assertWorkflow(String(batch.status) !== "archived", {
    code: "archived_batch",
    message: "Archived Amazon batches are read-only.",
    stage: "compile_candidates",
  });
  assertValidStatementType(args.input.statementType);
  await assertPayeeAndLane({
    organizationId: args.actor.organizationId,
    statementType: args.input.statementType,
    payeeId: args.input.payeeId ?? null,
    vehicleId: args.input.vehicleId ?? null,
  });
  const revenueSelections = await candidateRevenueSelections(
    args.actor.organizationId,
    batchId,
    args.input.selectedRevenueItemIds ?? [],
  );
  const fuelSelections = args.input.fuelInclusionPolicy === "no_fuel"
    ? []
    : await candidateFuelSelections(
      args.actor.organizationId,
      batchId,
      args.input.payeeType,
      args.input.selectedFuelLineIds ?? [],
      args.input.fuelInclusionPolicy ?? "transaction_date_in_period",
    );
  const config: CandidateCalculationConfig = {
    statementType: args.input.statementType,
    periodStart: args.input.periodStart,
    periodEnd: args.input.periodEnd,
    organizationId: args.actor.organizationId,
    batchId,
    payeeType: args.input.payeeType,
    payeeId: args.input.payeeId ?? null,
    vehicleId: args.input.vehicleId ?? null,
    calculationRuleVersion: "amazon-candidate-rules-v1",
    templateVersion: args.input.templateVersion,
    languageMode: args.input.languageMode ?? "en_tr",
    fuelInclusionPolicy: args.input.fuelInclusionPolicy === "no_fuel" ? "manual_reviewed_selection" : args.input.fuelInclusionPolicy ?? "transaction_date_in_period",
    companyFeeBasisPoints: args.input.companyFeeBasisPoints ?? null,
    driverPayBasisPoints: args.input.driverPayBasisPoints ?? null,
    externalCarrierFeeBasisPoints: args.input.externalCarrierFeeBasisPoints ?? null,
    fixedAdjustments: args.input.fixedAdjustments ?? [],
  };
  assertWorkflow(args.input.templateVersion === "amazon-statement-v1", {
    code: "unknown_template",
    message: "Unknown Amazon statement template version.",
    stage: "compile_candidates",
  });
  return { config, revenueSelections, fuelSelections };
}

async function buildProjectionInputForBatch(args: {
  actor: AmazonWorkflowActor;
  batchId: string;
}): Promise<{
  revenueItems: RevenueProjectionItem[];
  fuelItems: FuelProjectionItem[];
  existingRevenue: ExistingProjection[];
  existingFuel: ExistingProjection[];
}> {
  const supabase = await createClient();
  const [batch, revenueReconciliation, matchingIssues, revenueRows, fuelLineRows, existingRevenueRows, existingFuelRows] = await Promise.all([
    supabase
      .from("amazon_import_batches")
      .select("id, status")
      .eq("organization_id", args.actor.organizationId)
      .eq("id", args.batchId)
      .single(),
    supabase
      .from("amazon_import_reconciliations")
      .select("status")
      .eq("organization_id", args.actor.organizationId)
      .eq("batch_id", args.batchId)
      .eq("reconciliation_type", "amazon_revenue")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("amazon_import_issues")
      .select("id")
      .eq("organization_id", args.actor.organizationId)
      .eq("batch_id", args.batchId)
      .eq("status", "open")
      .eq("severity", "blocking")
      .in("issue_code", ["ambiguous_load_match", "unmatched_payment_row", "source_row_missing_from_revenue", "duplicate_revenue_contribution", "financial_reconciliation_failed", "missing_invoice", "missing_required_source_rows"]),
    supabase
      .from("amazon_revenue_items")
      .select("id, batch_id, grouping_type, grouping_key, trip_id, primary_load_id, start_date, end_date, route_resolution_status, distance, base_amount, fuel_surcharge_amount, toll_amount, detention_amount, tonu_amount, other_amount, gross_amount, match_status, driver_assignment_status, vehicle_assignment_status, reconciliation_status, source_revision")
      .eq("organization_id", args.actor.organizationId)
      .eq("batch_id", args.batchId),
    supabase
      .from("fuel_import_transaction_lines")
      .select("id, source_line_order, product_type_raw, product_type_normalized, quantity, retail_unit_price, charged_unit_price, discount_per_unit, discount_amount, deal_type, charged_amount, fuel_import_transactions!inner(id, card_group_id, source_transaction_fingerprint, transaction_at, invoice_number, merchant_raw, city_raw, state_raw, source_page, source_row_number, fuel_import_card_groups!inner(id, source_group_number, card_last_four, driver_label_raw, driver_label_normalized, unit_label_raw, unit_label_normalized, is_placeholder_group, source_page_start, source_page_end, fuel_import_reports!inner(batch_id)))")
      .eq("organization_id", args.actor.organizationId)
      .eq("fuel_import_transactions.fuel_import_card_groups.fuel_import_reports.batch_id", args.batchId),
    supabase
      .from("amazon_revenue_load_projections")
      .select("revenue_item_id, load_id, source_revision, source_fingerprint, projection_status")
      .eq("organization_id", args.actor.organizationId)
      .eq("batch_id", args.batchId)
      .neq("projection_status", "archived"),
    supabase
      .from("amazon_fuel_expense_projections")
      .select("transaction_line_id, expense_id, source_revision, source_fingerprint, projection_status")
      .eq("organization_id", args.actor.organizationId)
      .eq("batch_id", args.batchId)
      .neq("projection_status", "archived"),
  ]);
  for (const result of [batch, revenueReconciliation, matchingIssues, revenueRows, fuelLineRows, existingRevenueRows, existingFuelRows]) {
    if (result.error) throw new Error(result.error.message);
  }
  assertWorkflow(Boolean(batch.data), {
    code: "batch_not_found",
    message: "Amazon import batch is not available.",
    stage: "apply_projection",
  });
  assertWorkflow(revenueRows.data !== null && revenueRows.data.length > 0, {
    code: "missing_canonical_revenue",
    message: "Run payment/trip reconciliation before applying projection.",
    stage: "apply_projection",
  });
  assertWorkflow(revenueReconciliation.data?.status === "passed", {
    code: "amazon_revenue_reconciliation_not_passed",
    message: "Amazon revenue reconciliation must pass before applying projection.",
    stage: "apply_projection",
  });
  assertWorkflow((matchingIssues.data ?? []).length === 0, {
    code: "blocking_matching_issues",
    message: "Resolve blocking matching issues before applying projection.",
    stage: "apply_projection",
  });
  return {
    revenueItems: (revenueRows.data ?? []).map((row) => revenueProjectionFromRow(row as Record<string, unknown>, args.batchId)),
    fuelItems: (fuelLineRows.data ?? []).map((row) => fuelProjectionFromRow(row as Record<string, unknown>, args.batchId)),
    existingRevenue: (existingRevenueRows.data ?? []).map((row) => ({
      sourceId: String(row.revenue_item_id),
      targetId: String(row.load_id),
      sourceRevision: String(row.source_revision),
      sourceFingerprint: String(row.source_fingerprint),
      projectionStatus: row.projection_status as ExistingProjection["projectionStatus"],
    })),
    existingFuel: (existingFuelRows.data ?? []).map((row) => ({
      sourceId: String(row.transaction_line_id),
      targetId: String(row.expense_id),
      sourceRevision: String(row.source_revision),
      sourceFingerprint: String(row.source_fingerprint),
      projectionStatus: row.projection_status as ExistingProjection["projectionStatus"],
    })),
  };
}

function revenueProjectionFromRow(row: Record<string, unknown>, batchId: string): RevenueProjectionItem {
  const gross = numberValue(row.gross_amount);
  const sourceRevision = String(row.source_revision);
  const sourceFingerprint = projectionSourceFingerprint(["amazon-revenue-load", row.id, sourceRevision]);
  return {
    revenueItemId: String(row.id),
    batchId,
    sourceRevision,
    sourceFingerprint,
    canonicalItem: {
      id: String(row.id),
      invoiceId: "database",
      groupingType: row.grouping_type === "trip" ? "trip" : "load",
      groupingKey: String(row.grouping_key ?? row.id),
      tripId: stringOrNull(row.trip_id),
      primaryLoadId: stringOrNull(row.primary_load_id),
      startDate: stringOrNull(row.start_date),
      endDate: stringOrNull(row.end_date),
      originFacilityCode: null,
      destinationFacilityCode: null,
      routeResolutionStatus: row.route_resolution_status === "resolved" ? "resolved" : "unresolved",
      distance: nullableNumber(row.distance),
      baseAmount: numberValue(row.base_amount),
      fuelSurchargeAmount: numberValue(row.fuel_surcharge_amount),
      tollAmount: numberValue(row.toll_amount),
      detentionAmount: numberValue(row.detention_amount),
      tonuAmount: numberValue(row.tonu_amount),
      otherAmount: numberValue(row.other_amount),
      grossAmount: gross,
      matchStatus: String(row.match_status ?? "unknown"),
      driverAssignmentStatus: String(row.driver_assignment_status ?? "source_only"),
      vehicleAssignmentStatus: String(row.vehicle_assignment_status ?? "source_only"),
      reconciliationStatus: row.reconciliation_status === "passed" ? "passed" : row.reconciliation_status === "failed" ? "failed" : "warning",
      sourceRevision,
      sources: [],
    },
    load: {
      load_number: stringOrNull(row.primary_load_id) ?? stringOrNull(row.trip_id),
      load_source: "amazon_relay",
      vehicle_id: null,
      driver_id: null,
      pickup_date: stringOrNull(row.start_date),
      delivery_date: stringOrNull(row.end_date),
      pickup_location: null,
      delivery_location: null,
      route: null,
      gross_amount: gross,
      fuel_surcharge: numberValue(row.fuel_surcharge_amount),
      loaded_miles: nullableNumber(row.distance),
      empty_miles: 0,
      total_miles: nullableNumber(row.distance),
      status: "pending",
      notes: "Amazon Relay projection",
    },
    projectionSnapshot: { routeStatus: row.route_resolution_status, source: "database" },
    canonicalReady: row.reconciliation_status === "passed",
    projectionReady: row.reconciliation_status === "passed",
    settlementReady: false,
  };
}

function fuelProjectionFromRow(row: Record<string, unknown>, batchId: string): FuelProjectionItem {
  const transaction = row.fuel_import_transactions as Record<string, unknown> | null;
  const group = transaction?.fuel_import_card_groups as Record<string, unknown> | null;
  const sourceRevision = projectionSourceFingerprint(["amazon-fuel-source", row.id, row.charged_amount]);
  const sourceFingerprint = projectionSourceFingerprint(["amazon-fuel-expense", row.id, row.source_line_order]);
  const product = fuelProduct(row.product_type_normalized);
  const placeholder = group?.is_placeholder_group === true;
  return {
    transactionLineId: String(row.id),
    batchId,
    sourceRevision,
    sourceFingerprint,
    group: {
      sourceGroupNumber: Number(group?.source_group_number ?? 0),
      cardExternalId: null,
      cardLastFour: stringOrNull(group?.card_last_four),
      driverLabelRaw: stringOrNull(group?.driver_label_raw),
      driverLabelNormalized: stringOrNull(group?.driver_label_normalized),
      unitLabelRaw: stringOrNull(group?.unit_label_raw),
      unitLabelNormalized: stringOrNull(group?.unit_label_normalized),
      reportedTransactionCount: null,
      reportedTotalAmount: null,
      reportedTotalQuantity: null,
      reportedDiscountAmount: null,
      isPlaceholderGroup: placeholder,
      sourcePageStart: nullableNumber(group?.source_page_start),
      sourcePageEnd: nullableNumber(group?.source_page_end),
      sourceSnapshot: {},
      transactions: [],
    },
    transaction: {
      sourceTransactionFingerprint: String(transaction?.source_transaction_fingerprint ?? sourceFingerprint),
      transactionAt: stringOrNull(transaction?.transaction_at),
      invoiceNumber: stringOrNull(transaction?.invoice_number),
      merchantRaw: stringOrNull(transaction?.merchant_raw),
      cityRaw: stringOrNull(transaction?.city_raw),
      stateRaw: stringOrNull(transaction?.state_raw),
      odometerRaw: null,
      feesAmount: null,
      sourcePage: nullableNumber(transaction?.source_page),
      sourceRowNumber: nullableNumber(transaction?.source_row_number),
      sourceSnapshot: {},
      productLines: [],
    },
    productLine: {
      sourceLineOrder: Number(row.source_line_order ?? 1),
      productTypeRaw: stringOrNull(row.product_type_raw),
      productTypeNormalized: product,
      quantity: nullableNumber(row.quantity),
      retailUnitPrice: nullableNumber(row.retail_unit_price),
      chargedUnitPrice: nullableNumber(row.charged_unit_price),
      discountPerUnit: nullableNumber(row.discount_per_unit),
      discountAmount: nullableNumber(row.discount_amount),
      dealType: stringOrNull(row.deal_type),
      chargedAmount: numberValue(row.charged_amount),
      sourceSnapshot: {},
    },
    expense: {
      date: stringOrNull(transaction?.transaction_at)?.slice(0, 10) ?? null,
      vehicle_id: null,
      driver_id: null,
      owner_id: null,
      category: product === "DEF" ? "def" : product === "FEE" ? "fees" : product === "OTHER" ? "other" : "fuel",
      amount: numberValue(row.charged_amount),
      deduct_from_settlement: false,
      deduct_from_driver: false,
      deduct_from_owner: false,
      deduct_from_investor: false,
      notes: "Amazon fuel projection",
    },
    projectionSnapshot: { product, source: "database", discountPreservedAsMetadata: true },
    fuelSourceReady: !placeholder && row.charged_amount !== null,
    expenseProjectionReady: !placeholder && row.charged_amount !== null,
    settlementDeductionReady: false,
  };
}

function candidateCalculationSummary(calculation: CandidateCalculationResult): CandidateCalculationSummary {
  return {
    status: calculation.readiness.status,
    gross: calculation.grossAmount,
    percentageDeductions: calculation.percentageDeductionsAmount,
    fixedDeductions: calculation.fixedDeductionsAmount,
    fuelDeductions: calculation.fuelDeductionsAmount,
    otherDeductions: calculation.otherDeductionsAmount,
    totalDeductions: calculation.totalDeductionsAmount,
    net: calculation.netAmount,
    previewRevision: calculation.previewRevision,
    sourceRevision: calculation.sourceRevision,
    lineItems: calculation.settlementResult.lineItems.map((line) => ({
      key: line.key,
      label: line.labelEn,
      amount: line.amount,
      isOurRevenue: line.isOurRevenue === true,
    })),
    blockers: calculation.readiness.issues.filter((issue) => issue.severity === "blocking").map((issue) => issue.issueCode),
    warnings: calculation.readiness.issues.filter((issue) => issue.severity === "warning").map((issue) => issue.issueCode),
  };
}

function calculationSummaryFromSnapshot(snapshot: unknown, status: string, previewRevision: string | null): CandidateCalculationSummary | null {
  if (!snapshot || typeof snapshot !== "object") return null;
  const source = snapshot as Record<string, unknown>;
  const lineItems = Array.isArray(source.lineItems) ? source.lineItems as Array<Record<string, unknown>> : [];
  return {
    status,
    gross: numberValue(source.grossAmount),
    percentageDeductions: 0,
    fixedDeductions: 0,
    fuelDeductions: 0,
    otherDeductions: 0,
    totalDeductions: numberValue(source.totalDeductionsAmount),
    net: numberValue(source.netAmount),
    previewRevision: previewRevision ?? "",
    sourceRevision: "",
    lineItems: lineItems.map((line) => ({
      key: String(line.key ?? "line"),
      label: String(line.labelEn ?? line.label_en ?? line.key ?? "Line"),
      amount: numberValue(line.amount),
      isOurRevenue: line.isOurRevenue === true || line.is_our_revenue === true,
    })),
    blockers: [],
    warnings: [],
  };
}

function projectedRevenueRows(organizationId: string, batchId: string) {
  return createClient().then((supabase) => supabase
    .from("amazon_revenue_load_projections")
    .select("revenue_item_id, load_id, source_revision, source_fingerprint, projection_status, projection_snapshot, loads!inner(id, load_number, route, total_miles, gross_amount, fuel_surcharge, delivery_date, status, vehicle_id, driver_id, vehicles!loads_vehicle_same_org_fk(unit_number)), amazon_revenue_items!inner(id, start_date, end_date, distance, base_amount, fuel_surcharge_amount, toll_amount, detention_amount, tonu_amount, other_amount, gross_amount)")
    .eq("organization_id", organizationId)
    .eq("batch_id", batchId)
    .neq("projection_status", "archived"));
}

function projectedFuelRows(organizationId: string, batchId: string) {
  return createClient().then((supabase) => supabase
    .from("amazon_fuel_expense_projections")
    .select("transaction_line_id, expense_id, source_revision, source_fingerprint, projection_status, projection_snapshot, fuel_import_transaction_lines!inner(id, product_type_normalized, quantity, discount_amount, charged_amount, fuel_import_transactions!inner(transaction_at, invoice_number, source_transaction_fingerprint)), expenses!inner(id, date, amount, category, deduct_from_settlement, deduct_from_driver, deduct_from_owner, deduct_from_investor)")
    .eq("organization_id", organizationId)
    .eq("batch_id", batchId)
    .neq("projection_status", "archived"));
}

function revenueSourceViews(rows: Array<Record<string, unknown>>): CandidateEditorView["revenueSources"] {
  return rows.map((row) => {
    const load = firstRelated(row.loads);
    const revenue = firstRelated(row.amazon_revenue_items);
    const vehicle = firstRelated(load.vehicles);
    return {
      revenueItemId: String(row.revenue_item_id),
      loadId: String(row.load_id),
      serviceDateRange: `${stringOrNull(revenue.start_date) ?? "open"} - ${stringOrNull(revenue.end_date) ?? "open"}`,
      routeDisplay: stringOrNull(load.route) ?? "Pending Review",
      unitDisplay: stringOrNull(vehicle.unit_number) ?? "Pending Review",
      miles: nullableNumber(revenue.distance ?? load.total_miles),
      baseAmount: numberValue(revenue.base_amount),
      fuelSurchargeAmount: numberValue(revenue.fuel_surcharge_amount),
      tollAmount: numberValue(revenue.toll_amount),
      detentionAmount: numberValue(revenue.detention_amount),
      tonuAmount: numberValue(revenue.tonu_amount),
      otherAmount: numberValue(revenue.other_amount),
      grossAmount: numberValue(revenue.gross_amount ?? load.gross_amount),
      projectionStatus: String(row.projection_status ?? "unknown"),
      settlementEligible: String(load.status ?? "") !== "pending" && row.projection_status === "projected",
      sourceRevisionStatus: "current",
    };
  });
}

function fuelSourceViews(rows: Array<Record<string, unknown>>): CandidateEditorView["fuelSources"] {
  return rows.map((row) => {
    const line = firstRelated(row.fuel_import_transaction_lines);
    const transaction = firstRelated(line.fuel_import_transactions);
    const expense = firstRelated(row.expenses);
    const snapshot = safeSnapshot(row.projection_snapshot);
    return {
      transactionLineId: String(row.transaction_line_id),
      expenseId: String(row.expense_id),
      transactionDate: stringOrNull(transaction.transaction_at)?.slice(0, 10) ?? stringOrNull(expense.date),
      maskedTransactionReference: maskReference(stringOrNull(transaction.invoice_number) ?? stringOrNull(transaction.source_transaction_fingerprint) ?? "fuel"),
      product: String(line.product_type_normalized ?? expense.category ?? "fuel"),
      quantity: nullableNumber(line.quantity),
      chargedAmount: numberValue(line.charged_amount ?? expense.amount),
      discountAmount: nullableNumber(line.discount_amount),
      assignmentStatus: expense.deduct_from_settlement || expense.deduct_from_driver || expense.deduct_from_owner || expense.deduct_from_investor ? "deduction_ready" : "projected_only",
      deductionReady: expense.deduct_from_settlement === true || expense.deduct_from_driver === true || expense.deduct_from_owner === true || expense.deduct_from_investor === true,
      placeholder: snapshot.placeholder === true,
      sourceRevisionStatus: "current",
    };
  });
}

async function candidateRevenueSelections(organizationId: string, batchId: string, selectedRevenueItemIds: string[]): Promise<CandidateRevenueSelection[]> {
  assertWorkflow(selectedRevenueItemIds.length > 0, {
    code: "missing_revenue_selection",
    message: "Select at least one projected revenue item.",
    stage: "compile_candidates",
  });
  assertUnique(selectedRevenueItemIds, "duplicate_revenue_source");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("amazon_revenue_load_projections")
    .select("revenue_item_id, load_id, source_revision, source_fingerprint, projection_snapshot, loads!inner(id, gross_amount, delivery_date, status, vehicle_id, driver_id)")
    .eq("organization_id", organizationId)
    .eq("batch_id", batchId)
    .eq("projection_status", "projected")
    .in("revenue_item_id", selectedRevenueItemIds);
  if (error) throw new Error(error.message);
  assertWorkflow((data ?? []).length === selectedRevenueItemIds.length, {
    code: "invalid_revenue_selection",
    message: "One or more selected revenue sources are unavailable.",
    stage: "compile_candidates",
  });
  return (data ?? []).map((row, index) => {
    const load = firstRelated(row.loads);
    return {
      revenueItemId: String(row.revenue_item_id),
      organizationId,
      sourceRevision: String(row.source_revision),
      sourceFingerprint: String(row.source_fingerprint),
      allocatedGrossAmount: numberValue(load.gross_amount),
      projectionStatus: "projected",
      projectedLoad: {
        id: String(row.load_id),
        organizationId,
        status: String(load.status ?? "pending"),
        vehicleId: stringOrNull(load.vehicle_id),
        driverId: stringOrNull(load.driver_id),
        deliveryDate: stringOrNull(load.delivery_date),
        grossAmount: numberValue(load.gross_amount),
      },
      sourceSnapshot: safeSnapshot(row.projection_snapshot),
      displayOrder: index + 1,
    };
  });
}

async function candidateFuelSelections(
  organizationId: string,
  batchId: string,
  payeeType: CandidateCalculationConfig["payeeType"],
  selectedFuelLineIds: string[],
  fuelInclusionPolicy: CandidateCalculationConfig["fuelInclusionPolicy"],
): Promise<CandidateFuelSelection[]> {
  if (selectedFuelLineIds.length === 0) return [];
  assertUnique(selectedFuelLineIds, "duplicate_fuel_source");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("amazon_fuel_expense_projections")
    .select("transaction_line_id, expense_id, source_revision, source_fingerprint, projection_snapshot, expenses!inner(id, date, vehicle_id, driver_id, owner_id, category, amount, deduct_from_settlement, deduct_from_driver, deduct_from_owner, deduct_from_investor)")
    .eq("organization_id", organizationId)
    .eq("batch_id", batchId)
    .eq("projection_status", "projected")
    .in("transaction_line_id", selectedFuelLineIds);
  if (error) throw new Error(error.message);
  assertWorkflow((data ?? []).length === selectedFuelLineIds.length, {
    code: "invalid_fuel_selection",
    message: "One or more selected fuel lines are unavailable.",
    stage: "compile_candidates",
  });
  const lane = payeeType === "owner" ? "owner" : payeeType === "investor" ? "investor" : "driver";
  return (data ?? []).map((row, index) => {
    const expense = firstRelated(row.expenses);
    return {
      transactionLineId: String(row.transaction_line_id),
      organizationId,
      sourceRevision: String(row.source_revision),
      sourceFingerprint: String(row.source_fingerprint),
      transactionDate: stringOrNull(expense.date),
      reportPeriodStart: fuelInclusionPolicy === "fuel_report_period" ? stringOrNull(expense.date) : null,
      reportPeriodEnd: fuelInclusionPolicy === "fuel_report_period" ? stringOrNull(expense.date) : null,
      allocatedAmount: numberValue(expense.amount),
      projectionStatus: "projected",
      deductionLane: lane,
      projectedExpense: {
        id: String(row.expense_id),
        organizationId,
        date: stringOrNull(expense.date),
        vehicleId: stringOrNull(expense.vehicle_id),
        driverId: stringOrNull(expense.driver_id),
        ownerId: stringOrNull(expense.owner_id),
        category: String(expense.category ?? "fuel"),
        amount: numberValue(expense.amount),
        deductFromSettlement: expense.deduct_from_settlement === true,
        deductFromDriver: expense.deduct_from_driver === true,
        deductFromOwner: expense.deduct_from_owner === true,
        deductFromInvestor: expense.deduct_from_investor === true,
      },
      sourceSnapshot: safeSnapshot(row.projection_snapshot),
      displayOrder: index + 1,
    };
  });
}

async function assertPayeeAndLane(args: {
  organizationId: string;
  statementType: CandidateCalculationConfig["statementType"];
  payeeId?: string | null;
  vehicleId?: string | null;
}) {
  assertWorkflow(Boolean(args.payeeId), {
    code: "missing_payee",
    message: "Select an approved payee.",
    stage: "compile_candidates",
  });
  const supabase = await createClient();
  const { data: payee, error: payeeError } = await supabase
    .from("people")
    .select("id, type")
    .eq("organization_id", args.organizationId)
    .eq("id", args.payeeId)
    .single();
  if (payeeError) throw new Error(payeeError.message);
  if (args.statementType === "company_driver" || args.statementType === "box_truck_driver") {
    assertWorkflow(payee.type === "company_driver" || payee.type === "external_carrier_driver", {
      code: "invalid_accounting_lane",
      message: "Driver statement candidates require a driver payee.",
      stage: "compile_candidates",
    });
  }
  if (args.statementType === "owner_operator") {
    assertWorkflow(payee.type === "owner_operator", {
      code: "invalid_accounting_lane",
      message: "Owner-operator statement candidates require an owner-operator payee.",
      stage: "compile_candidates",
    });
  }
  if (args.statementType === "managed_investor") {
    assertWorkflow(payee.type === "investor", {
      code: "invalid_accounting_lane",
      message: "Managed investor statement candidates require an investor payee.",
      stage: "compile_candidates",
    });
  }
  if (args.vehicleId) {
    const { data: vehicle, error: vehicleError } = await supabase
      .from("vehicles")
      .select("id, vehicle_type, owner_id")
      .eq("organization_id", args.organizationId)
      .eq("id", args.vehicleId)
      .single();
    if (vehicleError) throw new Error(vehicleError.message);
    if (args.statementType === "box_truck_driver") {
      assertWorkflow(vehicle.vehicle_type === "box_truck", {
        code: "invalid_accounting_lane",
        message: "Box truck driver candidates require a box truck vehicle.",
        stage: "compile_candidates",
      });
    }
  }
}

function assertValidStatementType(value: string) {
  assertWorkflow(value === "company_driver" || value === "box_truck_driver" || value === "owner_operator" || value === "managed_investor", {
    code: "invalid_statement_type",
    message: "Select a supported Amazon statement type.",
    stage: "compile_candidates",
  });
}

function assertUnique(values: string[], code: string) {
  assertWorkflow(new Set(values).size === values.length, {
    code,
    message: "A source row was selected more than once.",
    stage: "compile_candidates",
  });
}

function maskReference(value: string): string {
  if (value.length <= 4) return "****";
  return `${value.slice(0, 2)}...${value.slice(-4)}`;
}

function safeSnapshot(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function firstRelated(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) return value[0] && typeof value[0] === "object" ? value[0] as Record<string, unknown> : {};
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function fuelProduct(value: unknown): "ULSD" | "DEF" | "FUEL" | "FEE" | "OTHER" {
  return value === "ULSD" || value === "DEF" || value === "FUEL" || value === "FEE" || value === "OTHER" ? value : "FUEL";
}

function validStatementType(value: unknown): CandidateCalculationConfig["statementType"] | null {
  return value === "company_driver" || value === "box_truck_driver" || value === "owner_operator" || value === "managed_investor" ? value : null;
}

function validPayeeType(value: unknown): CandidateCalculationConfig["payeeType"] | null {
  return value === "driver" || value === "owner" || value === "investor" ? value : null;
}

function validFuelPolicy(value: unknown): NonNullable<CandidateCalculationConfig["fuelInclusionPolicy"]> | "no_fuel" {
  return value === "fuel_report_period" || value === "manual_reviewed_selection" || value === "transaction_date_in_period" ? value : "transaction_date_in_period";
}

function validLanguage(value: unknown): "en" | "tr" | "en_tr" {
  return value === "en" || value === "tr" || value === "en_tr" ? value : "en_tr";
}
