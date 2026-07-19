import "server-only";

import { createClient } from "@/lib/supabase/server";
import { requireAmazonImportActor } from "./auth";
import { throwAmazonUiReadError } from "./read-errors";
import { safeProfileName } from "../ui-safe";
import type { AmazonImportSourceType } from "../types";

export type AmazonUiRole = "viewer" | "writer";
export type WorkflowStageState = "not_started" | "in_progress" | "completed" | "needs_review" | "blocked" | "failed";

export interface AmazonImportListItem {
  id: string;
  period: string;
  status: string;
  sourceFileCompleteness: string;
  paymentReconciliationStatus: string;
  fuelReconciliationStatus: string;
  blockingIssueCount: number;
  warningCount: number;
  canonicalRevenueTotal: number;
  projectedLoadCount: number;
  projectedFuelExpenseCount: number;
  candidateCount: number;
  lastUpdated: string | null;
  creator: string;
}

export interface AmazonSourceFileView {
  id: string;
  sourceType: AmazonImportSourceType;
  label: string;
  sanitizedFilename: string;
  verifiedSizeBytes: number;
  status: string;
  parserName: string | null;
  parserVersion: string | null;
  schemaStatus: "not_inspected" | "compatible" | "warning" | "failed";
  warningCount: number;
  blockingCount: number;
  uploadedAt: string | null;
}

export interface AmazonWorkflowStepView {
  key: string;
  label: string;
  state: WorkflowStageState;
  detail: string;
}

export interface AmazonBatchDetailView {
  id: string;
  status: string;
  period: string;
  notes: string | null;
  role: AmazonUiRole;
  archived: boolean;
  files: AmazonSourceFileView[];
  workflow: AmazonWorkflowStepView[];
  requiredFilesPresent: boolean;
  canMutate: boolean;
  canParse: boolean;
  reconciliation: {
    revenue: Record<string, number | string>;
    fuel: Record<string, number | string>;
  };
  issues: Array<{
    category: string;
    label: string;
    uniqueRootCount: number;
    affectedDependencyCount: number;
    severity: "warning" | "blocking" | "info";
  }>;
  referenceReadiness: {
    revenue: Record<string, number>;
    fuel: Record<string, number>;
    unresolved: Record<string, number>;
  };
  projection: {
    revenue: Record<string, number | string>;
    fuel: Record<string, number | string>;
  };
  candidates: Array<{
    id: string;
    statementType: string;
    period: string;
    payeeDisplay: string;
    unitDisplay: string;
    selectedRevenueCount: number;
    gross: number;
    selectedFuelAmount: number;
    totalDeductions: number;
    net: number;
    status: string;
    blockingIssueCount: number;
    warningCount: number;
    templateVersion: string;
    calculationRevision: string;
    previewRevision: string;
    approvedAt: string | null;
    lastCalculatedAt: string | null;
    settlementId: string | null;
  }>;
  history: Array<{
    action: string;
    actor: string;
    time: string | null;
    result: string;
    reason: string | null;
  }>;
}

const SOURCE_LABELS: Record<AmazonImportSourceType, string> = {
  amazon_payment: "Amazon Payment",
  amazon_trips: "Amazon Trips",
  fuel_card: "Fuel Card Report",
  statement_reference: "Statement Reference",
};

const REQUIRED_SOURCE_TYPES: AmazonImportSourceType[] = ["amazon_payment", "amazon_trips", "fuel_card"];

