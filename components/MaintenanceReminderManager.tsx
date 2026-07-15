"use client";

import { saveMaintenanceReminder, setMaintenanceReminderActive } from "@/app/(app)/maintenance/actions";
import MaintenanceProgramInstaller, { type MaintenanceProgramVehicle } from "@/components/MaintenanceProgramInstaller";
import { computePM, formatPMRemaining, PM_BADGE, type PMStatus, type PMThresholds } from "@/lib/maintenance";
import type { MaintenanceProgramExistingRule } from "@/lib/maintenance-program-presets";
import { VEHICLE_TYPE_OPTIONS, vehicleTypeLabel, type ReminderScope } from "@/lib/maintenance-reminders";
import { REMINDER_SERVICE_OPTIONS, isCustomManualService, validateManualServiceName } from "@/lib/manual-maintenance";
import { todayISO } from "@/lib/tz";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";

interface VehicleOption {
  value: string;
  label: string;
  vehicleType: string;
  currentMileage: number | null;
  engineHours: number | null;
}

export interface ReminderRow {
  id: string;
  vehicle_id: string | null;
  vehicle_type: string | null;
  scope: ReminderScope;
  effective_vehicle_id: string;
  state_id: string | null;
  service_type: string;
  interval_type: "mileage" | "date";
  interval_miles: number | null;
  interval_days: number | null;
  interval_engine_hours: number | null;
  last_done_mileage: number | null;
  last_done_date: string | null;
  last_done_engine_hours: number | null;
  active: boolean;
  vehicles: { id: string; unit_number: string; vehicle_type: string; current_mileage: number | null } | null;
}

interface FormState {
  vehicle_type: string;
  service_type: string;
  interval_miles: string;
  interval_months: string;
  interval_engine_hours: string;
}

const EMPTY: FormState = {
  vehicle_type: "truck",
  service_type: "",
  interval_miles: "",
  interval_months: "",
  interval_engine_hours: "",
};

const STATUS_ORDER: Record<PMStatus, number> = {
  overdue: 0,
  due_now: 1,
  due_soon: 2,
  warning: 3,
  ok: 4,
};

function formatIntervals(row: ReminderRow) {
  const parts = [];
  if (row.interval_miles != null) parts.push(`${Number(row.interval_miles).toLocaleString("en-US")} mil`);
  if (row.interval_days != null) parts.push(`${Math.round(Number(row.interval_days) / 30).toLocaleString("en-US")} ay`);
  if (row.interval_engine_hours != null) parts.push(`${Number(row.interval_engine_hours).toLocaleString("en-US")} engine saat`);
  return parts.join(" veya ") || "-";
}

function formatLastDone(row: ReminderRow) {
  const parts = [];
  if (row.last_done_mileage != null) parts.push(`${Number(row.last_done_mileage).toLocaleString("en-US")} mil`);
  if (row.last_done_date) parts.push(row.last_done_date);
  if (row.last_done_engine_hours != null) parts.push(`${Number(row.last_done_engine_hours).toLocaleString("en-US")} saat`);
  return parts.join(" / ") || "-";
}

function formatNextDue(row: ReminderRow) {
  const parts = [];
  if (row.interval_miles != null && row.last_done_mileage != null) {
    parts.push(`${(Number(row.last_done_mileage) + Number(row.interval_miles)).toLocaleString("en-US")} mil`);
  }
  if (row.interval_days != null && row.last_done_date) {
    const [year, month, day] = row.last_done_date.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day + Number(row.interval_days)));
    parts.push(date.toISOString().slice(0, 10));
  }
  if (row.interval_engine_hours != null && row.last_done_engine_hours != null) {
    parts.push(`${(Number(row.last_done_engine_hours) + Number(row.interval_engine_hours)).toLocaleString("en-US")} saat`);
  }
  return parts.join(" / ") || "-";
}

function groupSummary(rows: ReminderRow[], thresholds: PMThresholds, vehicleMap: Map<string, VehicleOption>) {
  const activeRows = rows.filter((row) => row.active && row.effective_vehicle_id);
  const results = activeRows.map((row) => {
    const vehicle = vehicleMap.get(row.effective_vehicle_id);
    return computePM(row, Number(row.vehicles?.current_mileage ?? vehicle?.currentMileage ?? 0), thresholds, todayISO(), vehicle?.engineHours ?? null);
  });
  const status = [...results].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status])[0]?.status ?? "ok";
  return {
    status,
    overdue: results.filter((pm) => pm.status === "overdue" || pm.status === "due_now").length,
    soon: results.filter((pm) => pm.status === "due_soon" || pm.status === "warning").length,
    ok: results.filter((pm) => pm.status === "ok").length,
  };
}

