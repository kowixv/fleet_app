import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

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
    expect(manager).toContain("Tekrar Aralığı");
    expect(manager).toContain("Son Yapılan");
    expect(manager).toContain("Sonraki Bakım");
    expect(manager).toContain("Yapıldı Olarak Kaydet");
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