export async function listAmazonImportBatchesForUi(filters: {
  status?: string;
  period?: string;
  needsReview?: boolean;
  ready?: boolean;
  archived?: boolean;
} = {}): Promise<{ role: AmazonUiRole; rows: AmazonImportListItem[] }> {
  const actor = await requireAmazonImportActor();
  const supabase = await createClient();
  let query = supabase
    .from("amazon_import_batches")
    .select("id, status, period_start, period_end, updated_at, created_at, created_by, creator:profiles!amazon_import_batches_created_by_same_org_fk(full_name)")
    .order("updated_at", { ascending: false })
    .limit(50);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.needsReview) query = query.eq("status", "needs_review");
  if (filters.ready) query = query.eq("status", "ready");
  if (filters.archived === true) query = query.eq("status", "archived");
  if (filters.archived === false) query = query.neq("status", "archived");
  if (filters.period) {
    query = query.or(`period_start.eq.${filters.period},period_end.eq.${filters.period}`);
  }
  const { data: batches, error } = await query;
  if (error) throwAmazonUiReadError("list_amazon_import_batches", error);
  const ids = (batches ?? []).map((row) => String(row.id));
  const [files, issues, reconciliations, revenueItems, revenueProjections, fuelProjections, candidates] = await Promise.all([
    ids.length ? supabase.from("amazon_import_files").select("batch_id, source_type, status").in("batch_id", ids) : emptyResult(),
    ids.length ? supabase.from("amazon_import_issues").select("batch_id, severity, status").in("batch_id", ids).eq("status", "open") : emptyResult(),
    ids.length ? supabase.from("amazon_import_reconciliations").select("batch_id, reconciliation_type, status, actual_amount, details").in("batch_id", ids) : emptyResult(),
    ids.length ? supabase.from("amazon_revenue_items").select("batch_id, gross_amount").in("batch_id", ids) : emptyResult(),
    ids.length ? supabase.from("amazon_revenue_load_projections").select("batch_id, projection_status").in("batch_id", ids) : emptyResult(),
    ids.length ? supabase.from("amazon_fuel_expense_projections").select("batch_id, projection_status").in("batch_id", ids) : emptyResult(),
    ids.length ? supabase.from("amazon_statement_candidates").select("batch_id, id").in("batch_id", ids) : emptyResult(),
  ]);
  for (const result of [files, issues, reconciliations, revenueItems, revenueProjections, fuelProjections, candidates]) {
    if ("error" in result && result.error) throwAmazonUiReadError("list_amazon_import_batch_rollups", result.error);
  }
  return {
    role: actor.access,
    rows: (batches ?? []).map((batch) => {
      const batchId = String(batch.id);
      const batchFiles = rowsFor(files, batchId);
      const batchIssues = rowsFor(issues, batchId);
      const batchReconciliations = rowsFor(reconciliations, batchId);
      const revenueRows = rowsFor(revenueItems, batchId);
      return {
        id: batchId,
        period: formatPeriod(batch.period_start, batch.period_end),
        status: String(batch.status),
        sourceFileCompleteness: `${new Set(batchFiles.map((file) => file.source_type)).size}/4`,
        paymentReconciliationStatus: revenueDisplayStatus(batchReconciliations),
        fuelReconciliationStatus: latestStatus(batchReconciliations, "fuel_report"),
        blockingIssueCount: batchIssues.filter((issue) => issue.severity === "blocking").length,
        warningCount: batchIssues.filter((issue) => issue.severity === "warning").length,
        canonicalRevenueTotal: revenueRows.reduce((sum, row) => sum + Number(row.gross_amount ?? 0), 0),
        projectedLoadCount: rowsFor(revenueProjections, batchId).filter((row) => row.projection_status !== "archived").length,
        projectedFuelExpenseCount: rowsFor(fuelProjections, batchId).filter((row) => row.projection_status !== "archived").length,
        candidateCount: rowsFor(candidates, batchId).length,
        lastUpdated: batch.updated_at ?? batch.created_at ?? null,
        creator: safeProfileName(batch.creator),
      };
    }),
  };
}

