import MaintenanceCostDashboard, { normalizeMaintenanceCostFilters } from "@/components/MaintenanceCostDashboard";
import MaintenanceNav from "@/components/MaintenanceNav";
import { getMaintenanceCostAnalytics } from "@/lib/maintenance/service";
import { maintenanceVisibleVehicleStatuses } from "@/lib/maintenance-vehicle-status";
import { createClient } from "@/lib/supabase/server";
import { todayISO } from "@/lib/tz";

export const dynamic = "force-dynamic";

function daysAgo(days: number): string {
  const [year, month, day] = todayISO().split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

export default async function MaintenanceCostsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const costFilters = normalizeMaintenanceCostFilters(params);
  const costStart = costFilters.start ?? daysAgo(365);
  const costEnd = costFilters.end ?? todayISO();
  const exportParams = new URLSearchParams();
  exportParams.set("start", costStart);
  exportParams.set("end", costEnd);
  if (costFilters.vehicleId) exportParams.set("vehicle", costFilters.vehicleId);
  if (costFilters.category) exportParams.set("category", costFilters.category);
  if (costFilters.planned && costFilters.planned !== "all") exportParams.set("planned", costFilters.planned);
  if (costFilters.shop) exportParams.set("shop", costFilters.shop);
  if (costFilters.status) exportParams.set("status", costFilters.status);

  const supabase = await createClient();
  const [settingsResult, vehiclesResult] = await Promise.all([
    supabase.from("settings").select("maintenance_average_daily_contribution").single(),
    supabase.from("vehicles").select("id, unit_number").in("status", maintenanceVisibleVehicleStatuses()).order("unit_number"),
  ]);
  const error = settingsResult.error ?? vehiclesResult.error;
  if (error) throw new Error(`Bakım maliyet analizi yüklenemedi: ${error.message}`);

  const analytics = await getMaintenanceCostAnalytics(supabase, {
    ...costFilters,
    start: costStart,
    end: costEnd,
    averageDailyContribution: Number(settingsResult.data?.maintenance_average_daily_contribution ?? 600),
  });

  return (
    <div className="space-y-5">
      <MaintenanceNav title="Bakım Merkezi" />
      <MaintenanceCostDashboard
        summary={analytics}
        vehicles={vehiclesResult.data ?? []}
        filters={{ ...costFilters, start: costStart, end: costEnd }}
        exportHref={`/api/maintenance/costs/export?${exportParams.toString()}`}
      />
    </div>
  );
}
