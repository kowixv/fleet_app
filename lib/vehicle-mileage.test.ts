import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  mileageRpcErrorMessage,
  validateMileageInput,
  validateOptionalInitialMileage,
} from "./vehicle-mileage";
import { clean } from "./crud-allowlist";

describe("vehicle mileage validation", () => {
  it("accepts valid whole-number mileage", () => {
    expect(validateMileageInput("150000")).toEqual({ ok: true, mileage: 150000 });
    expect(validateMileageInput(0)).toEqual({ ok: true, mileage: 0 });
  });

  it("rejects lower-mileage RPC errors with a clear message", () => {
    expect(
      mileageRpcErrorMessage("Mileage cannot be lower than the current odometer (150000)."),
    ).toBe("Mileage mevcut odometreden dusuk olamaz.");
  });

  it("rejects blank, negative, decimal and NaN mileage values", () => {
    expect(validateMileageInput("")).toMatchObject({ ok: false });
    expect(validateMileageInput("-1")).toMatchObject({ ok: false });
    expect(validateMileageInput("12.5")).toMatchObject({ ok: false });
    expect(validateMileageInput(Number.NaN)).toMatchObject({ ok: false });
  });

  it("keeps initial mileage optional during vehicle creation", () => {
    expect(validateOptionalInitialMileage("")).toBeNull();
    expect(validateOptionalInitialMileage("42")).toEqual({ ok: true, mileage: 42 });
  });
});

describe("vehicle mileage write contract", () => {
  const actions = readFileSync("app/(app)/maintenance/actions.ts", "utf8");
  const crud = readFileSync("lib/crud.ts", "utf8");
  const vehiclePage = readFileSync("app/(app)/vehicles/page.tsx", "utf8");
  const mileageComponent = readFileSync("components/VehicleMileageManager.tsx", "utf8");

  it("uses the audited mileage RPC instead of generic vehicle current_mileage updates", () => {
    expect(actions).toContain('supabase.rpc("set_vehicle_mileage"');
    expect(crud).toContain('supabase.rpc("set_vehicle_mileage"');
    expect(crud).not.toMatch(/from\(table\)\.update\([^)]*current_mileage/s);
    expect(clean("vehicles", { unit_number: "101", current_mileage: 999 })).toEqual({
      unit_number: "101",
    });
  });

  it("keeps Vehicles page independent of maintenance rules while retaining the mileage RPC component", () => {
    expect(vehiclePage).not.toContain("maintenance_rules");
    expect(vehiclePage).toContain("Current Mileage");
    expect(mileageComponent).toContain('updateMileage(vehicleId, parsed.mileage)');
    expect(mileageComponent).not.toContain("maintenance_rules");
  });
});