export async function getAmazonImportBatchDetailForUi(batchId: string): Promise<AmazonBatchDetailView | null> {
  const actor = await requireAmazonImportActor();
  const supabase = await createClient();
  const { data: batch, error } = await supabase
    .from("amazon_import_batches")
    .select("id, status, period_start, period_end, notes")
    .eq("id", batchId)
    .maybeSingle();
  if (error) throwAmazonUiReadError("get_amazon_import_batch", error);
  if (!batch) return null;
  const [
    files,
    issues,
    reconciliations,
    paymentInvoices,
    paymentRows,
    revenueItems,
    matches,
    fuelReports,
    fuelTransactions,
    fuelLines,
    revenueProjections,
    fuelProjections,
    candidates,
    candidateRevenue,
    candidateFuel,
    reviewDecisions,
  ] = await Promise.all([
    supabase.from("amazon_import_files").select("id, source_type, original_filename, size_bytes, status, parser_name, parser_version, schema_signature, created_at").eq("batch_id", batchId).order("created_at"),
    supabase.from("amazon_import_issues").select("issue_code, severity, status, details").eq("batch_id", batchId).eq("status", "open"),
    supabase.from("amazon_import_reconciliations").select("reconciliation_type, expected_amount, actual_amount, expected_count, actual_count, status, details").eq("batch_id", batchId),
    supabase.from("amazon_payment_invoices").select("summary_total").eq("batch_id", batchId),
    supabase.from("amazon_payment_rows").select("row_classification, parse_status, gross_amount").eq("batch_id", batchId).not("gross_amount", "is", null),
    supabase.from("amazon_revenue_items").select("id, gross_amount").eq("batch_id", batchId),
    supabase.from("amazon_import_matches").select("status, match_method").eq("batch_id", batchId),
    supabase.from("fuel_import_reports").select("reported_transaction_count, reported_total_amount, reported_total_quantity, reported_discount_amount").eq("batch_id", batchId),
    supabase.from("fuel_import_transactions").select("id, report_id, report:fuel_import_reports!fuel_import_transactions_report_same_org_fk!inner(batch_id)").eq("report.batch_id", batchId),
    supabase.from("fuel_import_transaction_lines").select("charged_amount, quantity, discount_amount, transaction:fuel_import_transactions!fuel_import_transaction_lines_transaction_same_org_fk!inner(report:fuel_import_reports!fuel_import_transactions_report_same_org_fk!inner(batch_id))").eq("transaction.report.batch_id", batchId),
    supabase.from("amazon_revenue_load_projections").select("projection_status, projection_snapshot").eq("batch_id", batchId),
    supabase.from("amazon_fuel_expense_projections").select("projection_status, projection_snapshot").eq("batch_id", batchId),
    supabase.from("amazon_statement_candidates").select("id, statement_type, status, period_start, period_end, payee_id, people!amazon_statement_candidates_payee_same_org_fk(full_name), vehicle_id, vehicles!amazon_statement_candidates_vehicle_same_org_fk(unit_number), gross_amount, total_deductions_amount, fuel_deductions_amount, net_amount, template_version, calculation_rule_version, preview_revision, approved_at, updated_at, converted_settlement_id, last_error").eq("batch_id", batchId).order("updated_at", { ascending: false }),
    supabase.from("amazon_statement_candidate_revenue").select("candidate_id, allocated_gross_amount").eq("organization_id", actor.organizationId),
    supabase.from("amazon_statement_candidate_fuel_lines").select("candidate_id, allocated_amount").eq("organization_id", actor.organizationId),
    supabase.from("amazon_import_review_decisions").select("decision_type, reason, decided_at, reviewer:profiles!amazon_import_review_decisions_decided_by_same_org_fk(full_name)").eq("batch_id", batchId).order("decided_at", { ascending: false }).limit(25),
  ]);
  for (const result of [files, issues, reconciliations, paymentInvoices, paymentRows, revenueItems, matches, fuelReports, fuelTransactions, fuelLines, revenueProjections, fuelProjections, candidates, candidateRevenue, candidateFuel, reviewDecisions]) {
    if (result.error) throwAmazonUiReadError("get_amazon_import_batch_detail", result.error);
  }
  const fileViews = (files.data ?? []).map((file) => fileView(file, issues.data ?? []));
  const issueViews = issueSummary(issues.data ?? []);
  const requiredFilesPresent = REQUIRED_SOURCE_TYPES.every((sourceType) => fileViews.some((file) => file.sourceType === sourceType && file.status !== "failed"));
  const parsedRequiredFiles = REQUIRED_SOURCE_TYPES.every((sourceType) => fileViews.some((file) => file.sourceType === sourceType && file.status === "parsed"));
  const blockingIssues = (issues.data ?? []).filter((issue) => issue.severity === "blocking").length;
  const warnings = (issues.data ?? []).filter((issue) => issue.severity === "warning").length;
  const revenueRows = revenueItems.data ?? [];
  const reconciliationRows = reconciliations.data ?? [];
  const validFinancialPaymentTotal = authoritativeValidPaymentTotal(reconciliationRows, paymentRows.data ?? []);
  const summaryInvoiceTotal = authoritativeSummaryInvoiceTotal(reconciliationRows, paymentInvoices.data ?? []);
  const canonicalTotal = revenueRows.reduce((sum, row) => sum + Number(row.gross_amount ?? 0), 0);
  const matchRows = matches.data ?? [];
  const fuelReport = (fuelReports.data ?? [])[0] ?? {};
  const fuelLineRows = fuelLines.data ?? [];
  const projectedRevenue = revenueProjections.data ?? [];
  const projectedFuel = fuelProjections.data ?? [];
  return {
    id: String(batch.id),
    status: String(batch.status),
    period: formatPeriod(batch.period_start, batch.period_end),
    notes: batch.notes ?? null,
    role: actor.access,
    archived: batch.status === "archived",
    files: fileViews,
    workflow: workflowSteps({
      status: String(batch.status),
      filesPresent: requiredFilesPresent,
      parsedRequiredFiles,
      blockingIssues,
      warnings,
      revenueReconciliationStatus: latestCurrentStatus(reconciliationRows, "amazon_revenue"),
      paymentInvoiceStatus: latestCurrentStatus(reconciliationRows, "payment_invoice_total"),
      matchCount: matchRows.length,
      canonicalRevenueItemCount: revenueRows.length,
      ambiguousOrUnmatchedMatches: matchRows.filter((row) => row.status === "ambiguous" || row.status === "unmatched").length,
      projectedRevenueCount: projectedRevenue.length,
      projectedFuelCount: projectedFuel.length,
      candidateCount: candidates.data?.length ?? 0,
    }),
    requiredFilesPresent,
    canMutate: actor.access === "writer" && batch.status !== "archived",
    canParse: actor.access === "writer" && batch.status !== "archived" && requiredFilesPresent && !parsedRequiredFiles,
    reconciliation: {
      revenue: {
        summaryInvoiceTotal,
        validPaymentRowTotal: validFinancialPaymentTotal,
        canonicalRevenueTotal: canonicalTotal,
        unassignedRevenue: Math.max(0, round2(validFinancialPaymentTotal - canonicalTotal)),
        status: revenueDisplayStatus(reconciliationRows),
        canonicalRevenueItemCount: revenueRows.length,
        exact: matchRows.filter((row) => row.status === "exact").length,
        inferred: matchRows.filter((row) => row.status === "inferred").length,
        ambiguous: matchRows.filter((row) => row.status === "ambiguous").length,
        unmatched: matchRows.filter((row) => row.status === "unmatched").length,
      },
      fuel: {
        reportedTransactionCount: Number(fuelReport.reported_transaction_count ?? 0),
        realParsedTransactionCount: fuelTransactions.data?.length ?? 0,
        productLineCount: fuelLineRows.length,
        reportedAmount: Number(fuelReport.reported_total_amount ?? 0),
        calculatedAmount: fuelLineRows.reduce((sum, row) => sum + Number(row.charged_amount ?? 0), 0),
        quantityStatus: reconciliationStatus(reconciliations.data ?? [], "fuel_quantity"),
        discountStatus: reconciliationStatus(reconciliations.data ?? [], "fuel_discount"),
        financialStatus: latestStatus(reconciliations.data ?? [], "fuel_report"),
        transactionCountStatus: transactionCountStatus(reconciliations.data ?? []),
      },
    },
    issues: issueViews,
    referenceReadiness: referenceReadiness(issueViews, revenueRows.length, fuelReport ? 1 : 0),
    projection: {
      revenue: {
        eligibleCanonicalItemCount: revenueRows.length,
        prospectiveLoadCount: projectedRevenue.length,
        grossAmount: projectedRevenue.reduce((sum, row) => sum + projectionSnapshotAmount(row, "gross_amount"), 0),
        alreadyProjectedAmount: projectedRevenue.reduce((sum, row) => sum + projectionSnapshotAmount(row, "gross_amount"), 0),
        unchangedCount: projectedRevenue.filter((row) => row.projection_status === "projected").length,
        conflictCount: projectedRevenue.filter((row) => row.projection_status === "conflict").length,
        skippedCount: projectedRevenue.filter((row) => row.projection_status === "archived").length,
        notSettlementReadyCount: projectedRevenue.filter((row) => row.projection_status !== "projected").length,
        previewRevision: shortRevision(projectedRevenue.map((row) => `${row.projection_status}:${projectionSnapshotAmount(row, "gross_amount")}`).join("|")),
      },
      fuel: {
        eligibleProductLineCount: fuelLineRows.length,
        prospectiveExpenseCount: projectedFuel.length,
        amount: projectedFuel.reduce((sum, row) => sum + projectionSnapshotAmount(row, "amount"), 0),
        placeholderSkips: projectedFuel.filter((row) => (row.projection_snapshot as Record<string, unknown> | null)?.placeholder === true).length,
        creditRefundIssues: projectedFuel.filter((row) => projectionSnapshotAmount(row, "amount") < 0).length,
        unchangedCount: projectedFuel.filter((row) => row.projection_status === "projected").length,
        conflictCount: projectedFuel.filter((row) => row.projection_status === "conflict").length,
        notDeductionReadyCount: projectedFuel.filter((row) => row.projection_status !== "projected").length,
        previewRevision: shortRevision(projectedFuel.map((row) => `${row.projection_status}:${projectionSnapshotAmount(row, "amount")}`).join("|")),
      },
    },
    candidates: (candidates.data ?? []).map((candidate) => ({
      id: String(candidate.id),
      statementType: String(candidate.statement_type),
      period: formatPeriod(candidate.period_start, candidate.period_end),
      payeeDisplay: safeProfileName(candidate.people),
      unitDisplay: safeUnit(candidate.vehicles),
      selectedRevenueCount: rowsForCandidate(candidateRevenue.data ?? [], String(candidate.id)).length,
      gross: Number(candidate.gross_amount ?? 0),
      selectedFuelAmount: rowsForCandidate(candidateFuel.data ?? [], String(candidate.id)).reduce((sum, row) => sum + Number(row.allocated_amount ?? 0), 0),
      totalDeductions: Number(candidate.total_deductions_amount ?? 0),
      net: Number(candidate.net_amount ?? 0),
      status: String(candidate.status),
      blockingIssueCount: issueCount(candidate.last_error, "blockingIssueCodes"),
      warningCount: issueCount(candidate.last_error, "warningIssueCodes"),
      templateVersion: String(candidate.template_version ?? "unknown"),
      calculationRevision: String(candidate.calculation_rule_version ?? "unknown"),
      previewRevision: String(candidate.preview_revision ?? ""),
      approvedAt: candidate.approved_at ?? null,
      lastCalculatedAt: candidate.updated_at ?? null,
      settlementId: candidate.converted_settlement_id ?? null,
    })),
    history: [
      ...fileViews.map((file) => ({
        action: `${file.label} upload`,
        actor: "-",
        time: file.uploadedAt,
        result: file.status,
        reason: null,
      })),
      ...(reviewDecisions.data ?? []).map((decision) => ({
        action: String(decision.decision_type ?? "review"),
        actor: safeProfileName(decision.reviewer),
        time: decision.decided_at ?? null,
        result: "recorded",
        reason: stringOrNull(decision.reason),
      })),
      ...(candidates.data ?? []).map((candidate) => ({
        action: `candidate_${candidate.status}`,
        actor: "-",
        time: candidate.updated_at ?? null,
        result: candidate.converted_settlement_id ? "converted" : String(candidate.status),
        reason: null,
      })),
    ].sort((a, b) => String(b.time ?? "").localeCompare(String(a.time ?? ""))).slice(0, 40),
  };
}

