import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MAINTENANCE_INTERVAL_DAYS,
  MAINTENANCE_PROGRAM_EXCLUSIONS,
  MAINTENANCE_PROGRAM_PRESETS,
  MAINTENANCE_PROGRAM_REFERENCES,
  MAINTENANCE_PROGRAM_SOURCE_COVERAGE,
  MAINTENANCE_PROGRAM_VEHICLE_OPTIONS,
  engineModelMatchesRequirement,
  findExistingProgramReminder,
  formatMaintenanceProgramInterval,
  getMaintenanceProgramPresets,
  maintenanceProgramPrimaryIntervalType,
  presetDefaultEnabled,
  presetIsInPackage,
  presetWarning,
  summarizeMaintenanceProgramStatuses,
  validateMaintenanceProgramIntervals,
  type MaintenanceProgramPreset,
} from "./maintenance-program-presets";

function preset(id: string) {
  const found = MAINTENANCE_PROGRAM_PRESETS.find((item) => item.id === id);
  if (!found) throw new Error(`Missing preset: ${id}`);
  return found;
}

describe("maintenance program preset catalog", () => {
  it("offers only Semi Truck and Box Truck in the installer", () => {
    expect(MAINTENANCE_PROGRAM_VEHICLE_OPTIONS.map((option) => option.value)).toEqual(["truck", "box_truck"]);
    expect(MAINTENANCE_PROGRAM_VEHICLE_OPTIONS.some((option) => (option.value as string) === "trailer")).toBe(false);
  });

  it("has no trailer preset and keeps trailer exclusions explicit", () => {
    expect(MAINTENANCE_PROGRAM_PRESETS.every((item) => item.applicableVehicleTypes.every((type) => type !== ("trailer" as never)))).toBe(true);
    expect(MAINTENANCE_PROGRAM_EXCLUSIONS.find((item) => item.id === "trailer-program-items")?.reason).toContain("power-only");
  });

  it("keeps fifth-wheel lubrication on trucks and off box trucks", () => {
    const item = preset("fifth-wheel-lubrication");
    expect(presetIsInPackage(item, "truck", "basic")).toBe(true);
    expect(presetIsInPackage(item, "box_truck", "full")).toBe(false);
  });

  it("returns the intended 15-item Semi Truck basic package", () => {
    expect(getMaintenanceProgramPresets("truck", "basic").map((item) => item.id)).toEqual([
      "power-steering-fluid-check",
      "transmission-fluid-leak-check",
      "fifth-wheel-lubrication",
      "electronic-fault-scan",
      "brake-inspection",
      "battery-connections-inspection",
      "coolant-hose-inspection",
      "engine-air-filter-inspection",
      "clutch-inspection",
      "suspension-steering-inspection",
      "engine-oil-filter",
      "fuel-filters",
      "detailed-brake-wheel-end-inspection",
      "coolant-condition-check",
      "dot-annual",
    ]);
  });

  it("returns the intended 14-item Box Truck basic package without fifth-wheel work", () => {
    const ids = getMaintenanceProgramPresets("box_truck", "basic").map((item) => item.id);
    expect(ids).toEqual([
      "power-steering-fluid-check",
      "transmission-fluid-leak-check",
      "electronic-fault-scan",
      "brake-inspection",
      "battery-connections-inspection",
      "coolant-hose-inspection",
      "engine-air-filter-inspection",
      "suspension-steering-inspection",
      "engine-oil-filter",
      "fuel-filters",
      "detailed-brake-wheel-end-inspection",
      "coolant-condition-check",
      "dot-annual",
      "cabin-air-filter-inspection",
    ]);
    expect(ids.some((id) => id.includes("fifth-wheel"))).toBe(false);
  });

  it("adds advanced reminders only in the full package", () => {
    const basic = getMaintenanceProgramPresets("truck", "basic");
    const full = getMaintenanceProgramPresets("truck", "full");
    expect(full.length).toBeGreaterThan(basic.length);
    expect(full.some((item) => item.id === "dpf-ash-cleaning")).toBe(true);
    expect(basic.some((item) => item.id === "dpf-ash-cleaning")).toBe(false);
  });

  it("keeps Box Truck air-brake-only presets optional, unchecked and warned", () => {
    const airBrakePresets = getMaintenanceProgramPresets("box_truck", "full")
      .filter((item) => item.equipmentRequirement === "air_brakes");
    expect(airBrakePresets.map((item) => item.id)).toEqual(expect.arrayContaining([
      "air-tank-drain",
      "air-dryer-cartridge-purge-valve",
      "brake-chamber-inspection",
      "slack-adjuster-inspection",
    ]));
    for (const item of airBrakePresets) {
      expect(presetDefaultEnabled(item, "box_truck")).toBe(false);
      expect(presetWarning(item, "box_truck")).toContain("air brake");
    }
  });

  it("protects the PACCAR first-service preset from fleet-wide or Box Truck use", () => {
    const item = preset("paccar-first-valve-adjustment");
    expect(item.engineRequirement).toBe("paccar_mx");
    expect(item.defaultEnabled).toBe(false);
    expect(presetIsInPackage(item, "truck", "full")).toBe(true);
    expect(presetIsInPackage(item, "box_truck", "full")).toBe(false);
    expect(getMaintenanceProgramPresets("truck", "full").some((candidate) => candidate.id === item.id)).toBe(false);
    expect(getMaintenanceProgramPresets("truck", "full", true).some((candidate) => candidate.id === item.id)).toBe(true);
    expect(engineModelMatchesRequirement("PACCAR MX-13", "paccar_mx")).toBe(true);
    expect(engineModelMatchesRequirement("Cummins X15 EPA21", "paccar_mx")).toBe(false);
  });

  it("preserves combined mileage, date and engine-hour limits", () => {
    expect(formatMaintenanceProgramInterval(preset("engine-oil-filter"))).toBe("37,500 mil veya 10 ay");
    expect(formatMaintenanceProgramInterval(preset("engine-coolant-full-replacement"))).toBe("750,000 mil veya 8 yıl veya 24,000 engine saat");
    expect(preset("engine-coolant-full-replacement")).toMatchObject({ intervalMiles: 750_000, intervalDays: 2_920, intervalEngineHours: 24_000 });
  });

  it("centralizes required month and year conversions", () => {
    expect(MAINTENANCE_INTERVAL_DAYS.tenMonths).toBe(300);
    expect(MAINTENANCE_INTERVAL_DAYS.fourYears).toBe(1_460);
    expect(MAINTENANCE_INTERVAL_DAYS.eightYears).toBe(2_920);
  });

  it.each([
    {
      label: "mileage-only",
      values: { intervalMiles: 15_000, intervalDays: null, intervalEngineHours: null },
      primaryType: "mileage",
      valid: true,
    },
    {
      label: "days-only",
      values: { intervalMiles: null, intervalDays: 30, intervalEngineHours: null },
      primaryType: "date",
      valid: true,
    },
    {
      label: "mileage + days",
      values: { intervalMiles: 15_000, intervalDays: 30, intervalEngineHours: null },
      primaryType: "mileage",
      valid: true,
    },
    {
      label: "mileage + days + engine hours",
      values: { intervalMiles: 500_000, intervalDays: 1_825, intervalEngineHours: 10_000 },
      primaryType: "mileage",
      valid: true,
    },
    {
      label: "engine-hours-only",
      values: { intervalMiles: null, intervalDays: null, intervalEngineHours: 10_000 },
      primaryType: null,
      valid: false,
    },
  ])("honors the existing interval_type contract for $label", ({ values, primaryType, valid }) => {
    expect(maintenanceProgramPrimaryIntervalType(values)).toBe(primaryType);
    const validation = validateMaintenanceProgramIntervals(values);
    expect(validation.ok).toBe(valid);
    if (!valid) {
      expect(validation).toMatchObject({ error: expect.stringContaining("engine saat") });
    }
  });

  it("never returns reference-only items for reminder creation", () => {
    const installableIds = new Set(MAINTENANCE_PROGRAM_PRESETS.map((item) => item.id));
    expect(MAINTENANCE_PROGRAM_REFERENCES).toHaveLength(5);
    expect(MAINTENANCE_PROGRAM_REFERENCES.every((item) => item.installMode === "reference" && !installableIds.has(item.id))).toBe(true);
    expect(MAINTENANCE_PROGRAM_REFERENCES.map((item) => item.id)).toEqual(expect.arrayContaining([
      "driver-pre-trip-inspection",
      "condition-based-clutch-replacement",
      "clutch-expense-reserve",
      "condition-based-sensor-replacement",
    ]));
  });
});

