import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AmazonParsedSourceRow, AmazonPaymentDetailFields, AmazonTripsRowFields } from "../types";
import { matchPaymentTrips } from "./payment-trip-matcher";
import { buildAmazonRevenueItems } from "../revenue/revenue-builder";
import { revenueGroupingKey } from "../revenue/grouping-key";
import { reconcileAmazonRevenue } from "../revenue/revenue-reconciliation";
import { parsePaymentXlsx } from "../parsers/payment-xlsx";
import { parseTripsCsv } from "../parsers/trips-csv";
import { sha256Hex } from "../parsers/normalization";
import {
  collectParserBatchIssues,
  createRouteResolutionIssues,
  markIssueResolved,
  summarizeIssueCategories,
} from "../issues/warning-lineage";
import type { AmazonPaymentParseResult, AmazonTripsParseResult } from "../types";

const migration = readFileSync("supabase/migrations/20260716020000_amazon_payment_trip_normalization.sql", "utf8");
const reconciliationMigration = readFileSync("supabase/migrations/20260718010000_amazon_reconciliation_pipeline.sql", "utf8");
const schema = readFileSync("supabase/schema.sql", "utf8");
const matchingService = readFileSync("lib/amazon-statements/server/matching-service.ts", "utf8");
const actions = readFileSync("app/(app)/settlements/amazon-imports/actions.ts", "utf8");
const batchOperations = readFileSync("app/(app)/settlements/amazon-imports/components/batch-operations.tsx", "utf8");
const uiReadService = readFileSync("lib/amazon-statements/server/ui-read-service.ts", "utf8");
const finalWorkflowService = readFileSync("lib/amazon-statements/server/final-workflow-service.ts", "utf8");

function payment(patch: Partial<AmazonPaymentDetailFields> & { fp?: string }): AmazonParsedSourceRow<AmazonPaymentDetailFields> {
  const values: AmazonPaymentDetailFields = {
    invoiceNumber: "INV",
    blockId: null,
    tripId: null,
    loadId: null,
    startDate: "2026-07-05",
    endDate: "2026-07-05",
    route: null,
    operatorType: null,
    equipment: null,
    distanceMiles: null,
    itemType: "LOAD - COMPLETED",
    programType: null,
    baseRate: 0,
    fuelSurcharge: 0,
    tolls: 0,
    detention: 0,
    tonu: 0,
    others: 0,
    grossPay: 0,
    comments: null,
    rowClassification: "standalone_load",
    ...patch,
  };
  return {
    sourceFile: { originalFilename: "synthetic.xlsx", sha256Hash: "hash", sourceType: "amazon_payment" },
    sourceSheet: "Payment Details",
    sourceRowNumber: 1,
    rawValues: {},
    normalizedValues: values,
    parser: { name: "test", version: "0" },
    schemaSignature: { sourceType: "amazon_payment", signature: "sig", parser: { name: "test", version: "0" } },
    parseStatus: "parsed",
    warnings: [],
    blockingIssues: [],
    sourceFingerprint: patch.fp ?? `${values.tripId ?? ""}:${values.loadId ?? ""}:${values.grossPay}`,
  };
}

function trip(patch: Partial<AmazonTripsRowFields> & { fp?: string }): AmazonParsedSourceRow<AmazonTripsRowFields> {
  const values: AmazonTripsRowFields = {
    tripId: null,
    loadId: null,
    driverNameRaw: "Driver A",
    driverTokens: ["Driver A"],
    requiresTeamAssignmentRule: false,
    tractorVehicleId: "UNIT-1",
    tripStage: "Completed",
    loadExecutionStatus: "Completed",
    estimatedDistance: null,
    equipmentType: "Van",
    operatorType: "Single Driver",
    soloTeamIndicator: "Single Driver",
    facilitySequence: "FAC1>FAC2",
    estimatedCost: 999,
    stops: [
      { sequence: 1, facilityCode: "FAC1", stopType: "pickup", plannedArrival: "2026-07-05T08:00", plannedDeparture: null, actualArrival: null, actualDeparture: null },
      { sequence: 2, facilityCode: "FAC2", stopType: "delivery", plannedArrival: null, plannedDeparture: "2026-07-05T18:00", actualArrival: null, actualDeparture: null },
    ],
    ...patch,
  };
  return {
    sourceFile: { originalFilename: "synthetic.csv", sha256Hash: "hash", sourceType: "amazon_trips" },
    sourceSheet: null,
    sourceRowNumber: 2,
    rawValues: {},
    normalizedValues: values,
    parser: { name: "test", version: "0" },
    schemaSignature: { sourceType: "amazon_trips", signature: "sig", parser: { name: "test", version: "0" } },
    parseStatus: "parsed",
    warnings: [],
    blockingIssues: [],
    sourceFingerprint: patch.fp ?? `${values.tripId ?? ""}:${values.loadId ?? ""}`,
  };
}

