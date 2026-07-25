import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260725190930_maintenance_budget_warranty_analytics.sql"),
  "utf8",
);

describe("maintenance PR3 database contract", () => {
  it("creates organization-scoped budget, warranty and audit tables with RLS", () => {
    for (const table of ["maintenance_budgets", "maintenance_warranty_claims", "maintenance_warranty_claim_events"]) {
      expect(migration).toContain(`create table if not exists public.${table}`);
      expect(migration).toContain(`alter table public.${table} enable row level security`);
      expect(migration).toMatch(new RegExp(`${table}[\\s\\S]*organization_id uuid not null`));
    }
    expect(migration).toContain("organization_id = (select public.current_org_id())");
    expect(migration).toContain("(select public.is_org_writer())");
  });

  it("explicitly grants Data API access without granting anonymous access", () => {
    expect(migration).toContain("revoke all on table public.maintenance_budgets from anon, authenticated");
    expect(migration).toContain("grant select, insert, update on table public.maintenance_budgets to authenticated");
    expect(migration).not.toContain("to anon;");
  });

  it("calculates committed cost from approved open work orders", () => {
    const budgetRpc = migration.slice(
      migration.indexOf("create or replace function public.get_maintenance_budget_performance"),
      migration.indexOf("create or replace function public.get_maintenance_decision_analytics"),
    );
    expect(budgetRpc).toContain("approved_cost_limit");
    expect(budgetRpc).toContain("estimated_cost");
    expect(budgetRpc).toContain("status not in ('completed', 'invoiced', 'closed', 'cancelled')");
    expect(budgetRpc).toContain("approval_state in ('approved', 'not_required')");
    expect(budgetRpc).toContain("where b.organization_id = v_org");
  });

  it("enforces warranty lifecycle and immutable status history", () => {
    for (const status of ["draft", "submitted", "under_review", "approved", "partially_approved", "denied", "paid", "closed"]) {
      expect(migration).toContain(`'${status}'`);
    }
    expect(migration).toContain("Invalid warranty claim transition");
    expect(migration).toContain("Warranty claim audit records are immutable.");
    expect(migration).toContain("before update or delete on public.maintenance_warranty_claim_events");
    expect(migration).toContain("Work order does not belong to the selected vehicle.");
  });

  it("produces vendor scorecard and repeat-repair metrics in SQL", () => {
    for (const metric of [
      "total_spend",
      "average_repair_cost",
      "repeat_repair_rate",
      "average_downtime_days",
      "estimate_to_final_variance",
      "warranty_recovery",
      "road_calls_after_repair",
      "open_work_orders",
    ]) expect(migration).toContain(`'${metric}'`);
    expect(migration).toContain("lag(f.cost_date)");
    expect(migration).toContain("cost_date - previous_same_repair_date <= 30");
  });

  it("keeps downtime impact dimensions separate and thresholds configurable", () => {
    for (const metric of [
      "direct_maintenance_cost",
      "travel_hotel_impact",
      "towing_road_service_impact",
      "estimated_lost_contribution",
      "total_estimated_operational_impact",
    ]) expect(migration).toContain(`'${metric}'`);
    expect(migration).toContain("maintenance_average_daily_contribution");
    expect(migration).toContain("maintenance_replacement_cost_12m_threshold");
    expect(migration).toContain("maintenance_replacement_cpm_threshold");
  });

  it("uses fixed search paths and revokes privileged function execution", () => {
    expect(migration).toContain("security definer");
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain("revoke execute on function public.get_maintenance_decision_analytics(date) from public, anon");
    expect(migration).not.toMatch(/p_organization_id/);
  });
});
