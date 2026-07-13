import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  applyExistingRules,
  applyServiceDefaults,
  buildFinalImportRecords,
  canCreateExpenseForInvoice,
  createReviewDraftData,
  deleteServiceRow,
  detectDuplicateHash,
  mergeServiceRows,
  mileageWarnings,
  serviceKey,
  undoIsolatedIds,
  type ReviewServiceRow,
} from "./maintenance-invoice-review";

const parser = { source: "text" as const, confidence: 0.82, warnings: [] };
const parsed = {
  invoice_number: "INV-1",
  invoice_date: "2026-07-12",
  shop_name: "Fleet Shop",
  unit_number: "14106",
  vehicle_id_text: null,
  mileage: 150_000,
  services: [
    { service_type: "Engine air filter", part_name: "AF-1", parts_used: [], performed_date: null, mileage: null, cost: 40, notes: null },
    { service_type: "DPF regeneration", part_name: null, parts_used: [], performed_date: null, mileage: null, cost: 300, notes: null },
  ],
};

function row(id: string, service_type: string): ReviewServiceRow {
  return {
    id,
    service_type,
    parts_used: [],
    performed_date: "2026-07-12",
    mileage: 150_000,
    cost: 100,
    notes: null,
    default_action: "history",
    mode: "history",
    next_due_mileage: null,
    next_due_date: null,
    existing_rule_id: null,
    existing_rule_summary: null,
    existing_rule_decision: null,
  };
}

describe("maintenance invoice review flow", () => {
  it("creates a pending draft shape without maintenance write records", () => {
    const draft = createReviewDraftData({
      organizationId: "org-1",
      parsed,
      parser,
      vehicles: [{ id: "veh-1", unit_number: "14106", current_mileage: 150_000 }],
      defaults: [],
    });

    expect(draft.suggested_vehicle_id).toBe("veh-1");
    expect(draft.services).toHaveLength(2);
    expect("records" in draft).toBe(false);
  });

  it("detects duplicate hashes before draft creation", () => {
    expect(detectDuplicateHash("abc", [{ file_hash: "abc", status: "completed" }])).toEqual({
      duplicate: true,
      status: "completed",
    });
  });

  it("supports service merge, edit and delete operations", () => {
    const rows = [
      { ...row("a", "Suspension Repair"), parts_used: ["tender spring"], cost: 100 },
      { ...row("b", "Suspension Repair"), parts_used: ["shock absorbers"], cost: 200 },
    ];
    const merged = mergeServiceRows(rows, "b", "a");
    expect(merged).toHaveLength(1);
    expect(merged[0].parts_used).toEqual(["tender spring", "shock absorbers"]);
    expect(merged[0].cost).toBe(300);
    expect(deleteServiceRow(merged, "a")).toHaveLength(0);
  });

  it("builds plan/history/skip records correctly", () => {
    const rows: ReviewServiceRow[] = [
      { ...row("plan", "Engine Air Filter Replacement"), mode: "plan", next_due_mileage: 180_000 },
      { ...row("hist", "DPF Regeneration"), mode: "history", next_due_mileage: 180_000 },
      { ...row("skip", "Bad Line"), mode: "skip" },
    ];
    const records = buildFinalImportRecords({
      rows,
      vehicleId: "veh-1",
      vehicleCurrentMileage: 150_000,
      invoiceMileage: 150_000,
      vendor: "Shop",
      invoiceDate: "2026-07-12",
    });
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({ resolution: "overwrite", next_due_mileage: 180_000 });
    expect(records[1]).toMatchObject({ resolution: "history", next_due_mileage: null });
  });

  it("applies existing-rule decisions without silent overwrite", () => {
    const [applied] = applyExistingRules([row("a", "Oil Change")], "veh-1", [{
      vehicle_id: "veh-1",
      service_key: serviceKey("Oil Change"),
      id: "rule-1",
      summary: "25,000 mi",
    }]);
    expect(applied.existing_rule_id).toBe("rule-1");
    expect(applied.existing_rule_decision).toBe("history_only");
  });

  it("warns for missing and lower mileage", () => {
    expect(mileageWarnings({ currentMileage: 0, invoiceMileage: 10_000 })).toContain("Araç mileage değeri eksik veya 0; kaydetmeden önce doğru mileage girin.");
    expect(mileageWarnings({ currentMileage: 200_000, invoiceMileage: 150_000 })[0]).toContain("otomatik düşürülmez");
  });

  it("keeps undo isolated to records created by the invoice", () => {
    expect(undoIsolatedIds("inv-1", [
      { id: "keep", invoice_id: "other" },
      { id: "remove", invoice_id: "inv-1" },
    ])).toEqual(["remove"]);
  });

  it("prevents duplicate expense creation for the same invoice hash", () => {
    expect(canCreateExpenseForInvoice("hash-1", [{ invoice_hash: "hash-1" }])).toBe(false);
    expect(canCreateExpenseForInvoice("hash-2", [{ invoice_hash: "hash-1" }])).toBe(true);
  });

  it("pre-fills saved service defaults without inventing missing intervals", () => {
    const [known, unknown] = applyServiceDefaults([
      { ...row("a", "Engine Air Filter Replacement"), parts_used: [], default_action: "plan" },
      { ...row("b", "Coolant Service"), parts_used: [], default_action: "history" },
    ], [{
      service_key: serviceKey("Engine Air Filter Replacement"),
      service_type: "Engine Air Filter Replacement",
      default_mode: "plan",
      interval_type: "mileage",
      interval_miles: 30_000,
      interval_days: null,
    }]);
    expect(known.next_due_mileage).toBe(180_000);
    expect(unknown.next_due_mileage).toBeNull();
    expect(unknown.mode).toBe("history");
  });

  it("keeps organization isolation and atomic final save in SQL", () => {
    const sql = readFileSync("supabase/migrations/20260712010000_maintenance_invoice_review_inbox.sql", "utf8");
    expect(sql).toContain("organization_id = (select current_org_id())");
    expect(sql).toContain("create or replace function finalize_maintenance_invoice_review");
    expect(sql).toContain("for update");
    expect(sql).toContain("where organization_id = v_org and invoice_hash = v_invoice.file_hash");
  });

  it("keeps scanned-PDF vision fallback wired in parser", () => {
    const source = readFileSync("lib/maintenance-invoice.ts", "utf8");
    expect(source).toContain("renderPdfForOcr");
    expect(source).toContain("runVision");
    expect(source).toContain("source = \"vision\"");
  });
});