describe("amazon payment/trip matching", () => {
  it("matches exact Load ID and preserves Trips estimated cost as non-authority", () => {
    const result = matchPaymentTrips([payment({ loadId: "LOAD-1", grossPay: 120 })], [trip({ loadId: "load-1", estimatedCost: 999 })]);
    expect(result.counts.exactLoadMatches).toBe(1);
    expect(result.matches[0].confidenceScore).toBe(1);
    expect(result.matches[0].paymentRow.normalizedValues.grossPay).toBe(120);
  });

  it("blocks duplicate Load ID ambiguity and unmatched financial rows", () => {
    const ambiguous = matchPaymentTrips([payment({ loadId: "LOAD-1", grossPay: 120 })], [trip({ loadId: "LOAD-1", fp: "a" }), trip({ loadId: "LOAD-1", fp: "b" })]);
    expect(ambiguous.counts.ambiguousMatches).toBe(1);
    expect(ambiguous.issues.some((issue) => issue.issueCode === "ambiguous_load_match")).toBe(true);
    const unmatched = matchPaymentTrips([payment({ loadId: "NOPE", grossPay: 120 })], []);
    expect(unmatched.counts.unmatchedFinancialRows).toBe(1);
    expect(unmatched.issues.some((issue) => issue.issueCode === "unmatched_payment_row")).toBe(true);
  });

  it("uses exact Trip ID for parent association and detects driver/vehicle conflicts", () => {
    const parent = payment({ tripId: "TRIP-1", rowClassification: "trip_parent", baseRate: 100, grossPay: 100 });
    const ok = matchPaymentTrips([parent], [trip({ tripId: "TRIP-1", loadId: "A" }), trip({ tripId: "TRIP-1", loadId: "B" })]);
    expect(ok.counts.exactTripMatches).toBe(1);
    const driverConflict = matchPaymentTrips([parent], [trip({ tripId: "TRIP-1", driverTokens: ["Driver A"] }), trip({ tripId: "TRIP-1", driverNameRaw: "Driver B", driverTokens: ["Driver B"] })]);
    expect(driverConflict.issues.some((issue) => issue.issueCode === "conflicting_trip_drivers")).toBe(true);
    const vehicleConflict = matchPaymentTrips([parent], [trip({ tripId: "TRIP-1", tractorVehicleId: "UNIT-1" }), trip({ tripId: "TRIP-1", tractorVehicleId: "UNIT-2" })]);
    expect(vehicleConflict.issues.some((issue) => issue.issueCode === "conflicting_trip_vehicle")).toBe(true);
  });

  it("infers by unique vehicle/date/facility and requires review when inference is ambiguous", () => {
    const p = payment({ loadId: "UNKNOWN", route: "FAC1->FAC2", grossPay: 80 });
    const inferred = matchPaymentTrips([p], [trip({ loadId: "OTHER" })]);
    expect(inferred.counts.inferredMatches).toBe(1);
    const ambiguous = matchPaymentTrips([p], [trip({ loadId: "A", fp: "a" }), trip({ loadId: "B", fp: "b" })]);
    expect(ambiguous.counts.ambiguousMatches).toBe(1);
  });

  it("creates blocking team-split issues without assigning percentages", () => {
    const result = matchPaymentTrips(
      [payment({ loadId: "LOAD-1", grossPay: 120 })],
      [trip({ loadId: "LOAD-1", driverNameRaw: "Driver A; Driver B", driverTokens: ["Driver A", "Driver B"], requiresTeamAssignmentRule: true })],
    );
    expect(result.issues.some((issue) => issue.issueCode === "missing_team_split")).toBe(true);
  });
});

