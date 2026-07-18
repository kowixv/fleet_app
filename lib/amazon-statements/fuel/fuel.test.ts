import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseOctaneFuelText, parseOctaneFuelTextPages } from "../parsers/octane-fuel-text";
import { inspectFuelXlsxSchema } from "../parsers/fuel-xlsx";
import { reconcileFuelReport } from "./fuel-reconciliation";
import {
  dateInHalfOpenRange,
  hasOverlappingAssignments,
  matchFuelCardGroup,
  matchFuelReport,
  type FuelMatchingContext,
} from "./fuel-matcher";

const migration = readFileSync("supabase/migrations/20260716030000_amazon_fuel_normalization.sql", "utf8");
const schema = readFileSync("supabase/schema.sql", "utf8");

function syntheticFuelText(overrides: { groupTwoTotal?: string; reportTotal?: string } = {}) {
  return [
    "Transaction Report",
    "Carrier SYNTHETIC-CARRIER · 2026-07-06 — 2026-07-12",
    "Carrier transactions detail",
    "4",
    "Transactions",
    overrides.reportTotal ?? "$150.00",
    "Total Spent",
    "$3.50",
    "Discount",
    "3",
    "Cards",
    "30.000",
    "Qty",
    "DATE AUTH CARD DRIVER CITY ST FEES ITEM UNIT PRC DISC PPU DISC CST QTY DISC AMT DT TOTAL",
    "CARD 1 · CARD-A-0001 · 2 txns DRIVER A · ID SYN-1 · Unit UNIT-1",
    "2026-07-06 08:00 INV-1 MERCHANT ONE Alpha ST ULSD 4.000 3.800 0.200 10.000 $2.00 CP $38.00",
    "DEFD 5.000 5.000 0.000 2.000 CP $10.00",
    "2026-07-06 09:00 INV-1 MERCHANT TWO Beta ST ULSD 4.000 3.900 0.100 5.000 $0.50 RM $19.50",
    "Fuel & Fees Amount Quantity Avg PPU",
    "DEFD $10.00 2.000 5.000",
    "ULSD $57.50 15.000 3.833",
    "Fees $0.00",
    "Totals $67.50",
    "Total Fuel $67.50 17.000",
    "Discount Disc Amt Disc PPU Total",
    "Cost Plus $2.00 0.200 $2.00",
    "Retail Minus $0.50 0.100 $0.50",
    "Total Discount $2.50",
    "Average Discount 0.167",
    "CARD 2 · CARD-B-0002 · 1 txn DRIVER B · ID SYN-2 · Unit UNIT-1",
    "2026-07-07 10:00 INV-2 MERCHANT THREE Gamma ST ULSD 4.000 3.500 0.500 20.000 $10.00 CP $70.00",
    "Fuel & Fees Amount Quantity Avg PPU",
    "ULSD $70.00 20.000 3.500",
    "Fees $0.00",
    `Totals ${overrides.groupTwoTotal ?? "$70.00"}`,
    "Total Fuel $70.00 20.000",
    "Discount Disc Amt Disc PPU Total",
    "Cost Plus $10.00 0.500 $10.00",
    "Total Discount $10.00",
    "Average Discount 0.500",
    "CARD 3 · — · 1 txn",
    "— — — 0.000",
    "Fuel & Fees Amount Quantity Avg PPU",
    "— $0.00 — 0.000",
    "Fees $0.00",
    "Totals $0.00",
    "Total Fuel $0.00 —",
    "Discount Disc Amt Disc PPU Total",
    "Total Discount $0.00",
  ].join("\n");
}

function matchingContext(patch: Partial<FuelMatchingContext> = {}): FuelMatchingContext {
  return {
    organizationId: "org-a",
    cardAssignments: [],
    knownCards: [],
    unitAliases: [],
    driverLabels: [],
    ...patch,
  };
}

