import Link from "next/link";
import { usd } from "@/lib/format";
import { formatMaintenanceCategory } from "@/lib/maintenance-terminology";
import {
  MAINTENANCE_COST_CATEGORIES,
  type MaintenanceCostCategory,
  type MaintenanceCostFilters,
  type PlannedFilter,
} from "@/lib/maintenance-cost";
import type { MaintenanceAnalytics } from "@/lib/maintenance/domain";

export interface MaintenanceCostVehicleOption {
  id: string;
  unit_number: string;
}

function cpm(value: number | null): string {
  return value == null ? "Mileage verisi yetersiz" : `${usd(value)} / mi`;
}

function perUnit(value: number | null, suffix: string): string {
  return value == null ? "Mileage verisi yetersiz" : `${value.toFixed(2)} ${suffix}`;
}

function filterValue(value: string | null | undefined, fallback = "") {
  return value ?? fallback;
}

export default function MaintenanceCostDashboard({
  summary,
  vehicles,
  filters,
  exportHref,
}: {
  summary: MaintenanceAnalytics;
  vehicles: MaintenanceCostVehicleOption[];
  filters: MaintenanceCostFilters;
  exportHref: string;
}) {
  const alerts = summary.unitRanking.flatMap((unit) => {
    const items: Array<{ key: string; title: string; explanation: string }> = [];
    if (summary.aboveFleetAverage.some((item) => item.vehicle_id === unit.vehicle_id)) {
      items.push({
        key: `${unit.vehicle_id}-cpm`,
        title: `Unit ${unit.unit_number} · Filo ortalamasının üzerinde CPM`,
        explanation: `${cpm(unit.cpm)}; filo CPM değeri ${cpm(summary.fleetCpm)}.`,
      });
    }
    if (unit.repeatRepairs > 0) {
      items.push({
        key: `${unit.vehicle_id}-repeat`,
        title: `Unit ${unit.unit_number} · Tekrar eden tamir`,
        explanation: `Seçilen dönemde 30 gün içinde tekrarlanan ${unit.repeatRepairs} servis kaydı bulundu.`,
      });
    }
    return items;
  });

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">Bakım Maliyetleri</h2>
          <p className="mt-1 text-sm text-slate-500">
            Sunucu tarafında hesaplanan finansal toplamlar, CPM, downtime ve tekrar eden tamir göstergeleri.
          </p>
        </div>
        <Link className="btn-ghost" href={exportHref}>CSV indir</Link>
      </div>

      {!summary.dataComplete && summary.partialDataWarning && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {summary.partialDataWarning}
        </p>
      )}
      {(summary.mileageEstimatedVehicleCount > 0 || summary.mileageUnavailableVehicleCount > 0) && (
        <p className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          Mileage: {summary.mileageEstimatedVehicleCount} unit için dönem sınırları interpolate/prorate edildi
          {summary.mileageUnavailableVehicleCount > 0
            ? `; ${summary.mileageUnavailableVehicleCount} unit için veri kullanılamadı.`
            : "."}
        </p>
      )}

      <form className="card grid gap-3 md:grid-cols-6">
        <Filter label="Başlangıç"><input className="input" type="date" name="cost_start" defaultValue={filterValue(filters.start)} /></Filter>
        <Filter label="Bitiş"><input className="input" type="date" name="cost_end" defaultValue={filterValue(filters.end)} /></Filter>
        <Filter label="Araç">
          <select className="input" name="cost_vehicle" defaultValue={filterValue(filters.vehicleId, "all")}>
            <option value="all">Hepsi</option>
            {vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.unit_number}</option>)}
          </select>
        </Filter>
        <Filter label="Kategori">
          <select className="input" name="cost_category" defaultValue={filterValue(filters.category, "all")}>
            <option value="all">Hepsi</option>
            {MAINTENANCE_COST_CATEGORIES.map((category) => (
              <option key={category} value={category}>{formatMaintenanceCategory(category)}</option>
            ))}
          </select>
        </Filter>
        <Filter label="Plan">
          <select className="input" name="cost_planned" defaultValue={filterValue(filters.planned, "all")}>
            <option value="all">Hepsi</option>
            <option value="planned">Planlı</option>
            <option value="unscheduled">Plansız</option>
          </select>
        </Filter>
        <Filter label="Shop">
          <select className="input" name="cost_shop" defaultValue={filterValue(filters.shop, "all")}>
            <option value="all">Hepsi</option>
            {summary.shopOptions.map((shop) => <option key={shop} value={shop}>{shop}</option>)}
          </select>
        </Filter>
        <Filter label="Durum">
          <select className="input" name="cost_status" defaultValue={filterValue(filters.status, "all")}>
            <option value="all">Hepsi</option>
            <option value="completed">Tamamlandı</option>
            <option value="open">Açık</option>
            <option value="cancelled">İptal edildi</option>
          </select>
        </Filter>
        <div className="flex items-end"><button className="btn-primary w-full" type="submit">Filtrele</button></div>
      </form>

      <div className="grid gap-4 md:grid-cols-4">
        <Stat label="Filtrelenen kayıt" value={summary.totalCount.toLocaleString("tr-TR")} />
        <Stat label="Filo bakım CPM" value={cpm(summary.fleetCpm)} accent={summary.fleetCpm != null} />
        <Stat label="Direct Maintenance Cost" value={usd(summary.directMaintenanceCost)} />
        <Stat label="Travel / Hotel Impact" value={usd(summary.travelHotelImpact)} />
        <Stat label="Towing / Road Service" value={usd(summary.towingRoadServiceCost)} />
        <Stat label="Estimated Lost Contribution" value={usd(summary.estimatedLostContribution)} />
        <Stat label="Total Estimated Operational Impact" value={usd(summary.totalEstimatedOperationalImpact)} />
        <Stat label="Planlı / Plansız" value={`${usd(summary.plannedCost)} / ${usd(summary.unscheduledCost)}`} />
        <Stat label="Warranty recovery" value={usd(summary.warrantyRecovery)} />
        <Stat label="Downtime" value={`${summary.downtimeDays.toFixed(1)} days`} />
        <Stat label="Lastik maliyeti / 1.000 mi" value={perUnit(summary.tireCostPerThousand, "/ 1k mi")} />
        <Stat label="Road call / 100k mi" value={perUnit(summary.roadCallsPer100k, "/ 100k mi")} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Breakdown title="Kategoriye göre maliyet" rows={summary.byCategory.map((row) => ({ label: formatMaintenanceCategory(row.category), value: row.totalCost }))} />
        <Breakdown title="Shop'a göre maliyet" rows={summary.byShop.map((row) => ({ label: row.shop, value: row.totalCost }))} />
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th">Araç CPM sıralaması</th><th className="th">Miles</th><th className="th">CPM</th>
              <th className="th">Total</th><th className="th">Planlı</th><th className="th">Plansız</th>
              <th className="th">Downtime</th><th className="th">Repeat</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {summary.unitRanking.length === 0 ? (
              <tr><td className="td text-slate-400" colSpan={8}>Bakım maliyet verisi yok.</td></tr>
            ) : summary.unitRanking.map((unit) => (
              <tr key={unit.vehicle_id} className={summary.aboveFleetAverage.some((item) => item.vehicle_id === unit.vehicle_id) ? "bg-amber-50/50" : ""}>
                <td className="td font-medium">
                  Unit {unit.unit_number}
                  {unit.mileageEstimated && <span className="ml-2 badge bg-blue-100 text-blue-700">Tahmini mileage</span>}
                </td>
                <td className="td">{unit.milesDriven > 0 ? unit.milesDriven.toLocaleString("en-US") : "Mileage verisi yetersiz"}</td>
                <td className="td">{cpm(unit.cpm)}</td><td className="td">{usd(unit.totalCost)}</td>
                <td className="td">{usd(unit.plannedCost)}</td><td className="td">{usd(unit.unscheduledCost)}</td>
                <td className="td">{unit.downtimeDays.toFixed(1)} days</td><td className="td">{unit.repeatRepairs}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3 className="font-semibold">Yüksek CPM ve tekrar eden tamir uyarıları</h3>
        {alerts.length === 0 ? (
          <p className="mt-2 text-sm text-slate-400">Seçilen dönem için maliyet uyarısı yok.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {alerts.slice(0, 12).map((alert) => (
              <div key={alert.key} className="rounded-lg border border-slate-200 p-3 text-sm">
                <div className="font-medium">{alert.title}</div>
                <p className="mt-1 text-slate-600">{alert.explanation}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export function normalizeMaintenanceCostFilters(params: Record<string, string | string[] | undefined>): MaintenanceCostFilters {
  const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
  const planned = first(params.cost_planned) as PlannedFilter | undefined;
  const category = first(params.cost_category) as MaintenanceCostCategory | "all" | undefined;
  return {
    start: first(params.cost_start) || null,
    end: first(params.cost_end) || null,
    vehicleId: first(params.cost_vehicle) && first(params.cost_vehicle) !== "all" ? first(params.cost_vehicle) : null,
    category: category && category !== "all" ? category : null,
    planned: planned && planned !== "all" ? planned : "all",
    shop: first(params.cost_shop) && first(params.cost_shop) !== "all" ? first(params.cost_shop) : null,
    status: first(params.cost_status) && first(params.cost_status) !== "all" ? first(params.cost_status) : null,
  };
}

function Filter({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="label">{label}</label>{children}</div>;
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return <div className="card"><p className="text-xs text-slate-500">{label}</p><p className={`mt-1 text-lg font-bold ${accent ? "text-brand" : ""}`}>{value}</p></div>;
}

function Breakdown({ title, rows }: { title: string; rows: Array<{ label: string; value: number }> }) {
  return (
    <div className="card">
      <h3 className="font-semibold">{title}</h3>
      {rows.length === 0 ? <p className="mt-2 text-sm text-slate-400">Veri yok.</p> : (
        <div className="mt-3 space-y-2 text-sm">
          {rows.slice(0, 8).map((row) => (
            <div key={row.label} className="flex justify-between gap-3 border-b border-slate-100 pb-2">
              <span>{row.label}</span><span className="font-medium">{usd(row.value)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
