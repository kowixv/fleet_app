import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { maintenanceInvalidationPaths } from "@/lib/maintenance/cache-policy";
import {
  canCompleteMaintenanceInvoiceJob,
  maintenanceInvoiceRetryDecision,
} from "@/lib/maintenance/invoice-pipeline";
import {
  milesFromAuthoritativeLogs,
  prorateSnapshotMiles,
} from "@/lib/maintenance/mileage-period";
import {
  decodeMaintenanceCursor,
  encodeMaintenanceCursor,
  maintenanceKeysetFilter,
  nextMaintenanceCursor,
} from "@/lib/maintenance/pagination";
import {
  summarizeMaintenanceCosts,
  type MaintenanceCostRow,
} from "@/lib/maintenance-cost";

const migration = readFileSync(
  new URL("../../supabase/migrations/20260726134020_maintenance_performance_types_async_pipeline.sql", import.meta.url),
  "utf8",
);
const uploadRoute = readFileSync(
  new URL("../../app/api/maintenance/invoices/upload/route.ts", import.meta.url),
  "utf8",
);
const programAction = readFileSync(
  new URL("../../app/(app)/maintenance/program-actions.ts", import.meta.url),
  "utf8",
);
const invoiceActions = readFileSync(
  new URL("../../app/(app)/maintenance/invoice-actions.ts", import.meta.url),
  "utf8",
);
const invoicePage = readFileSync(
  new URL("../../app/(app)/maintenance/invoices/page.tsx", import.meta.url),
  "utf8",
);

function costRow(index: number): MaintenanceCostRow {
  return {
    source_record_id: `record-${index}`,
    source_type: "maintenance_record",
    vehicle_id: "11111111-1111-4111-8111-111111111111",
    unit_number: "101",
    invoice_id: null,
    expense_id: null,
    invoice_hash: null,
    cost_date: "2026-07-20",
    shop: "Test Shop",
    service_type: "PM",
    service_key: "pm",
    category: "preventive_maintenance",
    planned: true,
    status: "completed",
    mileage_at_service: null,
    other_cost: 10,
    total_cost: 10,
  };
}

describe("maintenance performance and type-safety contracts", () => {
  it("keeps aggregate parity beyond the old 1000-row boundary", () => {
    const rows = Array.from({ length: 1_501 }, (_, index) => costRow(index));
    const summary = summarizeMaintenanceCosts(rows, [{
      vehicle_id: "11111111-1111-4111-8111-111111111111",
      period_start: "2026-07-01",
      period_end: "2026-07-31",
      miles_driven: 15_010,
    }]);
    expect(summary.totalCost).toBe(15_010);
    expect(summary.plannedCost).toBe(15_010);
    expect(summary.fleetCpm).toBe(1);
    expect(migration).toContain("No row cap is used for aggregate inputs");
    expect(migration).not.toMatch(/get_maintenance_cost_analytics_v2[\s\S]{0,3000}limit 1000/i);
  });

  it("uses stable opaque keyset cursors", () => {
    const cursor = encodeMaintenanceCursor({
      sortValue: "2026-07-26T12:00:00.000Z",
      id: "11111111-1111-4111-8111-111111111111",
    });
    expect(decodeMaintenanceCursor(cursor)).toEqual({
      sortValue: "2026-07-26T12:00:00.000Z",
      id: "11111111-1111-4111-8111-111111111111",
    });
    expect(maintenanceKeysetFilter("created_at", decodeMaintenanceCursor(cursor)!))
      .toContain("created_at.lt.2026-07-26T12:00:00.000Z");
    const page = nextMaintenanceCursor([
      { id: "11111111-1111-4111-8111-111111111111", created_at: "2026-07-26T12:00:00.000Z" },
      { id: "22222222-2222-4222-8222-222222222222", created_at: "2026-07-25T12:00:00.000Z" },
    ], (row) => row.created_at, 1);
    expect(page.rows).toHaveLength(1);
    expect(page.nextCursor).not.toBeNull();
    expect(invoicePage).toContain('{ count: "exact", head: true }');
    expect(invoicePage).toContain("totalResult.count");
  });

  it("does not zero a July 15-August 15 period when logs bracket it", () => {
    const result = milesFromAuthoritativeLogs([
      { date: "2026-07-10", mileage: 100_000 },
      { date: "2026-08-20", mileage: 106_150 },
    ], "2026-07-15", "2026-08-15");
    expect(result).not.toBeNull();
    expect(result!.miles).toBeGreaterThan(4_500);
    expect(result!.estimated).toBe(true);
    const prorated = prorateSnapshotMiles({
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
      miles: 3_100,
    }, "2026-07-15", "2026-08-15");
    expect(prorated).toBeCloseTo(1_700, 8);
    expect(migration).toContain("period_snapshots_prorated");
  });

  it("claims invoice jobs idempotently and retries with bounded backoff", () => {
    expect(migration).toContain("for update skip locked");
    expect(migration).toContain("lease_token");
    expect(uploadRoute).toContain('.eq("file_hash", hash)');
    expect(uploadRoute).not.toContain("parseMaintenanceInvoice(bytes)");
    expect(maintenanceInvoiceRetryDecision(1, 3, true)).toEqual({
      status: "queued",
      retryAtSeconds: 60,
    });
    expect(maintenanceInvoiceRetryDecision(3, 3, true)).toEqual({
      status: "failed",
      retryAtSeconds: null,
    });
    expect(canCompleteMaintenanceInvoiceJob("parsing", true)).toBe(true);
    expect(canCompleteMaintenanceInvoiceJob("parsing", false)).toBe(false);
    expect(invoiceActions).toContain("retryMaintenanceInvoiceProcessing");
    expect(invoiceActions).toContain('.eq("pipeline_status", "failed")');
  });

  it("installs maintenance programs through one bulk RPC", () => {
    expect(programAction).toContain('.rpc("install_maintenance_program_bulk"');
    expect(programAction).not.toContain('.rpc("save_vehicle_maintenance_reminder"');
    expect(programAction).not.toContain('.rpc("save_maintenance_reminder"');
    expect(migration).toContain("exception when others");
    expect(migration).toContain("'created'");
    expect(migration).toContain("'skipped'");
    expect(migration).toContain("'failed'");
  });

  it("invalidates only maintenance routes relevant to the mutation", () => {
    const invoice = maintenanceInvalidationPaths({ kind: "invoice", id: "invoice-1" });
    expect(invoice).toContain("/maintenance/invoices");
    expect(invoice).toContain("/maintenance/costs");
    expect(invoice).not.toContain("/");
    expect(invoice).not.toContain("/vehicles");
    const mileage = maintenanceInvalidationPaths({ kind: "mileage", vehicleId: "vehicle-1" });
    expect(mileage).toEqual([
      "/maintenance",
      "/maintenance/costs",
      "/maintenance/units/vehicle-1",
    ]);
  });
});