function emptyResult() {
  return Promise.resolve({ data: [], error: null });
}

function rowsFor(result: { data?: Array<Record<string, unknown>> | null }, batchId: string) {
  return (result.data ?? []).filter((row) => String(row.batch_id) === batchId);
}

function rowsForCandidate(rows: Array<Record<string, unknown>>, candidateId: string) {
  return rows.filter((row) => String(row.candidate_id) === candidateId);
}

function safeUnit(value: unknown): string {
  if (!value || typeof value !== "object") return "-";
  const unit = (value as { unit_number?: unknown }).unit_number;
  return typeof unit === "string" && unit.trim() ? unit : "-";
}

function formatPeriod(start: string | null | undefined, end: string | null | undefined) {
  if (!start && !end) return "No period";
  if (start === end) return start ?? "No period";
  return `${start ?? "open"} - ${end ?? "open"}`;
}

function fileView(file: Record<string, unknown>, issues: Array<Record<string, unknown>>): AmazonSourceFileView {
  const sourceType = file.source_type as AmazonImportSourceType;
  const fileIssues = issues.filter((issue) => String(issue.details ?? "").includes(String(file.id)));
  const warningCount = fileIssues.filter((issue) => issue.severity === "warning").length;
  const blockingCount = fileIssues.filter((issue) => issue.severity === "blocking").length;
  return {
    id: String(file.id),
    sourceType,
    label: SOURCE_LABELS[sourceType],
    sanitizedFilename: String(file.original_filename ?? "upload"),
    verifiedSizeBytes: Number(file.size_bytes ?? 0),
    status: String(file.status ?? "uploaded"),
    parserName: stringOrNull(file.parser_name),
    parserVersion: stringOrNull(file.parser_version),
    schemaStatus: file.schema_signature ? (blockingCount > 0 ? "failed" : warningCount > 0 ? "warning" : "compatible") : "not_inspected",
    warningCount,
    blockingCount,
    uploadedAt: stringOrNull(file.created_at),
  };
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value ? value : null;
}

