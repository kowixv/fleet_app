"use client";

import {
  computePM,
  formatPMDimension,
  formatPMRemaining,
  formatPMWhichever,
  PM_BADGE,
  type PMThresholds,
} from "@/lib/maintenance";
import { todayISO } from "@/lib/tz";
import Link from "next/link";
import { useMemo } from "react";

export interface MaintenanceRuleRow {
  id: string;
  service_type: string;
  interval_type: "mileage" | "date";
  interval_miles: number | null;
  interval_days: number | null;
  interval_engine_hours: number | null;
  last_done_mileage: number | null;
  last_done_date: string | null;
  last_done_engine_hours: number | null;
  vehicle_id: string;
  active: boolean;
  vehicles: { unit_number: string; current_mileage: number | null } | null;
}

interface VehicleGroup {
  vehicleId: string;
  unitNumber: string;
  mileage: number;
  engineHours: number | null;
  rules: MaintenanceRuleRow[];
}

export default function MaintenanceTable({
  rows,
  thresholds,
  engineHoursByVehicle,
}: {
  rows: MaintenanceRuleRow[];
  thresholds: PMThresholds;
  engineHoursByVehicle: Record<string, number | null>;
}) {
  const groups = useMemo(() => {
    const map = new Map<string, VehicleGroup>();
    for (const row of rows) {
      if (!row.vehicle_id || !row.vehicles) continue;
      const existing = map.get(row.vehicle_id) ?? {
        vehicleId: row.vehicle_id,
        unitNumber: row.vehicles.unit_number,
        mileage: Number(row.vehicles.current_mileage ?? 0),
        engineHours: engineHoursByVehicle[row.vehicle_id] ?? null,
        rules: [],
      };
      existing.rules.push(row);
      map.set(row.vehicle_id, existing);
    }
    return [...map.values()].sort((a, b) => a.unitNumber.localeCompare(b.unitNumber));
  }, [engineHoursByVehicle, rows]);

  return (
    <div className="space-y-4">
      {groups.length === 0 ? (
        <div className="card text-sm text-slate-400">Henüz aktif bakım kuralı yok.</div>
      ) : (
        groups.map((group) => (
          <div key={group.vehicleId} className="card overflow-x-auto p-0">
            <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
              <p className="font-semibold">Unit {group.unitNumber}</p>
              <p className="text-xs text-slate-500">
                Mileage {group.mileage.toLocaleString("en-US")} mi
                {group.engineHours != null ? ` · Engine ${Number(group.engineHours).toLocaleString("en-US")} h` : ""}
              </p>
            </div>

            <table className="w-full">
              <thead className="border-b border-slate-200 bg-white">
                <tr>
                  <th className="th">Servis</th>
                  <th className="th">Boyutlar</th>
                  <th className="th">İlk Dolan Sınır</th>
                  <th className="th">Durum</th>
                  <th className="th text-right">İşlem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {group.rules.map((rule) => {
                  const pm = computePM(rule, group.mileage, thresholds, todayISO(), group.engineHours);
                  return (
                    <tr key={rule.id} className="hover:bg-slate-50">
                      <td className="td font-medium">{rule.service_type}</td>
                      <td className="td">
                        <div className="space-y-1 text-xs">
                          {pm.dimensions.length === 0 ? "-" : pm.dimensions.map((dimension) => (
                            <div key={dimension.unit}>{formatPMDimension(dimension)}</div>
                          ))}
                        </div>
                      </td>
                      <td className="td">
                        <div>{formatPMRemaining(pm)}</div>
                        {pm.dimensions.length > 1 && <div className="text-xs text-slate-500">{formatPMWhichever(pm)}</div>}
                      </td>
                      <td className="td">
                        <span className={`badge ${PM_BADGE[pm.status]}`}>{pm.label}</span>
                      </td>
                      <td className="td text-right">
                        <Link
                          className="text-xs text-brand hover:underline"
                          href={`/maintenance?add=1&vehicleId=${group.vehicleId}&type=periodic&service=${encodeURIComponent(rule.service_type)}`}
                        >
                          Bakım Ekle
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))
      )}
    </div>
  );
}
