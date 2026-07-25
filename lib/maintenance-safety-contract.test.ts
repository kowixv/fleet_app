import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MAINTENANCE_VISIBLE_VEHICLE_STATUSES,
  isMaintenanceVisibleVehicleStatus,
} from "./maintenance-vehicle-status";

const migration = readFileSync(
  "supabase/migrations/20260724230329_maintenance_safety_data_integrity.sql",
  "utf8",
);

describe("maintenance safety database contract", () => {
  it("creates organization-scoped, writer-mutated dispatch holds with permanent audit history", () => {
    expect(migration).toContain("create table if not exists public.vehicle_dispatch_holds");
    expect(migration).toContain("foreign key (organization_id, vehicle_id)");
    expect(migration).toContain("vehicle_dispatch_holds_select");
    expect(migration).toContain("and (select public.is_org_writer())");
    expect(migration).toContain("revoke insert, update, delete on table public.vehicle_dispatch_holds from authenticated");
    expect(migration).toContain("vehicle_dispatch_holds_one_open_source_idx");
  });

  it("creates holds atomically from findings and clears only through an audited RPC", () => {
    expect(migration).toMatch(/after insert on public\.inspection_findings[\s\S]*create_dispatch_hold_from_inspection_finding/);
    expect(migration).toContain("new.severity = 'critical'");
    expect(migration).toContain("dispatch_hold_on_critical");
    expect(migration).toMatch(/clear_vehicle_dispatch_hold[\s\S]*length\(v_notes\) < 3/);
    expect(migration).toContain("status = 'cleared'");
    expect(migration).toContain("clearance_notes = v_notes");
  });

  it("blocks new load assignment in the database while preserving historical loads", () => {
    expect(migration).toContain("before insert or update of vehicle_id on public.loads");
    expect(migration).toContain("new.vehicle_id is not distinct from old.vehicle_id");
    expect(migration).toContain("Hold temizlenmeden yeni yük atanamaz");
  });

  it("enforces stale-draft concurrency in the RPC", () => {
    expect(migration).toContain("v_expected_updated_at");
    expect(migration).toContain("v_inspection.updated_at <> v_expected_updated_at");
    expect(migration).toContain("Taslak daha yeni bir sürüm");
  });

  it("uses the one shared maintenance-visible vehicle status contract", () => {
    expect(MAINTENANCE_VISIBLE_VEHICLE_STATUSES).toEqual(["active", "in_repair", "yard_hometime"]);
    expect(isMaintenanceVisibleVehicleStatus("yard_hometime")).toBe(true);
    expect(isMaintenanceVisibleVehicleStatus("inactive")).toBe(false);
  });

  it("resolves signed inspection files through an organization-owned result row", () => {
    const actions = readFileSync("app/(app)/maintenance/inspection-actions.ts", "utf8");
    expect(actions).toContain('.from("vehicle_inspection_results")');
    expect(actions).toContain('.eq("id", resultId)');
    expect(actions).toContain('.eq("organization_id", profile.organization_id)');
    expect(actions).not.toContain("signedInspectionFileUrl(storagePath");
  });

  it("uses the shared record validator in both create and edit actions", () => {
    const actions = readFileSync("app/(app)/maintenance/actions.ts", "utf8");
    expect(actions.match(/parseMaintenanceRecordForm\(/g)).toHaveLength(2);
    expect(actions).toContain('rpc("save_manual_maintenance_v2"');
    expect(migration).toContain("create or replace function public.edit_manual_maintenance_record");
  });
});
