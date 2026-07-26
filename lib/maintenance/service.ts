import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { MaintenanceCostFilters, MaintenanceCostRow } from "@/lib/maintenance-cost";
import type { MaintenanceAnalytics } from "@/lib/maintenance/domain";
import {
  readAllMaintenanceCostRows,
  readMaintenanceCostAnalytics,
  type MaintenanceAnalyticsQuery,
} from "@/lib/maintenance/repository";
import {
  parseMaintenanceAnalytics,
  parseMaintenanceCostRows,
} from "@/lib/maintenance/validators";

export async function getMaintenanceCostAnalytics(
  supabase: SupabaseClient,
  input: MaintenanceAnalyticsQuery,
): Promise<MaintenanceAnalytics> {
  return parseMaintenanceAnalytics(await readMaintenanceCostAnalytics(supabase, input));
}

export async function getAllMaintenanceCostRows(
  supabase: SupabaseClient,
  filters: MaintenanceCostFilters,
): Promise<MaintenanceCostRow[]> {
  return parseMaintenanceCostRows(await readAllMaintenanceCostRows(supabase, filters));
}
