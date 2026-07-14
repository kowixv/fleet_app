"use client";

import { createRow, updateRow } from "@/lib/crud";
import { useState } from "react";

interface Option { value: string; label: string }
export interface RuleManagerRow {
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
  service_category: string | null;
  description: string | null;
  checklist_reference: string | null;
  template_source: string | null;
  vehicles: { unit_number: string } | null;
}

interface FormState {
  vehicle_id: string;
  service_type: string;
  interval_miles: string;
  interval_days: string;
  interval_engine_hours: string;
  last_done_mileage: string;
  last_done_date: string;
  last_done_engine_hours: string;
  service_category: string;
  description: string;
  checklist_reference: string;
  active: boolean;
}

const EMPTY: FormState = {
  vehicle_id: "",
  service_type: "",
  interval_miles: "",
  interval_days: "",
  interval_engine_hours: "",
  last_done_mileage: "",
  last_done_date: "",
  last_done_engine_hours: "",
  service_category: "",
  description: "",
  checklist_reference: "",
  active: true,
};

function wholeNumber(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) return Number.NaN;
  return n;
}

function formatIntervals(row: RuleManagerRow) {
  const parts = [];
  if (row.interval_miles != null) parts.push(`${Number(row.interval_miles).toLocaleString("en-US")} mi`);
  if (row.interval_days != null) parts.push(`${Number(row.interval_days).toLocaleString("en-US")} days`);
  if (row.interval_engine_hours != null) parts.push(`${Number(row.interval_engine_hours).toLocaleString("en-US")} engine hours`);
  return parts.join(" OR ") || "-";
}

function formatBaseline(row: RuleManagerRow) {
  const parts = [];
  if (row.last_done_mileage != null) parts.push(`${Number(row.last_done_mileage).toLocaleString("en-US")} mi`);
  if (row.last_done_date) parts.push(row.last_done_date);
  if (row.last_done_engine_hours != null) parts.push(`${Number(row.last_done_engine_hours).toLocaleString("en-US")} hours`);
  return parts.join(" / ") || "-";
}

