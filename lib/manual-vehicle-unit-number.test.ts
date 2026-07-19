import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const component = readFileSync("components/VehicleResourceManager.tsx", "utf8");
const action = readFileSync("app/(app)/vehicles/manual-unit-actions.ts", "utf8");

describe("manual vehicle unit numbers", () => {
  it("requires a user-entered unit number in the vehicle form", () => {
    expect(component).toContain('name="unit_number"');
    expect(component).toContain('placeholder="1501"');
    expect(component).toContain('defaultValue={editing?.unit_number ?? ""}');
    expect(component).toContain("required");
  });

  it("uses the manual unit number for create and edit instead of random generation", () => {
    expect(component).toContain("saveVehicleWithManualUnitFromForm");
    expect(action).toContain("unit_number: manualUnitNumber(input.unit_number)");
    expect(action).toContain(".update(payload.vehicle)");
    expect(action).toContain("...payload.vehicle");
    expect(action).not.toContain("generatedVehicleUnitNumber");
    expect(action).not.toContain("crypto.randomUUID");
  });

  it("normalizes unit numbers and reports organization-scoped duplicates", () => {
    expect(action).toContain("normalizeUpperText(value)");
    expect(action).toContain("Unit numarası gerekli.");
    expect(action).toContain("Bu unit numarası zaten kullanılıyor");
    expect(action).toContain("isGeneratedUnitNumberCollision(error)");
  });
});
