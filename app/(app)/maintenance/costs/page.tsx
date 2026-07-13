import MaintenanceCostDashboard, { normalizeMaintenanceCostFilters } from "@/components/MaintenanceCostDashboard";
import MaintenanceNav from "@/components/MaintenanceNav";
import type { MaintenanceCostRow, MileagePeriodSnapshot } from "@/lib/maintenance-cost";
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
  const [settingsResult, vehiclesResult, costRowsResult, mileageSnapshotsResult] = await Promise.all([
    supabase.from("settings").select("repair_warning_amount").single(),
    supabase.from("vehicles").select("id, unit_number").eq("status", "active").order("unit_number"),
    supabase
      .from("maintenance_cost_fact_v")
      .select("*")
      .gte("cost_date", costStart)
      .lte("cost_date", costEnd)
      .order("cost_date", { ascending: false })
      .limit(1000),
    supabase
      .from("vehicle_mileage_period_snapshots")
      .select("vehicle_id, period_start, period_end, miles_driven")
      .gte("period_start", costStart)
      .lte("period_end", costEnd),
  ]);
  const error = settingsResult.error ?? vehiclesResult.error ?? costRowsResult.error ?? mileageSnapshotsResult.error;
  if (error) throw new Error(`Bakım maliyet analizi yüklenemedi: ${error.message}`);

  return (
    <div className="space-y-5">
      <MaintenanceNav title="Bakım Merkezi" />
      <MaintenanceCostDashboard
        rows={(costRowsResult.data ?? []) as unknown as MaintenanceCostRow[]}
        snapshots={(mileageSnapshotsResult.data ?? []) as unknown as MileagePeriodSnapshot[]}
        vehicles={(vehiclesResult.data ?? []) as any}
        filters={{ ...costFilters, start: costStart, end: costEnd }}
        repairWarningAmount={Number(settingsResult.data?.repair_warning_amount ?? 5_000)}
        exportHref={`/api/maintenance/costs/export?${exportParams.toString()}`}
      />
    </div>
  );
}
