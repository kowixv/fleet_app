import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  classifyInspectionResult,
  cloneTemplateName,
  findingSeverityLabel,
  hasDoNotDispatchFinding,
  inspectionTypeLabel,
  validateRequiredInspectionResults,
  type InspectionTemplateItem,
} from "./inspection";

const migration = readFileSync("supabase/migrations/20260713010000_pm_inspection_system.sql", "utf8");
const checklistRefreshMigration = readFileSync("supabase/migrations/20260714010000_maintenance_category_cost_contract.sql", "utf8");

const item = (patch: Partial<InspectionTemplateItem>): InspectionTemplateItem => ({
  id: "item-1",
  section: "Safety",
  label: "Brake remaining percentage",
  input_type: "number",
  required: true,
  warning_threshold: 25,
  critical_threshold: 15,
  axle_position: "front",
  ...patch,
});

describe("inspection helpers", () => {
  it("validates required fields for draft completion", () => {
    expect(validateRequiredInspectionResults([item({ label: "Engine oil level", input_type: "pass_fail" })], [])).toEqual([
      "Engine oil level",
    ]);
    expect(validateRequiredInspectionResults([item({})], [{ template_item_id: "item-1", value_number: 24 }])).toEqual([]);
  });

  it("creates threshold findings for service soon and critical measurements", () => {
    expect(classifyInspectionResult(item({}), { template_item_id: "item-1", value_number: 20 })).toMatchObject({
      severity: "service_soon",
    });
    expect(classifyInspectionResult(item({}), { template_item_id: "item-1", value_number: 10 })).toMatchObject({
      severity: "critical",
    });
  });

  it("classifies critical pass/fail examples as do-not-dispatch", () => {
    expect(classifyInspectionResult(
      item({ label: "Tire bulge/separation", input_type: "pass_fail", warning_threshold: null, critical_threshold: null }),
      { template_item_id: "item-1", passed: false },
    )).toMatchObject({ severity: "do_not_dispatch" });
    expect(hasDoNotDispatchFinding([{ severity: "do_not_dispatch", status: "open" }])).toBe(true);
  });

  it("uses clone naming for checklist versions", () => {
    expect(cloneTemplateName("PM-A")).toBe("PM-A Copy");
  });

  it("maps inspection types and finding severities to user-facing labels", () => {
    expect(inspectionTypeLabel("driver_daily", "Driver daily/pre-trip")).toBe("Hızlı Güvenlik Kontrolü");
    expect(inspectionTypeLabel("pm_a", "PM-A")).toBe("Temel PM");
    expect(inspectionTypeLabel("pm_b", "PM-B")).toBe("Detaylı PM");
    expect(inspectionTypeLabel("annual", "Annual inspection")).toBe("DOT Annual");
    expect(findingSeverityLabel("monitor")).toBe("Takip Et");
    expect(findingSeverityLabel("service_soon")).toBe("Yakında Servis");
    expect(findingSeverityLabel("critical")).toBe("Kritik");
    expect(findingSeverityLabel("do_not_dispatch")).toBe("Aracı Çıkartma");
  });

  it("does not apply fixed universal thresholds to MPG, CCA, regen or DPF measurements", () => {
    for (const label of ["MPG", "Battery CCA", "Regen frequency", "DPF differential pressure"]) {
      expect(classifyInspectionResult(item({ label, warning_threshold: null, critical_threshold: null }), {
        template_item_id: "item-1",
        value_number: 1,
      })).toBeNull();
    }
  });
});