function latestStatus(rows: Array<Record<string, unknown>>, type: string) {
  return String(rows.find((row) => row.reconciliation_type === type)?.status ?? "not_started");
}

function latestCurrentStatus(rows: Array<Record<string, unknown>>, type: string) {
  const typed = rows.filter((row) => row.reconciliation_type === type);
  const current = typed.find((row) => (row.details as Record<string, unknown> | null)?.current === true);
  return String((current ?? typed[0])?.status ?? "not_started");
}

function revenueDisplayStatus(rows: Array<Record<string, unknown>>) {
  const revenueStatus = latestCurrentStatus(rows, "amazon_revenue");
  return revenueStatus === "not_started" ? latestCurrentStatus(rows, "payment_invoice_total") : revenueStatus;
}

function reconciliationStatus(rows: Array<Record<string, unknown>>, type: string) {
  return String(rows.find((row) => row.reconciliation_type === type)?.status ?? "not_started");
}

function reconciliationAmount(rows: Array<Record<string, unknown>>, type: string, side: "expected" | "actual") {
  const row = rows.find((item) => item.reconciliation_type === type);
  return Number(row?.[side === "expected" ? "expected_amount" : "actual_amount"] ?? 0);
}

function authoritativeSummaryInvoiceTotal(reconciliations: Array<Record<string, unknown>>, invoices: Array<Record<string, unknown>>) {
  const paymentSummary = reconciliationAmountOrNull(reconciliations, "payment_invoice_total", "expected");
  if (paymentSummary !== null) return paymentSummary;
  const invoiceSummary = invoices.find((invoice) => invoice.summary_total !== null && invoice.summary_total !== undefined);
  return Number(invoiceSummary?.summary_total ?? 0);
}

