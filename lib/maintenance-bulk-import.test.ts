import { describe, expect, it } from "vitest";
import fs from "node:fs";
import {
  chooseLatestBaseline,
  groupBulkInvoices,
  highestMileage,
  mapRecurringService,
  normalizeMileageCandidate,
  normalizeUnitNumber,
  PETERBILT_579_X15_TEMPLATE_NAME,
} from "./maintenance-bulk-import";

const serviceRow = (service_type: string, mileage: number | null, performed_date: string | null = "2026-06-01") => ({
  id: `${service_type}-${mileage ?? "x"}`,
  service_type,
  parts_used: [],
  performed_date,
  mileage,
  cost: 100,
  notes: null,
  default_action: "history" as const,
  mode: "history" as const,
  next_due_mileage: null,
  next_due_date: null,
  existing_rule_id: null,
  existing_rule_summary: null,
  existing_rule_decision: null,
  category: "routine_pm" as const,
  planned: false,
  parts_cost: 0,
  labor_cost: 0,
  shop_fees: 0,
  tax_cost: 0,
  towing_cost: 0,
  road_service_cost: 0,
  hotel_travel_cost: 0,
  other_cost: 100,
  warranty_recovery: 0,
  total_cost: 100,
  downtime_start: null,
  downtime_end: null,
  status: "completed",
});

