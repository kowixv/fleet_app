import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { MaintenanceCostFilters } from "@/lib/maintenance-cost";

export interface MaintenanceAnalyticsQuery extends MaintenanceCostFilters {
  start: string;
  end: string;
  averageDailyContribution: number;
}

function plannedValue(value: MaintenanceCostFilters["planned"]): boolean | null {
  if (value === "planned") return true;
  if (value === "unscheduled") return false;
  return null;
}

export async function readMaintenanceCostAnalytics(
  supabase: SupabaseClient,
  input: MaintenanceAnalyticsQuery,
): Promise<unknown> {
  const { data, error } = await supabase.rpc("get_maintenance_cost_analytics_v2", {
    p_start: input.start,
    p_end: input.end,
    p_vehicle_id: input.vehicleId ?? null,
    p_category: input.category ?? null,
    p_planned: plannedValue(input.planned),
    p_shop: input.shop ?? null,
    p_status: input.status ?? null,
    p_average_daily_contribution: input.averageDailyContribution,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function readAllMaintenanceCostRows(
  supabase: SupabaseClient,
  filters: MaintenanceCostFilters,
): Promise<unknown[]> {
  const pageSize = 1000;
  const rows: unknown[] = [];
  for (let page = 0; ; page += 1) {
    let query = supabase
      .from("maintenance_cost_fact_v")
      .select("*")
      .order("cost_date", { ascending: false })
      .order("source_record_id", { ascending: false })
      .range(page * pageSize, page * pageSize + pageSize - 1);
    if (filters.start) query = query.gte("cost_date", filters.start);
    if (filters.end) query = query.lte("cost_date", filters.end);
    if (filters.vehicleId) query = query.eq("vehicle_id", filters.vehicleId);
    if (filters.category) query = query.eq("category", filters.category);
    if (filters.planned === "planned") query = query.eq("planned", true);
    if (filters.planned === "unscheduled") query = query.eq("planned", false);
    if (filters.shop) query = query.eq("shop", filters.shop);
    if (filters.status) query = query.eq("status", filters.status);

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const batch: unknown[] = data ?? [];
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }
  return rows;
}
