import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AmazonRevenueItem } from "../revenue/revenue-builder";
import type { FuelCardGroup, FuelProductLine, FuelTransaction } from "../fuel/fuel-normalization";
import { mapFuelLineToExpenseProjection } from "./fuel-expense-mapper";
import { applyProjectionPreview, previewFuelExpenseProjections, previewRevenueLoadProjections } from "./projection-preview";
import { projectionRevision } from "./projection-revision";
import { revenueProjectionRpcPayload } from "./projection-apply";
import { mapRevenueItemToLoadProjection } from "./revenue-load-mapper";

const migration = readFileSync("supabase/migrations/20260716050000_amazon_projection_links.sql", "utf8");
const schema = readFileSync("supabase/schema.sql", "utf8");
const schemaProjectionStart = schema.indexOf("-- Amazon controlled projection links.");
const schemaProjectionEnd = schema.indexOf("-- Amazon statement candidates.");
const schemaProjectionBlock = schema.slice(schemaProjectionStart, schemaProjectionEnd);

function revenueItem(patch: Partial<AmazonRevenueItem> = {}): AmazonRevenueItem {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    invoiceId: "invoice-1",
    groupingType: "load",
    groupingKey: "group-1",
    tripId: "TRIP-1",
    primaryLoadId: "LOAD-1",
    startDate: "2026-07-05",
    endDate: "2026-07-06",
    originFacilityCode: "ORIGIN",
    destinationFacilityCode: "DEST",
    routeResolutionStatus: "unresolved",
    distance: 320,
    baseAmount: 1000,
    fuelSurchargeAmount: 50,
    tollAmount: 20,
    detentionAmount: 0,
    tonuAmount: 0,
    otherAmount: 0,
    grossAmount: 1070,
    matchStatus: "exact",
    driverAssignmentStatus: "source_only",
    vehicleAssignmentStatus: "source_only",
    reconciliationStatus: "passed",
    sourceRevision: "source-revision-1",
    sources: [{
      contributionType: "standalone",
      paymentRow: {
        sourceFile: { originalFilename: "PAYMENT.xlsx", sha256Hash: "hash", sourceType: "amazon_payment" },
        sourceSheet: "Payment Details",
        sourceRowNumber: 2,
        rawValues: {},
        normalizedValues: {} as never,
        parser: { name: "test", version: "1" },
        schemaSignature: { sourceType: "amazon_payment", signature: "sig", parser: { name: "test", version: "1" } },
        parseStatus: "parsed",
        warnings: [],
        blockingIssues: [],
        sourceFingerprint: "a".repeat(64),
      },
    }],
    ...patch,
  };
}

function fuelGroup(patch: Partial<FuelCardGroup> = {}): FuelCardGroup {
  return {
    sourceGroupNumber: 1,
    cardExternalId: "CARD-1",
    cardLastFour: "1111",
    driverLabelRaw: null,
    driverLabelNormalized: null,
    unitLabelRaw: null,
    unitLabelNormalized: null,
    reportedTransactionCount: 1,
    reportedTotalAmount: 10,
    reportedTotalQuantity: 1,
    reportedDiscountAmount: 0,
    isPlaceholderGroup: false,
    sourcePageStart: 1,
    sourcePageEnd: 1,
    sourceSnapshot: {},
    transactions: [],
    ...patch,
  };
}

function fuelTransaction(patch: Partial<FuelTransaction> = {}): FuelTransaction {
  return {
    sourceTransactionFingerprint: "b".repeat(64),
    transactionAt: "2026-07-05T10:00:00",
    invoiceNumber: "INV-1",
    merchantRaw: "Merchant",
    cityRaw: "City",
    stateRaw: "ST",
    odometerRaw: null,
    feesAmount: null,
    sourcePage: 1,
    sourceRowNumber: 10,
    sourceSnapshot: {},
    productLines: [],
    ...patch,
  };
}

function fuelLine(patch: Partial<FuelProductLine> = {}): FuelProductLine {
  return {
    sourceLineOrder: 1,
    productTypeRaw: "ULSD",
    productTypeNormalized: "ULSD",
    quantity: 10,
    retailUnitPrice: 4,
    chargedUnitPrice: 3.5,
    discountPerUnit: 0.5,
    discountAmount: 5,
    dealType: "discount",
    chargedAmount: 35,
    sourceSnapshot: {},
    ...patch,
  };
}