export default function MaintenanceReminderManager({
  rows,
  vehicles,
  thresholds,
  installerVehicles,
  installerExistingRules,
  defaultVehicleType = "truck",
  defaultService,
}: {
  rows: ReminderRow[];
  vehicles: VehicleOption[];
  thresholds: PMThresholds;
  installerVehicles: MaintenanceProgramVehicle[];
  installerExistingRules: MaintenanceProgramExistingRule[];
  defaultVehicleType?: string;
  defaultService?: string;
}) {
  const [open, setOpen] = useState(Boolean(defaultService));
  const [editing, setEditing] = useState<ReminderRow | null>(null);
  const [form, setForm] = useState<FormState>({
    ...EMPTY,
    vehicle_type: defaultVehicleType,
    service_type: defaultService ?? "",
  });
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const vehicleMap = useMemo(() => new Map(vehicles.map((vehicle) => [vehicle.value, vehicle])), [vehicles]);
  const serviceValidation = validateManualServiceName(form.service_type);
  const customService = serviceValidation.ok && isCustomManualService("periodic", form.service_type);
  const groups = useMemo(() => {
    const grouped = new Map<string, ReminderRow[]>();
    for (const row of rows) grouped.set(row.id, [...(grouped.get(row.id) ?? []), row]);
    return [...grouped.values()].map((groupRows) => ({
      rule: groupRows[0],
      rows: groupRows.sort((a, b) => (a.vehicles?.unit_number ?? "").localeCompare(b.vehicles?.unit_number ?? "")),
    }));
  }, [rows]);

  function startAdd() {
    setEditing(null);
    setForm({ ...EMPTY, vehicle_type: defaultVehicleType, service_type: defaultService ?? "" });
    setError("");
    setOpen(true);
  }

  function startEdit(row: ReminderRow) {
    setEditing(row);
    setForm({
      vehicle_type: row.vehicle_type ?? defaultVehicleType,
      service_type: row.service_type,
      interval_miles: row.interval_miles == null ? "" : String(row.interval_miles),
      interval_months: row.interval_days == null ? "" : String(Math.round(Number(row.interval_days) / 30)),
      interval_engine_hours: row.interval_engine_hours == null ? "" : String(row.interval_engine_hours),
    });
    setError("");
    setOpen(true);
  }

  function save() {
    setError("");
    const formData = new FormData();
    if (editing) formData.set("rule_id", editing.id);
    formData.set("vehicle_type", form.vehicle_type);
    formData.set("service_type", form.service_type);
    formData.set("interval_miles", form.interval_miles);
    formData.set("interval_months", form.interval_months);
    formData.set("interval_engine_hours", form.interval_engine_hours);

    startTransition(async () => {
      const result = await saveMaintenanceReminder(formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
    });
  }

  function setActive(id: string, active: boolean) {
    setError("");
    startTransition(async () => {
      const result = await setMaintenanceReminderActive(id, active);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Bakım Hatırlatıcıları</h1>
          <p className="mt-1 text-sm text-slate-500">Yeni hatırlatıcılar unit türüne göre açılır; her unit kendi son yapılan bilgisini ayrı tutar.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <MaintenanceProgramInstaller vehicles={installerVehicles} existingRules={installerExistingRules} />
          <button type="button" className="btn-ghost" onClick={startAdd}>+ Hatırlatıcı Ekle</button>
        </div>
      </div>

      {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="space-y-3">
        {groups.length === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-400">Bakım hatırlatıcısı yok.</div>
        ) : groups.map(({ rule, rows: groupRows }) => {
          const summary = groupSummary(groupRows, thresholds, vehicleMap);
          const isType = rule.scope === "vehicle_type";
          return (
            <div key={rule.id} className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-semibold">
                      {isType ? vehicleTypeLabel(rule.vehicle_type) : `Unit ${rule.vehicles?.unit_number ?? "-"}`} · {rule.service_type}
                    </h2>
                    <span className={`badge ${rule.active ? PM_BADGE[summary.status] : "bg-slate-100 text-slate-600"}`}>
                      {rule.active ? (summary.overdue > 0 ? "Gecikmiş" : summary.soon > 0 ? "Yaklaşan" : "Tamam") : "Pasif"}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">
                    {isType
                      ? `${groupRows.length} unit · ${summary.overdue} gecikmiş · ${summary.soon} yaklaşıyor`
                      : `${formatLastDone(rule)} son yapılan`}
                  </p>
                  <p className="mt-1 text-sm text-slate-500">Tekrar: {formatIntervals(rule)}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn-ghost" onClick={() => startEdit(rule)}>Düzenle</button>
                  {rule.active ? (
                    <button type="button" className="btn-ghost text-red-600" disabled={isPending} onClick={() => setActive(rule.id, false)}>Pasifleştir</button>
                  ) : (
                    <button type="button" className="btn-ghost" disabled={isPending} onClick={() => setActive(rule.id, true)}>Aktif Et</button>
                  )}
                </div>
              </div>
              <details className="mt-3">
                <summary className="cursor-pointer text-sm font-medium text-brand">Unit Detayları</summary>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[760px] text-sm">
                    <thead className="border-b border-slate-200 bg-slate-50">
                      <tr>
                        <th className="th">Unit</th>
                        <th className="th">Current mileage</th>
                        <th className="th">Son Yapılan</th>
                        <th className="th">Sonraki Bakım</th>
                        <th className="th">Durum</th>
                        <th className="th text-right">İşlem</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {groupRows.map((row) => {
                        const vehicle = vehicleMap.get(row.effective_vehicle_id);
                        const pm = row.active && row.effective_vehicle_id
                          ? computePM(row, Number(row.vehicles?.current_mileage ?? vehicle?.currentMileage ?? 0), thresholds, todayISO(), vehicle?.engineHours ?? null)
                          : null;
                        return (
                          <tr key={`${row.id}-${row.effective_vehicle_id || "scope"}`}>
                            <td className="td font-medium">{row.vehicles?.unit_number ?? "-"}</td>
                            <td className="td">{row.vehicles?.current_mileage == null ? "-" : Number(row.vehicles.current_mileage).toLocaleString("en-US")}</td>
                            <td className="td">{formatLastDone(row)}</td>
                            <td className="td">{formatNextDue(row)}</td>
                            <td className="td">
                              {pm ? <span className={`badge ${PM_BADGE[pm.status]}`}>{formatPMRemaining(pm)}</span> : <span className="badge bg-slate-100 text-slate-600">Pasif</span>}
                            </td>
                            <td className="td text-right">
                              {row.effective_vehicle_id ? (
                                <Link className="text-brand hover:underline" href={`/maintenance?add=1&vehicleId=${row.effective_vehicle_id}&type=periodic&service=${encodeURIComponent(row.service_type)}`}>
                                  Yapıldı Olarak Kaydet
                                </Link>
                              ) : "-"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </details>
            </div>
          );
        })}
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-4">
          <div className="card my-8 w-full max-w-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-semibold">{editing ? "Hatırlatıcı Düzenle" : "Hatırlatıcı Ekle"}</h2>
              <button type="button" className="text-slate-500" onClick={() => setOpen(false)}>Kapat</button>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label className="label">Unit Türü</label>
                {editing?.scope === "vehicle" ? (
                  <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                    Eski unit-specific hatırlatıcı: Unit {editing.vehicles?.unit_number ?? "-"}
                  </div>
                ) : (
                  <select className="input" value={form.vehicle_type} onChange={(event) => setForm({ ...form, vehicle_type: event.target.value })}>
                    {VEHICLE_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                )}
              </div>
              <div>
                <label className="label">Bakım Türü</label>
                <input
                  className="input"
                  list="maintenance-reminder-service-options"
                  value={form.service_type}
                  onChange={(event) => setForm({ ...form, service_type: event.target.value })}
                  placeholder="PM-A"
                />
                <datalist id="maintenance-reminder-service-options">
                  {REMINDER_SERVICE_OPTIONS.map((service) => (
                    <option key={`${service.kind}-${service.value}`} value={service.value}>{service.label}</option>
                  ))}
                </datalist>
                {customService && <p className="mt-1 text-xs text-slate-500">Özel servis adı</p>}
              </div>
              <div>
                <label className="label">Her Kaç Milde</label>
                <input className="input" type="number" min="1" step="1" value={form.interval_miles} onChange={(event) => setForm({ ...form, interval_miles: event.target.value })} />
              </div>
              <div>
                <label className="label">Her Kaç Ayda</label>
                <input className="input" type="number" min="1" step="1" value={form.interval_months} onChange={(event) => setForm({ ...form, interval_months: event.target.value })} />
              </div>
              <div>
                <label className="label">Her Kaç Engine Saatte</label>
                <input className="input" type="number" min="1" step="1" value={form.interval_engine_hours} onChange={(event) => setForm({ ...form, interval_engine_hours: event.target.value })} />
              </div>
              <p className="md:col-span-2 text-sm text-slate-500">İlk dolan sınır geçerli olur. Type reminder kaydı, matching unitlerin son yapılan bilgisini ayrı saklar.</p>
              {error && <p className="md:col-span-2 text-sm text-red-600">{error}</p>}
              <div className="md:col-span-2 flex justify-end gap-2">
                <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>Vazgeç</button>
                <button type="button" className="btn-primary" disabled={isPending} onClick={save}>{isPending ? "Kaydediliyor..." : "Kaydet"}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
