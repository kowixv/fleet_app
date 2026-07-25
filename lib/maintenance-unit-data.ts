import "server-only";

import { expandEffectiveMaintenanceRules } from "@/lib/maintenance-reminders";
import {
  buildMaintenanceUnitSummaries,
  type MaintenanceEffectiveRuleSource,
  type MaintenanceFindingSummarySource,
  type MaintenanceProfileSummarySource,
  type MaintenanceRecordSummarySource,
  type MaintenanceVehicleSummarySource,
} from "@/lib/maintenance-unit-summary";
import { maintenanceVisibleVehicleStatuses } from "@/lib/maintenance-vehicles";
import { createClient } from "@/lib/supabase/server";
import { todayISO } from "@/lib/tz";

export async function loadMaintenanceUnitDirectory(includeArchived = false) {
  const supabase = await createClient();
  let vehiclesQuery = supabase
    .from("vehicles")
    .select(
      "id, unit_number, vehicle_type, current_mileage, status, vin, year, make, model, truck_color",
    )
    .order("unit_number");
  if (!includeArchived) {
    vehiclesQuery = vehiclesQuery.in("status", maintenanceVisibleVehicleStatuses());
  }

  const [
    vehiclesResult,
    rulesResult,
    statesResult,
    settingsResult,
    profilesResult,
    findingsResult,
    recordsResult,
  ] = await Promise.all([
    vehiclesQuery,
    supabase
      .from("maintenance_rules")
      .select(
        "id, vehicle_id, vehicle_type, service_type, interval_miles, interval_days, interval_engine_hours, last_done_mileage, last_done_date, last_done_engine_hours, active",
      )
      .eq("active", true),
    supabase
      .from("maintenance_rule_vehicle_states")
      .select(
        "id, rule_id, vehicle_id, last_done_mileage, last_done_date, last_done_engine_hours",
      ),
    supabase
      .from("settings")
      .select(
        "pm_due_soon_miles, pm_due_soon_days, pm_due_soon_engine_hours, repair_warning_amount",
      )
      .single(),
    supabase
      .from("vehicle_maintenance_profiles")
      .select("vehicle_id, engine_hours"),
    supabase
      .from("inspection_findings")
      .select("id, vehicle_id, severity, label, recommended_action")
      .eq("status", "open")
      .in("severity", ["critical", "do_not_dispatch"])
      .order("created_at", { ascending: false }),
    supabase
      .from("maintenance_records")
      .select(
        "id, vehicle_id, service_type, performed_date, mileage, cost, total_cost, shop_name, invoice_number, planned, status",
      )
      .is("deleted_at", null)
      .eq("status", "completed")
      .order("performed_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1000),
  ]);

  const error =
    vehiclesResult.error ??
    rulesResult.error ??
    statesResult.error ??
    settingsResult.error ??
    profilesResult.error ??
    findingsResult.error ??
    recordsResult.error;
  if (error) throw new Error(`Unit bakım görünümü yüklenemedi: ${error.message}`);

  const vehicles = (vehiclesResult.data ?? []) as MaintenanceVehicleSummarySource[];
  const settings = settingsResult.data;
  const thresholds = {
    dueSoonMiles: Number(settings?.pm_due_soon_miles ?? 2_000),
    dueSoonDays: Number(settings?.pm_due_soon_days ?? 7),
    dueSoonEngineHours: Number(settings?.pm_due_soon_engine_hours ?? 100),
  };
  const effectiveRules = expandEffectiveMaintenanceRules(
    (rulesResult.data ?? []) as any[],
    vehicles,
    (statesResult.data ?? []) as any[],
    true,
  ) as unknown as MaintenanceEffectiveRuleSource[];
  const profiles = (profilesResult.data ?? []) as MaintenanceProfileSummarySource[];
  const findings = (findingsResult.data ?? []) as Array<
    MaintenanceFindingSummarySource & {
      id: string;
      label: string | null;
      recommended_action: string | null;
    }
  >;
  const records = (recordsResult.data ?? []) as Array<
    MaintenanceRecordSummarySource & {
      id: string;
      mileage: number | null;
      shop_name: string | null;
      invoice_number: string | null;
      planned: boolean;
      status: string;
    }
  >;
  const units = buildMaintenanceUnitSummaries({
    vehicles,
    effectiveRules,
    profiles,
    findings,
    records,
    thresholds,
    today: todayISO(),
  });

  return {
    units,
    vehicles,
    effectiveRules,
    profiles,
    findings,
    records,
    thresholds,
    repairWarningAmount: Number(settings?.repair_warning_amount ?? 0),
  };
}
