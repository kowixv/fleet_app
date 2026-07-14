"use client";

import {
  computePM,
  formatPMDimension,
  formatPMRemaining,
  PM_BADGE,
  type PMResult,
  type PMThresholds,
} from "@/lib/maintenance";
import { todayISO } from "@/lib/tz";
import Link from "next/link";

interface RuleRow {
  id: string;
  service_type: string;
  interval_miles: number | null;
  interval_days: number | null;
  interval_engine_hours: number | null;
  last_done_mileage: number | null;
  last_done_date: string | null;
  last_done_engine_hours: number | null;
  vehicle_id: string;
  active: boolean;
}

function triggerText(pm: PMResult) {
  if (pm.triggeredBy === "miles") return "Mil sınırı önce doldu";
  if (pm.triggeredBy === "days") return "Tarih sınırı önce doldu";
  if (pm.triggeredBy === "engine_hours") return "Engine saat sınırı önce doldu";
  return "Sınır hesaplanamadı";
}

function nextDueText(pm: PMResult) {
  if (pm.dimensions.length === 0) return "-";
  return pm.dimensions.map((dimension) => {
    if (dimension.unit === "miles") return `${Number(dimension.nextDue).toLocaleString("en-US")} mi`;
    if (dimension.unit === "days") return String(dimension.nextDue);
    return `${Number(dimension.nextDue).toLocaleString("en-US")} saat`;
  }).join(" / ");
}

export default function UnitMaintenancePlans({
  rules,
  currentMileage,
  engineHours,
  thresholds,
}: {
  rules: RuleRow[];
  currentMileage: number | null;
  engineHours: number | null;
  thresholds: PMThresholds;
}) {
  if (rules.length === 0) return <div className="card text-sm text-slate-400">Aktif bakım hatırlatıcısı yok.</div>;

  return (
    <section className="space-y-3">
      <div className="grid gap-3">
        {rules.map((rule) => {
          const pm = computePM(rule, Number(currentMileage ?? 0), thresholds, todayISO(), engineHours);
          return (
            <div key={rule.id} className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold">{rule.service_type}</h3>
                    <span className={`badge ${PM_BADGE[pm.status]}`}>{pm.label}</span>
                  </div>
                  <p className="mt-1 text-sm font-medium text-slate-700">{formatPMRemaining(pm)}</p>
                  <p className="mt-1 text-xs text-slate-500">{triggerText(pm)}</p>
                  <details className="mt-2 text-xs text-slate-500">
                    <summary className="cursor-pointer text-brand">Detay</summary>
                    <div className="mt-1 space-y-1">
                      <p>Sonraki: {nextDueText(pm)}</p>
                      {pm.dimensions.map((dimension) => <p key={dimension.unit}>{formatPMDimension(dimension)}</p>)}
                    </div>
                  </details>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link className="btn-primary" href={`/maintenance?add=1&vehicleId=${rule.vehicle_id}&type=periodic&service=${encodeURIComponent(rule.service_type)}`}>
                    Bakım Ekle
                  </Link>
                  <Link className="btn-ghost" href={`/maintenance/reminders?vehicleId=${rule.vehicle_id}&service=${encodeURIComponent(rule.service_type)}`}>Düzenle</Link>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
