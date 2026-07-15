import Link from "next/link";
import MaintenanceNav from "@/components/MaintenanceNav";
import { PM_BADGE, computePM, type PMResult, type PMThresholds } from "@/lib/maintenance";
import { expandEffectiveMaintenanceRules } from "@/lib/maintenance-reminders";
import { createClient } from "@/lib/supabase/server";
import { todayISO } from "@/lib/tz";

export const dynamic = "force-dynamic";

interface VehicleRow {
  id: string;
  unit_number: string;
  vehicle_type: string;
  current_mileage: number | null;
}

interface RuleRow {
  id: string;
  vehicle_id: string | null;
  vehicle_type?: string | null;
  effective_vehicle_id?: string;
  vehicles?: { id: string; unit_number: string; vehicle_type: string; current_mileage: number | null } | null;
  service_type: string;
  interval_miles: number | null;
  interval_days: number | null;
  interval_engine_hours: number | null;
  last_done_mileage: number | null;
  last_done_date: string | null;
  last_done_engine_hours: number | null;
}

type UnitStatus = "ok" | "due_soon" | "overdue";

function classify(results: PMResult[]): UnitStatus {
  if (results.some((result) => result.status === "overdue" || result.status === "due_now")) return "overdue";
  if (results.some((result) => result.status === "due_soon" || result.status === "warning")) return "due_soon";
  return "ok";
}

function statusLabel(status: UnitStatus) {
  if (status === "overdue") return "Gecikmiş";
  if (status === "due_soon") return "Yakında";
  return "Tamam";
}