describe("amazon canonical revenue grouping", () => {
  it("uses deterministic invoice plus Trip/Load grouping keys", () => {
    expect(revenueGroupingKey("INV-ID", payment({ tripId: "TRIP-1", loadId: "LOAD-1" }).normalizedValues)).toEqual({
      groupingType: "trip",
      groupingKey: "INV-ID:TRIP:TRIP-1",
    });
    expect(revenueGroupingKey("INV-ID", payment({ loadId: "LOAD-2" }).normalizedValues).groupingKey).toBe("INV-ID:LOAD:LOAD-2");
  });

  it("consolidates parent and child rows once and preserves TONU/component totals", () => {
    const rows = [
      payment({ tripId: "TRIP-1", rowClassification: "trip_parent", baseRate: 100, grossPay: 100, fp: "p" }),
      payment({ tripId: "TRIP-1", loadId: "LOAD-1", rowClassification: "load_child", fuelSurcharge: 20, tolls: 5, tonu: 7, grossPay: 32, fp: "c" }),
      payment({ loadId: "LOAD-2", rowClassification: "standalone_load", baseRate: 50, grossPay: 50, fp: "s" }),
    ];
    const matching = matchPaymentTrips(rows, [trip({ tripId: "TRIP-1", loadId: "LOAD-1" }), trip({ loadId: "LOAD-2", tripId: null })]);
    const revenue = buildAmazonRevenueItems({ invoiceId: "INV-ID", paymentRows: rows, matches: matching.matches });
    expect(revenue.items).toHaveLength(2);
    const tripItem = revenue.items.find((item) => item.groupingType === "trip");
    expect(tripItem?.grossAmount).toBe(132);
    expect(tripItem?.baseAmount).toBe(100);
    expect(tripItem?.fuelSurchargeAmount).toBe(20);
    expect(tripItem?.tollAmount).toBe(5);
    expect(tripItem?.tonuAmount).toBe(7);
    expect(tripItem?.sources.map((source) => source.contributionType).sort()).toEqual(["child_accessorial", "parent_base"]);
    expect(revenue.duplicateSourceContributionCount).toBe(0);
  });

  it("reconciles totals, source row loss, duplicate contribution, null versus zero, and source-order independence", () => {
    const a = payment({ loadId: "LOAD-1", baseRate: 0, fuelSurcharge: null, grossPay: 0, fp: "a" });
    const b = payment({ loadId: "LOAD-2", baseRate: 10, grossPay: 10, fp: "b" });
    const trips = [trip({ loadId: "LOAD-1" }), trip({ loadId: "LOAD-2" })];
    const matching = matchPaymentTrips([b, a], trips);
    const revenue = buildAmazonRevenueItems({ invoiceId: "INV-ID", paymentRows: [b, a], matches: matching.matches });
    const reversed = buildAmazonRevenueItems({ invoiceId: "INV-ID", paymentRows: [a, b], matches: matchPaymentTrips([a, b], trips).matches });
    expect(revenue.items.map((item) => item.sourceRevision).sort()).toEqual(reversed.items.map((item) => item.sourceRevision).sort());
    const duplicate = buildAmazonRevenueItems({ invoiceId: "INV-ID", paymentRows: [a], matches: [matching.matches[0], matching.matches[0]] });
    expect(duplicate.duplicateSourceContributionCount).toBe(1);
    const reconciliation = reconcileAmazonRevenue({
      summaryInvoiceTotal: 10,
      validPaymentRowGrossTotal: 10,
      parentRowCount: 0,
      childRowCount: 0,
      standaloneRowCount: 2,
      matching,
      revenue,
    });
    expect(reconciliation.canonicalRevenueTotal).toBe(10);
    expect(reconciliation.unassignedRevenueTotal).toBe(0);
  });

  it("keeps paid revenue when operational Trips status is cancelled and warns on unresolved facilities", () => {
    const rows = [payment({ loadId: "LOAD-1", grossPay: 25 })];
    const matching = matchPaymentTrips(rows, [trip({ loadId: "LOAD-1", loadExecutionStatus: "Cancelled", stops: [] })]);
    const revenue = buildAmazonRevenueItems({ invoiceId: "INV-ID", paymentRows: rows, matches: matching.matches });
    expect(revenue.items[0].grossAmount).toBe(25);
    const reconciliation = reconcileAmazonRevenue({
      summaryInvoiceTotal: 25,
      validPaymentRowGrossTotal: 25,
      parentRowCount: 0,
      childRowCount: 0,
      standaloneRowCount: 1,
      matching,
      revenue,
      routeResolutionRequested: true,
    });
    expect(reconciliation.batchIssues.some((issue) => issue.issueCode === "unresolved_facility")).toBe(true);
  });

  it("preserves parser warning lineage into batch issues and final warning counts", () => {
    const paymentRow = payment({ loadId: "LOAD-1", grossPay: 25, fp: "payment-fp" });
    paymentRow.warnings = ["distance_mi:number_malformed"];
    const tripRow = trip({ loadId: "LOAD-1", fp: "trip-fp" });
    tripRow.warnings = ["team_assignment_rule_required"];
    const parserIssues = collectParserBatchIssues({
      payment: {
        summary: {} as AmazonPaymentParseResult["summary"],
        detailRows: [paymentRow],
        issues: [],
        reconciliation: {} as AmazonPaymentParseResult["reconciliation"],
        schemaInspection: {},
      },
      trips: {
        rows: [tripRow],
        issues: [],
        schemaInspection: {},
        aggregate: {} as AmazonTripsParseResult["aggregate"],
      },
    });
    expect(parserIssues.map((issue) => issue.issueCode).sort()).toEqual([
      "payment_distance_mi_number_malformed",
      "trips_team_assignment_rule_required",
    ]);
    expect(parserIssues[0].sourceRowReference.sourceFingerprint).toBe("payment-fp");
    const matching = matchPaymentTrips([paymentRow], [tripRow]);
    const revenue = buildAmazonRevenueItems({ invoiceId: "INV-ID", paymentRows: [paymentRow], matches: matching.matches });
    const reconciliation = reconcileAmazonRevenue({
      summaryInvoiceTotal: 25,
      validPaymentRowGrossTotal: 25,
      parentRowCount: 0,
      childRowCount: 0,
      standaloneRowCount: 1,
      matching,
      revenue,
      parserIssues,
    });
    expect(reconciliation.issueCategoryCounts.parserWarnings).toBe(2);
    expect(reconciliation.issueCategoryCounts.totalPersistedWarningIssues).toBe(2);
    expect(reconciliation.canonicalRevenueTotal).toBe(25);
  });

  it("marks intentionally resolved warnings as resolved rather than deleting them", () => {
    const issue = collectParserBatchIssues({
      payment: {
        summary: {} as AmazonPaymentParseResult["summary"],
        detailRows: [payment({ loadId: "LOAD-1", grossPay: 25, fp: "payment-fp" })],
        issues: [{ fileId: null, rawRowId: null, issueCode: "schema_extra_column", severity: "warning", message: "extra", details: {} }],
        reconciliation: {} as AmazonPaymentParseResult["reconciliation"],
        schemaInspection: {},
      },
      trips: { rows: [], issues: [], schemaInspection: {}, aggregate: {} as AmazonTripsParseResult["aggregate"] },
    })[0];
    const resolved = markIssueResolved(issue, "recognized optional source column");
    expect(resolved.resolutionStatus).toBe("resolved");
    expect(summarizeIssueCategories([resolved]).totalPersistedWarningIssues).toBe(0);
  });

  it("creates unresolved facility warnings only when route display resolution is requested", () => {
    const rows = [payment({ loadId: "LOAD-1", grossPay: 25 })];
    const matching = matchPaymentTrips(rows, [trip({ loadId: "LOAD-1", stops: [] })]);
    const revenue = buildAmazonRevenueItems({ invoiceId: "INV-ID", paymentRows: rows, matches: matching.matches });
    expect(createRouteResolutionIssues({ items: revenue.items, routeResolutionRequested: false })).toHaveLength(0);
    expect(createRouteResolutionIssues({ items: revenue.items, routeResolutionRequested: true })).toHaveLength(1);
    const reconciliation = reconcileAmazonRevenue({
      summaryInvoiceTotal: 25,
      validPaymentRowGrossTotal: 25,
      parentRowCount: 0,
      childRowCount: 0,
      standaloneRowCount: 1,
      matching,
      revenue,
      routeResolutionRequested: false,
    });
    expect(reconciliation.issueCategoryCounts.routeResolutionWarnings).toBe(0);
    expect(reconciliation.canonicalRevenueTotal).toBe(25);
  });

  it("reconciles the local Amazon private-sample aggregates without double-counting summary rows", async () => {
    const root = process.cwd();
    const paymentBytes = readFileSync(join(root, "fixtures", "amazon-statements", "sample-week", "PAYMENT.xlsx"));
    const tripsBytes = readFileSync(join(root, "fixtures", "amazon-statements", "sample-week", "Trips.csv"));
    const paymentParsed = await parsePaymentXlsx({
      bytes: paymentBytes,
      metadata: {
        sourceType: "amazon_payment",
        originalFilename: "PAYMENT.xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        sizeBytes: paymentBytes.byteLength,
        sha256Hash: sha256Hex(paymentBytes),
      },
      parser: { name: "test", version: "0" },
    });
    const tripsParsed = await parseTripsCsv({
      bytes: tripsBytes,
      metadata: {
        sourceType: "amazon_trips",
        originalFilename: "Trips.csv",
        mimeType: "text/csv",
        sizeBytes: tripsBytes.byteLength,
        sha256Hash: sha256Hex(tripsBytes),
      },
      parser: { name: "test", version: "0" },
    });
    const matching = matchPaymentTrips(paymentParsed.detailRows, tripsParsed.rows);
    const revenue = buildAmazonRevenueItems({
      invoiceId: paymentParsed.summary.invoiceNumber ? sha256Hex(paymentParsed.summary.invoiceNumber).slice(0, 16) : "sample-invoice",
      paymentRows: paymentParsed.detailRows,
      matches: matching.matches,
    });
    const reconciliation = reconcileAmazonRevenue({
      summaryInvoiceTotal: paymentParsed.reconciliation.summaryInvoiceTotal,
      validPaymentRowGrossTotal: paymentParsed.reconciliation.totalParsedGrossPay,
      parentRowCount: paymentParsed.reconciliation.tripParentCount,
      childRowCount: paymentParsed.reconciliation.loadChildCount,
      standaloneRowCount: paymentParsed.reconciliation.standaloneLoadCount,
      matching,
      revenue,
    });
    expect(paymentParsed.detailRows).toHaveLength(39);
    expect(paymentParsed.reconciliation.validFinancialRowCount).toBe(36);
    expect(paymentParsed.reconciliation.summaryInvoiceTotal).toBe(30665.09);
    expect(paymentParsed.reconciliation.totalParsedGrossPay).toBe(30665.09);
    const nonFinancialRows = paymentParsed.detailRows.filter((row) => row.normalizedValues.rowClassification === "non_financial");
    expect(nonFinancialRows.length).toBeGreaterThanOrEqual(1);
    expect(nonFinancialRows.some((row) => row.normalizedValues.grossPay === 30665.09)).toBe(true);
    expect(matching.counts.exactLoadMatches).toBe(29);
    expect(matching.counts.exactTripMatches).toBe(7);
    expect(revenue.items).toHaveLength(20);
    expect(reconciliation.canonicalRevenueTotal).toBe(30665.09);
    expect(reconciliation.unassignedRevenueTotal).toBe(0);
    expect(new Set(revenue.items.flatMap((item) => item.sources.map((source) => source.paymentRow.sourceFingerprint))).size).toBe(36);
  });
});