describe("amazon revenue load projection mapping", () => {
  it("maps one canonical revenue item to one pending load payload", () => {
    const projection = mapRevenueItemToLoadProjection({ item: revenueItem() });
    expect(projection.load).toMatchObject({
      load_number: "LOAD-1",
      load_source: "amazon_relay",
      gross_amount: 1070,
      fuel_surcharge: 50,
      status: "pending",
      driver_id: null,
      vehicle_id: null,
      pickup_location: null,
      delivery_location: null,
      route: null,
    });
    expect(projection.projectionSnapshot).toMatchObject({ tripId: "TRIP-1", primaryLoadId: "LOAD-1" });
  });

  it("uses canonical gross and never Trips estimated money", () => {
    const projection = mapRevenueItemToLoadProjection({ item: revenueItem({ grossAmount: 1234.56 }) });
    expect(projection.load.gross_amount).toBe(1234.56);
    expect(JSON.stringify(projection.projectionSnapshot)).not.toMatch(/estimatedCost/i);
  });

  it("leaves unresolved optional driver and facilities null", () => {
    const projection = mapRevenueItemToLoadProjection({ item: revenueItem() });
    expect(projection.load.driver_id).toBeNull();
    expect(projection.load.pickup_location).toBeNull();
    expect(projection.load.delivery_location).toBeNull();
  });

  it("uses verified facility locations without placing raw facility codes into route text", () => {
    const projection = mapRevenueItemToLoadProjection({
      item: revenueItem({ originFacilityCode: "ORIGIN", destinationFacilityCode: "DEST" }),
      references: {
        originFacility: { facilityCode: "ORIGIN", city: "Houston", state: "TX" },
        destinationFacility: { facilityCode: "DEST", city: "Dallas", state: "TX" },
      },
    });
    expect(projection.load.pickup_location).toBe("Houston, TX");
    expect(projection.load.delivery_location).toBe("Dallas, TX");
    expect(projection.load.route).toBe("Houston, TX -> Dallas, TX");
    expect(projection.load.route).not.toContain("ORIGIN");
    expect(projection.load.route).not.toContain("DEST");
  });

  it("preserves canonical/projection readiness while unresolved vehicle blocks settlement readiness only", () => {
    const projection = mapRevenueItemToLoadProjection({
      item: revenueItem(),
      canonicalReady: true,
      projectionReady: true,
      settlementReady: false,
    });
    expect(projection.canonicalReady).toBe(true);
    expect(projection.projectionReady).toBe(true);
    expect(projection.settlementReady).toBe(false);
    expect(projection.load.status).toBe("pending");
  });

  it("detects unchanged repeated preview and revision conflicts", () => {
    const projection = mapRevenueItemToLoadProjection({ item: revenueItem() });
    const first = previewRevenueLoadProjections({ items: [projection] });
    expect(first.toCreate).toHaveLength(1);
    const unchanged = previewRevenueLoadProjections({
      items: [projection],
      existing: [{
        sourceId: projection.revenueItemId,
        targetId: "load-1",
        sourceRevision: projection.sourceRevision,
        sourceFingerprint: projection.sourceFingerprint,
        projectionStatus: "projected",
      }],
    });
    expect(unchanged.unchanged).toHaveLength(1);
    const conflict = previewRevenueLoadProjections({
      items: [projection],
      existing: [{
        sourceId: projection.revenueItemId,
        targetId: "load-1",
        sourceRevision: "old",
        sourceFingerprint: projection.sourceFingerprint,
        projectionStatus: "projected",
      }],
    });
    expect(conflict.conflicts).toContainEqual(expect.objectContaining({ code: "revenue_projection_revision_conflict" }));
  });

  it("protects settlement-linked projected targets", () => {
    const projection = mapRevenueItemToLoadProjection({ item: revenueItem() });
    const preview = previewRevenueLoadProjections({
      items: [projection],
      existing: [{
        sourceId: projection.revenueItemId,
        targetId: "load-1",
        sourceRevision: projection.sourceRevision,
        sourceFingerprint: projection.sourceFingerprint,
        projectionStatus: "projected",
        targetSettlementLocked: true,
      }],
    });
    expect(preview.conflicts).toContainEqual(expect.objectContaining({ code: "projected_target_settlement_locked" }));
  });

  it("rejects duplicate source fingerprints and keeps projection revision source-order independent", () => {
    const a = mapRevenueItemToLoadProjection({ item: revenueItem({ id: "11111111-1111-1111-1111-111111111111" }) });
    const b = {
      ...mapRevenueItemToLoadProjection({ item: revenueItem({ id: "22222222-2222-2222-2222-222222222222" }) }),
      sourceFingerprint: a.sourceFingerprint,
    };
    const preview = previewRevenueLoadProjections({ items: [a, b] });
    expect(preview.invalid).toHaveLength(2);
    const one = previewRevenueLoadProjections({ items: [a] }).previewRevision;
    const again = previewRevenueLoadProjections({ items: [a] }).previewRevision;
    expect(one).toBe(again);
  });

  it("rejects stale preview apply and rolls back mid-batch conflicts in the contract", () => {
    const projection = mapRevenueItemToLoadProjection({ item: revenueItem() });
    const preview = previewRevenueLoadProjections({ items: [projection] });
    expect(applyProjectionPreview({ preview, expectedPreviewRevision: "stale" })).toMatchObject({ created: 0, conflicts: 1 });
    expect(applyProjectionPreview({ preview, expectedPreviewRevision: preview.previewRevision, failMidBatch: true })).toMatchObject({ created: 0 });
  });

  it("builds an RPC payload that ignores browser-supplied financial totals outside item payloads", () => {
    const projection = mapRevenueItemToLoadProjection({ item: revenueItem() });
    const payload = revenueProjectionRpcPayload({
      organizationId: "org-1",
      batchId: "batch-1",
      previewRevision: projectionRevision(["test"]),
      items: [projection],
    });
    expect(payload.p_items[0]).toHaveProperty("sourceRevision");
    expect(payload.p_items[0]).not.toHaveProperty("totalGross");
  });
});

