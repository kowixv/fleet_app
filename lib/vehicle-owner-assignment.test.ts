import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const component = readFileSync("components/VehicleResourceManager.tsx", "utf8");
const page = readFileSync("app/(app)/vehicles/page.tsx", "utf8");
const action = readFileSync("app/(app)/vehicles/manual-unit-actions.ts", "utf8");

describe("vehicle owner assignment", () => {
  it("shows owner operators and investors in a dedicated vehicle owner field", () => {
    expect(component).toContain('name="owner_id"');
    expect(component).toContain("editing?.owner_id");
    expect(component).toContain("Owner / Şoför Bilgileri");
    expect(page).toContain("owners={opts.owners}");
  });

  it("persists owner_id separately from assigned_driver_id", () => {
    expect(action).toContain("owner_id: vehicleId(input.owner_id)");
    expect(action).toContain("assigned_driver_id: vehicleId(input.assigned_driver_id)");
    expect(action).toContain("assertOwnerInOrg(payload.vehicle.owner_id");
    expect(action).toContain("assertDriverInOrg(payload.vehicle.assigned_driver_id");
  });

  it("accepts only owner-operator or investor people as vehicle owners", () => {
    expect(action).toContain('.in("type", ["owner_operator", "investor"])');
    expect(action).toContain("Seçilen owner bu organizasyona ait değil.");
  });
});
