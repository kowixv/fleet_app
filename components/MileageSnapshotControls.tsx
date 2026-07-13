import { refreshMaintenanceMileageSnapshots } from "@/app/(app)/maintenance/cost-actions";
import { todayISO } from "@/lib/tz";

function daysAgo(days: number): string {
  const [year, month, day] = todayISO().split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

export default function MileageSnapshotControls({
  vehicles,
}: {
  vehicles: Array<{ id: string; unit_number: string }>;
}) {
  return (
    <form action={refreshMaintenanceMileageSnapshots} className="card grid gap-3 md:grid-cols-4">
      <div className="md:col-span-4">
        <h2 className="font-semibold">Mileage Snapshot Refresh</h2>
        <p className="mt-1 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Bu işlem normal günlük kullanım için gerekli değildir.
        </p>
      </div>
      <div>
        <label className="label">Start</label>
        <input className="input" type="date" name="cost_start" defaultValue={daysAgo(365)} />
      </div>
      <div>
        <label className="label">End</label>
        <input className="input" type="date" name="cost_end" defaultValue={todayISO()} />
      </div>
      <div>
        <label className="label">Unit</label>
        <select className="input" name="cost_vehicle" defaultValue="all">
          <option value="all">All</option>
          {vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.unit_number}</option>)}
        </select>
      </div>
      <div className="flex items-end">
        <button className="btn-primary w-full" type="submit">Refresh Mileage Snapshots</button>
      </div>
    </form>
  );
}
