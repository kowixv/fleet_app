import Link from "next/link";
import { usd } from "@/lib/format";
import { summarizeMaintenanceCosts, type MaintenanceCostRow, type MileagePeriodSnapshot } from "@/lib/maintenance-cost";
import {
  comparePMAlerts,
  computePM,
  formatPMRemaining,
  formatPMWhichever,
  PM_BADGE,
  type PMResult,
} from "@/lib/maintenance";
import { createClient } from "@/lib/supabase/server";
import { todayISO, weekRange } from "@/lib/tz";

export const dynamic = "force-dynamic";

interface DashboardRule {
  id: string;
  vehicle_id: string;
  service_type: string;
  interval_type: "mileage" | "date";
  interval_miles: number | null;
  interval_days: number | null;
  interval_engine_hours: number | null;
  last_done_mileage: number | null;
  last_done_date: string | null;
  last_done_engine_hours: number | null;
  vehicles: { unit_number: string; current_mileage: number | null } | null;
}

interface PMAlert { rule: DashboardRule; pm: PMResult }

export default async function Dashboard() {
  const supabase = await createClient();
  const { start, end } = weekRange();

  const [
    loadsRes,
    expRes,
    importedRes,
    vehiclesRes,
    settleRes,
    rulesRes,
    settingsRes,
    profilesRes,
    maintenanceCostRes,
    costFactRes,
    mileageSnapshotsRes,
  ] =
    await Promise.all([
      supabase.from("loads").select("gross_amount").gte("delivery_date", start).lte("delivery_date", end),
      supabase.from("expenses").select("amount").gte("date", start).lte("date", end),
      supabase.from("imported_loads").select("id", { count: "exact", head: true }).eq("status", "pending"),
      supabase.from("vehicles").select("status"),
      supabase.from("settlements").select("status, our_commission_earned"),
      supabase
        .from("maintenance_rules")
        .select("*, vehicles!maintenance_rules_vehicle_id_fkey(unit_number, current_mileage)")
        .eq("active", true),
      supabase
        .from("settings")
        .select("pm_due_soon_miles, pm_due_soon_days, pm_due_soon_engine_hours, repair_warning_amount")
        .single(),
      supabase
        .from("vehicle_maintenance_profiles")
        .select("vehicle_id, engine_hours"),
      supabase
        .from("maintenance_records")
        .select("id, service_type, performed_date, cost, vehicles!maintenance_records_vehicle_id_fkey(unit_number)")
        .order("performed_date", { ascending: false })
        .limit(30),
      supabase
        .from("maintenance_cost_fact_v")
        .select("*")
        .gte("cost_date", start)
        .lte("cost_date", end)
        .limit(1000),
      supabase
        .from("vehicle_mileage_period_snapshots")
        .select("vehicle_id, period_start, period_end, miles_driven")
        .gte("period_start", start)
        .lte("period_end", end),
    ]);

  const queryError =
    loadsRes.error ??
    expRes.error ??
    vehiclesRes.error ??
    settleRes.error ??
    rulesRes.error ??
    settingsRes.error ??
    profilesRes.error ??
    maintenanceCostRes.error ??
    costFactRes.error ??
    mileageSnapshotsRes.error;
  if (queryError) throw new Error(`Dashboard data failed to load: ${queryError.message}`);

  const gross = (loadsRes.data ?? []).reduce((sum, load) => sum + Number(load.gross_amount || 0), 0);
  const expenses = (expRes.data ?? []).reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  const pendingImported = importedRes.count ?? 0;
  const activeVehicles = (vehiclesRes.data ?? []).filter((vehicle) => vehicle.status === "active").length;
  const inRepair = (vehiclesRes.data ?? []).filter((vehicle) => vehicle.status === "in_repair").length;
  const pendingSettlements = (settleRes.data ?? []).filter(
    (settlement) => settlement.status === "draft" || settlement.status === "pending_review",
  ).length;
  const commission = (settleRes.data ?? [])
    .filter((settlement) => settlement.status === "finalized" || settlement.status === "paid")
    .reduce((sum, settlement) => sum + Number(settlement.our_commission_earned || 0), 0);

  const thresholds = {
    dueSoonMiles: Number(settingsRes.data?.pm_due_soon_miles ?? 2_000),
    dueSoonDays: Number(settingsRes.data?.pm_due_soon_days ?? 7),
    dueSoonEngineHours: Number(settingsRes.data?.pm_due_soon_engine_hours ?? 100),
  };
  const engineHoursByVehicle = new Map(
    ((profilesRes.data ?? []) as Array<{ vehicle_id: string; engine_hours: number | null }>).map((profile) => [
      profile.vehicle_id,
      profile.engine_hours == null ? null : Number(profile.engine_hours),
    ]),
  );

  const pmAlerts: PMAlert[] = ((rulesRes.data ?? []) as unknown as DashboardRule[])
    .map((rule) => ({
      rule,
      pm: computePM(
        rule,
        Number(rule.vehicles?.current_mileage ?? 0),
        thresholds,
        todayISO(),
        engineHoursByVehicle.get(rule.vehicle_id) ?? null,
      ),
    }))
    .filter(({ pm }) => pm.status !== "ok")
    .sort((a, b) => comparePMAlerts(a.pm, b.pm));
  const datePMAlerts = pmAlerts.filter(({ pm }) => pm.unit === "days");
  const mileagePMAlerts = pmAlerts.filter(({ pm }) => pm.unit === "miles");
  const engineHourPMAlerts = pmAlerts.filter(({ pm }) => pm.unit === "engine_hours");

  const repairWarningAmount = Number(settingsRes.data?.repair_warning_amount ?? 5_000);
  const expensiveMaintenance = ((maintenanceCostRes.data ?? []) as unknown as Array<{
    id: string;
    service_type: string | null;
    performed_date: string | null;
    cost: number | null;
    vehicles: { unit_number: string } | null;
  }>).filter((record) => Number(record.cost ?? 0) >= repairWarningAmount);
  const costSummary = summarizeMaintenanceCosts(
    (costFactRes.data ?? []) as unknown as MaintenanceCostRow[],
    (mileageSnapshotsRes.data ?? []) as unknown as MileagePeriodSnapshot[],
  );

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">Dashboard</h1>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Bu Hafta Gross" value={usd(gross)} big />
        <Stat label="Bu Hafta Masraf" value={usd(expenses)} />
        <Stat label="Bu Hafta Net" value={usd(gross - expenses)} />
        <Stat label="Toplam Komisyon" value={usd(commission)} accent />
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <MiniLink href="/imported" label="Bekleyen Telegram Yuku" value={pendingImported} highlight={pendingImported > 0} />
        <MiniLink href="/settlements" label="Bekleyen Settlement" value={pendingSettlements} />
        <MiniLink href="/vehicles" label="Aktif Arac" value={activeVehicles} />
        <MiniLink href="/vehicles" label="Tamirde" value={inRepair} highlight={inRepair > 0} />
      </div>

      <div className="card">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Bakım Maliyet Özeti</h2>
          <Link href="/maintenance/costs" className="text-sm text-brand hover:underline">Analytics</Link>
        </div>
        <div className="grid gap-4 md:grid-cols-4">
          <Stat label="Fleet CPM" value={costSummary.fleetCpm == null ? "Mileage verisi yetersiz" : `${usd(costSummary.fleetCpm)} / mi`} />
          <Stat label="Bakım Maliyeti" value={usd(costSummary.totalCost)} />
          <Stat label="Planlı / Plansız" value={`${usd(costSummary.plannedCost)} / ${usd(costSummary.unscheduledCost)}`} />
          <Stat label="Downtime" value={`${costSummary.downtimeDays.toFixed(1)} days`} />
        </div>
      </div>

      <div className="card">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Bugun ilgilenilecek bakimlar</h2>
          <Link href="/maintenance/units" className="text-sm text-brand hover:underline">Tumu</Link>
        </div>
        {pmAlerts.length === 0 ? (
          <p className="text-sm text-slate-400">Yaklasan bakim yok.</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-3">
            <AlertList title="Date" alerts={datePMAlerts} />
            <AlertList title="Mileage" alerts={mileagePMAlerts} />
            <AlertList title="Engine Hours" alerts={engineHourPMAlerts} />
          </div>
        )}
      </div>

      <div className="card">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Bakim Uyarilari</h2>
          <Link href="/maintenance/units" className="text-sm text-brand hover:underline">Tumu</Link>
        </div>
        {pmAlerts.length === 0 ? (
          <p className="text-sm text-slate-400">Yaklasan bakim yok.</p>
        ) : (
          <div className="space-y-2">
            {pmAlerts.slice(0, 8).map(({ rule, pm }) => (
              <div key={rule.id} className="flex items-center justify-between border-b border-slate-100 pb-2 text-sm">
                <div>
                  <span className="font-medium">Unit {rule.vehicles?.unit_number}</span>
                  <span className="text-slate-500"> - {rule.service_type}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-slate-500">{formatPMWhichever(pm)}</span>
                  <span className={`badge ${PM_BADGE[pm.status]}`}>{pm.label}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {expensiveMaintenance.length > 0 && (
        <div className="card border-red-200">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold text-red-800">Yuksek Bakim Masraflari</h2>
            <Link href="/maintenance/units" className="text-sm text-brand hover:underline">Gecmis</Link>
          </div>
          <div className="space-y-2 text-sm">
            {expensiveMaintenance.slice(0, 5).map((record) => (
              <div key={record.id} className="flex justify-between border-b border-red-100 pb-2">
                <span>Unit {record.vehicles?.unit_number ?? "-"} - {record.service_type ?? "Bakim"} - {record.performed_date ?? "-"}</span>
                <span className="font-semibold text-red-700">{usd(Number(record.cost ?? 0))}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AlertList({ title, alerts }: { title: string; alerts: PMAlert[] }) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-slate-600">{title}</h3>
      {alerts.length === 0 ? (
        <p className="text-sm text-slate-400">Yok.</p>
      ) : (
        <div className="space-y-2">
          {alerts.slice(0, 8).map(({ rule, pm }) => (
            <div key={rule.id} className="flex items-center justify-between border-b border-slate-100 pb-2 text-sm">
              <div>
                <span className="font-medium">Unit {rule.vehicles?.unit_number}</span>
                <span className="text-slate-500"> - {rule.service_type}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-slate-500">{formatPMRemaining(pm)}</span>
                <span className={`badge ${PM_BADGE[pm.status]}`}>{pm.label}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, big, accent }: { label: string; value: string; big?: boolean; accent?: boolean }) {
  return (
    <div className="card">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`mt-1 font-bold ${big ? "text-2xl text-brand" : "text-lg"} ${accent ? "text-emerald-700" : ""}`}>{value}</p>
    </div>
  );
}

function MiniLink({ href, label, value, highlight }: { href: string; label: string; value: number; highlight?: boolean }) {
  return (
    <Link href={href} className={`card transition hover:shadow ${highlight ? "ring-1 ring-amber-300" : ""}`}>
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${highlight ? "text-amber-600" : "text-slate-800"}`}>{value}</p>
    </Link>
  );
}
