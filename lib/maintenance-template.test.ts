import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { previewTemplateItems } from "./maintenance-template";

const migration = readFileSync(
  "supabase/migrations/20260713000000_maintenance_profiles_templates_combined_intervals.sql",
  "utf8",
);

describe("maintenance profile/template SQL contract", () => {
  it("keeps one maintenance profile per vehicle", () => {
    expect(migration).toContain("constraint vehicle_maintenance_profiles_vehicle_unique unique (organization_id, vehicle_id)");
    expect(migration).toContain("vehicle_maintenance_profiles_vehicle_same_org_fk");
  });

  it("preserves organization isolation with RLS policies", () => {
    expect(migration).toContain("alter table vehicle_maintenance_profiles enable row level security");
    expect(migration).toContain("alter table maintenance_templates enable row level security");
    expect(migration).toContain("organization_id = (select current_org_id())");
    expect(migration).toContain("and (select is_org_writer())");
  });

  it("seeds the default Peterbilt/Cummins template as configurable guidance", () => {
    expect(migration).toContain("2023 Peterbilt 579 + Cummins X15 EPA21");
    expect(migration).toContain("VIN/build-sheet specifications take precedence");
    expect(migration).toContain("Wet PM / Oil Service");
    expect(migration).toContain("Valve Overhead");
  });

  it("applies templates transactionally and skips duplicate active rules", () => {
    expect(migration).toContain("create or replace function apply_maintenance_template");
    expect(migration).toContain("for update");
    expect(migration).toContain("maintenance_service_key(service_type) = v_service_key");
    expect(migration).toContain("v_skipped := v_skipped + 1");
    expect(migration).toContain("template_applied_by");
  });

  it("adds combined mileage/date/hour intervals to maintenance rules", () => {
    expect(migration).toContain("alter table maintenance_rules add column if not exists interval_engine_hours numeric");
    expect(migration).toContain("alter table maintenance_rules add column if not exists last_done_engine_hours numeric");
    expect(migration).toContain("maintenance_rules_combined_intervals_chk");
    expect(migration).toContain("pm_due_soon_engine_hours");
  });

  it("keeps inactive rules excluded from dashboard and cron alerts", () => {
    const dashboard = readFileSync("app/(app)/page.tsx", "utf8");
    const cron = readFileSync("app/api/cron/pm-check/route.ts", "utf8");
    expect(dashboard).toContain('.eq("active", true)');
    expect(cron).toContain('.eq("active", true)');
  });
});

describe("template preview", () => {
  const items = [{
    id: "item-1",
    service_type: "Wet PM / Oil Service",
    service_category: "Oil",
    description: null,
    default_checklist_reference: null,
    interval_miles: 75_000,
    interval_days: null,
    interval_engine_hours: null,
    duty_cycle_adjusted: true,
    configurable: true,
    warning: null,
    sort_order: 1,
  }];

  it("prevents duplicate active rules in preview", () => {
    const [preview] = previewTemplateItems({
      items,
      vehicleId: "veh-1",
      existingRules: [{ id: "rule-1", vehicle_id: "veh-1", service_type: "Wet PM / Oil Service", active: true }],
      profile: { vehicle_id: "veh-1", duty_cycle: "normal_otr", rolling_30_day_mpg: 6.5, idle_percentage: 10, engine_hours: null },
    });
    expect(preview.enabled).toBe(false);
    expect(preview.duplicate_rule_id).toBe("rule-1");
  });

  it("shows duty-cycle recommendation and oil-analysis warning", () => {
    const [preview] = previewTemplateItems({
      items,
      vehicleId: "veh-1",
      existingRules: [],
      profile: { vehicle_id: "veh-1", duty_cycle: "heavy", rolling_30_day_mpg: 4.8, idle_percentage: 40, engine_hours: null },
    });
    expect(preview.recommendation).toContain("25,000");
    expect(preview.recommendation_warning).toContain("oil-analysis");
  });
});
