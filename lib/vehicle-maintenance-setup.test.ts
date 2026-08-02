import { describe, expect, it } from "vitest";
import { computePM, DEFAULT_PM_THRESHOLDS } from "@/lib/maintenance";
import {
  buildVehicleMaintenancePresetPlan,
  defaultVehicleMaintenanceSetup,
  parseVehicleMaintenanceDefaults,
} from "@/lib/vehicle-maintenance-setup";

const vehicleId = "11111111-1111-4111-8111-111111111111";

describe("new vehicle maintenance package planning", () => {
  it("builds the default Semi Truck basic package as type-level rules", () => {
    const plan = buildVehicleMaintenancePresetPlan({ vehicleId, vehicleType: "truck", engineModel: null, packageLevel: "basic" });
    expect(plan.items.length).toBeGreaterThan(10);
    expect(plan.items.every((item) => item.vehicle_id === null && item.vehicle_type === "truck")).toBe(true);
    expect(plan.items.map((item) => item.preset_id)).toContain("engine-oil-filter");
  });

  it("builds the Box Truck basic package with Box-specific basic presets", () => {
    const plan = buildVehicleMaintenancePresetPlan({ vehicleId, vehicleType: "box_truck", engineModel: null, packageLevel: "basic" });
    expect(plan.items.every((item) => item.vehicle_id === null && item.vehicle_type === "box_truck")).toBe(true);
    expect(plan.items.map((item) => item.preset_id)).toContain("cabin-air-filter-inspection");
    expect(plan.items.map((item) => item.preset_id)).not.toContain("fifth-wheel-lubrication");
  });

  it("includes basic and full presets in the full package", () => {
    const basic = buildVehicleMaintenancePresetPlan({ vehicleId, vehicleType: "truck", engineModel: null, packageLevel: "basic" });
    const full = buildVehicleMaintenancePresetPlan({ vehicleId, vehicleType: "truck", engineModel: null, packageLevel: "full" });
    expect(full.items.length).toBeGreaterThan(basic.items.length);
    expect(full.items.map((item) => item.preset_id)).toEqual(expect.arrayContaining(basic.items.map((item) => item.preset_id)));
    expect(full.items.map((item) => item.preset_id)).toContain("transmission-oil-service");
  });

  it("defaults to no setup when organization automatic setup is disabled", () => {
    const settings = parseVehicleMaintenanceDefaults({ new_vehicle_auto_maintenance_setup: false });
    expect(defaultVehicleMaintenanceSetup("truck", settings)).toEqual({ mode: "none", baselineMode: "current" });
  });

  it("adds PACCAR MX engine-specific maintenance only to the target vehicle", () => {
    const plan = buildVehicleMaintenancePresetPlan({
      vehicleId,
      vehicleType: "truck",
      engineModel: "PACCAR MX-13 EPA 2024",
      packageLevel: "full",
    });
    const paccar = plan.items.find((item) => item.preset_id === "paccar-first-valve-adjustment");
    expect(paccar?.vehicle_id).toBe(vehicleId);
    expect(paccar?.interval_miles).toBe(60_000);
  });

  it("skips engine-specific maintenance and asks for engine model when missing", () => {
    const plan = buildVehicleMaintenancePresetPlan({ vehicleId, vehicleType: "truck", engineModel: null, packageLevel: "full" });
    expect(plan.items.map((item) => item.preset_id)).not.toContain("paccar-first-valve-adjustment");
    expect(plan.needsInformation).toContain("Motor özel bakımları için engine model gerekli.");
  });

  it("keeps a manual baseline in Kurulum gerekli state", () => {
    const pm = computePM({
      interval_type: "mileage",
      interval_miles: 15_000,
      interval_days: 30,
      interval_engine_hours: null,
      last_done_mileage: null,
      last_done_date: null,
      last_done_engine_hours: null,
    }, 120_000, DEFAULT_PM_THRESHOLDS, "2026-08-02", null);
    expect(pm.status).toBe("setup_required");
    expect(pm.label).toBe("Kurulum gerekli");
  });

  it("calculates from a current tracking baseline without pretending maintenance was completed", () => {
    const rule = {
      interval_type: "mileage" as const,
      interval_miles: 15_000,
      interval_days: 30,
      interval_engine_hours: null,
      last_done_mileage: null,
      last_done_date: null,
      last_done_engine_hours: null,
      tracking_baseline_mileage: 120_000,
      tracking_baseline_date: "2026-08-02",
      tracking_baseline_engine_hours: null,
    };
    const pm = computePM(rule, 120_000, DEFAULT_PM_THRESHOLDS, "2026-08-02", null);
    expect(rule.last_done_mileage).toBeNull();
    expect(rule.last_done_date).toBeNull();
    expect(pm.status).toBe("ok");
    expect(pm.dimensions.map((dimension) => dimension.nextDue)).toEqual([135_000, "2026-09-01"]);
  });
});