function authoritativeValidPaymentTotal(reconciliations: Array<Record<string, unknown>>, paymentRows: Array<Record<string, unknown>>) {
  const paymentActual = reconciliationAmountOrNull(reconciliations, "payment_invoice_total", "actual");
  if (paymentActual !== null) return paymentActual;
  return round2(paymentRows.filter(isValidFinancialPaymentRow).reduce((sum, row) => sum + Number(row.gross_amount ?? 0), 0));
}

function reconciliationAmountOrNull(rows: Array<Record<string, unknown>>, type: string, side: "expected" | "actual") {
  const row = rows.find((item) => item.reconciliation_type === type);
  const value = row?.[side === "expected" ? "expected_amount" : "actual_amount"];
  return value === null || value === undefined ? null : Number(value);
}

function isValidFinancialPaymentRow(row: Record<string, unknown>) {
  return (row.row_classification === "trip_parent" || row.row_classification === "load_child" || row.row_classification === "standalone_load")
    && (row.parse_status === "parsed" || row.parse_status === "warning");
}

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function transactionCountStatus(rows: Array<Record<string, unknown>>) {
  const fuel = rows.find((row) => row.reconciliation_type === "fuel_report");
  if (!fuel) return "not_started";
  return Number(fuel.expected_count ?? 0) === Number(fuel.actual_count ?? 0) ? "passed" : "warning";
}