export default function MaintenanceRuleManager({
  rows,
  vehicles,
  basePath = "/maintenance/settings",
}: {
  rows: RuleManagerRow[];
  vehicles: Option[];
  basePath?: string;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmDeactivateId, setConfirmDeactivateId] = useState<string | null>(null);

  function startAdd() {
    setEditingId(null);
    setForm(EMPTY);
    setError("");
    setOpen(true);
  }

  function startEdit(row: RuleManagerRow) {
    setEditingId(row.id);
    setForm({
      vehicle_id: row.vehicle_id ?? "",
      service_type: row.service_type ?? "",
      interval_miles: row.interval_miles == null ? "" : String(row.interval_miles),
      interval_days: row.interval_days == null ? "" : String(row.interval_days),
      interval_engine_hours: row.interval_engine_hours == null ? "" : String(row.interval_engine_hours),
      last_done_mileage: row.last_done_mileage == null ? "" : String(row.last_done_mileage),
      last_done_date: row.last_done_date ?? "",
      last_done_engine_hours: row.last_done_engine_hours == null ? "" : String(row.last_done_engine_hours),
      service_category: row.service_category ?? "",
      description: row.description ?? "",
      checklist_reference: row.checklist_reference ?? "",
      active: row.active,
    });
    setError("");
    setOpen(true);
  }

  async function save() {
    const intervalMiles = wholeNumber(form.interval_miles);
    const intervalDays = wholeNumber(form.interval_days);
    const intervalHours = wholeNumber(form.interval_engine_hours);
    if (!form.vehicle_id || !form.service_type.trim()) {
      setError("Arac ve servis tipi gerekli.");
      return;
    }
    if ([intervalMiles, intervalDays, intervalHours].some(Number.isNaN)) {
      setError("Interval degerleri pozitif tam sayi olmali.");
      return;
    }
    if (intervalMiles == null && intervalDays == null && intervalHours == null) {
      setError("En az bir interval girin: miles, days veya engine hours.");
      return;
    }
    if (intervalMiles != null && (form.last_done_mileage === "" || Number(form.last_done_mileage) < 0)) {
      setError("Mileage interval icin son yapilan mileage gerekli.");
      return;
    }
    if (intervalDays != null && !form.last_done_date) {
      setError("Date interval icin son yapilan tarih gerekli.");
      return;
    }
    if (intervalHours != null && (form.last_done_engine_hours === "" || Number(form.last_done_engine_hours) < 0)) {
      setError("Engine-hour interval icin son engine hours gerekli.");
      return;
    }

    const values = {
      vehicle_id: form.vehicle_id,
      service_type: form.service_type.trim(),
      interval_type: intervalMiles != null ? "mileage" : "date",
      interval_miles: intervalMiles,
      interval_days: intervalDays,
      interval_engine_hours: intervalHours,
      last_done_mileage: intervalMiles == null ? null : Number(form.last_done_mileage),
      last_done_date: intervalDays == null ? null : form.last_done_date,
      last_done_engine_hours: intervalHours == null ? null : Number(form.last_done_engine_hours),
      service_category: form.service_category.trim() || null,
      description: form.description.trim() || null,
      checklist_reference: form.checklist_reference.trim() || null,
      active: form.active,
    };

    setBusy(true);
    const result = editingId
      ? await updateRow("maintenance_rules", editingId, values, basePath)
      : await createRow("maintenance_rules", values, basePath);
    setBusy(false);
    if (result?.error) setError(result.error);
    else setOpen(false);
  }

  async function deactivate(id: string) {
    const result = await updateRow("maintenance_rules", id, { active: false }, basePath);
    setConfirmDeactivateId(null);
    if (result?.error) setError(result.error);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Bakim Kurallari</h2>
        <button type="button" onClick={startAdd} className="btn-primary">+ Kural</button>
      </div>
      <div className="card overflow-x-auto p-0">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th">Unit</th>
              <th className="th">Servis</th>
              <th className="th">Intervals</th>
              <th className="th">Baseline</th>
              <th className="th">Kaynak</th>
              <th className="th">Durum</th>
              <th className="th text-right">Islem</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 ? (
              <tr><td className="td text-slate-400" colSpan={7}>Henuz bakim kurali yok.</td></tr>
            ) : rows.map((row) => (
              <tr key={row.id} className="hover:bg-slate-50">
                <td className="td font-medium">{row.vehicles?.unit_number ?? "-"}</td>
                <td className="td">{row.service_type}</td>
                <td className="td">{formatIntervals(row)}</td>
                <td className="td">{formatBaseline(row)}</td>
                <td className="td">{row.template_source ?? "Manual"}</td>
                <td className="td"><span className={`badge ${row.active ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-600"}`}>{row.active ? "Aktif" : "Pasif"}</span></td>
                <td className="td text-right">
                  <button type="button" onClick={() => startEdit(row)} className="mr-3 text-brand hover:underline">Duzenle</button>
                  {row.active && (
                    confirmDeactivateId === row.id ? (
                      <span className="inline-flex items-center gap-2">
                        <button type="button" onClick={() => deactivate(row.id)} className="text-red-600 hover:underline">Onayla</button>
                        <button type="button" onClick={() => setConfirmDeactivateId(null)} className="text-slate-500 hover:underline">Vazgeç</button>
                      </span>
                    ) : (
                      <button type="button" onClick={() => setConfirmDeactivateId(row.id)} className="text-red-600 hover:underline">Pasiflestir</button>
                    )
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-4">
          <div className="card my-8 w-full max-w-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-semibold">{editingId ? "Bakim Kuralini Duzenle" : "Bakim Kurali Ekle"}</h3>
              <button type="button" onClick={() => setOpen(false)} className="text-slate-400">x</button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Arac</label>
                <select className="input" value={form.vehicle_id} onChange={(e) => setForm({ ...form, vehicle_id: e.target.value })}>
                  <option value="">-</option>
                  {vehicles.map((vehicle) => <option key={vehicle.value} value={vehicle.value}>{vehicle.label}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Servis Tipi</label>
                <input className="input" value={form.service_type} onChange={(e) => setForm({ ...form, service_type: e.target.value })} placeholder="PM-A" />
              </div>
              <div>
                <label className="label">Every X miles</label>
                <input className="input" type="number" min="1" step="1" value={form.interval_miles} onChange={(e) => setForm({ ...form, interval_miles: e.target.value })} />
              </div>
              <div>
                <label className="label">Last done mileage</label>
                <input className="input" type="number" min="0" step="1" value={form.last_done_mileage} onChange={(e) => setForm({ ...form, last_done_mileage: e.target.value })} />
              </div>
              <div>
                <label className="label">Every X days</label>
                <input className="input" type="number" min="1" step="1" value={form.interval_days} onChange={(e) => setForm({ ...form, interval_days: e.target.value })} />
              </div>
              <div>
                <label className="label">Last done date</label>
                <input className="input" type="date" value={form.last_done_date} onChange={(e) => setForm({ ...form, last_done_date: e.target.value })} />
              </div>
              <div>
                <label className="label">Every X engine hours</label>
                <input className="input" type="number" min="1" step="1" value={form.interval_engine_hours} onChange={(e) => setForm({ ...form, interval_engine_hours: e.target.value })} />
              </div>
              <div>
                <label className="label">Last done engine hours</label>
                <input className="input" type="number" min="0" step="1" value={form.last_done_engine_hours} onChange={(e) => setForm({ ...form, last_done_engine_hours: e.target.value })} />
              </div>
              <div>
                <label className="label">Category</label>
                <input className="input" value={form.service_category} onChange={(e) => setForm({ ...form, service_category: e.target.value })} />
              </div>
              <div>
                <label className="label">Checklist Ref</label>
                <input className="input" value={form.checklist_reference} onChange={(e) => setForm({ ...form, checklist_reference: e.target.value })} />
              </div>
              <div className="col-span-2">
                <label className="label">Description</label>
                <textarea className="input" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
              <label className="col-span-2 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} className="h-4 w-4 accent-brand" />
                Kural aktif
              </label>
              {error && <p className="col-span-2 text-sm text-red-600">{error}</p>}
              <div className="col-span-2 mt-2 flex justify-end gap-2">
                <button type="button" onClick={() => setOpen(false)} className="btn-ghost">Iptal</button>
                <button type="button" onClick={save} disabled={busy} className="btn-primary">{busy ? "Kaydediliyor..." : "Kaydet"}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
