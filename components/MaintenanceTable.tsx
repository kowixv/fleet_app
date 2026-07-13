"use client";

import { markServiced } from "@/app/(app)/maintenance/actions";
import {
  computePM,
  formatPMDimension,
  formatPMRemaining,
  formatPMWhichever,
  PM_BADGE,
  type PMThresholds,
} from "@/lib/maintenance";
import { todayISO } from "@/lib/tz";
import { useMemo, useState, useTransition } from "react";

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

  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  function serviceRule(rule: MaintenanceRuleRow, unitNumber: string) {
    if (!window.confirm(`Unit ${unitNumber} - ${rule.service_type} bugun yapilmis olarak kaydedilsin mi?`)) return;
    const costRaw = window.prompt("Maliyet ($) - bilinmiyorsa 0 yazin:", "0");
    if (costRaw === null) return;
    const cost = Number(costRaw.replace(/,/g, ""));
    if (!Number.isFinite(cost) || cost < 0) {
      setMessage({ type: "error", text: "Gecerli, negatif olmayan bir maliyet girin." });
      return;
    }
    const shopName = window.prompt("Shop adi (opsiyonel):", "") ?? "";
    const partName = window.prompt("Parca adi / numarasi (opsiyonel):", "") ?? "";
    const notes = window.prompt("Not (opsiyonel):", "") ?? "";

    startTransition(async () => {
      const result = await markServiced(rule.id, { cost, shopName, partName, notes });
      setMessage(
        result.ok
          ? { type: "ok", text: `${rule.service_type} bakim gecmisine kaydedildi.` }
          : { type: "error", text: result.error },
      );
    });
  }

  return (
    <div className="space-y-4">
      {message && (
        <p
          className={`rounded-lg border px-3 py-2 text-sm ${
            message.type === "ok"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {message.text}
        </p>
      )}

      {groups.length === 0 ? (
        <div className="card text-sm text-slate-400">Henuz aktif bakim kurali yok.</div>
      ) : (
        groups.map((group) => (
          <div key={group.vehicleId} className="card overflow-x-auto p-0">
            <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
              <p className="font-semibold">Unit {group.unitNumber}</p>
              <p className="text-xs text-slate-500">
                Odometer {group.mileage.toLocaleString("en-US")} mi
                {group.engineHours != null ? ` - Engine ${Number(group.engineHours).toLocaleString("en-US")} h` : ""}
              </p>
            </div>

            <table className="w-full">
              <thead className="border-b border-slate-200 bg-white">
                <tr>
                  <th className="th">Servis</th>
                  <th className="th">Boyutlar</th>
                  <th className="th">İlk Dolan Sınır</th>
                  <th className="th">Durum</th>
                  <th className="th text-right">Islem</th>
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
                        <button
                          type="button"
                          onClick={() => serviceRule(rule, group.unitNumber)}
                          disabled={pending}
                          className="text-xs text-brand hover:underline"
                        >
                          Yapildi isaretle
                        </button>
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