describe("octane fuel parser", () => {
  it("parses report header, card groups, transactions, continuation product lines, and placeholder groups", () => {
    const report = parseOctaneFuelText(syntheticFuelText());
    expect(report.reportedTransactionCount).toBe(4);
    expect(report.reportedTotalAmount).toBe(150);
    expect(report.reportedTotalQuantity).toBe(30);
    expect(report.reportedDiscountAmount).toBe(3.5);
    expect(report.cardGroups).toHaveLength(3);
    expect(report.cardGroups[0].transactions).toHaveLength(2);
    expect(report.cardGroups[0].transactions[0].productLines.map((line) => line.productTypeNormalized)).toEqual(["ULSD", "DEF"]);
    expect(report.cardGroups[1].unitLabelNormalized).toBe("UNIT-1");
    expect(report.cardGroups[2].isPlaceholderGroup).toBe(true);
  });

  it("keeps repeated invoices as separate transactions but associates continuation lines with the previous transaction", () => {
    const [firstGroup] = parseOctaneFuelText(syntheticFuelText()).cardGroups;
    expect(firstGroup.transactions.map((transaction) => transaction.invoiceNumber)).toEqual(["INV-1", "INV-1"]);
    expect(firstGroup.transactions[0].productLines).toHaveLength(2);
    expect(firstGroup.transactions[1].productLines).toHaveLength(1);
  });

  it("preserves null versus zero and supports negative refund lines", () => {
    const report = parseOctaneFuelText([
      "Transaction Report",
      "1",
      "Transactions",
      "-$12.00",
      "Total Spent",
      "0.000",
      "Discount",
      "1",
      "Cards",
      "-3.000",
      "Qty",
      "CARD 1 · CARD-R · 1 txn DRIVER R · ID SYN-R · Unit UNIT-R",
      "2026-07-08 11:00 INV-R REFUND SHOP Delta ST ULSD 4.000 4.000 0.000 -3.000 ND -$12.00",
      "Fuel & Fees Amount Quantity Avg PPU",
      "ULSD -$12.00 -3.000 4.000",
      "Fees $0.00",
      "Totals -$12.00",
      "Total Fuel -$12.00 -3.000",
      "Discount Disc Amt Disc PPU Total",
      "Total Discount $0.00",
    ].join("\n"));
    const line = report.cardGroups[0].transactions[0].productLines[0];
    expect(line.chargedAmount).toBe(-12);
    expect(line.discountAmount).toBeNull();
  });

  it("emits source-lineage issues for malformed values and orphan product lines", () => {
    const report = parseOctaneFuelText([
      "Transaction Report",
      "1",
      "Transactions",
      "$1.00",
      "Total Spent",
      "CARD 1 · CARD-M · 1 txn DRIVER M · ID SYN-M · Unit UNIT-M",
      "ULSD 4.000 4.000 0.000 1.000 CP $4.00",
      "not-a-date 08:00 INV-M MERCHANT M City ST ULSD 4.000 4.000 0.000 1.000 CP $4.00",
    ].join("\n"));
    expect(report.issues.some((issue) => issue.issueCode === "orphan_product_line" && issue.location.sourceRowNumber !== null)).toBe(true);
    expect(reconcileFuelReport(report).issues.some((issue) => issue.issueCode === "report_amount_mismatch")).toBe(true);
  });

  it("reconciles transaction, group, and report totals without changing financial totals", () => {
    const report = parseOctaneFuelText(syntheticFuelText());
    const reconciliation = reconcileFuelReport(report);
    expect(reconciliation.parsedRealTransactionCount).toBe(3);
    expect(reconciliation.parsedProductLineCount).toBe(4);
    expect(reconciliation.calculatedChargedAmount).toBe(137.5);
    expect(reconciliation.placeholderGroupCount).toBe(1);
    expect(reconciliation.status).toBe("failed");
    expect(reconciliation.issues.some((issue) => issue.issueCode === "report_amount_mismatch")).toBe(true);
  });

  it("detects group amount mismatches and duplicate transaction fingerprints", () => {
    const report = parseOctaneFuelText(syntheticFuelText({ groupTwoTotal: "$71.00" }));
    report.cardGroups[1].transactions[0].sourceTransactionFingerprint = report.cardGroups[0].transactions[1].sourceTransactionFingerprint;
    const reconciliation = reconcileFuelReport(report);
    expect(reconciliation.issues.some((issue) => issue.issueCode === "group_amount_mismatch")).toBe(true);
    expect(reconciliation.issues.some((issue) => issue.issueCode === "duplicate_transaction_fingerprint")).toBe(true);
  });

  it("does not merge same invoice/date/card/merchant rows when source rows are distinct", () => {
    const report = parseOctaneFuelText([
      "Transaction Report",
      "2",
      "Transactions",
      "$20.00",
      "Total Spent",
      "$0.00",
      "Discount",
      "1",
      "Cards",
      "4.000",
      "Qty",
      "CARD 1 - CARD-SAME - 2 txns DRIVER S - ID SYN-S - Unit UNIT-S",
      "2026-07-08 10:00 INV-S MERCHANT SAME Same ST ULSD 5.000 5.000 0.000 2.000 ND $10.00",
      "2026-07-08 10:00 INV-S MERCHANT SAME Same ST ULSD 5.000 5.000 0.000 2.000 ND $10.00",
      "Fuel & Fees Amount Quantity Avg PPU",
      "ULSD $20.00 4.000 5.000",
      "Fees $0.00",
      "Totals $20.00",
      "Total Fuel $20.00 4.000",
      "Discount Disc Amt Disc PPU Total",
      "Total Discount $0.00",
    ].join("\n"));
    const reconciliation = reconcileFuelReport(report);
    const fingerprints = report.cardGroups[0].transactions.map((transaction) => transaction.sourceTransactionFingerprint);
    expect(report.cardGroups[0].transactions).toHaveLength(2);
    expect(new Set(fingerprints).size).toBe(2);
    expect(reconciliation.issues.some((issue) => issue.issueCode === "duplicate_transaction_fingerprint")).toBe(false);
    expect(reconciliation.calculatedChargedAmount).toBe(20);
  });

  it("associates a page-break continuation line with the preceding transaction", () => {
    const report = parseOctaneFuelTextPages([
      [
        "Transaction Report",
        "1",
        "Transactions",
        "$30.00",
        "Total Spent",
        "$0.00",
        "Discount",
        "1",
        "Cards",
        "6.000",
        "Qty",
        "CARD 1 - CARD-PAGE - 1 txn DRIVER P - ID SYN-P - Unit UNIT-P",
        "2026-07-08 10:00 INV-P MERCHANT PAGE Page ST ULSD 5.000 5.000 0.000 4.000 ND $20.00",
      ].join("\n"),
      [
        "DEFD 5.000 5.000 0.000 2.000 ND $10.00",
        "Fuel & Fees Amount Quantity Avg PPU",
        "ULSD $20.00 4.000 5.000",
        "DEFD $10.00 2.000 5.000",
        "Fees $0.00",
        "Totals $30.00",
        "Total Fuel $30.00 6.000",
        "Discount Disc Amt Disc PPU Total",
        "Total Discount $0.00",
      ].join("\n"),
    ]);
    const transaction = report.cardGroups[0].transactions[0];
    expect(report.cardGroups[0].transactions).toHaveLength(1);
    expect(transaction.productLines.map((line) => line.productTypeNormalized)).toEqual(["ULSD", "DEF"]);
    expect(reconcileFuelReport(report).financialStatus).toBe("passed");
  });

  it("treats a repeated card-group header after a page break as the same source group", () => {
    const report = parseOctaneFuelTextPages([
      [
        "Transaction Report",
        "2",
        "Transactions",
        "$30.00",
        "Total Spent",
        "$0.00",
        "Discount",
        "1",
        "Cards",
        "6.000",
        "Qty",
        "CARD 1 - CARD-REPEAT - 2 txns DRIVER R - ID SYN-R - Unit UNIT-R",
        "2026-07-08 10:00 INV-R1 MERCHANT R Repeat ST ULSD 5.000 5.000 0.000 2.000 ND $10.00",
      ].join("\n"),
      [
        "DATE AUTH CARD DRIVER CITY ST FEES ITEM UNIT PRC DISC PPU DISC CST QTY DISC AMT DT TOTAL",
        "CARD 1 - CARD-REPEAT - 2 txns DRIVER R - ID SYN-R - Unit UNIT-R",
        "2026-07-08 11:00 INV-R2 MERCHANT R Repeat ST ULSD 5.000 5.000 0.000 4.000 ND $20.00",
        "Fuel & Fees Amount Quantity Avg PPU",
        "ULSD $30.00 6.000 5.000",
        "Fees $0.00",
        "Totals $30.00",
        "Total Fuel $30.00 6.000",
        "Discount Disc Amt Disc PPU Total",
        "Total Discount $0.00",
      ].join("\n"),
    ]);
    expect(report.cardGroups).toHaveLength(1);
    expect(report.cardGroups[0].transactions).toHaveLength(2);
    expect(report.cardGroups[0].sourcePageEnd).toBe(2);
    expect(reconcileFuelReport(report).transactionCountStatus).toBe("passed");
  });

  it("keeps transaction count mismatch separate from financial reconciliation and does not fabricate rows", () => {
    const report = parseOctaneFuelText([
      "Transaction Report",
      "3",
      "Transactions",
      "$30.00",
      "Total Spent",
      "$0.00",
      "Discount",
      "1",
      "Cards",
      "6.000",
      "Qty",
      "CARD 1 - CARD-CNT - 3 txns DRIVER C - ID SYN-C - Unit UNIT-C",
      "2026-07-08 10:00 INV-C1 MERCHANT C Count ST ULSD 5.000 5.000 0.000 2.000 ND $10.00",
      "2026-07-08 11:00 INV-C2 MERCHANT C Count ST ULSD 5.000 5.000 0.000 4.000 ND $20.00",
      "Fuel & Fees Amount Quantity Avg PPU",
      "ULSD $30.00 6.000 5.000",
      "Fees $0.00",
      "Totals $30.00",
      "Total Fuel $30.00 6.000",
      "Discount Disc Amt Disc PPU Total",
      "Total Discount $0.00",
    ].join("\n"));
    const reconciliation = reconcileFuelReport(report);
    expect(reconciliation.parsedRealTransactionCount).toBe(2);
    expect(reconciliation.financialStatus).toBe("passed");
    expect(reconciliation.transactionCountStatus).toBe("warning");
    expect(reconciliation.quantityStatus).toBe("passed");
    expect(reconciliation.discountStatus).toBe("passed");
    expect(reconciliation.issues.some((issue) => issue.issueCode === "report_transaction_count_mismatch")).toBe(true);
    expect(reconciliation.blockingIssueCount).toBe(0);
  });

  it("keeps parser independent from settlements, Supabase writes, and expenses projection", () => {
    const source = readFileSync("lib/amazon-statements/parsers/octane-fuel-pdf.ts", "utf8")
      + readFileSync("lib/amazon-statements/fuel/fuel-reconciliation.ts", "utf8")
      + readFileSync("lib/amazon-statements/fuel/fuel-matcher.ts", "utf8");
    expect(source).not.toMatch(/from ["']@\/lib\/supabase|createClient|settlement|public\.expenses|expenses/i);
  });
});

describe("fuel matching candidates", () => {
  it("prioritizes exact effective-card assignments", () => {
    const group = parseOctaneFuelText(syntheticFuelText()).cardGroups[0];
    const result = matchFuelCardGroup(group, matchingContext({
      cardAssignments: [{
        organizationId: "org-a",
        fuelCardId: "fuel-card-1",
        externalCardId: "CARD-A-0001",
        vehicleId: "vehicle-1",
        driverId: "driver-1",
        effectiveFrom: "2026-07-01",
        effectiveTo: "2026-08-01",
        status: "approved",
      }],
    }), group.transactions[0]);
    expect(result.candidates[0]).toMatchObject({ matchMethod: "effective_card_assignment", status: "exact", confidenceScore: 1 });
  });

  it("uses exact unit aliases as inferred vehicle candidates and keeps same unit with multiple cards reviewable", () => {
    const report = parseOctaneFuelText(syntheticFuelText());
    const result = matchFuelReport(report.cardGroups, matchingContext({
      unitAliases: [{ organizationId: "org-a", normalizedUnit: "UNIT-1", vehicleId: "vehicle-1" }],
    }));
    expect(result.candidates.filter((candidate) => candidate.vehicleId === "vehicle-1")).toHaveLength(2);
    expect(result.candidates.filter((candidate) => candidate.matchMethod === "exact_unit_alias").every((candidate) => candidate.status === "inferred")).toBe(true);
  });

  it("does not auto-approve driver-label-only candidates", () => {
    const group = parseOctaneFuelText(syntheticFuelText()).cardGroups[0];
    const result = matchFuelCardGroup(group, matchingContext({
      driverLabels: [{ organizationId: "org-a", normalizedDriverLabel: "DRIVER A", driverId: "driver-a" }],
    }));
    expect(result.candidates[0]).toMatchObject({ matchMethod: "exact_driver_label", status: "inferred", confidenceScore: 0.5 });
    expect(result.issues.some((issue) => issue.issueCode === "unmatched_fuel_card" && issue.severity === "warning")).toBe(true);
  });

  it("marks ambiguous matches and overlapping assignments as blocking", () => {
    const group = parseOctaneFuelText(syntheticFuelText()).cardGroups[0];
    const ambiguous = matchFuelCardGroup(group, matchingContext({
      unitAliases: [
        { organizationId: "org-a", normalizedUnit: "UNIT-1", vehicleId: "vehicle-1" },
        { organizationId: "org-a", normalizedUnit: "UNIT-1", vehicleId: "vehicle-2" },
      ],
    }));
    expect(ambiguous.candidates.every((candidate) => candidate.status === "ambiguous")).toBe(true);
    expect(ambiguous.issues.some((issue) => issue.severity === "blocking")).toBe(true);

    expect(hasOverlappingAssignments([
      { organizationId: "org-a", fuelCardId: "card", externalCardId: "CARD-A-0001", vehicleId: "v1", driverId: null, effectiveFrom: "2026-07-01", effectiveTo: "2026-07-10", status: "approved" },
      { organizationId: "org-a", fuelCardId: "card", externalCardId: "CARD-A-0001", vehicleId: "v2", driverId: null, effectiveFrom: "2026-07-10", effectiveTo: null, status: "approved" },
    ])).toBe(false);
    expect(dateInHalfOpenRange("2026-07-10", "2026-07-01", "2026-07-10")).toBe(false);
    expect(hasOverlappingAssignments([
      { organizationId: "org-a", fuelCardId: "card", externalCardId: "CARD-A-0001", vehicleId: "v1", driverId: null, effectiveFrom: "2026-07-01", effectiveTo: "2026-07-11", status: "approved" },
      { organizationId: "org-a", fuelCardId: "card", externalCardId: "CARD-A-0001", vehicleId: "v2", driverId: null, effectiveFrom: "2026-07-10", effectiveTo: null, status: "approved" },
    ])).toBe(true);
  });

  it("keeps same card identifiers in different organizations isolated", () => {
    const group = parseOctaneFuelText(syntheticFuelText()).cardGroups[0];
    const result = matchFuelCardGroup(group, matchingContext({
      knownCards: [
        { organizationId: "org-b", fuelCardId: "other-org-card", externalCardId: "CARD-A-0001" },
      ],
    }));
    expect(result.candidates[0].status).toBe("unmatched");
  });
});

describe("fuel adapter and SQL source contracts", () => {
  it("returns unsupported schema for fuel XLSX until a real sample exists", async () => {
    const inspection = await inspectFuelXlsxSchema({
      bytes: new Uint8Array(),
      metadata: {
        sourceType: "fuel_card",
        originalFilename: "fuel.xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        sizeBytes: 0,
        sha256Hash: "0".repeat(64),
      },
      parser: { name: "test", version: "0" },
    });
    expect(inspection.warnings).toEqual(["unsupported_fuel_schema"]);
    expect(inspection.details).toMatchObject({ supported: false });
  });

  it("creates exactly the seven approved fuel tables in migration and schema", () => {
    for (const table of [
      "fuel_import_reports",
      "fuel_import_card_groups",
      "fuel_import_transactions",
      "fuel_import_transaction_lines",
      "fuel_cards",
      "fuel_card_assignments",
      "fuel_import_matches",
    ]) {
      expect(migration).toContain(`create table if not exists public.${table}`);
      expect(schema).toContain(`create table if not exists public.${table}`);
    }
    expect(migration).not.toContain("create table if not exists public.expenses");
    expect(migration).not.toContain("references public.settlements");
  });

  it("enforces same-org keys, RLS, immutability, source facts, active match uniqueness, and overlap rejection", () => {
    for (const source of [migration, schema]) {
      expect(source).toContain("fuel_import_reports_org_id_id_key unique (organization_id, id)");
      expect(source).toContain("foreign key (organization_id, batch_id)");
      expect(source).toContain("references public.amazon_import_batches (organization_id, id)");
      expect(source).toContain("references public.amazon_import_files (organization_id, batch_id, id)");
      expect(source).toContain("references public.vehicles (organization_id, id)");
      expect(source).toContain("references public.people (organization_id, id)");
      expect(source).toContain("alter table public.%I enable row level security");
      expect(source).toContain("for select to authenticated using (organization_id = (select public.current_org_id()))");
      expect(source).toContain("and (select public.is_org_writer())");
      expect(source).toContain("guard_amazon_import_organization_id");
      expect(source).toContain("guard_fuel_import_report_source");
      expect(source).toContain("guard_fuel_import_transaction_source");
      expect(source).toContain("fuel_import_matches_one_active_group_key");
      expect(source).toContain("fuel_import_matches_one_active_transaction_key");
      expect(source).toContain("fuel_card_assignments_no_approved_overlap");
      expect(source).toContain("daterange(effective_from, coalesce(effective_to, 'infinity'::date), '[)') with &&");
      expect(source).toContain("fuel_card_assignments_approved_target_check");
      expect(source).not.toMatch(/create policy .* on public\.fuel_.* for all/i);
    }
  });
});
