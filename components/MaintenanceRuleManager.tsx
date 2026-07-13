"use client";

import { useState } from "react";
import { createRow, updateRow } from "@/lib/crud";

interface Option { value: string; label: string }
export interface RuleManagerRow {
  id: string;
  vehicle_id: string;
  service_type: string;
  interval_type: "mileage" | "date";
  interval_miles: number | null;
  interval_days: number | null;
  last_done_mileage: number | null;
  last_done_date: string | null;
  active: boolean;
  vehicles: { unit_number: string } | null;
}

interface FormState {
  vehicle_id: string;
  service_type: string;
  interval_type: "mileage" | "date";
  interval_miles: string;
  interval_days: string;
  last_done_mileage: string;
  last_done_date: string;
  active: boolean;
}

const EMPTY: FormState = {
  vehicle_id: "",
  service_type: "",
  interval_type: "mileage",
  interval_miles: "",
  interval_days: "",
  last_done_mileage: "",
  last_done_date: "",
  active: true,
};

export default function MaintenanceRuleManager({ rows, vehicles }: { rows: RuleManagerRow[]; vehicles: Option[] }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

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
      interval_type: row.interval_type,
      interval_miles: row.interval_miles == null ? "" : String(row.interval_miles),
      interval_days: row.interval_days == null ? "" : String(row.interval_days),
      last_done_mileage: row.last_done_mileage == null ? "" : String(row.last_done_mileage),
      last_done_date: row.last_done_date ?? "",
      active: row.active,
    });
    setError("");
    setOpen(true);
  }

  async function save() {
    const intervalValue = form.interval_type === "mileage" ? Number(form.interval_miles) : Number(form.interval_days);
    if (!form.vehicle_id || !form.service_type.trim()) {
      setError("Araç ve servis tipi gerekli.");
      return;
    }
    if (!Number.isFinite(intervalValue) || intervalValue <= 0 || !Number.isInteger(intervalValue)) {
      setError(form.interval_type === "mileage" ? "Mil aralığı pozitif tam sayı olmalı." : "Gün aralığı pozitif tam sayı olmalı.");
      return;
    }
    if (form.interval_type === "mileage" && (!form.last_done_mileage || Number(form.last_done_mileage) < 0)) {
      setError("Mileage bazlı kural için son yapılan mileage gerekli.");
      return;
    }
    if (form.interval_type === "date" && !form.last_done_date) {
      setError("Tarih bazlı kural için son yapılan tarih gerekli.");
      return;
    }

    const values = {
      vehicle_id: form.vehicle_id,
      service_type: form.service_type.trim(),
      interval_type: form.interval_type,
      interval_miles: form.interval_type === "mileage" ? intervalValue : null,
      interval_days: form.interval_type === "date" ? intervalValue : null,
      last_done_mileage: form.interval_type === "mileage" ? Number(form.last_done_mileage) : null,
      last_done_date: form.interval_type === "date" ? form.last_done_date : null,
      active: form.active,
    };

    setBusy(true);
    const result = editingId
      ? await updateRow("maintenance_rules", editingId, values, "/maintenance")
      : await createRow("maintenance_rules", values, "/maintenance");
    setBusy(false);
    if (result?.error) setError(result.error);
    else setOpen(false);
  }

  async function deactivate(id: string) {
    if (!window.confirm("Bakım kuralı pasifleştirilsin mi? Geçmiş kayıtları korunur.")) return;
    const result = await updateRow("maintenance_rules", id, { active: false }, "/maintenance");
    if (result?.error) window.alert(result.error);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Bakım Kuralları</h2>
        <button type="button" onClick={startAdd} className="btn-primary">+ Kural</button>
      </div>
      <div className="card overflow-x-auto p-0">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th">Unit</th>
              <th className="th">Servis</th>
              <th className="th">Aralık</th>
              <th className="th">Son Yapılan</th>
              <th className="th">Durum</th>
              <th className="th text-right">İşlem</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 ? (
              <tr><td className="td text-slate-400" colSpan={6}>Henüz bakım kuralı yok.</td></tr>
            ) : rows.map((row) => (
              <tr key={row.id} className="hover:bg-slate-50">
                <td className="td font-medium">{row.vehicles?.unit_number ?? "—"}</td>
                <td className="td">{row.service_type}</td>
                <td className="td">{row.interval_type === "mileage" ? `${Number(row.interval_miles).toLocaleString("en-US")} mi` : `${row.interval_days} gün`}</td>
                <td className="td">{row.interval_type === "mileage" ? `${Number(row.last_done_mileage).toLocaleString("en-US")} mi` : row.last_done_date}</td>
                <td className="td"><span className={`badge ${row.active ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-600"}`}>{row.active ? "Aktif" : "Pasif"}</span></td>
                <td className="td text-right">
                  <button type="button" onClick={() => startEdit(row)} className="mr-3 text-brand hover:underline">Düzenle</button>
                  {row.active && (
                    <button type="button" onClick={() => deactivate(row.id)} className="text-red-600 hover:underline">Pasifleştir</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-4">
          <div className="card my-8 w-full max-w-lg">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-semibold">{editingId ? "Bakım Kuralını Düzenle" : "Bakım Kuralı Ekle"}</h3>
              <button type="button" onClick={() => setOpen(false)} className="text-slate-400">✕</button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Araç</label>
                <select className="input" value={form.vehicle_id} onChange={(e) => setForm({ ...form, vehicle_id: e.target.value })}>
                  <option value="">—</option>
                  {vehicles.map((vehicle) => <option key={vehicle.value} value={vehicle.value}>{vehicle.label}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Servis Tipi</label>
                <input className="input" value={form.service_type} onChange={(e) => setForm({ ...form, service_type: e.target.value })} placeholder="Oil Change" />
              </div>
              <div>
                <label className="label">Interval Tipi</label>
                <select className="input" value={form.interval_type} onChange={(e) => setForm({ ...form, interval_type: e.target.value as FormState["interval_type"] })}>
                  <option value="mileage">Mileage</option>
                  <option value="date">Tarih</option>
                </select>
              </div>
              {form.interval_type === "mileage" ? (
                <>
                  <div>
                    <label className="label">Her X mil</label>
                    <input className="input" type="number" min="1" step="1" value={form.interval_miles} onChange={(e) => setForm({ ...form, interval_miles: e.target.value })} />
                  </div>
                  <div>
                    <label className="label">Son yapılan mileage</label>
                    <input className="input" type="number" min="0" step="1" value={form.last_done_mileage} onChange={(e) => setForm({ ...form, last_done_mileage: e.target.value })} />
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="label">Her X gün</label>
                    <input className="input" type="number" min="1" step="1" value={form.interval_days} onChange={(e) => setForm({ ...form, interval_days: e.target.value })} />
                  </div>
                  <div>
                    <label className="label">Son yapılan tarih</label>
                    <input className="input" type="date" value={form.last_done_date} onChange={(e) => setForm({ ...form, last_done_date: e.target.value })} />
                  </div>
                </>
              )}
              <label className="col-span-2 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} className="h-4 w-4 accent-brand" />
                Kural aktif
              </label>
              {error && <p className="col-span-2 text-sm text-red-600">{error}</p>}
              <div className="col-span-2 mt-2 flex justify-end gap-2">
                <button type="button" onClick={() => setOpen(false)} className="btn-ghost">İptal</button>
                <button type="button" onClick={save} disabled={busy} className="btn-primary">{busy ? "Kaydediliyor…" : "Kaydet"}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
