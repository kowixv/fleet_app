import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  isRepairHistoryOnly,
  manualMaintenanceCategory,
  manualServiceKeys,
  normalizeUnitNumber,
  shouldUpdateMaintenancePlan,
} from "./manual-maintenance";

const migration = readFileSync(
  "supabase/migrations/20260713040000_manual_maintenance_daily_workflow.sql",
  "utf8",
);

describe("manual maintenance service safety", () => {
  it("updates plans only for recurring periodic maintenance when requested", () => {
    expect(shouldUpdateMaintenancePlan("periodic", "PM-A", true)).toBe(true);
    expect(shouldUpdateMaintenancePlan("periodic", "Wet PM / Oil Service", false)).toBe(false);
    expect(shouldUpdateMaintenancePlan("repair", "Engine Repair", true)).toBe(false);
  });

  it("keeps repair and failure work history-only", () => {
    expect(isRepairHistoryOnly("DPF Regeneration")).toBe(true);
    expect(isRepairHistoryOnly("Coolant Leak Repair")).toBe(true);
    expect(isRepairHistoryOnly("Diagnostic")).toBe(true);
    expect(isRepairHistoryOnly("Towing")).toBe(true);
  });

  it("classifies manual entries for cost analytics without forcing allocation fields", () => {
    expect(manualMaintenanceCategory("periodic", "PM-A")).toBe("preventive_maintenance");
    expect(manualMaintenanceCategory("repair", "Tire Repair")).toBe("tires");
    expect(manualMaintenanceCategory("repair", "Road Service")).toBe("other");
  });

  it("normalizes unit numbers before quick creation", () => {
    expect(normalizeUnitNumber("Unit # 14129")).toBe("14129");
    expect(normalizeUnitNumber(" truck- A 12 ")).toBe("A12");
  });

  it("matches fleet-manager labels to existing reminder service names", () => {
    expect(manualServiceKeys("periodic", "Cabin Air Filter")).toContain("cabin air filter inspection replacement");
    expect(manualServiceKeys("periodic", "Cabin Air Filter Inspection/Replacement")).toContain("cabin air filter");
    expect(manualServiceKeys("periodic", "DOT Annual")).toContain("annual inspection");
    expect(manualServiceKeys("periodic", "Synthetic Drive Axle Oil")).toContain("drive axle oil");
  });
});

describe("manual maintenance SQL contract", () => {
  it("finalizes manual maintenance transactionally and idempotently", () => {
    expect(migration).toContain("create or replace function save_manual_maintenance");
    expect(migration).toContain("manual_submission_key");
    expect(migration).toContain("maintenance_records_manual_submission_key_idx");
    expect(migration).toContain("for update of v");
  });

  it("preserves historical mileage and advances current mileage only upward", () => {
    expect(migration).toContain("source, effective_date, maintenance_record_id, manual_submission_key");
    expect(migration).toContain("'manual_maintenance'");
    expect(migration).toContain("if v_mileage > coalesce(v_current_mileage, 0) then");
    expect(migration).toContain("coalesce(current_mileage, 0) < v_mileage");
  });

  it("updates only the matching active recurring rule", () => {
    expect(migration).toContain("manual_maintenance_service_key(v_kind, service_type) = v_service_key");
    expect(migration).toContain("where id = v_rule and organization_id = v_org");
    expect(migration).toContain("if v_kind = 'repair' then");
    expect(migration).toContain("v_update_plan := false");
  });

  it("keeps the normal quick-create path away from the legacy template RPC", () => {
    const actions = readFileSync("app/(app)/maintenance/actions.ts", "utf8");
    expect(actions).not.toContain('rpc("quick_create_maintenance_vehicle"');
    expect(actions).toContain('from("vehicles")');
    expect(actions).toContain('rpc("set_vehicle_mileage"');
    expect(actions).toContain("created: true");
    expect(actions).not.toContain("Peterbilt");
    expect(actions).not.toContain("Cummins");
  });

  it("keeps viewer restrictions and organization isolation on RPCs", () => {
    expect(migration).toContain("v_org uuid := (select current_org_id())");
    expect(migration).toContain("not (select is_org_writer())");
    expect(migration).toContain("revoke execute on function save_manual_maintenance(jsonb) from public, anon");
    expect(migration).toContain("grant execute on function save_manual_maintenance(jsonb) to authenticated");
  });

  it("supports safe delete recalculation without deleting unrelated records", () => {
    expect(migration).toContain("create or replace function delete_manual_maintenance_record");
    expect(migration).toContain("set deleted_at = now()");
    expect(migration).toContain("perform recalculate_maintenance_rule_baseline(v_rule)");
    expect(migration).not.toContain("delete from maintenance_records");
  });

  it("supports safe edit recalculation for manual records", () => {
    expect(migration).toContain("create or replace function edit_manual_maintenance_record");
    expect(migration).toContain("source = 'manual_maintenance'");
    expect(migration).toContain("edited_at = now()");
    expect(migration).toContain("perform recalculate_maintenance_rule_baseline(v_record.rule_id)");
  });
});

