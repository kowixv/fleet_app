"use client";

import { useState, useTransition } from "react";
import { updateMileage, markServiced } from "@/app/(app)/maintenance/actions";
import { computePM, PM_BADGE } from "@/lib/maintenance";

interface Row {
  id: string;
  service_type: string;
  interval_type: "mileage" | "date";
  interval_miles: number | null;
  interval_days: number | null;
  last_done_mileage: number | null;
  last_done_date: string | null;
  vehicle_id: string;
  vehicles: { unit_number: string; current_mileage: number } | null;
}

function MileageCell({ vehicleId, mileage }: { vehicleId: string; mileage: number }) {
  const [val, setVal] = useState(String(mileage ?? 0));
  const [pending, start] = useTransition();
  return (
    <div className="flex items-center gap-1">
      <input
        className="input w-24 py-1"
        value={val}
        onChange={(e) => setVal(e.target.value)}
      />
      <button
        onClick={() => start(async () => void (await updateMileage(vehicleId, Number(val))))}
        disabled={pending}
        className="text-xs text-brand hover:underline"
      >
        Kaydet
      </button>
    </div>
  );
}

export default function MaintenanceTable({
  rows,
  dueSoonMiles,
}: {
  rows: Row[];
  dueSoonMiles: number;
}) {
  const [pending, start] = useTransition();

  return (
    <div className="card overflow-x-auto p-0">
      <table className="w-full">
        <thead className="border-b border-slate-200 bg-slate-50">
          <tr>
            <th className="th">Unit</th>
            <th className="th">Servis</th>
            <th className="th">Mevcut Mileage</th>
            <th className="th">Sonraki</th>
            <th className="th">Kalan</th>
            <th className="th">Durum</th>
            <th className="th"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.length === 0 ? (
            <tr><td className="td text-slate-400" colSpan={7}>Henüz bakım kuralı yok.</td></tr>
          ) : (
            rows.map((r) => {
              const cur = r.vehicles?.current_mileage ?? 0;
              const pm = computePM(r, cur, dueSoonMiles);
              return (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="td font-medium">{r.vehicles?.unit_number ?? "—"}</td>
                  <td className="td">{r.service_type}</td>
                  <td className="td">
                    <MileageCell vehicleId={r.vehicle_id} mileage={cur} />
                  </td>
                  <td className="td">
                    {pm.nextDue ?? "—"}
                    {pm.unit === "miles" && pm.nextDue ? " mi" : ""}
                  </td>
                  <td className="td">
                    {pm.remaining ?? "—"} {pm.remaining != null ? (pm.unit === "miles" ? "mi" : "gün") : ""}
                  </td>
                  <td className="td">
                    <span className={`badge ${PM_BADGE[pm.status]}`}>{pm.label}</span>
                  </td>
                  <td className="td text-right">
                    <button
                      onClick={() => start(async () => void (await markServiced(r.id, cur)))}
                      disabled={pending}
                      className="text-xs text-brand hover:underline"
                    >
                      Yapıldı işaretle
                    </button>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
