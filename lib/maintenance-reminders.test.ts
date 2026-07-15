import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { expandEffectiveMaintenanceRules, isVehicleType, vehicleTypeLabel } from "./maintenance-reminders";

describe("maintenance reminders UX contract", () => {
  const nav = readFileSync("components/MaintenanceNav.tsx", "utf8");
  const page = readFileSync("app/(app)/maintenance/reminders/page.tsx", "utf8");
  const manager = readFileSync("components/MaintenanceReminderManager.tsx", "utf8");
  const settings = readFileSync("app/(app)/maintenance/settings/page.tsx", "utf8");
  const vehicles = readFileSync("app/(app)/vehicles/page.tsx", "utf8");
  const unitDetail = readFileSync("app/(app)/maintenance/units/[vehicleId]/page.tsx", "utf8");

  it("uses simple maintenance navigation without template management", () => {
    expect(nav).toContain("Özet");
    expect(nav).toContain("Hatırlatıcılar");
    expect(nav).toContain("Bakım Ekle");
    expect(nav).toContain("Geçmiş");
    expect(nav).toContain("Inspection");
    expect(nav).toContain("Maliyetler");
    expect(nav).toContain("Ayarlar");
    expect(nav).not.toContain("Template");
    expect(nav).not.toContain("Şablon");
  });

  it("shows a dedicated reminder page with compact user-facing columns", () => {
    expect(page).toContain("/maintenance/reminders");
    expect(page).toContain("Tümü");
    expect(page).toContain("Yaklaşan");
    expect(page).toContain("Geciken");
    expect(page).toContain("Pasif");
    expect(manager).toContain("Bakım Hatırlatıcıları");
    expect(manager).toContain("+ Hatırlatıcı Ekle");
    expect(manager).toContain("Tekrar:");
    expect(manager).toContain("Son Yapılan");
    expect(manager).toContain("Sonraki Bakım");
    expect(manager).toContain("Yapıldı Olarak Kaydet");
    expect(manager).toContain("Unit Türü");
    expect(manager).toContain("vehicle_type");
    expect(manager).toContain("İlk dolan sınır geçerli olur");
    expect(manager).not.toContain("template_source");
    expect(manager).not.toContain("Template");
    expect(manager).not.toContain("Baseline");
  });

  it("does not fetch maintenance template tables on normal pages", () => {
    for (const source of [settings, vehicles, unitDetail, page]) {
      expect(source).not.toContain("maintenance_templates");
      expect(source).not.toContain("maintenance_template_items");
      expect(source).not.toContain("maintenance_template_default_checklists");
    }
  });

  it("keeps template controls out of settings and unit detail", () => {
    expect(settings).not.toContain("Maintenance Templates");
    expect(settings).not.toContain("Default Checklist Assignments");
    expect(settings).not.toContain("MaintenanceTemplateChecklistAssignments");
    expect(unitDetail).not.toContain("Template Uygula");
    expect(unitDetail).not.toContain("UnitTemplateApplyWizard");
  });
});