describe("manual maintenance daily UX contract", () => {
  it("does not use browser prompt or confirm dialogs in the manual maintenance path", () => {
    const files = [
      "app/(app)/maintenance/page.tsx",
      "components/ManualMaintenanceEntry.tsx",
      "components/MaintenanceTable.tsx",
      "components/UnitMaintenancePlans.tsx",
    ].map((file) => readFileSync(file, "utf8"));
    const combined = files.join("\n");
    expect(combined).not.toContain("window.prompt");
    expect(combined).not.toContain("window.confirm");
  });

  it("keeps invoice import out of the compact Overview and under advanced settings", () => {
    const overview = readFileSync("app/(app)/maintenance/page.tsx", "utf8");
    const terms = readFileSync("lib/maintenance-terminology.ts", "utf8");
    const settings = readFileSync("app/(app)/maintenance/settings/page.tsx", "utf8");
    expect(overview).toContain("MAINTENANCE_TERMS.otherActions");
    expect(terms).toContain("Diğer İşlemler");
    expect(overview).toContain("PDF Invoice Yükle");
    expect(overview).toContain("Toplu Invoice Import");
    expect(overview).not.toContain("BulkMaintenanceInvoiceUpload");
    expect(settings).toContain("Gelişmiş Araçlar");
    expect(settings).toContain("/maintenance/invoices");
  });

  it("keeps the manual maintenance form focused on the one-minute workflow", () => {
    const form = readFileSync("components/ManualMaintenanceEntry.tsx", "utf8");
    const terms = readFileSync("lib/maintenance-terminology.ts", "utf8");
    expect(form).toContain("Unit");
    expect(form).toContain("İşlem Türü");
    expect(terms).toContain("Bakım / Tamir Çeşidi");
    expect(terms).toContain("Yapılma Tarihi");
    expect(terms).toContain("Yapıldığı Mileage");
    expect(terms).toContain("Toplam Maliyet");
    expect(terms).toContain("Ek Detaylar");
    expect(form).toContain("Yeni Unit Oluştur");
    expect(form).toContain("Unit Number");
    expect(form).toContain("Current Mileage");
    expect(form).toContain("Ek Araç Bilgileri");
    expect(form).toContain("Bakım Hatırlatıcısı Ekle");
    expect(form).not.toContain("Peterbilt");
    expect(form).not.toContain("template");
  });

  it("does not show a duplicate Maintenance Category dropdown in the manual form", () => {
    const form = readFileSync("components/ManualMaintenanceEntry.tsx", "utf8");
    expect(form).toContain("service_type");
    expect(form).toContain("MAINTENANCE_TERMS.serviceType");
    expect(form).not.toContain("Maintenance Category");
    expect(form).not.toContain('name="category"');
    expect(form).not.toContain("MAINTENANCE_COST_CATEGORIES");
    expect(form).not.toContain("formatMaintenanceCategory");
  });

  it("derives manual maintenance category on the server from service_type", () => {
    const actions = readFileSync("app/(app)/maintenance/actions.ts", "utf8");
    const saveBlock = actions.slice(
      actions.indexOf("export async function saveManualMaintenance"),
      actions.indexOf("export async function quickCreateMaintenanceVehicle"),
    );
    expect(saveBlock).toContain("normalizeMaintenanceCostCategory(manualMaintenanceCategory(kind, serviceType), serviceType)");
    expect(saveBlock).not.toContain('formData.get("category")');
    expect(saveBlock.match(/manualServiceOption\(kind, serviceType\)/g)?.length).toBe(1);
  });

  it("keeps invoice review category selection available", () => {
    const review = readFileSync("components/MaintenanceInvoiceReview.tsx", "utf8");
    expect(review).toContain("category");
    expect(review).toContain("MAINTENANCE_COST_CATEGORIES");
  });

  it("shows plain-language save summaries for periodic, repair, and historical entries", () => {
    const form = readFileSync("components/ManualMaintenanceEntry.tsx", "utf8");
    const actions = readFileSync("app/(app)/maintenance/actions.ts", "utf8");
    expect(actions).toContain("Bakım kaydedildi");
    expect(actions).toContain("Tamir kaydedildi");
    expect(actions).toContain("Geçmiş bakım kaydedildi");
    expect(form).toContain("Current mileage güncellendi");
    expect(form).toContain("Current mileage düşürülmedi");
    expect(form).toContain("Bakım hatırlatıcısı değişmedi");
    expect(form).toContain("Sonraki bakım");
  });

  it("keeps repair entries history-only in the normal form", () => {
    const form = readFileSync("components/ManualMaintenanceEntry.tsx", "utf8");
    const terms = readFileSync("lib/maintenance-terminology.ts", "utf8");
    expect(form).toContain("Bu kayıt bakım hatırlatıcısını değiştirmez.");
    expect(terms).toContain("Sonraki bakımı güncelle");
    expect(terms).toContain("Gelişmiş hatırlatıcı ayarları");
  });

  it("uses a real delete confirmation panel and edit service/type controls", () => {
    const actions = readFileSync("components/MaintenanceHistoryActions.tsx", "utf8");
    expect(actions).toContain("Bu bakım kaydı silinecek.");
    expect(actions).toContain("Güncel araç mileage'ı otomatik olarak düşürülmeyecek.");
    expect(actions).toContain("entry_kind");
    expect(actions).toContain("service_type");
    expect(actions).toContain("Periyodik bakım ile tamir");
    expect(actions).not.toContain("window.confirm");
  });

  it("does not show raw source ids in the normal cost alert UI", () => {
    const dashboard = readFileSync("components/MaintenanceCostDashboard.tsx", "utf8");
    expect(dashboard).toContain("Unit {row.unit_number");
    expect(dashboard).toContain("row.cost_date");
    expect(dashboard).toContain("row.service_type");
    expect(dashboard).toContain("row.shop");
    expect(dashboard).not.toContain("sourceRecordIds.join");
  });

  it("keeps unit detail daily actions primary and advanced actions secondary", () => {
    const unitDetail = readFileSync("app/(app)/maintenance/units/[vehicleId]/page.tsx", "utf8");
    expect(unitDetail).toContain("MAINTENANCE_TERMS.addMaintenance");
    expect(unitDetail).toContain("MAINTENANCE_TERMS.updateMileage");
    expect(unitDetail).toContain("MAINTENANCE_TERMS.startInspection");
    expect(unitDetail).toContain("MAINTENANCE_TERMS.otherActions");
    expect(unitDetail).toContain("Unit Ayarları");
    expect(unitDetail).toContain("Gelişmiş İşlemler");
  });
});