describe("amazon fuel expense projection mapping", () => {
  it("maps one fuel product line to one non-deducting expense payload", () => {
    const projection = mapFuelLineToExpenseProjection({ group: fuelGroup(), transaction: fuelTransaction(), productLine: fuelLine() });
    expect(projection.expense).toMatchObject({
      date: "2026-07-05",
      category: "fuel",
      amount: 35,
      deduct_from_settlement: false,
      deduct_from_driver: false,
      deduct_from_owner: false,
      deduct_from_investor: false,
    });
  });

  it("keeps DEF and ULSD as separate expenses when separate source lines exist", () => {
    const tx = fuelTransaction();
    const ulsd = mapFuelLineToExpenseProjection({ group: fuelGroup(), transaction: tx, productLine: fuelLine({ sourceLineOrder: 1, productTypeNormalized: "ULSD", chargedAmount: 35 }) });
    const def = mapFuelLineToExpenseProjection({ group: fuelGroup(), transaction: tx, productLine: fuelLine({ sourceLineOrder: 2, productTypeNormalized: "DEF", chargedAmount: 12 }) });
    expect(ulsd.expense.category).toBe("fuel");
    expect(def.expense.category).toBe("def");
    expect(ulsd.transactionLineId).not.toBe(def.transactionLineId);
  });

  it("uses charged amount authority and keeps discount as metadata only", () => {
    const projection = mapFuelLineToExpenseProjection({
      group: fuelGroup(),
      transaction: fuelTransaction(),
      productLine: fuelLine({ chargedAmount: 35, discountAmount: 5 }),
    });
    expect(projection.expense.amount).toBe(35);
    expect(projection.projectionSnapshot).toMatchObject({ discountAmount: 5, discountPreservedAsMetadata: true });
  });

  it("keeps transaction-count warnings from blocking expense projection", () => {
    const projection = mapFuelLineToExpenseProjection({
      group: fuelGroup(),
      transaction: fuelTransaction(),
      productLine: fuelLine(),
      fuelSourceReady: true,
      expenseProjectionReady: true,
      settlementDeductionReady: false,
    });
    expect(projection.fuelSourceReady).toBe(true);
    expect(projection.expenseProjectionReady).toBe(true);
    expect(projection.settlementDeductionReady).toBe(false);
  });

  it("allows negative credits when the current expenses schema allows numeric amounts", () => {
    const projection = mapFuelLineToExpenseProjection({
      group: fuelGroup(),
      transaction: fuelTransaction(),
      productLine: fuelLine({ chargedAmount: -10 }),
    });
    const preview = previewFuelExpenseProjections({ items: [projection], negativeExpensesSupported: true });
    expect(preview.invalid).toEqual([]);
    expect(preview.totals.toCreate).toBe(-10);
  });

  it("does not auto-target unresolved fuel deductions", () => {
    const projection = mapFuelLineToExpenseProjection({ group: fuelGroup(), transaction: fuelTransaction(), productLine: fuelLine() });
    expect(projection.expense.driver_id).toBeNull();
    expect(projection.expense.vehicle_id).toBeNull();
    expect(projection.expense.deduct_from_settlement).toBe(false);
  });

  it("is idempotent and protects settlement-linked projected expenses", () => {
    const projection = mapFuelLineToExpenseProjection({ group: fuelGroup(), transaction: fuelTransaction(), productLine: fuelLine() });
    const unchanged = previewFuelExpenseProjections({
      items: [projection],
      existing: [{
        sourceId: projection.transactionLineId,
        targetId: "expense-1",
        sourceRevision: projection.sourceRevision,
        sourceFingerprint: projection.sourceFingerprint,
        projectionStatus: "projected",
      }],
    });
    expect(unchanged.unchanged).toHaveLength(1);
    const locked = previewFuelExpenseProjections({
      items: [projection],
      existing: [{
        sourceId: projection.transactionLineId,
        targetId: "expense-1",
        sourceRevision: projection.sourceRevision,
        sourceFingerprint: projection.sourceFingerprint,
        projectionStatus: "projected",
        targetSettlementLocked: true,
      }],
    });
    expect(locked.conflicts).toContainEqual(expect.objectContaining({ code: "projected_target_settlement_locked" }));
  });

  it("reconciles projected fuel line amounts exactly once", () => {
    const tx = fuelTransaction();
    const items = [
      mapFuelLineToExpenseProjection({ group: fuelGroup(), transaction: tx, productLine: fuelLine({ sourceLineOrder: 1, chargedAmount: 35 }) }),
      mapFuelLineToExpenseProjection({ group: fuelGroup(), transaction: tx, productLine: fuelLine({ sourceLineOrder: 2, productTypeNormalized: "DEF", chargedAmount: 12 }) }),
    ];
    const preview = previewFuelExpenseProjections({ items });
    expect(preview.eligibleCount).toBe(2);
    expect(preview.totals.toCreate).toBe(47);
  });
});