describe("maintenance program duplicate and result contracts", () => {
  const batteryPreset: MaintenanceProgramPreset = {
    id: "battery-replacement",
    serviceType: "Battery Replacement",
    titleTr: "Akü değişimi",
    descriptionTr: "Test",
    section: "scheduled",
    applicableVehicleTypes: ["truck"],
    intervalMiles: 100_000,
    packageLevel: "full",
    defaultEnabled: true,
    installMode: "reminder",
    sortOrder: 1,
  };

  it("detects active aliases through the canonical service key", () => {
    const existing = findExistingProgramReminder(batteryPreset, [{
      id: "rule-1",
      vehicle_id: null,
      vehicle_type: "truck",
      service_type: "Battery Set Replacement",
      interval_miles: 100_000,
      interval_days: null,
      interval_engine_hours: null,
      active: true,
    }], "truck");
    expect(existing?.id).toBe("rule-1");
  });

  it("makes a repeated submission idempotently detectable", () => {
    const rules = [{
      id: "created-rule",
      vehicle_id: null,
      vehicle_type: "truck",
      service_type: "Battery Replacement",
      interval_miles: 100_000,
      interval_days: null,
      interval_engine_hours: null,
      active: true,
    }];
    expect(findExistingProgramReminder(batteryPreset, rules, "truck")?.id).toBe("created-rule");
    expect(findExistingProgramReminder(batteryPreset, rules, "truck")?.id).toBe("created-rule");
  });

  it("reports a failed item without hiding created and skipped items", () => {
    expect(summarizeMaintenanceProgramStatuses([
      { status: "created" },
      { status: "skipped" },
      { status: "failed" },
    ])).toEqual({ ok: false, created: 1, skipped: 1, failed: 1 });
  });
});