describe("manual maintenance edit migration contract", () => {
  const editMigration = readFileSync(
    "supabase/migrations/20260713050000_phase1_manual_maintenance_edit_safety.sql",
    "utf8",
  );

  it("supports service/type edits while preserving writer and organization checks", () => {
    expect(editMigration).toContain("create or replace function edit_manual_maintenance_record");
    expect(editMigration).toContain("v_org uuid := (select current_org_id())");
    expect(editMigration).toContain("not (select is_org_writer())");
    expect(editMigration).toContain("v_kind not in ('periodic', 'repair')");
    expect(editMigration).toContain("manual_maintenance_service_key(v_kind, service_type) = v_service_key");
  });

  it("recalculates only affected old and new maintenance plans", () => {
    expect(editMigration).toContain("perform recalculate_maintenance_rule_baseline(v_old_rule)");
    expect(editMigration).toContain("perform recalculate_maintenance_rule_baseline(v_new_rule)");
    expect(editMigration).toContain("v_new_rule := null");
    expect(editMigration).not.toContain("delete from maintenance_records");
  });

  it("keeps historical mileage from lowering current mileage", () => {
    expect(editMigration).toContain("if v_mileage > coalesce(v_current_mileage, 0) then");
    expect(editMigration).toContain("coalesce(current_mileage, 0) < v_mileage");
    expect(editMigration).toContain("grant execute on function edit_manual_maintenance_record(jsonb) to authenticated");
  });
});