export default async function MaintenanceUnitsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const q = String(Array.isArray(params.q) ? params.q[0] : params.q ?? "").trim().toLowerCase();
  const statusFilter = String(Array.isArray(params.status) ? params.status[0] : params.status ?? "all");
  const supabase = await createClient();
  const [vehiclesRes, rulesRes, statesRes, settingsRes, profilesRes, findingsRes, historyRes] = await Promise.all([
    supabase.from("vehicles").select("id, unit_number, vehicle_type, current_mileage, status").eq("status", "active").order("unit_number"),
    supabase
      .from("maintenance_rules")
      .select("id, vehicle_id, vehicle_type, service_type, interval_miles, interval_days, interval_engine_hours, last_done_mileage, last_done_date, last_done_engine_hours, active")
      .eq("active", true),
    supabase.from("maintenance_rule_vehicle_states").select("id, rule_id, vehicle_id, last_done_mileage, last_done_date, last_done_engine_hours"),
    supabase.from("settings").select("pm_due_soon_miles, pm_due_soon_days, pm_due_soon_engine_hours").single(),
    supabase.from("vehicle_maintenance_profiles").select("vehicle_id, engine_hours"),
    supabase.from("inspection_findings").select("vehicle_id, severity").eq("status", "open").in("severity", ["critical", "do_not_dispatch"]),
    supabase.from("maintenance_records").select("vehicle_id, performed_date").order("performed_date", { ascending: false }).limit(500),
  ]);
  const error = vehiclesRes.error ?? rulesRes.error ?? statesRes.error ?? settingsRes.error ?? profilesRes.error ?? findingsRes.error ?? historyRes.error;
  if (error) throw new Error(`Araç bakım listesi yüklenemedi: ${error.message}`);

  const settings = settingsRes.data;
  const thresholds: PMThresholds = {
    dueSoonMiles: Number(settings?.pm_due_soon_miles ?? 2_000),
    dueSoonDays: Number(settings?.pm_due_soon_days ?? 7),
    dueSoonEngineHours: Number(settings?.pm_due_soon_engine_hours ?? 100),
  };
  const rulesByVehicle = new Map<string, RuleRow[]>();
  const effectiveRules = expandEffectiveMaintenanceRules(
    (rulesRes.data ?? []) as any[],
    (vehiclesRes.data ?? []) as any[],
    (statesRes.data ?? []) as any[],
  ) as unknown as RuleRow[];
  for (const rule of effectiveRules) {
    const vehicleId = rule.effective_vehicle_id ?? rule.vehicle_id;
    if (!vehicleId) continue;
    rulesByVehicle.set(vehicleId, [...(rulesByVehicle.get(vehicleId) ?? []), rule]);
  }
  const engineHours = new Map(
    ((profilesRes.data ?? []) as Array<{ vehicle_id: string; engine_hours: number | null }>).map((row) => [
      row.vehicle_id,
      row.engine_hours == null ? null : Number(row.engine_hours),
    ]),
  );
  const criticalFindings = new Map<string, number>();
  for (const finding of (findingsRes.data ?? []) as Array<{ vehicle_id: string }>) {
    criticalFindings.set(finding.vehicle_id, (criticalFindings.get(finding.vehicle_id) ?? 0) + 1);
  }
  const lastMaintenance = new Map<string, string>();
  for (const row of (historyRes.data ?? []) as Array<{ vehicle_id: string; performed_date: string | null }>) {
    if (row.performed_date && !lastMaintenance.has(row.vehicle_id)) lastMaintenance.set(row.vehicle_id, row.performed_date);
  }

  const units = ((vehiclesRes.data ?? []) as VehicleRow[])
    .map((vehicle) => {
      const ruleResults = (rulesByVehicle.get(vehicle.id) ?? []).map((rule) =>
        computePM(rule, Number(vehicle.current_mileage ?? 0), thresholds, todayISO(), engineHours.get(vehicle.id) ?? null),
      );
      const status = classify(ruleResults);
      return {
        vehicle,
        status,
        overdue: ruleResults.filter((result) => result.status === "overdue" || result.status === "due_now").length,
        dueSoon: ruleResults.filter((result) => result.status === "due_soon" || result.status === "warning").length,
        engineHours: engineHours.get(vehicle.id) ?? null,
        lastMaintenance: lastMaintenance.get(vehicle.id) ?? null,
        criticalFindings: criticalFindings.get(vehicle.id) ?? 0,
      };
    })
    .filter((row) => !q || row.vehicle.unit_number.toLowerCase().includes(q))
    .filter((row) => statusFilter === "all" || row.status === statusFilter);

  return (
    <div className="space-y-5">
      <MaintenanceNav title="Bakım Merkezi" />
      <div>
        <h2 className="font-semibold">Araç Bakım Listesi</h2>
        <p className="mt-1 text-sm text-slate-500">Aktif araçların bakım durumunu hızlıca kontrol edin.</p>
      </div>

      <form className="card grid gap-3 md:grid-cols-4">
        <div className="md:col-span-2">
          <label className="label">Ara</label>
          <input className="input" name="q" defaultValue={q} placeholder="Araç numarası" />
        </div>
        <div>
          <label className="label">Durum</label>
          <select className="input" name="status" defaultValue={statusFilter}>
            <option value="all">Hepsi</option>
            <option value="overdue">Gecikmiş</option>
            <option value="due_soon">Yakında</option>
            <option value="ok">Tamam</option>
          </select>
        </div>
        <div className="flex items-end">
          <button type="submit" className="btn-primary w-full">Filtrele</button>
        </div>
      </form>

      {units.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-500">Araç bulunamadı.</div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {units.map((row) => (
            <Link
              key={row.vehicle.id}
              href={`/maintenance/units/${row.vehicle.id}`}
              className="rounded-lg border border-slate-200 bg-white p-4 transition hover:border-brand/50 hover:shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm text-slate-500">Araç</p>
                  <h3 className="text-xl font-bold">{row.vehicle.unit_number}</h3>
                </div>
                <span className={`badge ${row.status === "ok" ? PM_BADGE.ok : row.status === "overdue" ? PM_BADGE.overdue : PM_BADGE.due_soon}`}>
                  {statusLabel(row.status)}
                </span>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <MiniStat label="Mevcut mileage" value={row.vehicle.current_mileage == null ? "-" : `${Number(row.vehicle.current_mileage).toLocaleString("en-US")} mi`} />
                <MiniStat label="Engine Hours" value={row.engineHours == null ? "-" : Number(row.engineHours).toLocaleString("en-US")} />
                <MiniStat label="Son bakım" value={row.lastMaintenance ?? "-"} />
                <MiniStat label="Gecikmiş" value={String(row.overdue)} />
                <MiniStat label="Yakında" value={String(row.dueSoon)} />
                <MiniStat label="Kritik bulgu" value={String(row.criticalFindings)} />
              </div>
              <div className="mt-4 text-right text-sm font-medium text-brand">Detay</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 font-semibold text-slate-900">{value}</p>
    </div>
  );
}