describe("maintenance program source coverage", () => {
  it("covers every preset, reference and exclusion exactly once", () => {
    expect(MAINTENANCE_PROGRAM_SOURCE_COVERAGE).toHaveLength(
      MAINTENANCE_PROGRAM_PRESETS.length + MAINTENANCE_PROGRAM_REFERENCES.length + MAINTENANCE_PROGRAM_EXCLUSIONS.length,
    );
    const ids = MAINTENANCE_PROGRAM_SOURCE_COVERAGE.map((row) => row.presetId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("explicitly covers the requested source-list edge cases", () => {
    const required = [
      "Motor air filter planning threshold / Engine Air Filter Inspection",
      "Oil Pan / Engine Oil Leak Inspection",
      "Cooling System Laboratory Analysis",
      "Battery Conductance / Load Test",
      "PACCAR First Valve Adjustment",
      "Clutch Expense Reserve",
      "Condition-based Clutch Replacement",
      "Engine Coolant Full Replacement",
      "Power Steering Fluid & Filter Service",
      "Air Dryer Cartridge & Purge Valve",
    ];
    for (const originalItem of required) {
      expect(MAINTENANCE_PROGRAM_SOURCE_COVERAGE.filter((row) => row.originalItem === originalItem)).toHaveLength(1);
    }
  });
});

describe("maintenance program integration contract", () => {
  const action = readFileSync("app/(app)/maintenance/actions.ts", "utf8");
  const component = readFileSync("components/MaintenanceProgramInstaller.tsx", "utf8");
  const migration = readFileSync("supabase/migrations/20260714030000_maintenance_program_installer.sql", "utf8");
  const stateMigration = readFileSync("supabase/migrations/20260714020000_vehicle_type_maintenance_reminders.sql", "utf8");

  it("validates canonical presets on the server and uses safe RPCs", () => {
    expect(action).toContain("maintenanceProgramPreset(selection.presetId)");
    expect(action).toContain('supabase.rpc("save_maintenance_reminder"');
    expect(action).toContain('supabase.rpc("save_vehicle_maintenance_reminder"');
    expect(action).toContain("profile.organization_id");
    expect(action).not.toContain("input.organization_id");
  });

  it("keeps category inference out of the installer form", () => {
    expect(component).not.toContain('name="category"');
    expect(component).not.toContain("Maintenance Category");
  });

  it("keeps reference items outside the selected reminder payload", () => {
    expect(component).toContain("MAINTENANCE_PROGRAM_REFERENCES.filter");
    expect(component).toContain("if (!selectedIds.has(preset.id)) continue");
    expect(action).toContain('preset.installMode !== "reminder"');
  });

  it("creates engine-specific rules with organization, writer and active-vehicle guards", () => {
    expect(migration).toContain("v_org uuid := (select public.current_org_id())");
    expect(migration).toContain("not (select public.is_org_writer())");
    expect(migration).toContain("organization_id = v_org");
    expect(migration).toContain("and status = 'active'");
    expect(migration).toContain("public.manual_maintenance_service_key('periodic', service_type)");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("on conflict do nothing");
    expect(migration).toContain("revoke execute on function public.save_vehicle_maintenance_reminder");
  });

  it("uses only supported primary interval types and rejects engine-hours-only payloads", () => {
    const combinedMigration = readFileSync("supabase/migrations/20260713000000_maintenance_profiles_templates_combined_intervals.sql", "utf8");
    const schema = readFileSync("supabase/schema.sql", "utf8");
    expect(schema).toContain("check (interval_type in ('mileage','date'))");
    expect(combinedMigration).not.toContain("interval_type in ('mileage','date','engine_hours')");
    expect(migration).toContain("if v_interval_miles is null and v_interval_days is null then");
    expect(migration).toContain("Engine-hours-only reminders are not supported; provide interval_miles or interval_days.");
    expect(migration).toContain("v_interval_type := case");
    expect(migration).toContain("when v_interval_miles is not null then 'mileage'");
    expect(migration).toContain("when v_interval_days is not null then 'date'");
    expect(migration).toContain("v_interval_type,");
    expect(migration).not.toContain("case when v_interval_miles is not null then 'mileage' else 'date' end");
  });

  it("stores a stable source slug and remains rerunnable", () => {
    expect(migration).toContain("create or replace function public.save_vehicle_maintenance_reminder");
    expect(migration).toContain("'maintenance_program_installer', v_user, now()");
    expect(migration).not.toContain("Hazır Bakım Programı");
    expect(migration).not.toContain("HazÄ±r BakÄ±m ProgramÄ±");
    expect(migration).toContain("on conflict do nothing");
    expect(migration).toContain("revoke execute on function public.save_vehicle_maintenance_reminder(uuid,jsonb) from public, anon");
    expect(migration).toContain("grant execute on function public.save_vehicle_maintenance_reminder(uuid,jsonb) to authenticated");
  });

  it("retains independent type-scoped vehicle state synchronization", () => {
    expect(stateMigration).toContain("perform sync_maintenance_rule_vehicle_states(v_rule)");
    expect(stateMigration).toContain("on conflict (organization_id, rule_id, vehicle_id) do nothing");
  });

  it("shows clear partial results and existing reminder intervals", () => {
    expect(component).toContain("Mevcut interval:");
    expect(component).toContain("Zaten mevcut");
    expect(component).toContain('result.results.filter((item) => item.status === "failed")');
    expect(component).toContain("Varsayılana döndür");
  });
});
