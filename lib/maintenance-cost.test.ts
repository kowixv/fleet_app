import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import {
  buildMaintenanceCostAlerts,
  calculateCpm,
  calculateMaintenanceCpmCost,
  calculateMaintenanceCostTotal,
  calculateTotalBreakdownImpact,
  filterMaintenanceCostRows,
  filterMileagePeriodSnapshots,
  maintenanceCostRowsToCsv,
  normalizeMaintenanceCostCategory,
  reconcileInvoiceAllocations,
  summarizeMaintenanceCosts,
  type MaintenanceCostRow,
  type MileagePeriodSnapshot,
} from "./maintenance-cost";

const migration = readFileSync("supabase/migrations/20260713020000_maintenance_cost_analytics.sql", "utf8");
const categoryCostMigration = readFileSync("supabase/migrations/20260714010000_maintenance_category_cost_contract.sql", "utf8");

function row(overrides: Partial<MaintenanceCostRow>): MaintenanceCostRow {
  return {
    source_record_id: overrides.source_record_id ?? crypto.randomUUID(),
    source_type: overrides.source_type ?? "maintenance_record",
    vehicle_id: overrides.vehicle_id ?? "v1",
    unit_number: overrides.unit_number ?? "101",
    invoice_id: overrides.invoice_id ?? null,
    expense_id: overrides.expense_id ?? null,
    invoice_hash: overrides.invoice_hash ?? null,
    cost_date: overrides.cost_date ?? "2026-07-01",
    shop: overrides.shop ?? "Shop A",
    service_type: overrides.service_type ?? "Oil Service",
    service_key: overrides.service_key ?? "oil service",
    category: overrides.category ?? "routine_pm",
    planned: overrides.planned ?? true,
    status: overrides.status ?? "completed",
    mileage_at_service: overrides.mileage_at_service ?? 100000,
    parts_cost: overrides.parts_cost ?? 0,
    labor_cost: overrides.labor_cost ?? 0,
    shop_fees: overrides.shop_fees ?? 0,
    tax_cost: overrides.tax_cost ?? 0,
    towing_cost: overrides.towing_cost ?? 0,
    road_service_cost: overrides.road_service_cost ?? 0,
    hotel_travel_cost: overrides.hotel_travel_cost ?? 0,
    other_cost: overrides.other_cost ?? 0,
    warranty_recovery: overrides.warranty_recovery ?? 0,
    total_cost: overrides.total_cost ?? null,
    downtime_days: overrides.downtime_days ?? 0,
    ...overrides,
  };
}

const snapshots: MileagePeriodSnapshot[] = [
  { vehicle_id: "v1", period_start: "2026-07-01", period_end: "2026-07-31", miles_driven: 10000 },
  { vehicle_id: "v2", period_start: "2026-07-01", period_end: "2026-07-31", miles_driven: 5000 },
];

function expectOrdered(source: string, tokens: string[]) {
  let previous = -1;
  for (const token of tokens) {
    const next = source.indexOf(token, previous + 1);
    expect(next, `Missing ${token}`).toBeGreaterThanOrEqual(0);
    expect(next, `${token} is out of order`).toBeGreaterThan(previous);
    previous = next;
  }
}

