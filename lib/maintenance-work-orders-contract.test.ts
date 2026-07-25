import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260725001831_maintenance_work_orders_and_scheduling.sql"),
  "utf8",
);

describe("maintenance work-order database contract", () => {
  it("creates every org-scoped work-order relation with RLS", () => {
    for (const table of [
      "maintenance_work_orders",
      "maintenance_work_order_tasks",
      "maintenance_work_order_parts",
      "maintenance_work_order_status_events",
      "maintenance_work_order_attachments",
      "maintenance_work_order_approvals",
    ]) {
      expect(migration).toContain(`create table if not exists public.${table}`);
      expect(migration).toContain(`alter table public.${table} enable row level security`);
      expect(migration).toMatch(new RegExp(`${table}[\\s\\S]*organization_id uuid not null`));
    }
  });

  it("keeps viewer mutations denied while writer checks are database enforced", () => {
    expect(migration).toContain("revoke all on table public.maintenance_work_orders from anon, authenticated");
    expect(migration).not.toContain("grant insert on table public.maintenance_work_orders to authenticated");
    expect(migration).toContain("and (select public.is_org_writer())");
    expect(migration).toContain("not (select public.is_org_writer())");
  });

  it("uses same-org keys and session-derived organization in privileged workflows", () => {
    expect(migration).toContain("foreign key (organization_id, work_order_id)");
    expect(migration).toContain("v_org uuid := (select public.current_org_id())");
    expect(migration).toContain("where organization_id = v_org");
    expect(migration).not.toMatch(/p_organization_id/);
  });

  it("makes status and approval audit rows immutable", () => {
    expect(migration).toContain("Work-order audit records are immutable.");
    expect(migration).toContain("before update or delete on public.maintenance_work_order_status_events");
    expect(migration).toContain("before update or delete on public.maintenance_work_order_approvals");
  });

  it("supports all conversion sources and links inspection findings to real work orders", () => {
    for (const source of ["inspection_finding", "maintenance_reminder", "manual", "breakdown", "invoice_review"]) {
      expect(migration).toContain(`'${source}'`);
    }
    expect(migration).toContain("add column if not exists work_order_id uuid");
    expect(migration).toContain("set work_order_id = v_work_order_id");
    expect(migration).toContain("work_order_status = 'created'");
  });

  it("enforces approval, child lifecycles, and closure invariants", () => {
    expect(migration).toContain("maintenance_work_order_approval_threshold");
    expect(migration).toContain("Approval is required for this estimate.");
    expect(migration).toContain("Invalid work-order task transition");
    expect(migration).toContain("Invalid work-order part transition");
    expect(migration).toContain("All active tasks must be completed before closure.");
  });

  it("never clears dispatch hold as a side effect of work-order closure", () => {
    const transitionFunction = migration.slice(
      migration.indexOf("create or replace function public.transition_maintenance_work_order"),
      migration.indexOf("create or replace function public.submit_maintenance_work_order_estimate"),
    );
    expect(transitionFunction).toContain("downtime_end");
    expect(transitionFunction).not.toContain("clear_vehicle_dispatch_hold");
    expect(transitionFunction).not.toMatch(/update public\.vehicle_dispatch_holds/);
  });
});
