import MaintenanceNav from "@/components/MaintenanceNav";
import { saveMaintenanceBudget } from "@/app/(app)/maintenance/decision-actions";
import {
  MAINTENANCE_BUDGET_SCOPES,
  budgetElapsedFraction,
  calculateBudgetPerformance,
  maintenanceBudgetScopeLabel,
  parseBudgetPerformanceRows,
} from "@/lib/maintenance-decision-support";
import { MAINTENANCE_COST_CATEGORIES } from "@/lib/maintenance-cost";
import { formatMaintenanceCategory } from "@/lib/maintenance-terminology";
import { maintenanceVisibleVehicleStatuses } from "@/lib/maintenance-vehicle-status";
import { usd } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function MaintenanceBudgetsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const rawYear = Array.isArray(params.year) ? params.year[0] : params.year;
  const year = Number(rawYear ?? new Date().getFullYear());
  const selectedYear = Number.isInteger(year) && year >= 2000 && year <= 2200 ? year : new Date().getFullYear();
  const supabase = await createClient();
  const [performanceRes, vehiclesRes, vendorsRes] = await Promise.all([
    supabase.rpc("get_maintenance_budget_performance", { p_year: selectedYear }),
    supabase.from("vehicles").select("id, unit_number").in("status", maintenanceVisibleVehicleStatuses()).order("unit_number"),
    supabase.from("maintenance_records").select("vendor, shop_name").not("vendor", "is", null).limit(1000),
  ]);
  const error = performanceRes.error ?? vehiclesRes.error ?? vendorsRes.error;
  if (error) throw new Error(`Bakım bütçeleri yüklenemedi: ${error.message}`);
  const rows = parseBudgetPerformanceRows(performanceRes.data);
  const vehicles = (vehiclesRes.data ?? []) as Array<{ id: string; unit_number: string }>;
  const vehicleNames = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle.unit_number]));
  const vendors = [...new Set((vendorsRes.data ?? []).map((row) => row.vendor || row.shop_name).filter((value): value is string => Boolean(value)))].sort();
  const total = rows.reduce((sum, row) => {
    const period = budgetElapsedFraction(row.fiscal_year, row.month);
    const performance = calculateBudgetPerformance({
      budget: row.budget_amount,
      actual: row.actual,
      committed: row.committed,
      elapsedFraction: period.elapsed,
      periodComplete: period.complete,
    });
    return {
      budget: sum.budget + performance.budget,
      actual: sum.actual + performance.actual,
      committed: sum.committed + performance.committed,
      forecast: sum.forecast + performance.forecast,
    };
  }, { budget: 0, actual: 0, committed: 0, forecast: 0 });

  return <div className="space-y-5">
    <MaintenanceNav title="Bakım Merkezi" />
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><h2 className="text-lg font-semibold">Bakım Bütçeleri</h2><p className="text-sm text-slate-500">Actual, onaylı açık work order taahhütleri ve run-rate forecast birlikte izlenir.</p></div>
      <form><label className="text-sm"><span className="label">Yıl</span><input className="input w-28" name="year" type="number" min="2000" max="2200" defaultValue={selectedYear} /></label></form>
    </div>

    <div className="grid gap-3 md:grid-cols-5">
      <Stat label="Budget" value={usd(total.budget)} />
      <Stat label="Actual" value={usd(total.actual)} />
      <Stat label="Committed" value={usd(total.committed)} />
      <Stat label="Forecast" value={usd(total.forecast)} />
      <Stat label="Variance" value={usd(total.budget - total.forecast)} warn={total.forecast > total.budget} />
    </div>

    <details className="rounded-lg border border-slate-200 bg-white" open={rows.length === 0}>
      <summary className="cursor-pointer px-4 py-3 font-semibold">Bütçe ekle</summary>
      <form action={saveMaintenanceBudget} className="grid gap-3 border-t border-slate-100 p-4 md:grid-cols-4">
        <label className="text-sm"><span className="label">Yıl</span><input className="input" name="fiscal_year" type="number" min="2000" max="2200" defaultValue={selectedYear} required /></label>
        <label className="text-sm"><span className="label">Ay (opsiyonel)</span><select className="input" name="month"><option value="">Yıllık</option>{Array.from({ length: 12 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}</select></label>
        <label className="text-sm"><span className="label">Kapsam</span><select className="input" name="scope" defaultValue="annual_org">{MAINTENANCE_BUDGET_SCOPES.map((scope) => <option key={scope} value={scope}>{maintenanceBudgetScopeLabel(scope)}</option>)}</select></label>
        <label className="text-sm"><span className="label">Bütçe ($)</span><input className="input" name="budget_amount" type="number" min="0" step="0.01" required /></label>
        <label className="text-sm"><span className="label">Unit (unit kapsamı)</span><select className="input" name="vehicle_id"><option value="">Seçin</option>{vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.unit_number}</option>)}</select></label>
        <label className="text-sm"><span className="label">Kategori (kategori kapsamı)</span><select className="input" name="category"><option value="">Seçin</option>{MAINTENANCE_COST_CATEGORIES.map((category) => <option key={category} value={category}>{formatMaintenanceCategory(category)}</option>)}</select></label>
        <label className="text-sm"><span className="label">Vendor (vendor kapsamı)</span><input className="input" name="vendor" list="budget-vendors" /><datalist id="budget-vendors">{vendors.map((vendor) => <option key={vendor} value={vendor} />)}</datalist></label>
        <label className="text-sm"><span className="label">Not</span><input className="input" name="notes" /></label>
        <div className="md:col-span-4"><button className="btn-primary">Bütçe kaydet</button></div>
      </form>
    </details>

    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="min-w-full text-sm"><thead className="bg-slate-50 text-left text-slate-500"><tr>
        <th className="p-3">Kapsam</th><th className="p-3">Dönem</th><th className="p-3">Budget</th><th className="p-3">Actual</th><th className="p-3">Committed</th><th className="p-3">Forecast</th><th className="p-3">Variance</th><th className="p-3">% Used</th>
      </tr></thead><tbody>{rows.map((row) => {
        const period = budgetElapsedFraction(row.fiscal_year, row.month);
        const performance = calculateBudgetPerformance({ budget: row.budget_amount, actual: row.actual, committed: row.committed, elapsedFraction: period.elapsed, periodComplete: period.complete });
        const target = row.scope === "vehicle" ? vehicleNames.get(row.vehicle_id ?? "") : row.scope === "category" ? formatMaintenanceCategory(row.category ?? "") : row.scope === "vendor" ? row.vendor : null;
        return <tr key={row.id} className="border-t border-slate-100">
          <td className="p-3 font-medium">{maintenanceBudgetScopeLabel(row.scope)}{target ? <div className="text-xs text-slate-500">{target}</div> : null}</td>
          <td className="p-3">{row.fiscal_year}{row.month ? ` / ${String(row.month).padStart(2, "0")}` : ""}</td>
          <td className="p-3">{usd(performance.budget)}</td><td className="p-3">{usd(performance.actual)}</td><td className="p-3">{usd(performance.committed)}</td><td className="p-3">{usd(performance.forecast)}</td>
          <td className={`p-3 font-medium ${performance.variance < 0 ? "text-red-700" : "text-emerald-700"}`}>{usd(performance.variance)}</td>
          <td className="p-3">{performance.percentageUsed == null ? "—" : `${(performance.percentageUsed * 100).toFixed(1)}%`}</td>
        </tr>;
      })}</tbody></table>
      {rows.length === 0 && <p className="p-8 text-center text-sm text-slate-500">Bu yıl için bütçe yok.</p>}
    </div>
  </div>;
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return <div className={`rounded-lg border p-3 ${warn ? "border-red-200 bg-red-50" : "border-slate-200 bg-white"}`}><p className="text-xs text-slate-500">{label}</p><p className="mt-1 font-bold">{value}</p></div>;
}
