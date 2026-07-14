"use client";

import { createRow, updateRow } from "@/lib/crud";
import { computePM, formatPMRemaining, PM_BADGE, type PMThresholds } from "@/lib/maintenance";
import { todayISO } from "@/lib/tz";
import Link from "next/link";
import { useMemo, useState } from "react";

interface VehicleOption {
  value: string;
  label: string;
  currentMileage: number | null;
  engineHours: number | null;
}

export interface ReminderRow {
  id: string;
  vehicle_id: string;
  service_type: string;
  interval_type: "mileage" | "date";
  interval_miles: number | null;
  interval_days: number | null;
  interval_engine_hours: number | null;
  last_done_mileage: number | null;
  last_done_date: string | null;
  last_done_engine_hours: number | null;
  active: boolean;
  vehicles: { unit_number: string; current_mileage: number | null } | null;
}

interface FormState {
  vehicle_id: string;
  service_type: string;
  interval_miles: string;
  interval_days: string;
  warning_miles: string;
  warning_days: string;
}

const EMPTY: FormState = {
  vehicle_id: "",
  service_type: "",
  interval_miles: "",
  interval_days: "",
  warning_miles: "",
  warning_days: "",
};

function wholeNumber(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || !Number.isInteger(parsed)) return Number.NaN;
  return parsed;
}

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