describe("maintenance cost analytics", () => {
  it("calculates CPM with the requested formula", () => {
    const cost = calculateMaintenanceCpmCost({
      parts_cost: 100,
      labor_cost: 200,
      shop_fees: 25,
      road_service_cost: 50,
      towing_cost: 75,
      other_cost: 20,
      tax_cost: 30,
      diagnostic_cost: 15,
      freight_shipping_cost: 10,
      core_charge_cost: 40,
      environmental_fee_cost: 5,
      machine_shop_cost: 60,
      sublet_cost: 80,
      hotel_travel_cost: 999,
      warranty_recovery: 70,
      refund_credit: 15,
    });
    expect(cost).toBe(625);
    expect(calculateCpm(cost, 1000)).toBe(0.625);
  });

  it("subtracts warranty recovery and refund credit while excluding hotel from CPM", () => {
    const input = {
      parts_cost: 500,
      labor_cost: 100,
      tax_cost: 30,
      hotel_travel_cost: 90,
      warranty_recovery: 200,
      refund_credit: 20,
    };
    expect(calculateMaintenanceCostTotal(input)).toBe(500);
    expect(calculateMaintenanceCpmCost(input)).toBe(410);
    expect(calculateTotalBreakdownImpact(input)).toBe(500);
  });

  it("normalizes new and legacy maintenance cost categories", () => {
    expect(normalizeMaintenanceCostCategory("routine_pm", "PM-A")).toBe("preventive_maintenance");
    expect(normalizeMaintenanceCostCategory("cooling", "Coolant leak")).toBe("cooling_system");
    expect(normalizeMaintenanceCostCategory("transmission_driveline", "U-joint replacement")).toBe("driveline_differential");
    expect(normalizeMaintenanceCostCategory("transmission_driveline", "Clutch adjustment")).toBe("transmission_clutch");
    expect(normalizeMaintenanceCostCategory("road_service_towing", "Towing")).toBe("other");
  });

  it("handles zero miles without division", () => {
    const summary = summarizeMaintenanceCosts([row({ parts_cost: 100 })], []);
    expect(summary.fleetCpm).toBeNull();
    expect(summary.insufficientMileage).toBe(true);
  });

  it("does not double count linked invoice expenses in the canonical view contract", () => {
    expect(migration).toContain("from expenses e");
    expect(migration).toContain("e.maintenance_invoice_id is null");
    expect(migration).toContain("e.invoice_hash is null");
    expect(migration).toContain("canonical_cost_source = 'maintenance_records'");
  });

  it("validates invoice allocation reconciliation", () => {
    const ok = reconcileInvoiceAllocations(1000, [{ total_cost: 600 }, { total_cost: 399.5 }], 1);
    const bad = reconcileInvoiceAllocations(1000, [{ total_cost: 600 }, { total_cost: 350 }], 1);
    expect(ok.ok).toBe(true);
    expect(bad.ok).toBe(false);
    expect(bad.difference).toBe(-50);
  });

  it("guards duplicate expense creation by invoice hash", () => {
    expect(migration).toContain("expenses_org_invoice_hash_key");
    expect(migration).toContain("where not exists");
    expect(migration).toContain("invoice_hash = v_invoice.file_hash");
  });

  it("splits planned versus unscheduled costs", () => {
    const summary = summarizeMaintenanceCosts([
      row({ total_cost: 500, planned: true }),
      row({ total_cost: 700, planned: false }),
    ], snapshots);
    expect(summary.plannedCost).toBe(500);
    expect(summary.unscheduledCost).toBe(700);
  });

  it("detects repeat repairs within 30 days", () => {
    const summary = summarizeMaintenanceCosts([
      row({ source_record_id: "a", service_key: "dpf regen", service_type: "DPF Regen", cost_date: "2026-07-01" }),
      row({ source_record_id: "b", service_key: "dpf regen", service_type: "DPF Regen", cost_date: "2026-07-20" }),
    ], snapshots);
    const alerts = buildMaintenanceCostAlerts([
      row({ source_record_id: "a", service_key: "dpf regen", service_type: "DPF Regen", cost_date: "2026-07-01" }),
      row({ source_record_id: "b", service_key: "dpf regen", service_type: "DPF Regen", cost_date: "2026-07-20" }),
    ], summary, 5000);
    expect(summary.repeatRepairRate30Days).toBe(0.5);
    expect(alerts.some((alert) => alert.type === "repeat_repair_30_days")).toBe(true);
  });

  it("filters dashboard rows by date, unit, category, plan status, shop and status", () => {
    const rows = [
      row({ source_record_id: "a", vehicle_id: "v1", category: "tires", planned: false, shop: "Shop A", status: "completed", cost_date: "2026-07-10" }),
      row({ source_record_id: "b", vehicle_id: "v2", category: "engine", planned: true, shop: "Shop B", status: "open", cost_date: "2026-07-10" }),
    ];
    expect(filterMaintenanceCostRows(rows, {
      start: "2026-07-01",
      end: "2026-07-31",
      vehicleId: "v1",
      category: "tires",
      planned: "unscheduled",
      shop: "Shop A",
      status: "completed",
    })).toHaveLength(1);
  });

  it("excludes undated costs from explicit date windows", () => {
    expect(filterMaintenanceCostRows([
      row({ source_record_id: "a", cost_date: null }),
      row({ source_record_id: "b", cost_date: "2026-07-10" }),
    ], { start: "2026-07-01", end: "2026-07-31" }).map((item) => item.source_record_id)).toEqual(["b"]);
  });

  it("filters mileage snapshots to the same selected period", () => {
    expect(filterMileagePeriodSnapshots([
      { vehicle_id: "v1", period_start: "2026-06-01", period_end: "2026-06-30", miles_driven: 9000 },
      { vehicle_id: "v1", period_start: "2026-07-01", period_end: "2026-07-31", miles_driven: 10000 },
      { vehicle_id: "v2", period_start: "2026-07-01", period_end: "2026-07-31", miles_driven: 5000 },
    ], { start: "2026-07-01", end: "2026-07-31", vehicleId: "v1" })).toEqual([
      { vehicle_id: "v1", period_start: "2026-07-01", period_end: "2026-07-31", miles_driven: 10000 },
    ]);
  });

  it("scopes tables and view by organization/RLS", () => {
    expect(migration).toContain("organization_id uuid not null");
    expect(migration).toContain("vehicle_mileage_period_snapshots enable row level security");
    expect(migration).toContain("using (organization_id = (select current_org_id()))");
    expect(migration).toContain("with (security_invoker = true)");
  });

  it("extends the database cost contract for new fields and category compatibility", () => {
    for (const column of [
      "diagnostic_cost",
      "freight_shipping_cost",
      "core_charge_cost",
      "environmental_fee_cost",
      "machine_shop_cost",
      "sublet_cost",
      "refund_credit",
      "cause",
      "breakdown_occurred",
    ]) {
      expect(categoryCostMigration).toContain(`add column if not exists ${column}`);
    }
    expect(categoryCostMigration).toContain("'preventive_maintenance'");
    expect(categoryCostMigration).toContain("'routine_pm'");
    expect(categoryCostMigration).toContain("create or replace function normalize_maintenance_cost_category");
    expect(categoryCostMigration).toContain("create or replace view maintenance_cost_fact_v");
    expect(categoryCostMigration).toContain("total_breakdown_impact");
    expect(categoryCostMigration).toContain("and e.invoice_hash is null");
  });

  it("appends new maintenance cost view columns after the original view columns", () => {
    const viewSql = categoryCostMigration.slice(
      categoryCostMigration.indexOf("create or replace view maintenance_cost_fact_v"),
      categoryCostMigration.indexOf("revoke all on maintenance_cost_fact_v"),
    );
    const maintenanceBranch = viewSql.slice(0, viewSql.indexOf("union all"));
    const expenseBranch = viewSql.slice(viewSql.indexOf("union all"));
    const originalColumnOrder = [
      "organization_id",
      "source_record_id",
      "source_type",
      "vehicle_id",
      "unit_number",
      "invoice_id",
      "expense_id",
      "invoice_hash",
      "cost_date",
      "shop",
      "service_type",
      "service_key",
      "category",
      "planned",
      "status",
      "mileage_at_service",
      "parts_cost",
      "labor_cost",
      "shop_fees",
      "tax_cost",
      "towing_cost",
      "road_service_cost",
      "hotel_travel_cost",
      "other_cost",
      "warranty_recovery",
      "total_cost",
      "cpm_cost",
      "downtime_start",
      "downtime_end",
      "downtime_days",
    ];
    const appendedColumnOrder = [
      "cause",
      "breakdown_occurred",
      "diagnostic_cost",
      "freight_shipping_cost",
      "core_charge_cost",
      "environmental_fee_cost",
      "machine_shop_cost",
      "sublet_cost",
      "refund_credit",
      "total_breakdown_impact",
    ];
    expectOrdered(maintenanceBranch, [...originalColumnOrder, ...appendedColumnOrder]);
    expectOrdered(expenseBranch, [...originalColumnOrder, ...appendedColumnOrder]);
    expect(maintenanceBranch).toContain("r.cause::text as cause");
    expect(expenseBranch).toContain("null::text as cause");
    expect(expenseBranch).toContain("false::boolean as breakdown_occurred");
    expect(expenseBranch).toContain("0::numeric as refund_credit");
  });

  it("keeps viewer writes blocked by is_org_writer policies and RPC checks", () => {
    expect(migration).toContain("and (select is_org_writer())");
    expect(migration).toContain("Write permission required");
    expect(migration).toContain("grant select on maintenance_cost_fact_v to authenticated");
  });

  it("keeps maintenance migrations in dependency order", () => {
    const files = readdirSync("supabase/migrations").filter((file) => file.endsWith(".sql")).sort();
    const positions = [
      "20260712000000_maintenance_invoice_upgrade.sql",
      "20260712010000_maintenance_invoice_review_inbox.sql",
      "20260713000000_maintenance_profiles_templates_combined_intervals.sql",
      "20260713010000_pm_inspection_system.sql",
      "20260713020000_maintenance_cost_analytics.sql",
      "20260714010000_maintenance_category_cost_contract.sql",
    ].map((file) => files.indexOf(file));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("exports the direct cost and new cost bucket fields", () => {
    const csv = maintenanceCostRowsToCsv([row({ diagnostic_cost: 12, refund_credit: 3 })]);
    expect(csv.split("\n")[0]).toContain("diagnostic");
    expect(csv.split("\n")[0]).toContain("refund_credit");
    expect(csv.split("\n")[0]).toContain("direct_maintenance_cost");
    expect(csv.split("\n")[0]).toContain("total_breakdown_impact");
  });
});