describe("amazon projection SQL source contracts", () => {
  it("creates exactly the two approved projection tables", () => {
    for (const source of [migration, schemaProjectionBlock]) {
      expect(source).toContain("create table if not exists public.amazon_revenue_load_projections");
      expect(source).toContain("create table if not exists public.amazon_fuel_expense_projections");
      expect(source).not.toContain("create table if not exists public.amazon_statement_candidates");
      expect(source).not.toContain("create table if not exists public.amazon_projected_loads");
    }
  });

  it("enforces active uniqueness and same-organization foreign keys", () => {
    for (const source of [migration, schemaProjectionBlock]) {
      expect(source).toContain("amazon_revenue_load_projections_active_revenue_item_key");
      expect(source).toContain("amazon_revenue_load_projections_active_load_key");
      expect(source).toContain("amazon_fuel_expense_projections_active_line_key");
      expect(source).toContain("amazon_fuel_expense_projections_active_expense_key");
      expect(source).toContain("foreign key (organization_id, batch_id, revenue_item_id)");
      expect(source).toContain("references public.amazon_revenue_items (organization_id, batch_id, id)");
      expect(source).toContain("references public.loads (organization_id, id)");
      expect(source).toContain("references public.expenses (organization_id, id)");
    }
  });

  it("uses RLS, read-only authenticated policies, and RPC-owned writes", () => {
    for (const source of [migration, schemaProjectionBlock]) {
      expect(source).toContain("alter table public.%I enable row level security");
      expect(source).toContain("create policy %I_select");
      expect(source).not.toContain("create policy %I_insert");
      expect(source).not.toContain("create policy %I_update");
      expect(source).not.toContain("create policy %I_delete");
      expect(source).toContain("grant insert, update, delete on table");
      expect(source).toContain("to service_role");
    }
  });

  it("defines fixed-search-path RPCs with restricted execute permissions", () => {
    for (const source of [migration, schemaProjectionBlock]) {
      expect(source).toContain("create or replace function public.apply_amazon_revenue_load_projections");
      expect(source).toContain("create or replace function public.apply_amazon_fuel_expense_projections");
      expect(source).toContain("security definer");
      expect(source).toContain("set search_path = public");
      expect(source).toContain("revoke execute on function public.apply_amazon_revenue_load_projections");
      expect(source).toContain("revoke execute on function public.apply_amazon_fuel_expense_projections");
      expect(source).toContain("grant execute on function public.apply_amazon_revenue_load_projections");
      expect(source).toContain("grant execute on function public.apply_amazon_fuel_expense_projections");
    }
  });

  it("does not create settlements and treats legacy settlement pointers as non-authoritative", () => {
    for (const source of [migration, schemaProjectionBlock]) {
      expect(source).not.toContain("insert into public.settlements");
      expect(source).not.toContain("insert into settlement_load_links");
      expect(source).not.toContain("insert into settlement_expense_links");
      expect(source).not.toContain("set settlement_id");
      expect(source).toContain("join public.settlements");
      expect(source).toContain("s.status in ('finalized','paid')");
    }
  });

  it("recomputes financial amounts from canonical database rows inside RPCs", () => {
    for (const source of [migration, schemaProjectionBlock]) {
      expect(source).toContain("coalesce(v_revenue.gross_amount, 0)");
      expect(source).toContain("coalesce(v_revenue.fuel_surcharge_amount, 0)");
      expect(source).toContain("coalesce(v_line.charged_amount, 0)");
      expect(source).not.toContain("v_item #>> '{load,gross_amount}'");
      expect(source).not.toContain("v_item #>> '{expense,amount}'");
    }
  });
});