export default function MaintenanceReminderManager({
  rows,
  vehicles,
  thresholds,
  defaultVehicleId,
  defaultService,
  basePath = "/maintenance/reminders",
}: {
  rows: ReminderRow[];
  vehicles: VehicleOption[];
  thresholds: PMThresholds;
  defaultVehicleId?: string;
  defaultService?: string;
  basePath?: string;
}) {
  const [open, setOpen] = useState(Boolean(defaultVehicleId || defaultService));
  const [editing, setEditing] = useState<ReminderRow | null>(null);
  const [form, setForm] = useState<FormState>({
    ...EMPTY,
    vehicle_id: defaultVehicleId ?? "",
    service_type: defaultService ?? "",
    warning_miles: String(thresholds.dueSoonMiles),
    warning_days: String(thresholds.dueSoonDays),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const vehicleMap = useMemo(() => new Map(vehicles.map((vehicle) => [vehicle.value, vehicle])), [vehicles]);

  function startAdd() {
    setEditing(null);
    setForm({
      ...EMPTY,
      vehicle_id: defaultVehicleId ?? "",
      service_type: defaultService ?? "",
      warning_miles: String(thresholds.dueSoonMiles),
      warning_days: String(thresholds.dueSoonDays),
    });
    setError("");
    setOpen(true);
  }

  function startEdit(row: ReminderRow) {
    setEditing(row);
    setForm({
      vehicle_id: row.vehicle_id,
      service_type: row.service_type,
      interval_miles: row.interval_miles == null ? "" : String(row.interval_miles),
      interval_days: row.interval_days == null ? "" : String(Math.round(Number(row.interval_days) / 30)),
      warning_miles: String(thresholds.dueSoonMiles),
      warning_days: String(thresholds.dueSoonDays),
    });
    setError("");
    setOpen(true);
  }

  async function save() {
    const intervalMiles = wholeNumber(form.interval_miles);
    const intervalMonths = wholeNumber(form.interval_days);
    if (!form.vehicle_id || !form.service_type.trim()) {
      setError("Unit ve bakım türü gerekli.");
      return;
    }
    if ([intervalMiles, intervalMonths].some(Number.isNaN)) {
      setError("Tekrar aralığı pozitif tam sayı olmalı.");
      return;
    }
    if (intervalMiles == null && intervalMonths == null) {
      setError("En az bir tekrar aralığı girin.");
      return;
    }
    const vehicle = vehicleMap.get(form.vehicle_id);
    const intervalDays = intervalMonths == null ? null : intervalMonths * 30;
    const values = {
      vehicle_id: form.vehicle_id,
      service_type: form.service_type.trim(),
      interval_type: intervalMiles != null ? "mileage" : "date",
      interval_miles: intervalMiles,
      interval_days: intervalDays,
      interval_engine_hours: null,
      last_done_mileage: intervalMiles == null ? null : vehicle?.currentMileage ?? 0,
      last_done_date: intervalDays == null ? null : todayISO(),
      last_done_engine_hours: null,
      active: true,
      service_category: null,
      description: null,
      checklist_reference: null,
    };

    setBusy(true);
    const result = editing
      ? await updateRow("maintenance_rules", editing.id, values, basePath)
      : await createRow("maintenance_rules", values, basePath);
    setBusy(false);
    if (result?.error) setError(result.error);
    else setOpen(false);
  }

  async function deactivate(id: string) {
    const result = await updateRow("maintenance_rules", id, { active: false }, basePath);
    if (result?.error) setError(result.error);
  }

  async function reactivate(id: string) {
    const result = await updateRow("maintenance_rules", id, { active: true }, basePath);
    if (result?.error) setError(result.error);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Bakım Hatırlatıcıları</h1>
          <p className="mt-1 text-sm text-slate-500">İlk dolan sınır geçerli olur.</p>
        </div>
        <button type="button" className="btn-primary" onClick={startAdd}>+ Hatırlatıcı Ekle</button>
      </div>

      {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[820px]">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th">Unit</th>
              <th className="th">Bakım</th>
              <th className="th">Tekrar Aralığı</th>
              <th className="th">Son Yapılan</th>
              <th className="th">Sonraki Bakım</th>
              <th className="th">Durum</th>
              <th className="th text-right">İşlem</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 ? (
              <tr><td className="td text-slate-400" colSpan={7}>Bakım hatırlatıcısı yok.</td></tr>
            ) : rows.map((row) => {
              const vehicle = vehicleMap.get(row.vehicle_id);
              const pm = row.active
                ? computePM(row, Number(row.vehicles?.current_mileage ?? vehicle?.currentMileage ?? 0), thresholds, todayISO(), vehicle?.engineHours ?? null)
                : null;
              return (
                <tr key={row.id} className="hover:bg-slate-50">
                  <td className="td font-medium">{row.vehicles?.unit_number ?? vehicle?.label ?? "-"}</td>
                  <td className="td">{row.service_type}</td>
                  <td className="td">{formatIntervals(row)}</td>
                  <td className="td">{formatLastDone(row)}</td>
                  <td className="td">{formatNextDue(row)}</td>
                  <td className="td">
                    {pm ? (
                      <span className={`badge ${PM_BADGE[pm.status]}`}>{formatPMRemaining(pm)}</span>
                    ) : (
                      <span className="badge bg-slate-100 text-slate-600">Pasif</span>
                    )}
                  </td>
                  <td className="td text-right">
                    <Link className="mr-3 text-brand hover:underline" href={`/maintenance?add=1&vehicleId=${row.vehicle_id}&type=periodic&service=${encodeURIComponent(row.service_type)}`}>Yapıldı Olarak Kaydet</Link>
                    <button type="button" className="mr-3 text-brand hover:underline" onClick={() => startEdit(row)}>Düzenle</button>
                    {row.active ? (
                      <button type="button" className="text-red-600 hover:underline" onClick={() => deactivate(row.id)}>Pasifleştir</button>
                    ) : (
                      <button type="button" className="text-brand hover:underline" onClick={() => reactivate(row.id)}>Aktif Et</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
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
                <label className="label">Unit</label>
                <select className="input" value={form.vehicle_id} onChange={(event) => setForm({ ...form, vehicle_id: event.target.value })}>
                  <option value="">Seçin</option>
                  {vehicles.map((vehicle) => <option key={vehicle.value} value={vehicle.value}>{vehicle.label}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Bakım Türü</label>
                <input className="input" value={form.service_type} onChange={(event) => setForm({ ...form, service_type: event.target.value })} placeholder="PM-A" />
              </div>
              <div>
                <label className="label">Her Kaç Milde</label>
                <input className="input" type="number" min="1" step="1" value={form.interval_miles} onChange={(event) => setForm({ ...form, interval_miles: event.target.value })} />
              </div>
              <div>
                <label className="label">Her Kaç Ayda</label>
                <input className="input" type="number" min="1" step="1" value={form.interval_days} onChange={(event) => setForm({ ...form, interval_days: event.target.value })} />
              </div>
              <div>
                <label className="label">Kaç Mil Kala Uyar</label>
                <input className="input" type="number" min="0" step="1" value={form.warning_miles} onChange={(event) => setForm({ ...form, warning_miles: event.target.value })} />
              </div>
              <div>
                <label className="label">Kaç Gün Kala Uyar</label>
                <input className="input" type="number" min="1" step="1" value={form.warning_days} onChange={(event) => setForm({ ...form, warning_days: event.target.value })} />
              </div>
              <p className="md:col-span-2 text-sm text-slate-500">İlk dolan sınır geçerli olur. Uyarı değerleri mevcut genel ayarlara göre hesaplanır.</p>
              {error && <p className="md:col-span-2 text-sm text-red-600">{error}</p>}
              <div className="md:col-span-2 flex justify-end gap-2">
                <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>Vazgeç</button>
                <button type="button" className="btn-primary" disabled={busy} onClick={save}>{busy ? "Kaydediliyor..." : "Kaydet"}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
