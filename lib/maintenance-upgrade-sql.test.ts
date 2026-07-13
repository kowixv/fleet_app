import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260712000000_maintenance_invoice_upgrade.sql",
  "utf8",
);

describe("maintenance invoice upgrade SQL contract", () => {
  it("prevents duplicate invoice hashes inside an organization", () => {
    expect(migration).toContain(
      "constraint maintenance_invoices_org_hash_key unique (organization_id, file_hash)",
    );
    expect(migration).toContain("raise exception 'DUPLICATE_INVOICE'");
  });

  it("stores every invoice service as a maintenance record in the RPC transaction", () => {
    expect(migration).toMatch(
      /for v_item in select value from jsonb_array_elements\(p_services\)[\s\S]*insert into maintenance_records/,
    );
    expect(migration).toContain("alter table maintenance_records add column if not exists parts_used text[]");
    expect(migration).toContain("v_org, v_vehicle, v_rule, v_invoice, v_service");
    expect(migration).toContain("part_name, parts_used, notes");
    expect(migration).toContain("coalesce(v_parts, '{}'::text[])");
    expect(migration).toContain("v_next_mileage, v_next_date, 'invoice'");
  });

  it("keeps mileage writes monotonic and audited", () => {
    expect(migration).toContain("if p_mileage < coalesce(v_current, 0) then");
    expect(migration).toContain("insert into vehicle_mileage_logs (organization_id, vehicle_id, mileage, source)");
    expect(migration).toContain("and v_mileage > coalesce(current_mileage, 0)");
  });

  it("uses active scoped rules and authoritative mileage in service RPCs", () => {
    expect(migration).toMatch(/where r\.id = p_rule_id[\s\S]*r\.active = true[\s\S]*for update of r, v/);
    expect(migration).toContain("select r.vehicle_id, r.service_type, v.current_mileage");
    expect(migration).toContain("where organization_id = v_org and vehicle_id = v_vehicle and active = true");
  });

  it("keeps invoice metadata private and service-role scoped", () => {
    expect(migration).toContain("values ('maintenance-invoices', 'maintenance-invoices', false)");
    expect(migration).toContain("alter table maintenance_invoices enable row level security");
    expect(migration).toContain("using (organization_id = (select current_org_id()))");
    expect(migration).toContain("revoke execute on function save_maintenance_invoice(jsonb,jsonb) from public, anon, authenticated");
    expect(migration).toContain("grant execute on function save_maintenance_invoice(jsonb,jsonb) to service_role");
  });
});
