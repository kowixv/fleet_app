import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const vehicleAction = readFileSync("app/(app)/vehicles/manual-unit-actions.ts", "utf8");
const setupAction = readFileSync("app/(app)/vehicles/maintenance-setup-actions.ts", "utf8");
const vehicleUi = readFileSync("components/VehicleResourceManager.tsx", "utf8");
const bulkService = readFileSync("lib/maintenance/program-installation.ts", "utf8");
const migration = readFileSync("supabase/migrations/20260802133726_vehicle_maintenance_onboarding.sql", "utf8");

describe("new vehicle maintenance onboarding contracts", () => {
  it("creates no maintenance rules when no setup is selected", () => {
    expect(setupAction).toContain('normalized.mode === "none" ? "manual"');
    expect(setupAction).not.toContain('.from("maintenance_rules").insert');
  });

  it("reuses the bulk installer and its canonical duplicate protection", () => {
    expect(bulkService).toContain('client.rpc("install_maintenance_program_bulk"');
    expect(setupAction).toContain("installMaintenanceProgramItems(");
    expect(setupAction).not.toContain('.from("maintenance_rules").insert');
  });

  it("makes vehicle creation and maintenance retry idempotent", () => {
    expect(migration).toContain("vehicles_org_creation_request_key_uidx");
    expect(vehicleAction).toContain('onConflict: "organization_id,creation_request_key"');
    expect(vehicleAction).toContain("ignoreDuplicates: true");
  });

  it("does not reinstall maintenance while editing a vehicle", () => {
    expect(vehicleUi).toContain("{!editing && (");
    expect(vehicleAction).toContain("if (id || !maintenanceSetup)");
    expect(vehicleAction.indexOf("installVehicleMaintenanceSetup({")).toBeGreaterThan(vehicleAction.indexOf("if (id || !maintenanceSetup)"));
  });

  it("rejects copying from a different organization or vehicle type", () => {
    expect(setupAction).toContain('.eq("organization_id", profile.organization_id)');
    expect(setupAction).toContain('.eq("vehicle_type", target.vehicle_type)');
    expect(setupAction).toContain("Kaynak araç aynı organizasyonda ve aynı tipte olmalı.");
  });

  it("requires a writer for vehicle creation, setup, baseline RPC and settings", () => {
    expect(vehicleAction).toContain("await requireWriteRole()");
    expect(setupAction.match(/await requireWriteRole\(\)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(migration).toContain("not (select public.is_org_writer())");
  });

  it("preserves the vehicle ID when profile or maintenance setup fails", () => {
    expect(vehicleAction).toContain("ok: true as const");
    expect(vehicleAction).toContain("vehicleId: vehicleRecordId");
    expect(vehicleAction).toContain("maintenance = {");
  });

  it("uses state baselines without creating fake completed maintenance records", () => {
    expect(migration).toContain("insert into public.maintenance_rule_vehicle_states");
    expect(migration).toContain("tracking_baseline_mileage");
    expect(migration).toContain("set last_done_mileage = null");
    expect(migration).not.toContain("insert into public.maintenance_records");
    expect(migration).toContain("p_mode = 'manual'");
    expect(migration).toContain("else null");
  });
});