function issueSummary(rows: Array<Record<string, unknown>>) {
  const categories = [
    ["parser", "Parser"],
    ["schema", "Schema"],
    ["matching", "Matching"],
    ["reconciliation", "Reconciliation"],
    ["driver", "Driver mapping"],
    ["vehicle", "Vehicle mapping"],
    ["facility", "Facility mapping"],
    ["fuel_assignment", "Fuel assignment"],
    ["team_split", "Team split"],
    ["projection", "Projection conflict"],
    ["candidate", "Candidate readiness"],
  ] as const;
  return categories.map(([category, label]) => {
    const matches = rows.filter((row) => issueCategory(String(row.issue_code ?? "")) === category);
    const roots = new Set(matches.map((row) => {
      const details = row.details as Record<string, unknown> | null;
      return String(details?.rootIssueKey ?? details?.issueKey ?? row.issue_code);
    }));
    return {
      category,
      label,
      uniqueRootCount: roots.size,
      affectedDependencyCount: matches.length,
      severity: matches.some((row) => row.severity === "blocking") ? "blocking" as const : matches.some((row) => row.severity === "warning") ? "warning" as const : "info" as const,
    };
  });
}

function issueCategory(code: string) {
  if (code.includes("schema")) return "schema";
  if (code.includes("match")) return "matching";
  if (code.includes("reconciliation")) return "reconciliation";
  if (code.includes("driver")) return "driver";
  if (code.includes("vehicle")) return "vehicle";
  if (code.includes("facility")) return "facility";
  if (code.includes("fuel_assignment") || code.includes("fuel")) return "fuel_assignment";
  if (code.includes("team")) return "team_split";
  if (code.includes("projection")) return "projection";
  if (code.includes("candidate")) return "candidate";
  return "parser";
}

function referenceReadiness(issues: AmazonBatchDetailView["issues"], revenueCount: number, fuelCount: number) {
  const unresolved = {
    drivers: countCategory(issues, "driver"),
    vehicles: countCategory(issues, "vehicle"),
    facilities: countCategory(issues, "facility"),
    fuelAssignments: countCategory(issues, "fuel_assignment"),
    teamRules: countCategory(issues, "team_split"),
  };
  const referenceBlockers = Object.values(unresolved).reduce((sum, value) => sum + value, 0);
  return {
    revenue: {
      canonicalReady: revenueCount,
      projectionReady: revenueCount,
      settlementReady: referenceBlockers === 0 ? revenueCount : 0,
      statementDisplayReady: unresolved.facilities === 0 ? revenueCount : 0,
    },
    fuel: {
      sourceReady: fuelCount,
      expenseProjectionReady: fuelCount,
      settlementDeductionReady: unresolved.fuelAssignments === 0 ? fuelCount : 0,
    },
    unresolved,
  };
}

function countCategory(issues: AmazonBatchDetailView["issues"], category: string) {
  return issues.find((issue) => issue.category === category)?.uniqueRootCount ?? 0;
}