describe("vehicle-type reminder scope contract", () => {
  const migration = readFileSync("supabase/migrations/20260714020000_vehicle_type_maintenance_reminders.sql", "utf8");

  it("uses the existing vehicle_type values and labels", () => {
    expect(isVehicleType("truck")).toBe(true);
    expect(isVehicleType("box_truck")).toBe(true);
    expect(isVehicleType("hotshot")).toBe(true);
    expect(isVehicleType("trailer")).toBe(true);
    expect(isVehicleType("other")).toBe(true);
    expect(isVehicleType("tractor")).toBe(false);
    expect(vehicleTypeLabel("box_truck")).toBe("Box Truck");
  });

  it("adds type-scoped rules and per-vehicle state without rewriting legacy reminders", () => {
    expect(migration).toContain("alter table maintenance_rules add column if not exists vehicle_type text");
    expect(migration).toContain("maintenance_rules_scope_chk");
    expect(migration).toContain("(vehicle_id is not null and vehicle_type is null)");
    expect(migration).toContain("(vehicle_id is null and vehicle_type is not null)");
    expect(migration).toContain("create table if not exists maintenance_rule_vehicle_states");
    expect(migration).toContain("constraint maintenance_rule_vehicle_states_unique unique (organization_id, rule_id, vehicle_id)");
    expect(migration).toContain("maintenance_rule_vehicle_states_select");
    expect(migration).toContain("organization_id = (select current_org_id())");
  });

  it("prevents duplicate active reminders per scope and canonical service key", () => {
    expect(migration).toContain("maintenance_rules_one_active_service_idx");
    expect(migration).toContain("maintenance_rules_one_active_type_service_idx");
    expect(migration).toContain("public.manual_maintenance_service_key('periodic', service_type)");
    expect(migration).toContain("An active reminder already exists for this unit type and service.");
  });

  it("defines service-key helpers before indexes that depend on them", () => {
    const maintenanceHelper = migration.indexOf("create or replace function public.maintenance_service_key");
    const manualHelper = migration.indexOf("create or replace function public.manual_maintenance_service_key");
    const firstMaintenanceUseAfterDefinition = migration.indexOf("public.maintenance_service_key(p_service)");
    const firstExpressionIndex = migration.indexOf("create index if not exists maintenance_rules_service_key_vehicle_idx");
    expect(maintenanceHelper).toBeGreaterThanOrEqual(0);
    expect(manualHelper).toBeGreaterThan(maintenanceHelper);
    expect(firstMaintenanceUseAfterDefinition).toBeGreaterThan(manualHelper);
    expect(manualHelper).toBeLessThan(firstExpressionIndex);
  });

  it("uses schema-qualified service-key functions in expression indexes", () => {
    expect(migration).toContain("on maintenance_rules (organization_id, vehicle_id, public.manual_maintenance_service_key('periodic', service_type))");
    expect(migration).toContain("on maintenance_rules (organization_id, vehicle_type, public.manual_maintenance_service_key('periodic', service_type))");
    expect(migration).not.toContain("on maintenance_rules (organization_id, vehicle_id, manual_maintenance_service_key");
    expect(migration).not.toContain("on maintenance_rules (organization_id, vehicle_type, manual_maintenance_service_key");
  });

  it("keeps the vehicle-type reminder migration ordered and idempotent", () => {
    expect(migration).toContain("alter table maintenance_rules add column if not exists vehicle_type text");
    expect(migration).toContain("create table if not exists maintenance_rule_vehicle_states");
    expect(migration).toContain("drop policy if exists maintenance_rule_vehicle_states_select");
    expect(migration).toContain("drop trigger if exists vehicles_sync_type_maintenance_states on vehicles");
    expect(migration).toContain("create or replace function public.maintenance_service_key");
    expect(migration).toContain("create or replace function public.manual_maintenance_service_key");
  });

  it("syncs existing, future, retyped, and reactivated vehicles without overwriting state", () => {
    expect(migration).toContain("create or replace function sync_maintenance_rule_vehicle_states");
    expect(migration).toContain("on conflict (organization_id, rule_id, vehicle_id) do nothing");
    expect(migration).toContain("after insert or update of vehicle_type, status on vehicles");
    expect(migration).toContain("sync_vehicle_type_maintenance_states_for_vehicle");
  });

  it("manual maintenance prefers unit-specific rules and falls back to type-scoped rules", () => {
    expect(migration).toContain("vehicle_id = v_vehicle");
    expect(migration).toContain("and vehicle_id is null");
    expect(migration).toContain("and vehicle_type = v_vehicle_type");
    expect(migration).toContain("v_rule_scope = 'vehicle_type'");
    expect(migration).toContain("on conflict (organization_id, rule_id, vehicle_id) do update");
  });

  it("expands type reminders into independent effective rows", () => {
    const rows = expandEffectiveMaintenanceRules(
      [{
        id: "rule-type",
        vehicle_id: null,
        vehicle_type: "truck",
        service_type: "PM-A",
        interval_miles: 15_000,
        interval_days: null,
        interval_engine_hours: null,
        last_done_mileage: null,
        last_done_date: null,
        last_done_engine_hours: null,
        active: true,
      }],
      [
        { id: "v1", unit_number: "101", vehicle_type: "truck", current_mileage: 120_000, status: "active" },
        { id: "v2", unit_number: "102", vehicle_type: "truck", current_mileage: 130_000, status: "active" },
        { id: "v3", unit_number: "201", vehicle_type: "trailer", current_mileage: 10_000, status: "active" },
        { id: "v4", unit_number: "103", vehicle_type: "truck", current_mileage: 99_000, status: "inactive" },
      ],
      [
        { rule_id: "rule-type", vehicle_id: "v1", last_done_mileage: 110_000, last_done_date: "2026-07-01", last_done_engine_hours: null },
        { rule_id: "rule-type", vehicle_id: "v2", last_done_mileage: 129_000, last_done_date: "2026-07-10", last_done_engine_hours: null },
      ],
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.effective_vehicle_id)).toEqual(["v1", "v2"]);
    expect(rows.find((row) => row.effective_vehicle_id === "v1")?.last_done_mileage).toBe(110_000);
    expect(rows.find((row) => row.effective_vehicle_id === "v2")?.last_done_mileage).toBe(129_000);
  });

  it("keeps vehicle-specific rows compatible and ahead of type fallback in manual save", () => {
    const rows = expandEffectiveMaintenanceRules(
      [{
        id: "rule-vehicle",
        vehicle_id: "v1",
        vehicle_type: null,
        service_type: "PM-A",
        interval_miles: 15_000,
        interval_days: null,
        interval_engine_hours: null,
        last_done_mileage: 100_000,
        last_done_date: "2026-06-01",
        last_done_engine_hours: null,
        active: true,
      }],
      [{ id: "v1", unit_number: "101", vehicle_type: "truck", current_mileage: 120_000, status: "active" }],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].scope).toBe("vehicle");
    expect(rows[0].last_done_mileage).toBe(100_000);
    const saveManual = migration.slice(migration.indexOf("create or replace function save_manual_maintenance"));
    expect(saveManual.indexOf("vehicle_id = v_vehicle")).toBeLessThan(saveManual.indexOf("and vehicle_id is null"));
  });
});
