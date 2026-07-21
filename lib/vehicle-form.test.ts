import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ENGINE_TYPE_SUGGESTIONS,
  GENERATED_UNIT_NUMBER_PREFIX,
  REMOVED_VEHICLE_FORM_FIELDS,
  VEHICLE_FORM_BUSINESS_LABELS,
  VEHICLE_FORM_FIELDS,
  VEHICLE_STATUS_OPTIONS,
  VEHICLE_TYPE_OPTIONS,
  VEHICLES_ORG_UNIT_NUMBER_CONSTRAINT,
  generatedVehicleUnitNumber,
  isGeneratedUnitNumberCollision,
  optionalNonNegativeNumber,
  optionalPercentFraction,
} from "./vehicle-form";

describe("vehicle create/edit form contract", () => {
  const component = readFileSync("components/VehicleResourceManager.tsx", "utf8");
  const page = readFileSync("app/(app)/vehicles/page.tsx", "utf8");
  const actions = readFileSync("app/(app)/vehicles/actions.ts", "utf8");
  const manualActions = readFileSync("app/(app)/vehicles/manual-unit-actions.ts", "utf8");
  const migration = readFileSync("supabase/migrations/20260714040000_vehicle_edit_profile_fields.sql", "utf8");
  const statusMigration = readFileSync("supabase/migrations/20260721010000_vehicle_yard_hometime_status.sql", "utf8");
  const allowlist = readFileSync("lib/crud-allowlist.ts", "utf8");

  it("defines exactly the requested visible business fields", () => {
    expect(VEHICLE_FORM_BUSINESS_LABELS).toEqual([
      "Tip",
      "Şoför",
      "Driver Pay",
      "VIN",
      "Yıl",
      "Make",
      "Model",
      "Plaka",
      "Durum",
      "Not",
      "Mileage",
      "Engine Hour",
      "Engine Type",
      "Truck Color",
    ]);
    for (const label of VEHICLE_FORM_BUSINESS_LABELS) {
      expect(component).toContain(label);
    }
  });

  it("keeps the managed payload narrow and includes current mileage", () => {
    expect(VEHICLE_FORM_FIELDS).toEqual([
      "vehicle_type",
      "owner_id",
      "assigned_driver_id",
      "default_driver_pay_pct",
      "vin",
      "year",
      "make",
      "model",
      "plate",
      "status",
      "notes",
      "current_mileage",
      "engine_hours",
      "engine_model",
      "truck_color",
    ]);
    for (const field of REMOVED_VEHICLE_FORM_FIELDS) {
      expect(component).not.toContain(`name="${field}"`);
    }
    expect(component).toContain('name="current_mileage"');
    expect(manualActions).toContain('current_mileage: optionalNonNegativeNumber(input.current_mileage, "Mileage")');
    expect(allowlist).toContain('"current_mileage"');
    expect(component).not.toContain("Company Fee");
    expect(component).not.toContain("External Carrier");
    expect(component).not.toContain("Komisyon");
    expect(component).not.toContain("Sahiplik");
  });

  it("restricts this form to semi truck and box truck values only", () => {
    expect(VEHICLE_TYPE_OPTIONS.map((option) => option.value)).toEqual(["truck", "box_truck"]);
    expect(VEHICLE_TYPE_OPTIONS.map((option) => option.label)).toEqual(["Semi Truck", "Box Truck"]);
    expect(component).not.toContain("Trailer");
    expect(component).not.toContain("semi_truck");
    expect(component).not.toContain("tractor");
    expect(component).not.toContain("power_only");
  });

  it("supports active, repair, yard/hometime and inactive operations statuses", () => {
    expect(VEHICLE_STATUS_OPTIONS.map((option) => option.value)).toEqual([
      "active",
      "in_repair",
      "yard_hometime",
      "inactive",
    ]);
    expect(VEHICLE_STATUS_OPTIONS.find((option) => option.value === "yard_hometime")?.label).toBe("YARD/HOMETIME");
    expect(page).toContain('["active", "in_repair", "yard_hometime"]');
    expect(statusMigration).toContain("'yard_hometime'");
  });

  it("supports suggested and custom engine types while rejecting negative engine hours or mileage", () => {
    expect(ENGINE_TYPE_SUGGESTIONS).toContain("Cummins X15");
    expect(ENGINE_TYPE_SUGGESTIONS).toContain("PACCAR MX-13");
    expect(component).toContain('list="engine-type-suggestions"');
    expect(optionalNonNegativeNumber("0", "Engine Hour")).toBe(0);
    expect(optionalNonNegativeNumber("482077", "Mileage")).toBe(482077);
    expect(optionalNonNegativeNumber("", "Engine Hour")).toBeNull();
    expect(() => optionalNonNegativeNumber("-1", "Engine Hour")).toThrow(/zero or greater/);
    expect(() => optionalNonNegativeNumber("-1", "Mileage")).toThrow(/zero or greater/);
  });

  it("loads and saves engine profile data through vehicle_maintenance_profiles", () => {
    expect(page).toContain("vehicle_maintenance_profiles");
    expect(page).toContain("engine_model");
    expect(page).toContain("engine_hours");
    expect(actions).toContain('from("vehicle_maintenance_profiles")');
    expect(actions).toContain("engine_model: payload.profile.engine_model");
    expect(actions).toContain("engine_hours: payload.profile.engine_hours");
    expect(actions).toContain('onConflict: "organization_id,vehicle_id"');
  });

  it("saves and reloads truck color on vehicles through an idempotent migration", () => {
    expect(component).toContain('name="truck_color"');
    expect(component).toContain("truck_color: string | null");
    expect(page).toContain('select("*"');
    expect(actions).toContain("truck_color: optionalText(input.truck_color)");
    expect(allowlist).toContain('"truck_color"');
    expect(migration).toContain("add column if not exists truck_color text");
  });

  it("generates stable internal unit numbers for new vehicles without using plate", () => {
    expect(generatedVehicleUnitNumber("12345678-aaaa-bbbb-cccc-ddddeeeeffff")).toBe("UNIT-12345678");
    expect(generatedVehicleUnitNumber("abc_def_987654321")).toBe("UNIT-ABCDEF98");
    expect(generatedVehicleUnitNumber()).toMatch(/^UNIT-[A-F0-9]{8}$/);
    expect(actions).toContain("generatedVehicleUnitNumber()");
    expect(actions).toContain("createVehicleWithGeneratedUnitNumber");
    expect(actions).not.toContain("unit_number: payload.vehicle.plate");
    expect(actions).not.toContain("Plaka gerekli");
    expect(component).toContain('name="plate"');
    expect(component).not.toContain("required={!editing}");
    expect(GENERATED_UNIT_NUMBER_PREFIX).toBe("UNIT-");
  });

  it("keeps unit_number out of legacy edit payloads so plate changes do not rename units", () => {
    const saveAction = actions.slice(actions.indexOf("export async function saveVehicleFromForm"));
    const editBranch = saveAction.slice(saveAction.indexOf("if (vehicleRecordId)"), saveAction.indexOf("} else {"));
    expect(editBranch).toContain(".update(payload.vehicle)");
    expect(editBranch).not.toContain("unit_number");
  });

  it("handles generated unit-number duplicates according to the org-scoped unique constraint", () => {
    expect(schema()).toContain("vehicles_org_unit_number_key");
    expect(schema()).toContain("unique (organization_id, unit_number)");
    expect(actions).toContain("isGeneratedUnitNumberCollision(error)");
    expect(actions).toContain("for (let attempt = 0; attempt < 8; attempt += 1)");
  });

  it("retries on the exact unit-number constraint with PostgreSQL 23505", () => {
    expect(isGeneratedUnitNumberCollision({
      code: "23505",
      message: `duplicate key value violates unique constraint "${VEHICLES_ORG_UNIT_NUMBER_CONSTRAINT}"`,
    })).toBe(true);
    expect(isGeneratedUnitNumberCollision({
      code: "23505",
      constraint: VEHICLES_ORG_UNIT_NUMBER_CONSTRAINT,
      message: "duplicate key value violates unique constraint",
    })).toBe(true);
  });

  it("retries when 23505 details explicitly identify organization_id and unit_number", () => {
    expect(isGeneratedUnitNumberCollision({
      code: "23505",
      message: "duplicate key value violates unique constraint",
      details: "Key (organization_id, unit_number)=(org-1, UNIT-ABC12345) already exists.",
    })).toBe(true);
  });

  it("does not retry unrelated or generic uniqueness errors", () => {
    expect(isGeneratedUnitNumberCollision({
      code: "23505",
      message: "duplicate key value violates unique constraint \"vehicles_vin_key\"",
      details: "Key (vin)=(1XPBD49X1ND123456) already exists.",
    })).toBe(false);
    expect(isGeneratedUnitNumberCollision({
      code: "23505",
      message: "duplicate key value violates unique constraint",
    })).toBe(false);
    expect(isGeneratedUnitNumberCollision({
      code: "40001",
      message: `duplicate key value violates unique constraint "${VEHICLES_ORG_UNIT_NUMBER_CONSTRAINT}"`,
      details: "Key (organization_id, unit_number)=(org-1, UNIT-ABC12345) already exists.",
    })).toBe(false);
  });

  it("preserves hidden settlement fields during edits", () => {
    expect(actions).toContain("payload.vehicle");
    expect(actions).toContain(".update(payload.vehicle)");
    const saveAction = actions.slice(actions.indexOf("export async function saveVehicleFromForm"));
    const editBranch = saveAction.slice(saveAction.indexOf("if (vehicleRecordId)"), saveAction.indexOf("} else {"));
    expect(actions).not.toContain("company_fee_pct:");
    expect(actions).not.toContain("external_carrier_fee_pct:");
    expect(actions).not.toContain("management_commission_amount:");
    expect(editBranch).not.toContain("ownership_type:");
  });

  it("does not silently stamp ownership settlement configuration during vehicle create", () => {
    expect(schema()).toContain("ownership_type text not null default 'company_owned'");
    const createHelper = actions.slice(
      actions.indexOf("async function createVehicleWithGeneratedUnitNumber"),
      actions.indexOf("export async function saveVehicleFromForm"),
    );
    expect(createHelper).toContain('from("vehicles")');
    expect(createHelper).toContain("unit_number: unitNumber");
    expect(createHelper).not.toContain("ownership_type");
    expect(createHelper).not.toContain("company_fee_pct");
    expect(createHelper).not.toContain("external_carrier_fee_pct");
    expect(createHelper).not.toContain("management_commission");
  });

  it("updates only engine fields in the vehicle form profile upsert", () => {
    const saveAction = actions.slice(actions.indexOf("export async function saveVehicleFromForm"));
    const profileUpsert = saveAction.slice(saveAction.indexOf(".upsert("), saveAction.indexOf("revalidateVehicleMaintenance();"));
    expect(profileUpsert).toContain("engine_model: payload.profile.engine_model");
    expect(profileUpsert).toContain("engine_hours: payload.profile.engine_hours");
    expect(profileUpsert).not.toContain("engine_esn");
    expect(profileUpsert).not.toContain("transmission_model");
    expect(profileUpsert).not.toContain("duty_cycle");
  });

  it("keeps Driver Pay as a percentage fraction compatible with settlement resolution", () => {
    expect(optionalPercentFraction("33")).toBe(0.33);
    expect(component).toContain('name="default_driver_pay_pct"');
    expect(component).toContain('max="100"');
    expect(actions).toContain("default_driver_pay_pct: optionalPercentFraction");
  });

  it("keeps create/edit authorization and same-organization driver checks", () => {
    expect(actions).toContain("await requireWriteRole()");
    expect(actions).toContain("assertDriverInOrg");
    expect(actions).toContain('.eq("organization_id", profile.organization_id)');
    expect(actions).toContain('.in("type", ["company_driver", "external_carrier_driver"])');
  });
});

function schema() {
  return readFileSync("supabase/schema.sql", "utf8");
}
