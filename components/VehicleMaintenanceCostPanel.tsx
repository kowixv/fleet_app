import { usd } from "@/lib/format";
import { formatMaintenanceCategory } from "@/lib/maintenance-terminology";
import {
  filterMaintenanceCostRows,
  filterMileagePeriodSnapshots,
  summarizeMaintenanceCosts,
  type MaintenanceCostRow,
  type MileagePeriodSnapshot,
} from "@/lib/maintenance-cost";
import { todayISO } from "@/lib/tz";

function daysAgo(days: number): string {
  const [year, month, day] = todayISO().split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function cpm(value: number | null): string {
  return value == null ? "Mileage verisi yetersiz" : `${usd(value)} / mi`;
}

export default function VehicleMaintenanceCostPanel({
  unitNumber,
  rows,
  snapshots,
}: {
  unitNumber: string;
  rows: MaintenanceCostRow[];
  snapshots: MileagePeriodSnapshot[];
}) {
  const summary30 = summarizeMaintenanceCosts(
    filterMaintenanceCostRows(rows, { start: daysAgo(30) }),
    filterMileagePeriodSnapshots(snapshots, { start: daysAgo(30) }),
  );
  const summary90 = summarizeMaintenanceCosts(
    filterMaintenanceCostRows(rows, { start: daysAgo(90) }),
    filterMileagePeriodSnapshots(snapshots, { start: daysAgo(90) }),
  );
  const summary365 = summarizeMaintenanceCosts(
    filterMaintenanceCostRows(rows, { start: daysAgo(365) }),
    filterMileagePeriodSnapshots(snapshots, { start: daysAgo(365) }),
  );
  const allTime = summarizeMaintenanceCosts(rows, snapshots);
  const unit = allTime.unitRanking[0];

  return (
    <section className="space-y-4">
      <div>
        <h2 className="font-semibold">Unit {unitNumber} Bakım Maliyeti</h2>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Stat label="30 Gün CPM" value={cpm(summary30.fleetCpm)} />
        <Stat label="90 Gün CPM" value={cpm(summary90.fleetCpm)} />
        <Stat label="365 Gün CPM" value={cpm(summary365.fleetCpm)} />
        <Stat label="Toplam Maliyet" value={usd(allTime.totalCost)} />
        <Stat label="Planlı / Plansız" value={`${usd(allTime.plannedCost)} / ${usd(allTime.unscheduledCost)}`} />
        <Stat label="Downtime" value={`${allTime.downtimeDays.toFixed(1)} gün`} />
      </div>

      <div className="card">
        <h3 className="font-semibold">Kategori Dağılımı</h3>
        <div className="mt-3 space-y-2 text-sm">
          {allTime.byCategory.length === 0 ? (
            <p className="text-slate-400">Maliyet verisi yok.</p>
          ) : allTime.byCategory.map((row) => (
            <div key={row.category} className="flex justify-between border-b border-slate-100 pb-2">
              <span>{formatMaintenanceCategory(row.category)}</span>
              <span className="font-medium">{usd(row.totalCost)}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-bold">{value}</p>
    </div>
  );
}
