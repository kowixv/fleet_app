import VehicleResourceManager, { type VehicleFormRow } from "@/components/VehicleResourceManager";
import { requireProfile } from "@/lib/auth";
import { DEFAULT_PAGE_SIZE, fetchOptions, parsePage } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function VehiclesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; showInactive?: string }>;
}) {
  const { page, showInactive } = await searchParams;
  const includeInactive = showInactive === "1";
  const currentPage = parsePage(page);
  const from = (currentPage - 1) * DEFAULT_PAGE_SIZE;
  const profile = await requireProfile();
  const canPermanentDelete = profile.role === "owner" || profile.role === "admin";
  const supabase = await createClient();

  let vehiclesQuery = supabase
    .from("vehicles")
    .select("*", { count: "exact" })
    .order("unit_number", { ascending: true })
    .range(from, from + DEFAULT_PAGE_SIZE - 1);
  if (!includeInactive) vehiclesQuery = vehiclesQuery.in("status", ["active", "in_repair", "yard_hometime"]);

  const [vehiclesRes, opts] = await Promise.all([vehiclesQuery, fetchOptions()]);
  if (vehiclesRes.error) throw new Error(`Vehicle data failed to load: ${vehiclesRes.error.message}`);

  const vehicles = (vehiclesRes.data ?? []) as Array<Record<string, any>>;
  const vehicleIds = vehicles.map((vehicle) => vehicle.id);
  const profilesRes = vehicleIds.length
    ? await supabase
        .from("vehicle_maintenance_profiles")
        .select("vehicle_id, engine_model, engine_hours")
        .in("vehicle_id", vehicleIds)
    : { data: [], error: null };
  if (profilesRes.error) throw new Error(`Vehicle profile data failed to load: ${profilesRes.error.message}`);

  const profileByVehicle = new Map((profilesRes.data ?? []).map((row: any) => [row.vehicle_id, row]));
  const rows = vehicles.map((vehicle) => {
    const maintenanceProfile = profileByVehicle.get(vehicle.id);
    return {
      ...vehicle,
      engine_model: maintenanceProfile?.engine_model ?? null,
      engine_hours: maintenanceProfile?.engine_hours ?? null,
      has_maintenance_profile: Boolean(maintenanceProfile),
    };
  }) as VehicleFormRow[];

  return (
    <VehicleResourceManager
      rows={rows}
      drivers={opts.drivers}
      owners={opts.owners}
      pagination={{ page: currentPage, pageSize: DEFAULT_PAGE_SIZE, total: vehiclesRes.count ?? 0 }}
      includeInactive={includeInactive}
      canPermanentDelete={canPermanentDelete}
    />
  );
}