function issueCount(value: unknown, key: "blockingIssueCodes" | "warningIssueCodes") {
  if (!value || typeof value !== "object") return 0;
  const list = (value as Record<string, unknown>)[key];
  return Array.isArray(list) ? list.length : 0;
}

function projectionSnapshotAmount(row: Record<string, unknown>, key: "gross_amount" | "amount") {
  const snapshot = row.projection_snapshot as Record<string, unknown> | null;
  const nested = key === "gross_amount"
    ? snapshot?.load as Record<string, unknown> | undefined
    : snapshot?.expense as Record<string, unknown> | undefined;
  return Number(nested?.[key] ?? 0);
}

function shortRevision(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(16).padStart(8, "0").slice(0, 8);
}

function workflowSteps(args: {
  status: string;
  filesPresent: boolean;
  parsedRequiredFiles: boolean;
  blockingIssues: number;
  warnings: number;
  revenueReconciliationStatus: string;
  paymentInvoiceStatus: string;
  matchCount: number;
  canonicalRevenueItemCount: number;
  ambiguousOrUnmatchedMatches: number;
  projectedRevenueCount: number;
  projectedFuelCount: number;
  candidateCount: number;
}): AmazonWorkflowStepView[] {
  const failed = args.status === "failed";
  const financialReconciliationStarted = args.paymentInvoiceStatus !== "not_started" || args.revenueReconciliationStatus !== "not_started";
  const financialReconciliationPassed = (args.paymentInvoiceStatus === "passed" || args.paymentInvoiceStatus === "warning") && args.revenueReconciliationStatus === "passed";
  const matchingStarted = args.matchCount > 0 || args.canonicalRevenueItemCount > 0 || args.revenueReconciliationStatus !== "not_started";
  const matchingNeedsReview = args.ambiguousOrUnmatchedMatches > 0 || args.revenueReconciliationStatus === "failed" || args.blockingIssues > 0;
  const matchingCompleted = args.matchCount > 0 && args.canonicalRevenueItemCount > 0 && args.revenueReconciliationStatus === "passed";
  const referencesReady = matchingCompleted && !matchingNeedsReview;
  const projectionReady = referencesReady && args.projectedRevenueCount + args.projectedFuelCount > 0;
  return [
    { key: "files", label: "Files", state: args.filesPresent ? "completed" : failed ? "failed" : "in_progress", detail: args.filesPresent ? "Required source files are present." : "Upload required source files." },
    { key: "parsing", label: "Parsing", state: failed ? "failed" : args.parsedRequiredFiles ? "completed" : "not_started", detail: args.parsedRequiredFiles ? "Required files parsed." : "Parsing has not completed." },
    { key: "reconciliation", label: "Reconciliation", state: !financialReconciliationStarted ? "not_started" : financialReconciliationPassed ? "completed" : args.blockingIssues > 0 || args.revenueReconciliationStatus === "failed" ? "blocked" : "needs_review", detail: financialReconciliationPassed ? "Financial reconciliation passed." : financialReconciliationStarted ? "Financial reconciliation needs review." : "Run reconciliation after parsing." },
    { key: "matching", label: "Matching", state: !matchingStarted ? "not_started" : matchingNeedsReview ? "needs_review" : matchingCompleted ? "completed" : "in_progress", detail: matchingCompleted ? "Payment and trip matches were persisted." : "Run matching/reconciliation to persist canonical revenue." },
    { key: "references", label: "References", state: referencesReady ? "in_progress" : "blocked", detail: "Reference readiness depends on persisted canonical revenue." },
    { key: "projection", label: "Projection", state: projectionReady ? "completed" : referencesReady ? "not_started" : "blocked", detail: "Projection requires passed revenue reconciliation and canonical revenue." },
    { key: "candidates", label: "Candidates", state: args.candidateCount > 0 ? "needs_review" : projectionReady ? "not_started" : "blocked", detail: "Statement candidate creation, approval, and conversion." },
    { key: "statements", label: "Statements", state: args.candidateCount > 0 ? "in_progress" : "blocked", detail: "Server-rendered statement preview/download." },
  ];
}