describe("inspection SQL contract", () => {
  it("creates org-scoped inspection tables with RLS and viewer read-only behavior", () => {
    for (const table of [
      "inspection_templates",
      "inspection_template_items",
      "vehicle_inspections",
      "vehicle_inspection_results",
      "inspection_findings",
    ]) {
      expect(migration).toContain(`create table if not exists ${table}`);
      expect(migration).toContain(`alter table ${table} enable row level security`);
    }
    expect(migration).toContain("organization_id = (select current_org_id())");
    expect(migration).toContain("and (select is_org_writer())");
  });

  it("supports draft/resume and atomic completion", () => {
    expect(migration).toContain("create or replace function start_vehicle_inspection");
    expect(migration).toContain("status = 'draft'");
    expect(migration).toContain("create or replace function save_vehicle_inspection_draft");
    expect(migration).toContain("create or replace function complete_vehicle_inspection");
    expect(migration).toContain("for update");
  });

  it("always re-reads authoritative mileage when completing", () => {
    expect(migration).toContain("from vehicles");
    expect(migration).toContain("for update");
    expect(migration).toContain("mileage = v_vehicle.current_mileage");
  });

  it("preserves immutable completed inspection history", () => {
    expect(migration).toContain("prevent_completed_inspection_result_changes");
    expect(migration).toContain("Completed inspection results are immutable");
  });

  it("creates threshold findings and do-not-dispatch severity", () => {
    expect(migration).toContain("classify_inspection_result");
    expect(migration).toContain("do_not_dispatch");
    expect(migration).toContain("inspection_findings");
  });

  it("supports checklist clone/version behavior", () => {
    expect(migration).toContain("version integer not null default 1");
    expect(migration).toContain("source_template_id");
    expect(migration).toContain("clone_inspection_template");
  });

  it("links inspections to maintenance rules and can mark PM serviced", () => {
    expect(migration).toContain("maintenance_rule_id uuid references maintenance_rules");
    expect(migration).toContain("maintenance_record_id uuid references maintenance_records");
    expect(migration).toContain("mark_maintenance_serviced");
  });

  it("uses private storage for inspection files and signed-url action wiring", () => {
    const actions = readFileSync("app/(app)/maintenance/inspection-actions.ts", "utf8");
    expect(migration).toContain("values ('inspection-files', 'inspection-files', false)");
    expect(actions).toContain("createSignedUrl");
  });

  it("keeps inspection template internals out of the normal UI labels", () => {
    const workflow = readFileSync("components/MaintenanceInspectionWorkflow.tsx", "utf8");
    const manager = readFileSync("components/InspectionTemplateManager.tsx", "utf8");
    const helpers = readFileSync("lib/inspection.ts", "utf8");
    expect(workflow).toContain("Inspection Başlat");
    expect(helpers).toContain("Temel PM");
    expect(helpers).toContain("Detaylı PM");
    expect(workflow).not.toContain("v{template.version}");
    expect(manager).not.toContain("İlk checklist'i aç");
    expect(manager).not.toContain(">Kopyala<");
    expect(manager).toContain("Yeni Kontrol Listesi Oluştur");
  });

  it("seeds refreshed PM checklist contents without universal metric thresholds", () => {
    expect(checklistRefreshMigration).toContain("'PM Inspection - Temel'");
    expect(checklistRefreshMigration).toContain("'PM Inspection - Detaylı'");
    expect(checklistRefreshMigration).toContain("select seed_pm_inspection_checklists_20260714(id) from organizations");
    expect(checklistRefreshMigration).toContain("from inspection_template_items");
    expect(checklistRefreshMigration).toContain("template_id = v_basic_template");
    expect(checklistRefreshMigration).toContain("'Battery CCA','number','CCA',false,null,null");
    expect(checklistRefreshMigration).toContain("'Regen frequency','number','miles between regens',false,null,null");
    expect(checklistRefreshMigration).toContain("'DPF differential pressure','number','kPa',false,null,null");
    expect(checklistRefreshMigration).toContain("'MPG','number','mpg',false,null,null");
    const itemRows = checklistRefreshMigration.match(/\(\d+,'[^']+','[^']+','(?:pass_fail|checkbox|number|text|select)'/g) ?? [];
    expect(itemRows.filter((line) => /^\(\d{2,3},/.test(line))).toHaveLength(34);
    expect(itemRows.filter((line) => /^\(\d{4},/.test(line))).toHaveLength(26);
  });
});
