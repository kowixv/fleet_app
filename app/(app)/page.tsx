import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { usd } from "@/lib/format";
import {
  comparePMAlerts,
  computePM,
  formatPMRemaining,
  PM_BADGE,
  type PMResult,
} from "@/lib/maintenance";
import { todayISO, weekRange } from "@/lib/tz";

export const dynamic = "force-dynamic";

interface DashboardRule {
  id: string;
  service_type: string;
  interval_type: "mileage" | "date";
  interval_miles: number | null;
  interval_days: number | null;
  last_done_mileage: number | null;
  last_done_date: string | null;
  vehicles: { unit_number: string; current_mileage: number | null } | null;
}

interface PMAlert { rule: DashboardRule; pm: PMResult }

export default async function Dashboard() {
  const supabase = await createClient();
  const { start, end } = weekRange();

  const [loadsRes, expRes, importedRes, vehiclesRes, settleRes, rulesRes, settingsRes, maintenanceCostRes] =
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
        .select("pm_due_soon_miles, pm_due_soon_days, repair_warning_amount")
        .single(),
      supabase
        .from("maintenance_records")
        .select("id, service_type, performed_date, cost, vehicles!maintenance_records_vehicle_id_fkey(unit_number)")
        .order("performed_date", { ascending: false })
        .limit(30),
    ]);

  const queryError = loadsRes.error ?? expRes.error ?? vehiclesRes.error ?? settleRes.error ?? rulesRes.error ?? settingsRes.error ?? maintenanceCostRes.error;
  if (queryError) throw new Error(`Dashboard verisi yüklenemedi: ${queryError.message}`);

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
  };
  const pmAlerts: PMAlert[] = ((rulesRes.data ?? []) as unknown as DashboardRule[])
    .map((rule) => ({
      rule,
      pm: computePM(rule, Number(rule.vehicles?.current_mileage ?? 0), thresholds, todayISO()),
    }))
    .filter(({ pm }) => pm.status !== "ok")
    .sort((a, b) => comparePMAlerts(a.pm, b.pm));
  const datePMAlerts = pmAlerts.filter(({ pm }) => pm.unit === "days");
  const mileagePMAlerts = pmAlerts.filter(({ pm }) => pm.unit === "miles");

  const repairWarningAmount = Number(settingsRes.data?.repair_warning_amount ?? 5_000);
  const expensiveMaintenance = ((maintenanceCostRes.data ?? []) as unknown as Array<{
    id: string;
    service_type: string | null;
    performed_date: string | null;
    cost: number | null;
    vehicles: { unit_number: string } | null;
  }>).filter((record) => Number(record.cost ?? 0) >= repairWarningAmount);

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
        <MiniLink href="/imported" label="Bekleyen Telegram Yükü" value={pendingImported} highlight={pendingImported > 0} />
        <MiniLink href="/settlements" label="Bekleyen Settlement" value={pendingSettlements} />
        <MiniLink href="/vehicles" label="Aktif Araç" value={activeVehicles} />
        <MiniLink href="/vehicles" label="Tamirde" value={inRepair} highlight={inRepair > 0} />
      </div>

      <div className="card">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Bugün ilgilenilecek bakımlar</h2>
          <Link href="/maintenance" className="text-sm text-brand hover:underline">Tümü →</Link>
        </div>
        {pmAlerts.length === 0 ? (
          <p className="text-sm text-slate-400">Yaklaşan bakım yok.</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            <AlertList title="Tarih bazlı" alerts={datePMAlerts} />
            <AlertList title="Mileage bazlı" alerts={mileagePMAlerts} />
          </div>
        )}
      </div>

      <div className="card">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Bakım Uyarıları</h2>
          <Link href="/maintenance" className="text-sm text-brand hover:underline">Tümü →</Link>
        </div>
        {pmAlerts.length === 0 ? (
          <p className="text-sm text-slate-400">Yaklaşan bakım yok. 👍</p>
        ) : (
          <div className="space-y-2">
            {pmAlerts.slice(0, 8).map(({ rule, pm }) => (
              <div key={rule.id} className="flex items-center justify-between border-b border-slate-100 pb-2 text-sm">
                <div>
                  <span className="font-medium">Unit {rule.vehicles?.unit_number}</span>
                  <span className="text-slate-500"> · {rule.service_type}</span>
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

      {expensiveMaintenance.length > 0 && (
        <div className="card border-red-200">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold text-red-800">Yüksek Bakım Masrafları</h2>
            <Link href="/maintenance" className="text-sm text-brand hover:underline">Geçmiş →</Link>
          </div>
          <div className="space-y-2 text-sm">
            {expensiveMaintenance.slice(0, 5).map((record) => (
              <div key={record.id} className="flex justify-between border-b border-red-100 pb-2">
                <span>Unit {record.vehicles?.unit_number ?? "—"} · {record.service_type ?? "Bakım"} · {record.performed_date ?? "—"}</span>
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
                <span className="text-slate-500"> · {rule.service_type}</span>
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
