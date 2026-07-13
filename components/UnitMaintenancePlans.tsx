"use client";

import { markServiced } from "@/app/(app)/maintenance/actions";
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
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

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
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  function service(rule: RuleRow) {
    const costRaw = window.prompt("Maliyet ($) - bilinmiyorsa 0 yazın:", "0");
    if (costRaw === null) return;
    const cost = Number(costRaw.replace(/,/g, ""));
    if (!Number.isFinite(cost) || cost < 0) {
      setMessage({ type: "error", text: "Geçerli, negatif olmayan bir maliyet girin." });
      return;
    }
    const shopName = window.prompt("Shop adı (opsiyonel):", "") ?? "";
    const partName = window.prompt("Parça adı / numarası (opsiyonel):", "") ?? "";
    const notes = window.prompt("Not (opsiyonel):", "") ?? "";
    setPendingId(rule.id);
    startTransition(async () => {
      const result = await markServiced(rule.id, { cost, shopName, partName, notes });
      setPendingId(null);
      if (!result.ok) {
        setMessage({ type: "error", text: result.error });
        return;
      }
      setMessage({ type: "ok", text: "Bakım kaydedildi." });
      router.refresh();
    });
  }

  if (rules.length === 0) return <div className="card text-sm text-slate-400">Aktif bakım planı yok.</div>;

  return (
    <section className="space-y-3">
      {message && (
        <p className={`rounded-lg border px-3 py-2 text-sm ${message.type === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700"}`}>
          {message.text}
        </p>
      )}
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
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={isPending && pendingId === rule.id}
                    onClick={() => service(rule)}
                  >
                    {pendingId === rule.id ? "Kaydediliyor..." : "Yapıldı"}
                  </button>
                  <Link className="btn-ghost" href="/maintenance/settings">Düzenle</Link>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
