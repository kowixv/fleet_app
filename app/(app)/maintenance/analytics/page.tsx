import MaintenanceNav from "@/components/MaintenanceNav";
import {
  evaluateRepairReplace,
  parseDecisionAnalytics,
} from "@/lib/maintenance-decision-support";
import { usd } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function MaintenanceAnalyticsPage() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_maintenance_decision_analytics", {});
  if (error) throw new Error(`Karar destek analitiği yüklenemedi: ${error.message}`);
  const analytics = parseDecisionAnalytics(data);
  const thresholds = {
    cost12m: analytics.settings.replacement_cost_12m_threshold,
    cpm: analytics.settings.replacement_cpm_threshold,
    downtimeDays12m: analytics.settings.replacement_downtime_days_threshold,
    vehicleAgeYears: analytics.settings.replacement_vehicle_age_years_threshold,
  };

  return <div className="space-y-5">
    <MaintenanceNav title="Bakım Merkezi" />
    <div><h2 className="text-lg font-semibold">Filo Karar Destek</h2><p className="text-sm text-slate-500">Bu hesaplamalar tavsiye niteliğindedir; otomatik repair/replace kararı vermez.</p></div>

    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="font-semibold">Vendor / Shop Scorecard</h3>
      <div className="mt-3 overflow-x-auto"><table className="min-w-full text-sm"><thead className="bg-slate-50 text-left text-slate-500"><tr>
        <th className="p-3">Vendor</th><th className="p-3">Spend</th><th className="p-3">Avg Repair</th><th className="p-3">Repeat</th><th className="p-3">Avg Downtime</th><th className="p-3">Estimate Variance</th><th className="p-3">Warranty</th><th className="p-3">Road Calls</th><th className="p-3">Open WO</th>
      </tr></thead><tbody>{analytics.vendors.map((vendor) => <tr key={vendor.vendor} className="border-t border-slate-100">
        <td className="p-3 font-medium">{vendor.vendor}</td><td className="p-3">{usd(vendor.total_spend)}</td><td className="p-3">{usd(vendor.average_repair_cost)}</td><td className="p-3">{(vendor.repeat_repair_rate * 100).toFixed(1)}%</td><td className="p-3">{vendor.average_downtime_days.toFixed(1)} gün</td><td className="p-3">{(vendor.estimate_to_final_variance * 100).toFixed(1)}%</td><td className="p-3">{usd(vendor.warranty_recovery)}</td><td className="p-3">{vendor.road_calls_after_repair}</td><td className="p-3">{vendor.open_work_orders}</td>
      </tr>)}</tbody></table>{analytics.vendors.length === 0 && <p className="p-6 text-center text-sm text-slate-500">Vendor verisi yok.</p>}</div>
    </section>

    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="font-semibold">Repair vs Replace — karar destek paneli</h3>
      <p className="mt-1 text-xs text-slate-500">Eşikler: 12 ay maliyet {usd(thresholds.cost12m)}, CPM {usd(thresholds.cpm)}, downtime {thresholds.downtimeDays12m} gün, yaş {thresholds.vehicleAgeYears} yıl.</p>
      <div className="mt-3 overflow-x-auto"><table className="min-w-full text-sm"><thead className="bg-slate-50 text-left text-slate-500"><tr>
        <th className="p-3">Unit</th><th className="p-3">3 / 6 / 12 ay</th><th className="p-3">CPM</th><th className="p-3">Downtime</th><th className="p-3">Repeat</th><th className="p-3">Mileage / Yaş</th><th className="p-3">Open Repairs</th><th className="p-3">Advisory</th>
      </tr></thead><tbody>{analytics.vehicles.map((vehicle) => {
        const result = evaluateRepairReplace({
          maintenanceCost12m: vehicle.maintenance_cost_12m,
          cpm12m: vehicle.cpm_12m,
          downtimeDays12m: vehicle.downtime_days_12m,
          vehicleAgeYears: vehicle.vehicle_age_years,
          repeatRepairs12m: vehicle.repeat_repairs_12m,
          openEstimatedRepairs: vehicle.open_estimated_repairs,
        }, thresholds);
        return <tr key={vehicle.vehicle_id} className="border-t border-slate-100">
          <td className="p-3 font-medium">{vehicle.unit_number}</td><td className="p-3">{usd(vehicle.maintenance_cost_3m)} / {usd(vehicle.maintenance_cost_6m)} / {usd(vehicle.maintenance_cost_12m)}</td><td className="p-3">{vehicle.cpm_12m == null ? "Mileage yetersiz" : usd(vehicle.cpm_12m)}</td><td className="p-3">{vehicle.downtime_days_12m.toFixed(1)} gün</td><td className="p-3">{vehicle.repeat_repairs_12m}</td><td className="p-3">{vehicle.current_mileage?.toLocaleString("en-US") ?? "—"} / {vehicle.vehicle_age_years ?? "—"} yıl</td><td className="p-3">{usd(vehicle.open_estimated_repairs)}</td><td className="p-3"><span className={`badge ${result.advisory === "replacement_review" ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-700"}`}>{result.advisory === "replacement_review" ? `Replacement review (${result.triggeredSignals})` : "İzlemeye devam"}</span></td>
        </tr>;
      })}</tbody></table></div>
    </section>

    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="font-semibold">Downtime ve operasyonel etki</h3>
      <p className="mt-1 text-xs text-slate-500">Tahmini lost contribution, günlük {usd(analytics.settings.average_daily_contribution)} katkı varsayımıyla hesaplanır ve gerçek muhasebe geliri değildir.</p>
      <div className="mt-3 grid gap-3 lg:grid-cols-2">{analytics.vehicles.map((vehicle) => <div key={vehicle.vehicle_id} className="rounded-lg border border-slate-100 p-3">
        <div className="flex justify-between"><strong>Unit {vehicle.unit_number}</strong><strong>{usd(vehicle.total_estimated_operational_impact)}</strong></div>
        <dl className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-600"><Metric label="Direct maintenance" value={usd(vehicle.direct_maintenance_cost)} /><Metric label="Travel / hotel" value={usd(vehicle.travel_hotel_impact)} /><Metric label="Towing / road service" value={usd(vehicle.towing_road_service_impact)} /><Metric label="Estimated lost contribution" value={usd(vehicle.estimated_lost_contribution)} /></dl>
      </div>)}</div>
    </section>
  </div>;
}

function Metric({ label, value }: { label: string; value: string }) { return <div><dt>{label}</dt><dd className="font-medium text-slate-900">{value}</dd></div>; }
