import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  filterMaintenanceUnits,
  maintenanceUnitHref,
  maintenanceUnitMatchesSearch,
  sortMaintenanceUnits,
  type MaintenanceUnitSummary,
} from "./maintenance-unit-summary";
import {
  MAINTENANCE_VISIBLE_VEHICLE_STATUSES,
  isMaintenanceVisibleVehicleStatus,
} from "./maintenance-vehicles";

const navSource = readFileSync("components/MaintenanceNav.tsx", "utf8");
const overviewSource = readFileSync("app/(app)/maintenance/page.tsx", "utf8");
const directorySource = readFileSync(
  "components/maintenance/MaintenanceUnitDirectory.tsx",
  "utf8",
);
const dataSource = readFileSync("lib/maintenance-unit-data.ts", "utf8");

function unit(
  patch: Partial<MaintenanceUnitSummary> = {},
): MaintenanceUnitSummary {
  return {
    id: "vehicle-1",
    unitNumber: "14105",
    vehicleType: "truck",
    currentMileage: 250000,
    engineHours: 12000,
    operationalStatus: "active",
    vin: "1XKYD49X7NJ123456",
    year: 2022,
    make: "Kenworth",
    model: "T680",
    truckColor: "white",
    maintenanceStatus: "ok",
    overdueCount: 0,
    dueNowCount: 0,
    dueSoonCount: 0,
    criticalFindingCount: 0,
    doNotDispatchCount: 0,
    hasActivePlan: true,
    lastServiceDate: "2026-07-01",
    lastServiceType: "Wet PM",
    lastServiceCost: 850,
    ...patch,
  };
}

describe("maintenance unit directory UX", () => {
  it("adds Unitler to the maintenance navigation", () => {
    expect(navSource).toContain('{ href: "/maintenance/units", label: "Unitler" }');
  });

  it("keeps Unitler active for dynamic unit-detail routes", () => {
    expect(navSource).toContain('pathname.startsWith(`${item.href}/`)');
    expect(navSource).toContain('{ href: "/maintenance/units", label: "Unitler" }');
  });

  it("defines active, in-repair, and yard/hometime as maintenance-visible", () => {
    expect([...MAINTENANCE_VISIBLE_VEHICLE_STATUSES]).toEqual([
      "active",
      "in_repair",
      "yard_hometime",
    ]);
  });

  it("hides inactive units by default", () => {
    const result = filterMaintenanceUnits(
      [unit(), unit({ id: "archived", operationalStatus: "inactive" })],
      {},
    );
    expect(result.map((row) => row.id)).toEqual(["vehicle-1"]);
  });

  it("reveals inactive units when the archive filter is enabled", () => {
    const result = filterMaintenanceUnits(
      [unit(), unit({ id: "archived", operationalStatus: "inactive" })],
      { includeArchived: true },
    );
    expect(result.map((row) => row.id)).toContain("archived");
    expect(isMaintenanceVisibleVehicleStatus("inactive")).toBe(false);
  });

  it("searches by unit number", () => {
    expect(maintenanceUnitMatchesSearch(unit(), " 14105 ")).toBe(true);
  });

  it("searches by VIN and VIN suffix", () => {
    expect(maintenanceUnitMatchesSearch(unit(), "123456")).toBe(true);
    expect(maintenanceUnitMatchesSearch(unit(), "1xkyd49")).toBe(true);
  });

  it("searches make and model case-insensitively with tolerant whitespace", () => {
    expect(maintenanceUnitMatchesSearch(unit(), "KEN WORTH")).toBe(true);
    expect(maintenanceUnitMatchesSearch(unit(), "t 680")).toBe(true);
  });

  it("sorts overdue units above healthy units", () => {
    const healthy = unit({ id: "healthy", unitNumber: "100", maintenanceStatus: "ok" });
    const overdue = unit({
      id: "overdue",
      unitNumber: "200",
      maintenanceStatus: "overdue",
      overdueCount: 1,
    });
    expect(sortMaintenanceUnits([healthy, overdue])[0].id).toBe("overdue");
  });

  it("sorts critical findings above ordinary overdue maintenance", () => {
    const overdue = unit({ id: "overdue", maintenanceStatus: "overdue" });
    const critical = unit({
      id: "critical",
      maintenanceStatus: "ok",
      criticalFindingCount: 1,
    });
    expect(sortMaintenanceUnits([overdue, critical])[0].id).toBe("critical");
  });

  it("builds the existing unit-detail destination", () => {
    expect(maintenanceUnitHref("vehicle-1")).toBe("/maintenance/units/vehicle-1");
  });

  it("links reminder units to the plans tab", () => {
    expect(overviewSource).toContain('"plans"');
    expect(overviewSource).toContain("detailHref");
  });

  it("links critical findings to the inspections tab", () => {
    expect(overviewSource).toContain('maintenanceUnitHref(finding.vehicle_id, "inspections")');
  });

  it("links recent records to the history tab", () => {
    expect(overviewSource).toContain('maintenanceUnitHref(row.vehicle_id, "history")');
  });

  it("links high-cost repairs to the costs tab", () => {
    expect(overviewSource).toContain('maintenanceUnitHref(row.vehicle_id, "costs")');
  });

  it("shows missing mileage and engine hours without inventing zero values", () => {
    expect(directorySource).toContain("Mileage bilgisi gerekli.");
    expect(directorySource).toContain("Engine hours girilmemiş.");
    expect(directorySource).not.toContain("currentMileage ?? 0");
    expect(directorySource).not.toContain("engineHours ?? 0");
  });

  it("renders distinct no-units and no-match empty states", () => {
    expect(directorySource).toContain("Henüz bakım için kayıtlı unit bulunmuyor.");
    expect(directorySource).toContain("Arama ve filtrelerle eşleşen unit bulunamadı.");
  });

  it("keeps mobile unit cards keyboard and touch accessible", () => {
    expect(directorySource).toContain("aria-label={`Unit ${unit.unitNumber} bakım detayını aç`}");
    expect(directorySource).toContain("focus-visible:ring-2");
    expect(directorySource).toContain("grid grid-cols-2");
    expect(directorySource).toContain("min-h-11");
  });

  it("loads directory data in one batched query group without an N+1 loop", () => {
    expect(dataSource).toContain("await Promise.all([");
    expect(dataSource).not.toMatch(/\.map\s*\(\s*async/);
    expect(dataSource.match(/\.from\("/g)).toHaveLength(7);
  });

  it("preserves all existing overview sections below the directory", () => {
    expect(overviewSource).toContain("Unit Bakım Görünümü");
    expect(overviewSource).toContain('aria-label="Hızlı işlemler"');
    expect(overviewSource).toContain('aria-label="Dikkat özeti"');
    expect(overviewSource).toContain("Bugünün İş Listesi");
    expect(overviewSource).toContain("Yüksek Maliyetli Son Tamirler");
    expect(overviewSource).toContain("Son Bakım Kayıtları");
  });
});