describe("bulk historical maintenance import", () => {
  it("normalizes canonical unit numbers without invoice-number style labels", () => {
    expect(normalizeUnitNumber(" Unit #14129 ")).toBe("14129");
    expect(normalizeUnitNumber("truck ab-12")).toBe("AB-12");
  });

  it("selects the highest valid mileage and rejects bad candidates", () => {
    expect(normalizeMileageCandidate("349,000")).toBe(349000);
    expect(normalizeMileageCandidate("349000.5")).toBeNull();
    expect(normalizeMileageCandidate("-1")).toBeNull();
    expect(highestMileage([340000, "349,000", "bad", 345000])).toBe(349000);
  });

  it("matches VIN first, then canonical unit number, and preserves existing higher mileage", () => {
    const vehicles = [
      { id: "v1", unit_number: "14129", vin: "1XPBD49X1ND123456", current_mileage: 355000 },
    ];
    const groups = groupBulkInvoices([
      {
        id: "i1",
        file_name: "a.pdf",
        file_hash: "h1",
        invoice_date: "2026-06-01",
        shop_name: "Shop",
        vehicle_id: null,
        parsed_data: {
          parsed: { unit_number: "Unit 99999", vin: "1XPBD49X1ND123456" },
          review: {
            organization_id: "org",
            suggested_vehicle_id: null,
            invoice_number: "1",
            invoice_date: "2026-06-01",
            vendor: "Shop",
            mileage: 349000,
            total: 100,
            services: [serviceRow("Oil Change", 349000)],
            parser: { source: "text", confidence: 0.9, warnings: [] },
            warnings: [],
          },
        },
      },
    ], vehicles);
    expect(groups).toHaveLength(1);
    expect(groups[0].vehicle?.id).toBe("v1");
    expect(groups[0].proposed_current_mileage).toBe(355000);
  });

  it("includes prior completed invoice mileage when proposing current mileage", () => {
    const vehicles = [
      {
        id: "v1",
        unit_number: "14129",
        vin: null,
        current_mileage: 320000,
        prior_completed_invoice_mileages: [340000, 355000],
      },
    ];
    const groups = groupBulkInvoices([
      {
        id: "i1",
        file_name: "a.pdf",
        file_hash: "h1",
        invoice_date: "2026-06-01",
        shop_name: "Shop",
        vehicle_id: null,
        parsed_data: {
          parsed: { unit_number: "14129" },
          review: {
            organization_id: "org",
            suggested_vehicle_id: null,
            invoice_number: "1",
            invoice_date: "2026-06-01",
            vendor: "Shop",
            mileage: 349000,
            total: 100,
            services: [serviceRow("Oil Change", 349000)],
            parser: { source: "text", confidence: 0.9, warnings: [] },
            warnings: [],
          },
        },
      },
    ], vehicles);
    expect(groups[0].proposed_current_mileage).toBe(355000);
  });

  it("blocks automatic finalization when VIN and unit point to different existing vehicles", () => {
    const vehicles = [
      { id: "vin-match", unit_number: "100", vin: "1XPBD49X1ND123456", current_mileage: 100000 },
      { id: "unit-match", unit_number: "14129", vin: "1XPBD49X1ND654321", current_mileage: 200000 },
    ];
    const groups = groupBulkInvoices([
      {
        id: "i1",
        file_name: "a.pdf",
        file_hash: "h1",
        invoice_date: "2026-06-01",
        shop_name: "Shop",
        vehicle_id: null,
        parsed_data: {
          parsed: { unit_number: "14129", vin: "1XPBD49X1ND123456" },
          review: {
            organization_id: "org",
            suggested_vehicle_id: null,
            invoice_number: "1",
            invoice_date: "2026-06-01",
            vendor: "Shop",
            mileage: 349000,
            total: 100,
            services: [serviceRow("Oil Change", 349000)],
            parser: { source: "text", confidence: 0.9, warnings: [] },
            warnings: [],
          },
        },
      },
    ], vehicles);
    expect(groups[0].vehicle?.id).toBe("vin-match");
    expect(groups[0].status).toBe("blocked");
    expect(groups[0].conflicts.join(" ")).toContain("VIN ve unit number");
  });

  it("keeps multiple service history records for one unit and maps recurring baselines", () => {
    const groups = groupBulkInvoices([
      {
        id: "i1",
        file_name: "a.pdf",
        file_hash: "h1",
        invoice_date: "2026-01-10",
        shop_name: "Shop",
        vehicle_id: null,
        parsed_data: {
          parsed: { unit_number: "14129" },
          review: {
            organization_id: "org",
            suggested_vehicle_id: null,
            invoice_number: "1",
            invoice_date: "2026-01-10",
            vendor: "Shop",
            mileage: 300000,
            total: 100,
            services: [serviceRow("Oil Change", 300000, "2026-01-10")],
            parser: { source: "text", confidence: 0.9, warnings: [] },
            warnings: [],
          },
        },
      },
      {
        id: "i2",
        file_name: "b.pdf",
        file_hash: "h2",
        invoice_date: "2026-06-17",
        shop_name: "Shop",
        vehicle_id: null,
        parsed_data: {
          parsed: { unit_number: "14129" },
          review: {
            organization_id: "org",
            suggested_vehicle_id: null,
            invoice_number: "2",
            invoice_date: "2026-06-17",
            vendor: "Shop",
            mileage: 349000,
            total: 100,
            services: [serviceRow("Engine Oil and Filter", 349000, "2026-06-17")],
            parser: { source: "text", confidence: 0.9, warnings: [] },
            warnings: [],
          },
        },
      },
    ], []);
    expect(groups[0].services).toHaveLength(2);
    expect(groups[0].mapped_baselines[0]).toMatchObject({
      service_type: "Wet PM / Oil Service",
      date: "2026-06-17",
      mileage: 349000,
    });
  });

  it("keeps repair-only services out of recurring rule baselines", () => {
    expect(mapRecurringService("Coolant Refill").mapped_service_type).toBeNull();
    expect(mapRecurringService("DPF Regeneration").mapped_service_type).toBeNull();
    expect(mapRecurringService("Electrical Repair").reason).toBe("Bakım planına eşleşmedi");
    expect(mapRecurringService("DEF Filter Replacement").mapped_service_type).toBe("DEF Filter");
  });

  it("detects chronological mileage conflicts and preserves newer existing baselines", () => {
    const conflict = chooseLatestBaseline([
      { service_key: "pm-a", service_type: "PM-A", date: "2026-01-01", mileage: 350000 },
      { service_key: "pm-a", service_type: "PM-A", date: "2026-02-01", mileage: 340000 },
    ]);
    expect(conflict.conflict).toContain("Chronological mileage conflict");

    const preserved = chooseLatestBaseline([
      { service_key: "pm-a", service_type: "PM-A", date: "2026-01-01", mileage: 340000 },
    ], { date: "2026-03-01", mileage: 360000 });
    expect(preserved.preservedExisting).toBe(true);
  });

  it("does not emit a baseline update when an existing newer baseline is preserved", () => {
    const vehicles = [
      {
        id: "v1",
        unit_number: "14129",
        vin: null,
        current_mileage: 350000,
        existing_baselines: [{ service_key: "wet pm oil service", service_type: "Wet PM / Oil Service", date: "2026-07-01", mileage: 360000 }],
      },
    ];
    const groups = groupBulkInvoices([
      {
        id: "i1",
        file_name: "a.pdf",
        file_hash: "h1",
        invoice_date: "2026-06-01",
        shop_name: "Shop",
        vehicle_id: null,
        parsed_data: {
          parsed: { unit_number: "14129" },
          review: {
            organization_id: "org",
            suggested_vehicle_id: null,
            invoice_number: "1",
            invoice_date: "2026-06-01",
            vendor: "Shop",
            mileage: 349000,
            total: 100,
            services: [serviceRow("Oil Change", 349000, "2026-06-01")],
            parser: { source: "text", confidence: 0.9, warnings: [] },
            warnings: [],
          },
        },
      },
    ], vehicles);
    expect(groups[0].mapped_baselines).toHaveLength(0);
    expect(groups[0].warnings.join(" ")).toContain("mevcut daha yeni baseline korundu");
  });

  it("adds the ordered migration, RPCs, metadata, aliases and template name", () => {
    const sql = fs.readFileSync("supabase/migrations/20260713030000_bulk_historical_maintenance_invoice_import.sql", "utf8");
    expect(sql).toContain("create table if not exists maintenance_invoice_batches");
    expect(sql).toContain("create or replace function finalize_bulk_maintenance_invoice_unit");
    expect(sql).toContain("create or replace function undo_bulk_maintenance_invoice_batch");
    expect(sql).toContain("vehicle_mileage_logs_invoice_mileage_once_idx");
    expect(sql).toContain("vehicles_org_canonical_unit_unique_idx");
    expect(sql).toContain("vehicles_org_vin_unique_idx");
    expect(sql).toContain("exception when unique_violation");
    expect(sql).toContain("v_prior_completed_mileage");
    expect(sql).toContain("last_done_date = nullif(v_baseline->>'last_done_date'");
    expect(sql).toContain("maintenance_service_aliases");
    expect(sql).toContain(PETERBILT_579_X15_TEMPLATE_NAME);
  });
});