describe("amazon normalization SQL source contracts", () => {
  it("creates only the approved normalized payment/trip tables", () => {
    for (const table of [
      "amazon_payment_invoices",
      "amazon_payment_rows",
      "amazon_trip_rows",
      "amazon_trip_driver_tokens",
      "amazon_import_matches",
      "amazon_revenue_items",
      "amazon_revenue_item_sources",
    ]) {
      expect(migration).toContain(`create table if not exists public.${table}`);
      expect(schema).toContain(`create table if not exists public.${table}`);
    }
    expect(migration).not.toContain("amazon_fuel");
    expect(migration).not.toContain("references public.loads");
    expect(migration).not.toContain("references public.expenses");
    expect(migration).not.toContain("references public.settlements");
  });

  it("uses same-org FKs, idempotent source keys and active match/contribution uniqueness", () => {
    for (const source of [migration, schema]) {
      expect(source).toContain("foreign key (organization_id, batch_id, file_id)");
      expect(source).toContain("foreign key (organization_id, batch_id, raw_row_id)");
      expect(source).toContain("amazon_payment_rows_source_fingerprint_key unique (organization_id, file_id, source_fingerprint)");
      expect(source).toContain("amazon_trip_rows_source_fingerprint_key unique (organization_id, file_id, source_fingerprint)");
      expect(source).toContain("amazon_import_matches_one_active_approved_key");
      expect(source).toContain("where status in ('exact','inferred','manually_approved')");
      expect(source).toContain("amazon_revenue_item_sources_one_active_contribution_key");
    }
  });

  it("enables RLS without broad FOR ALL policies and uses immutable source guards", () => {
    for (const source of [migration, schema]) {
      expect(source).toContain("alter table public.%I enable row level security");
      expect(source).toContain("for select to authenticated using (organization_id = (select public.current_org_id()))");
      expect(source).toContain("for insert to authenticated with check (organization_id = (select public.current_org_id()) and (select public.is_org_writer()))");
      expect(source).toContain("for update to authenticated using (organization_id = (select public.current_org_id()) and (select public.is_org_writer()))");
      expect(source).toContain("guard_amazon_payment_invoice_source");
      expect(source).toContain("guard_amazon_payment_row_source");
      expect(source).not.toMatch(/create policy .* on public\.amazon_.* for all/i);
    }
  });

  it("defines the atomic payment reconciliation RPC with writer, org, locking, retry, and execute guards", () => {
    expect(reconciliationMigration).toContain("create or replace function public.reconcile_amazon_payment_atomic");
    expect(reconciliationMigration).toContain("v_org uuid := (select public.current_org_id())");
    expect(reconciliationMigration).toContain("not (select public.is_org_writer())");
    expect(reconciliationMigration).toContain("for update");
    expect(reconciliationMigration).toContain("Archived Amazon import batches are immutable.");
    expect(reconciliationMigration).toContain("amazon_import_matches_batch_payment_type_key");
    expect(reconciliationMigration).toContain("on conflict (organization_id, batch_id, payment_row_id, match_type)");
    expect(reconciliationMigration).toContain("on conflict on constraint amazon_revenue_items_grouping_key");
    expect(reconciliationMigration).toContain("A financial payment row cannot contribute to canonical revenue more than once.");
    expect(reconciliationMigration).toContain("details->>'lifecycleStage' = 'reconcile_payment'");
    expect(reconciliationMigration).toContain("reconciliation_type = 'amazon_revenue'");
    expect(reconciliationMigration).toContain("revoke execute on function public.reconcile_amazon_payment_atomic");
    expect(reconciliationMigration).toContain("grant execute on function public.reconcile_amazon_payment_atomic");
  });

  it("runs reconciliation from persisted database rows and never browser monetary totals", () => {
    expect(matchingService).toContain("loadPersistedPaymentTripRows");
    expect(matchingService).toContain("source_fingerprint");
    expect(matchingService).toContain("base_amount");
    expect(matchingService).toContain("fuel_surcharge_amount");
    expect(matchingService).toContain("amazon_trip_driver_tokens");
    expect(matchingService).toContain("reconcile_amazon_payment_atomic");
    expect(actions).toContain("reconcileAmazonImportBatchAction");
    expect(actions).toContain("requireAmazonImportActor({ writer: true })");
    expect(batchOperations).toContain("Run reconciliation / matching");
    expect(batchOperations).not.toMatch(/grossAmount|validPaymentRowTotal|canonicalRevenueTotal|summaryInvoiceTotal/);
  });

  it("uses authoritative reconciliation types for UI totals and workflow evidence", () => {
    expect(uiReadService).toContain("authoritativeSummaryInvoiceTotal");
    expect(uiReadService).toContain("payment_invoice_total");
    expect(uiReadService).toContain("isValidFinancialPaymentRow");
    expect(uiReadService).toContain("row_classification === \"trip_parent\"");
    expect(uiReadService).toContain("latestCurrentStatus(reconciliationRows, \"amazon_revenue\")");
    expect(uiReadService).toContain("matchCount: matchRows.length");
    expect(uiReadService).toContain("canonicalRevenueItemCount: revenueRows.length");
    expect(uiReadService).toContain("!matchingStarted ? \"not_started\"");
  });

  it("blocks projection until canonical revenue and amazon_revenue reconciliation are real", () => {
    expect(finalWorkflowService).toContain("missing_canonical_revenue");
    expect(finalWorkflowService).toContain("amazon_revenue_reconciliation_not_passed");
    expect(finalWorkflowService).toContain("blocking_matching_issues");
    expect(finalWorkflowService).toContain(".eq(\"reconciliation_type\", \"amazon_revenue\")");
  });
});
