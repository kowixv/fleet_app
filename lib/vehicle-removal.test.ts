import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("vehicles page template cleanup", () => {
  const page = readFileSync("app/(app)/vehicles/page.tsx", "utf8");

  it("does not render template or large maintenance-profile UI on /vehicles", () => {
    expect(page).not.toContain("Apply Template");
    expect(page).not.toContain("VehicleMaintenanceProfileManager");
    expect(page).not.toContain("VehicleMileageManager");
  });

  it("does not fetch template or active maintenance rule data for /vehicles", () => {
    expect(page).not.toContain("maintenance_templates");
    expect(page).not.toContain("maintenance_template_items");
    expect(page).not.toContain("maintenance_rules");
    expect(page).toContain("vehicle_maintenance_profiles");
    expect(page).toContain('select("vehicle_id, engine_model, engine_hours")');
  });
});

describe("vehicle safe removal workflow", () => {
  const page = readFileSync("app/(app)/vehicles/page.tsx", "utf8");
  const vehicleManager = readFileSync("components/VehicleResourceManager.tsx", "utf8");
  const actions = readFileSync("app/(app)/vehicles/actions.ts", "utf8");
  const removal = readFileSync("components/VehicleRemovalActions.tsx", "utf8");
  const resourceManager = readFileSync("components/ResourceManager.tsx", "utf8");
  const crud = readFileSync("lib/crud.ts", "utf8");

  it("keeps /vehicles as a server component and moves callbacks into the client boundary", () => {
    expect(page).not.toContain('"use client"');
    expect(page).toContain("VehicleResourceManager");
    expect(page).not.toContain("renderActions=");
    expect(page).not.toContain("paginationHref=");
    expect(vehicleManager).toContain('"use client"');
    expect(vehicleManager).toContain("paginationHref");
    expect(vehicleManager).toContain("VehicleRemovalActions");
  });

  it("hides inactive units by default and preserves pagination with the inactive filter", () => {
    expect(page).toContain('vehiclesQuery.in("status", ["active", "in_repair"])');
    expect(page).toContain('showInactive === "1"');
    expect(vehicleManager).toContain("Pasif Unitleri");
    expect(vehicleManager).toContain("&showInactive=1");
  });

  it("uses a vehicle-specific deactivate/reactivate UI instead of generic hard delete", () => {
    expect(removal).toContain("Listeden Kald");
    expect(removal).toContain("Pasife Al");
    expect(removal).toContain("Tekrar Aktif Et");
    expect(removal).toContain("Pasif");
    expect(removal).not.toContain("window.confirm");
    expect(removal).not.toContain("window.alert");
    expect(resourceManager).toContain("renderActions");
    expect(crud).toContain("export async function deleteRow");
  });

  it("deactivates and reactivates through organization-scoped server actions", () => {
    expect(actions).toContain("export async function deactivateVehicle");
    expect(actions).toContain("export async function reactivateVehicle");
    expect(actions).toContain("await requireWriteRole()");
    expect(actions).toContain('update({ status: "inactive" })');
    expect(actions).toContain('update({ status: "active" })');
    expect(actions).toContain('.eq("organization_id", profile.organization_id)');
    expect(actions).toContain('revalidatePath("/vehicles")');
    expect(actions).toContain('revalidatePath("/maintenance")');
    expect(actions).toContain('revalidatePath("/maintenance/units")');
  });

  it("preserves related history and disables only active tracking state on deactivate", () => {
    expect(actions).toContain("shutdownVehicleTracking");
    expect(actions).toContain('from("unit_locations")');
    expect(actions).toContain('tracking_mode: "offline"');
    expect(actions).toContain('from("tablet_tokens")');
    expect(actions).toContain("is_active: false");
    expect(actions).toContain('from("load_tracking")');
    expect(actions).toContain('tracking_status: "cancelled"');
    expect(actions).not.toContain('delete().eq("vehicle_id"');
  });

  it("blocks permanent delete when related data exists and avoids raw foreign-key errors", () => {
    expect(actions).toContain("VEHICLE_RELATION_CHECKS");
    expect(actions).toContain("maintenance_records");
    expect(actions).toContain("vehicle_mileage_logs");
    expect(actions).toContain("maintenance_invoices");
    expect(actions).toContain("vehicle_inspections");
    expect(actions).toContain("tracking_events");
    expect(actions).toContain("friendlyVehicleRemovalError");
    expect(actions).toContain("foreign key|violates|constraint|23503");
  });

  it("allows permanent delete only for owner/admin and only after unit-number confirmation", () => {
    expect(page).toContain('profile.role === "owner" || profile.role === "admin"');
    expect(page).toContain("canPermanentDelete={canPermanentDelete}");
    expect(removal).toContain("canPermanentDelete");
    expect(actions).toContain("permanentlyDeleteUnusedVehicle");
    expect(actions).toContain('!["owner", "admin"].includes(profile.role)');
    expect(actions).toContain("confirmationUnitNumber");
    expect(actions).toContain(".delete()");
  });

  it("keeps viewer read-only behavior through write-role checks", () => {
    expect(actions).toContain("requireWriteRole");
    expect(actions).toContain("owner veya admin");
  });
});
