import { describe, expect, it } from "vitest";
import {
  buildMaintenanceImportRecord,
  maintenanceInvoiceHash,
  normalizeMaintenanceInvoiceServices,
  safeMaintenanceInvoiceJson,
  type NormalizedMaintenanceService,
} from "./maintenance-invoice";

describe("maintenance invoice validation", () => {
  it("splits and validates multiple services", () => {
    const parsed = safeMaintenanceInvoiceJson(JSON.stringify({
      invoice_number: "INV-7",
      invoice_date: "2026-07-10",
      shop_name: "Example Shop",
      unit_number: "14106",
      mileage: "155,000 mi",
      services: [
        { service_type: "Oil Change", part_name: "Oil filter", cost: "$420.50" },
        { service_type: "Annual Inspection", performed_date: "bad-date", mileage: -1 },
      ],
    }));
    expect(parsed?.services).toHaveLength(2);
    expect(parsed?.services[0]).toMatchObject({ performed_date: "2026-07-10", mileage: 155_000, cost: 420.5 });
    expect(parsed?.services[1]).toMatchObject({ performed_date: "2026-07-10", mileage: 155_000 });
  });

  it("rejects output without services", () => {
    expect(safeMaintenanceInvoiceJson('{"services":[]}')).toBeNull();
  });

  it("creates a stable SHA-256 hash", () => {
    expect(maintenanceInvoiceHash(new TextEncoder().encode("same invoice")))
      .toBe(maintenanceInvoiceHash(new TextEncoder().encode("same invoice")));
    expect(maintenanceInvoiceHash(new TextEncoder().encode("same invoice"))).toHaveLength(64);
  });

  it("deduplicates duplicated chassis inspection lines into one full inspection", () => {
    const normalized = normalizeMaintenanceInvoiceServices([
      { service_type: "Full chassis inspection", part_name: null, parts_used: [], performed_date: "2026-07-10", mileage: 150_000, cost: 100, notes: null },
      { service_type: "Chassis inspection labor", part_name: null, parts_used: [], performed_date: "2026-07-10", mileage: 150_000, cost: 75, notes: null },
    ]);

    expect(normalized).toHaveLength(1);
    expect(normalized[0]).toMatchObject({
      service_type: "Full Inspection",
      cost: 175,
      default_action: "history",
    });
  });

  it("groups multiple suspension parts under one suspension repair service", () => {
    const normalized = normalizeMaintenanceInvoiceServices([
      { service_type: "Suspension repair labor", part_name: null, parts_used: [], performed_date: null, mileage: null, cost: 300, notes: null },
      { service_type: "Tender spring", part_name: "Tender spring TS-44", parts_used: [], performed_date: null, mileage: null, cost: 120, notes: null },
      { service_type: "Shock absorber", part_name: "Shock absorber SA-9", parts_used: ["Shock absorber SA-9"], performed_date: null, mileage: null, cost: 180, notes: null },
    ]);

    expect(normalized).toHaveLength(1);
    expect(normalized[0].service_type).toBe("Suspension Repair");
    expect(normalized[0].cost).toBe(600);
    expect(normalized[0].parts_used).toEqual(expect.arrayContaining(["Tender spring TS-44", "tender spring", "Shock absorber SA-9"]));
    expect(normalized[0].default_action).toBe("history");
  });

  it("normalizes the common repair-heavy invoice pattern without part-only duplicates", () => {
    const normalized = normalizeMaintenanceInvoiceServices([
      { service_type: "Full Inspection", part_name: null, parts_used: [], performed_date: null, mileage: null, cost: null, notes: null },
      { service_type: "Electrical wiring repair", part_name: "Harness", parts_used: [], performed_date: null, mileage: null, cost: null, notes: null },
      { service_type: "Halo install", part_name: "Halo kit", parts_used: [], performed_date: null, mileage: null, cost: null, notes: null },
      { service_type: "Tender spring", part_name: "Tender spring", parts_used: [], performed_date: null, mileage: null, cost: null, notes: null },
      { service_type: "Shock absorbers", part_name: "Shock absorbers", parts_used: [], performed_date: null, mileage: null, cost: null, notes: null },
      { service_type: "Engine air filter", part_name: null, parts_used: [], performed_date: null, mileage: null, cost: null, notes: null },
      { service_type: "Cabin air filter", part_name: null, parts_used: [], performed_date: null, mileage: null, cost: null, notes: null },
      { service_type: "TriPac APU repair", part_name: null, parts_used: [], performed_date: null, mileage: null, cost: null, notes: null },
      { service_type: "DPF regeneration", part_name: null, parts_used: [], performed_date: null, mileage: null, cost: null, notes: null },
      { service_type: "Coolant refill", part_name: "Coolant", parts_used: [], performed_date: null, mileage: null, cost: null, notes: null },
    ]);

    expect(normalized.map((service) => service.service_type)).toEqual([
      "Full Inspection",
      "Electrical System Repair",
      "Halo Installation",
      "Suspension Repair",
      "Engine Air Filter Replacement",
      "Cabin Air Filter Replacement",
      "TriPac/APU Repair",
      "DPF Regeneration",
      "Coolant Service",
    ]);
  });

  it("builds history-only records without next-due rule updates", () => {
    const service: NormalizedMaintenanceService = {
      service_type: "Electrical System Repair",
      parts_used: ["Harness"],
      performed_date: "2026-07-10",
      mileage: 150_000,
      cost: 450,
      notes: null,
      default_action: "history",
    };

    const result = buildMaintenanceImportRecord({
      service,
      mode: "history",
      vehicleId: "vehicle-1",
      vehicleCurrentMileage: 150_000,
      invoiceMileage: null,
      invoiceShopName: "Shop",
      performedDate: service.performed_date,
      nextDue: { next_due_mileage: 160_000, next_due_date: null },
    });

    expect(result.record).toMatchObject({
      resolution: "history",
      next_due_mileage: null,
      next_due_date: null,
      parts_used: ["Harness"],
    });
  });

  it("returns no record for skipped services", () => {
    const service: NormalizedMaintenanceService = {
      service_type: "DPF Regeneration",
      parts_used: [],
      performed_date: null,
      mileage: null,
      cost: null,
      notes: null,
      default_action: "history",
    };

    expect(buildMaintenanceImportRecord({
      service,
      mode: "skip",
      vehicleId: "vehicle-1",
      vehicleCurrentMileage: 0,
      invoiceMileage: null,
      invoiceShopName: null,
      performedDate: null,
    }).record).toBeNull();
  });

  it("flags zero-mileage vehicles before mileage-based rule creation", () => {
    const service: NormalizedMaintenanceService = {
      service_type: "Oil Change",
      parts_used: ["Oil filter"],
      performed_date: "2026-07-10",
      mileage: null,
      cost: null,
      notes: null,
      default_action: "plan",
    };

    const result = buildMaintenanceImportRecord({
      service,
      mode: "plan",
      vehicleId: "vehicle-1",
      vehicleCurrentMileage: 0,
      invoiceMileage: null,
      invoiceShopName: null,
      performedDate: service.performed_date,
      nextDue: { next_due_mileage: 25_000, next_due_date: null },
    });

    expect(result.zeroMileageRuleWarning).toBe(true);
    expect(result.record?.resolution).toBe("overwrite");
  });
});
