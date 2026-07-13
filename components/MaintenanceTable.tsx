"use client";

import { useMemo, useState, useTransition } from "react";
import { updateMileage, markServiced } from "@/app/(app)/maintenance/actions";
import {
  computePM,
  formatPMRemaining,
  PM_BADGE,
  type PMThresholds,
} from "@/lib/maintenance";
import { todayISO } from "@/lib/tz";

export interface MaintenanceRuleRow {
  id: string;
  service_type: string;
  interval_type: "mileage" | "date";
  interval_miles: number | null;
  interval_days: number | null;
  last_done_mileage: number | null;
  last_done_date: string | null;
  vehicle_id: string;
  active: boolean;
  vehicles: { unit_number: string; current_mileage: number | null } | null;
}

interface VehicleGroup {
  vehicleId: string;
  unitNumber: string;
  mileage: number;
  rules: MaintenanceRuleRow[];
}

export default function MaintenanceTable({
  rows,
  thresholds,
}: {
  rows: MaintenanceRuleRow[];
  thresholds: PMThresholds;
}) {
  const groups = useMemo(() => {
    const map = new Map<string, VehicleGroup>();
    for (const row of rows) {
      if (!row.vehicle_id || !row.vehicles) continue;
      const existing = map.get(row.vehicle_id) ?? {
        vehicleId: row.vehicle_id,
        unitNumber: row.vehicles.unit_number,
        mileage: Number(row.vehicles.current_mileage ?? 0),
        rules: [],
      };
      existing.rules.push(row);
      map.set(row.vehicle_id, existing);
    }
    return [...map.values()].sort((a, b) => a.unitNumber.localeCompare(b.unitNumber));
  }, [rows]);

  const [mileages, setMileages] = useState<Record<string, string>>(() =>
    Object.fromEntries(groups.map((group) => [group.vehicleId, String(group.mileage)])),
  );
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  function saveMileage(group: VehicleGroup) {
    const mileage = Number(mileages[group.vehicleId]);
    startTransition(async () => {
      const result = await updateMileage(group.vehicleId, mileage);
      if (!result.ok) {
        setMessage({ type: "error", text: result.error });
        return;
      }
      setMileages((current) => ({ ...current, [group.vehicleId]: String(result.mileage) }));
      setMessage({ type: "ok", text: `Unit ${group.unitNumber} mileage güncellendi.` });
    });
  }

  function serviceRule(rule: MaintenanceRuleRow, unitNumber: string) {
    if (!window.confirm(`Unit ${unitNumber} — ${rule.service_type} bugün yapılmış olarak kaydedilsin mi?`)) return;
    const costRaw = window.prompt("Maliyet ($) — bilinmiyorsa 0 yazın:", "0");
    if (costRaw === null) return;
    const cost = Number(costRaw.replace(/,/g, ""));
    if (!Number.isFinite(cost) || cost < 0) {
      setMessage({ type: "error", text: "Geçerli, negatif olmayan bir maliyet girin." });
      return;
    }
    const shopName = window.prompt("Shop adı (opsiyonel):", "") ?? "";
    const partName = window.prompt("Parça adı / numarası (opsiyonel):", "") ?? "";
    const notes = window.prompt("Not (opsiyonel):", "") ?? "";

    startTransition(async () => {
      const result = await markServiced(rule.id, { cost, shopName, partName, notes });
      setMessage(
        result.ok
          ? { type: "ok", text: `${rule.service_type} bakım geçmişine kaydedildi.` }
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
        <div className="card text-sm text-slate-400">Henüz aktif bakım kuralı yok.</div>
      ) : (
        groups.map((group) => {
          const currentMileage = Number(mileages[group.vehicleId] ?? group.mileage);
          return (
            <div key={group.vehicleId} className="card overflow-x-auto p-0">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
                <div>
                  <p className="font-semibold">Unit {group.unitNumber}</p>
                  <p className="text-xs text-slate-500">Güncel odometre</p>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    aria-label={`Unit ${group.unitNumber} mileage`}
                    className="input w-32 py-1"
                    type="number"
                    min={group.mileage}
                    step="1"
                    value={mileages[group.vehicleId] ?? String(group.mileage)}
                    onChange={(event) =>
                      setMileages((current) => ({ ...current, [group.vehicleId]: event.target.value }))
                    }
                  />
                  <button
                    type="button"
                    onClick={() => saveMileage(group)}
                    disabled={pending}
                    className="btn-primary py-1.5 text-xs"
                  >
                    Mileage Kaydet
                  </button>
                </div>
              </div>

              <table className="w-full">
                <thead className="border-b border-slate-200 bg-white">
                  <tr>
                    <th className="th">Servis</th>
                    <th className="th">Sonraki</th>
                    <th className="th">Kalan</th>
                    <th className="th">Durum</th>
                    <th className="th text-right">İşlem</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {group.rules.map((rule) => {
                    const pm = computePM(rule, currentMileage, thresholds, todayISO());
                    return (
                      <tr key={rule.id} className="hover:bg-slate-50">
                        <td className="td font-medium">{rule.service_type}</td>
                        <td className="td">
                          {pm.nextDue ?? "—"}
                          {pm.unit === "miles" && pm.nextDue != null ? " mi" : ""}
                        </td>
                        <td className="td">{formatPMRemaining(pm)}</td>
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
                            Yapıldı işaretle
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })
      )}
    </div>
  );
}
