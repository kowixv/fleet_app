import MaintenanceNav from "@/components/MaintenanceNav";
import MaintenanceReminderManager, { type ReminderRow } from "@/components/MaintenanceReminderManager";
import { computePM, type PMThresholds } from "@/lib/maintenance";
import { expandEffectiveMaintenanceRules } from "@/lib/maintenance-reminders";
import { createClient } from "@/lib/supabase/server";
import { todayISO } from "@/lib/tz";
import Link from "next/link";

export const dynamic = "force-dynamic";

type Tab = "all" | "soon" | "overdue" | "inactive";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "all", label: "Tümü" },
  { id: "soon", label: "Yaklaşan" },
  { id: "overdue", label: "Geciken" },
  { id: "inactive", label: "Pasif" },
];

function tabFrom(value: string | string[] | undefined): Tab {
  const raw = Array.isArray(value) ? value[0] : value;
  return TABS.some((tab) => tab.id === raw) ? raw as Tab : "all";
}

export default async function MaintenanceRemindersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const tab = tabFrom(params.tab);
  const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
  const supabase = await createClient();
  const [rulesRes, vehiclesRes, profilesRes, settingsRes, statesRes] = await Promise.all([
    supabase
      .from("maintenance_rules")
      .select("id, vehicle_id, vehicle_type, service_type, interval_type, interval_miles, interval_days, interval_engine_hours, last_done_mileage, last_done_date, last_done_engine_hours, active, created_at")
      .order("active", { ascending: false })
      .order("created_at", { ascending: false }),
    supabase.from("vehicles").select("id, unit_number, vehicle_type, current_mileage, status").order("unit_number"),
    supabase.from("vehicle_maintenance_profiles").select("vehicle_id, engine_hours, engine_model"),
    supabase.from("settings").select("pm_due_soon_miles, pm_due_soon_days, pm_due_soon_engine_hours").single(),
    supabase.from("maintenance_rule_vehicle_states").select("id, rule_id, vehicle_id, last_done_mileage, last_done_date, last_done_engine_hours"),
  ]);
  const error = rulesRes.error ?? vehiclesRes.error ?? profilesRes.error ?? settingsRes.error ?? statesRes.error;
  if (error) throw new Error(`Bakım hatırlatıcıları yüklenemedi: ${error.message}`);

  const thresholds: PMThresholds = {
    dueSoonMiles: Number(settingsRes.data?.pm_due_soon_miles ?? 2_000),
    dueSoonDays: Number(settingsRes.data?.pm_due_soon_days ?? 7),
    dueSoonEngineHours: Number(settingsRes.data?.pm_due_soon_engine_hours ?? 100),
  };
  const profileRows = (profilesRes.data ?? []) as Array<{ vehicle_id: string; engine_hours: number | null; engine_model: string | null }>;
  const profiles = new Map(
    profileRows.map((profile) => [
      profile.vehicle_id,
      profile.engine_hours == null ? null : Number(profile.engine_hours),
    ]),
  );
  const engineModels = new Map(profileRows.map((profile) => [profile.vehicle_id, profile.engine_model]));
  const vehicles = ((vehiclesRes.data ?? []) as Array<{ id: string; unit_number: string; vehicle_type: string; current_mileage: number | null; status: string | null }>).map((vehicle) => ({
    value: vehicle.id,
    label: vehicle.unit_number,
    vehicleType: vehicle.vehicle_type,
    currentMileage: vehicle.current_mileage == null ? null : Number(vehicle.current_mileage),
    engineHours: profiles.get(vehicle.id) ?? null,
  }));
  const vehicleById = new Map(vehicles.map((vehicle) => [vehicle.value, vehicle]));
  const effectiveRows = expandEffectiveMaintenanceRules(
    (rulesRes.data ?? []) as any[],
    ((vehiclesRes.data ?? []) as any[]).map((vehicle) => ({
      ...vehicle,
      engine_hours: profiles.get(vehicle.id) ?? null,
    })),
    (statesRes.data ?? []) as any[],
    tab === "inactive",
  ) as unknown as ReminderRow[];
  const rows = effectiveRows.filter((row) => {
    if (tab === "inactive") return !row.active;
    if (!row.active) return false;
    if (tab === "all") return true;
    const vehicle = vehicleById.get(row.effective_vehicle_id);
    const pm = computePM(
      row,
      Number(row.vehicles?.current_mileage ?? vehicle?.currentMileage ?? 0),
      thresholds,
      todayISO(),
      vehicle?.engineHours ?? null,
    );
    if (tab === "overdue") return pm.status === "overdue" || pm.status === "due_now";
    return pm.status === "due_soon" || pm.status === "warning";
  });
  const defaultVehicle = first(params.vehicleId) ? vehicleById.get(first(params.vehicleId)!) : null;
  const installerVehicles = ((vehiclesRes.data ?? []) as Array<{ id: string; unit_number: string; vehicle_type: string; status: string | null }>)
    .filter((vehicle) => vehicle.status === "active" && (vehicle.vehicle_type === "truck" || vehicle.vehicle_type === "box_truck"))
    .map((vehicle) => ({
      id: vehicle.id,
      unitNumber: vehicle.unit_number,
      vehicleType: vehicle.vehicle_type,
      engineModel: engineModels.get(vehicle.id) ?? null,
    }));
  const installerExistingRules = ((rulesRes.data ?? []) as Array<{
    id: string;
    vehicle_id: string | null;
    vehicle_type: string | null;
    service_type: string;
    interval_miles: number | null;
    interval_days: number | null;
    interval_engine_hours: number | null;
    active: boolean;
  }>).filter((rule) => rule.active);

  return (
    <div className="space-y-5">
      <MaintenanceNav title="Bakım Merkezi" />
      <nav className="flex gap-2 overflow-x-auto border-b border-slate-200 pb-2 text-sm">
        {TABS.map((item) => (
          <Link
            key={item.id}
            href={`/maintenance/reminders${item.id === "all" ? "" : `?tab=${item.id}`}`}
            className={`whitespace-nowrap rounded-md px-3 py-1.5 ${
              item.id === tab ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            }`}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <MaintenanceReminderManager
        rows={rows}
        vehicles={vehicles}
        thresholds={thresholds}
        installerVehicles={installerVehicles}
        installerExistingRules={installerExistingRules}
        defaultVehicleType={defaultVehicle?.vehicleType ?? "truck"}
        defaultService={first(params.service)}
      />
    </div>
  );
}
