import Link from "next/link";
import { usd } from "@/lib/format";
import {
  MAINTENANCE_COST_CATEGORIES,
  buildMaintenanceCostAlerts,
  filterMaintenanceCostRows,
  summarizeMaintenanceCosts,
  type MaintenanceCostCategory,
  type MaintenanceCostFilters,
  type MaintenanceCostRow,
  type MileagePeriodSnapshot,
  type PlannedFilter,
} from "@/lib/maintenance-cost";

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

function formatCategory(category: string): string {
  return category.replace(/_/g, " ");
}

function filterValue(value: string | null | undefined, fallback = "") {
  return value ?? fallback;
}

export default function MaintenanceCostDashboard({
  rows,
  snapshots,
  vehicles,
  filters,
  repairWarningAmount,
  exportHref,
}: {
  rows: MaintenanceCostRow[];
  snapshots: MileagePeriodSnapshot[];
  vehicles: MaintenanceCostVehicleOption[];
  filters: MaintenanceCostFilters;
  repairWarningAmount: number;
  exportHref: string;
}) {
  const filteredRows = filterMaintenanceCostRows(rows, filters);
  const summary = summarizeMaintenanceCosts(filteredRows, snapshots);
  const alerts = buildMaintenanceCostAlerts(filteredRows, summary, repairWarningAmount);
  const shops = [...new Set(rows.map((row) => row.shop).filter(Boolean) as string[])].sort();

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">Bakım Maliyetleri</h2>
          <p className="mt-1 text-sm text-slate-500">Finansal toplamlar, CPM, downtime ve tekrar eden tamir uyarıları. Operasyonel bakım uyarıları ayrı tutulur.</p>
        </div>
        <Link className="btn-ghost" href={exportHref}>CSV indir</Link>
      </div>

      <form className="card grid gap-3 md:grid-cols-6">
        <div>
          <label className="label">Başlangıç</label>
          <input className="input" type="date" name="cost_start" defaultValue={filterValue(filters.start)} />
        </div>
        <div>
          <label className="label">Bitiş</label>
          <input className="input" type="date" name="cost_end" defaultValue={filterValue(filters.end)} />
        </div>
        <div>
          <label className="label">Araç</label>
          <select className="input" name="cost_vehicle" defaultValue={filterValue(filters.vehicleId, "all")}>
            <option value="all">Hepsi</option>
            {vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.unit_number}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Kategori</label>
          <select className="input" name="cost_category" defaultValue={filterValue(filters.category, "all")}>
            <option value="all">Hepsi</option>
            {MAINTENANCE_COST_CATEGORIES.map((category) => (
              <option key={category} value={category}>{formatCategory(category)}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Plan</label>
          <select className="input" name="cost_planned" defaultValue={filterValue(filters.planned, "all")}>
            <option value="all">Hepsi</option>
            <option value="planned">Planlı</option>
            <option value="unscheduled">Plansız</option>
          </select>
        </div>
        <div>
          <label className="label">Shop</label>
          <select className="input" name="cost_shop" defaultValue={filterValue(filters.shop, "all")}>
            <option value="all">Hepsi</option>
            {shops.map((shop) => <option key={shop} value={shop}>{shop}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Durum</label>
          <select className="input" name="cost_status" defaultValue={filterValue(filters.status, "all")}>
            <option value="all">Hepsi</option>
            <option value="completed">Tamamlandı</option>
            <option value="open">Açık</option>
            <option value="cancelled">İptal edildi</option>
          </select>
        </div>
        <div className="flex items-end">
          <button className="btn-primary w-full" type="submit">Filtrele</button>
        </div>
      </form>

      <div className="grid gap-4 md:grid-cols-4">
        <Stat label="Filo bakım CPM" value={cpm(summary.fleetCpm)} accent={summary.fleetCpm != null} />
        <Stat label="Toplam maliyet" value={usd(summary.totalCost)} />
        <Stat label="Planlı / Plansız" value={`${usd(summary.plannedCost)} / ${usd(summary.unscheduledCost)}`} />
        <Stat label="Warranty recovery" value={usd(summary.warrantyRecovery)} />
        <Stat label="Towing + Road Service" value={usd(summary.towingRoadServiceCost)} />
        <Stat label="Downtime" value={`${summary.downtimeDays.toFixed(1)} days`} />
        <Stat label="Lastik maliyeti / 1.000 mi" value={perUnit(summary.tireCostPerThousand, "/ 1k mi")} />
        <Stat label="Road call / 100k mi" value={perUnit(summary.roadCallsPer100k, "/ 100k mi")} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Breakdown title="Kategoriye göre maliyet" rows={summary.byCategory.map((row) => ({ label: formatCategory(row.category), value: row.totalCost }))} />
        <Breakdown title="Shop'a göre maliyet" rows={summary.byShop.map((row) => ({ label: row.shop, value: row.totalCost }))} />
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th">Araç CPM sıralaması</th>
              <th className="th">Miles</th>
              <th className="th">CPM</th>
              <th className="th">Total</th>
              <th className="th">Planlı</th>
              <th className="th">Plansız</th>
              <th className="th">Downtime</th>
              <th className="th">Repeat</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {summary.unitRanking.length === 0 ? (
              <tr><td className="td text-slate-400" colSpan={8}>Bakım maliyet verisi yok.</td></tr>
            ) : summary.unitRanking.map((unit) => (
              <tr key={unit.vehicle_id} className={summary.aboveFleetAverage.some((item) => item.vehicle_id === unit.vehicle_id) ? "bg-amber-50/50" : ""}>
                <td className="td font-medium">Unit {unit.unit_number}</td>
                <td className="td">{unit.milesDriven > 0 ? unit.milesDriven.toLocaleString("en-US") : "Mileage verisi yetersiz"}</td>
                <td className="td">{cpm(unit.cpm)}</td>
                <td className="td">{usd(unit.totalCost)}</td>
                <td className="td">{usd(unit.plannedCost)}</td>
                <td className="td">{usd(unit.unscheduledCost)}</td>
                <td className="td">{unit.downtimeDays.toFixed(1)} days</td>
                <td className="td">{unit.repeatRepairs}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3 className="font-semibold">Yüksek maliyet ve tekrar eden tamir uyarıları</h3>
        {alerts.length === 0 ? (
          <p className="mt-2 text-sm text-slate-400">Seçilen dönem için maliyet uyarısı yok.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {alerts.slice(0, 12).map((alert, index) => (
              <div key={`${alert.type}-${index}`} className="rounded-lg border border-slate-200 p-3 text-sm">
                <div className="font-medium">{alert.unit_number ? `Unit ${alert.unit_number} - ` : ""}{alert.title}</div>
                <p className="mt-1 text-slate-600">{alert.explanation}</p>
                <p className="mt-1 text-xs text-slate-400">Kaynak kayıtlar: {alert.sourceRecordIds.join(", ")}</p>
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

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="card">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`mt-1 text-lg font-bold ${accent ? "text-brand" : ""}`}>{value}</p>
    </div>
  );
}

function Breakdown({ title, rows }: { title: string; rows: Array<{ label: string; value: number }> }) {
  return (
    <div className="card">
      <h3 className="font-semibold">{title}</h3>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-slate-400">Veri yok.</p>
      ) : (
        <div className="mt-3 space-y-2 text-sm">
          {rows.slice(0, 8).map((row) => (
            <div key={row.label} className="flex justify-between gap-3 border-b border-slate-100 pb-2">
              <span>{row.label}</span>
              <span className="font-medium">{usd(row.value)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
