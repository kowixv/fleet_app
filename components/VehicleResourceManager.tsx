"use client";

import { saveVehicleWithManualUnitFromForm } from "@/app/(app)/vehicles/manual-unit-actions";
import {
  ENGINE_TYPE_SUGGESTIONS,
  TRUCK_COLOR_SUGGESTIONS,
  VEHICLE_STATUS_OPTIONS,
  VEHICLE_TYPE_OPTIONS,
} from "@/lib/vehicle-form";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import VehicleRemovalActions from "@/components/VehicleRemovalActions";

export interface VehicleFormRow {
  id: string;
  unit_number: string;
  vehicle_type: string;
  owner_id: string | null;
  assigned_driver_id: string | null;
  default_driver_pay_pct: number | null;
  vin: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  plate: string | null;
  truck_color: string | null;
  current_mileage: number | null;
  status: string | null;
  notes: string | null;
  engine_model: string | null;
  engine_hours: number | null;
  has_maintenance_profile: boolean;
}

interface PersonOption {
  value: string;
  label: string;
}

interface Pagination {
  page: number;
  pageSize: number;
  total: number;
}

function vehicleTypeLabel(value: string | null) {
  return VEHICLE_TYPE_OPTIONS.find((option) => option.value === value)?.label ?? value ?? "-";
}

function statusLabel(value: string | null) {
  return VEHICLE_STATUS_OPTIONS.find((option) => option.value === value)?.label ?? value ?? "-";
}

function percentValue(value: number | null) {
  return value == null ? "" : String(Math.round(Number(value) * 1000) / 10);
}

function numberValue(value: number | null) {
  return value == null ? "" : String(value);
}

function personName(people: PersonOption[], id: string | null) {
  return people.find((person) => person.value === id)?.label ?? "-";
}

export default function VehicleResourceManager({
  rows,
  drivers,
  owners,
  pagination,
  includeInactive,
  canPermanentDelete,
}: {
  rows: VehicleFormRow[];
  drivers: PersonOption[];
  owners: PersonOption[];
  pagination: Pagination;
  includeInactive: boolean;
  canPermanentDelete: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<VehicleFormRow | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  function paginationHref(nextPage: number) {
    return `/vehicles?page=${nextPage}${includeInactive ? "&showInactive=1" : ""}`;
  }

  function startAdd() {
    setEditing(null);
    setError("");
    setOpen(true);
  }

  function startEdit(row: VehicleFormRow) {
    setEditing(row);
    setError("");
    setOpen(true);
  }

  function onSubmit(formData: FormData) {
    setError("");
    const values = Object.fromEntries(formData.entries());
    if (editing) values.id = editing.id;
    values.has_maintenance_profile = editing?.has_maintenance_profile ? "1" : "";
    startTransition(async () => {
      const result = await saveVehicleWithManualUnitFromForm(values);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Vehicles / Units</h1>
        <button onClick={startAdd} className="btn-primary">
          + Araç
        </button>
      </div>

      <div className="flex justify-end">
        <a className="btn-ghost" href={includeInactive ? "/vehicles" : "/vehicles?showInactive=1"}>
          {includeInactive ? "Pasif Unitleri Gizle" : "Pasif Unitleri Göster"}
        </a>
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th">Unit #</th>
              <th className="th">Tip</th>
              <th className="th">Owner</th>
              <th className="th">Şoför</th>
              <th className="th">Plaka</th>
              <th className="th">Durum</th>
              <th className="th text-right">İşlem</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 ? (
              <tr>
                <td className="td text-slate-400" colSpan={7}>
                  Henüz kayıt yok.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="hover:bg-slate-50">
                  <td className="td font-medium">{row.unit_number}</td>
                  <td className="td">{vehicleTypeLabel(row.vehicle_type)}</td>
                  <td className="td">{personName(owners, row.owner_id)}</td>
                  <td className="td">{personName(drivers, row.assigned_driver_id)}</td>
                  <td className="td">{row.plate ?? "-"}</td>
                  <td className="td">{statusLabel(row.status)}</td>
                  <td className="td text-right">
                    <VehicleRemovalActions
                      row={{ id: row.id, unit_number: row.unit_number, status: row.status }}
                      startEdit={() => startEdit(row)}
                      canPermanentDelete={canPermanentDelete}
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {pagination.total > pagination.pageSize && (
        <div className="flex items-center justify-between text-sm text-slate-500">
          <span>
            {(pagination.page - 1) * pagination.pageSize + 1}
            -{Math.min(pagination.page * pagination.pageSize, pagination.total)}
            {" / "}Toplam {pagination.total}
          </span>
          <span className="flex gap-2">
            {pagination.page > 1 ? (
              <a href={paginationHref(pagination.page - 1)} className="btn-ghost">
                Önceki
              </a>
            ) : (
              <span className="btn-ghost opacity-40">Önceki</span>
            )}
            {pagination.page * pagination.pageSize < pagination.total ? (
              <a href={paginationHref(pagination.page + 1)} className="btn-ghost">
                Sonraki
              </a>
            ) : (
              <span className="btn-ghost opacity-40">Sonraki</span>
            )}
          </span>
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-4">
          <div className="card my-8 w-full max-w-4xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-semibold">{editing ? "Düzenle" : "Araç"}</h2>
              <button onClick={() => setOpen(false)} className="text-slate-400">
                X
              </button>
            </div>

            <form action={onSubmit} className="space-y-5">
              <section className="space-y-3">
                <h3 className="text-sm font-semibold text-slate-900">Araç Bilgileri</h3>
                <div className="grid gap-3 md:grid-cols-3">
                  <div>
                    <label className="label">Unit #</label>
                    <input
                      name="unit_number"
                      className="input uppercase"
                      required
                      placeholder="1501"
                      defaultValue={editing?.unit_number ?? ""}
                    />
                  </div>
                  <div>
                    <label className="label">Tip</label>
                    <select name="vehicle_type" className="input" required defaultValue={editing?.vehicle_type ?? "truck"}>
                      {VEHICLE_TYPE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label">VIN</label>
                    <input name="vin" className="input uppercase" defaultValue={editing?.vin ?? ""} />
                  </div>
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  <div>
                    <label className="label">Yıl</label>
                    <input name="year" type="number" min="0" step="1" className="input" defaultValue={numberValue(editing?.year ?? null)} />
                  </div>
                  <div>
                    <label className="label">Make</label>
                    <input name="make" className="input" defaultValue={editing?.make ?? ""} />
                  </div>
                  <div>
                    <label className="label">Model</label>
                    <input name="model" className="input" defaultValue={editing?.model ?? ""} />
                  </div>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <label className="label">Plaka</label>
                    <input name="plate" className="input uppercase" defaultValue={editing?.plate ?? ""} />
                  </div>
                  <div>
                    <label className="label">Truck Color</label>
                    <input name="truck_color" list="truck-color-suggestions" className="input" defaultValue={editing?.truck_color ?? ""} />
                    <datalist id="truck-color-suggestions">
                      {TRUCK_COLOR_SUGGESTIONS.map((color) => <option key={color} value={color} />)}
                    </datalist>
                  </div>
                </div>
              </section>

              <section className="space-y-3">
                <h3 className="text-sm font-semibold text-slate-900">Owner / Şoför Bilgileri</h3>
                <p className="text-xs text-slate-500">Owner Operator veya Investor kişisini Owner alanından; aktif sürücüyü Şoför alanından bağlayın.</p>
                <div className="grid gap-3 md:grid-cols-3">
                  <div>
                    <label className="label">Owner</label>
                    <select name="owner_id" className="input" defaultValue={editing?.owner_id ?? ""}>
                      <option value="">-</option>
                      {owners.map((owner) => (
                        <option key={owner.value} value={owner.value}>
                          {owner.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label">Şoför</label>
                    <select name="assigned_driver_id" className="input" defaultValue={editing?.assigned_driver_id ?? ""}>
                      <option value="">-</option>
                      {drivers.map((driver) => (
                        <option key={driver.value} value={driver.value}>
                          {driver.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label">Driver Pay</label>
                    <input
                      name="default_driver_pay_pct"
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      className="input"
                      defaultValue={percentValue(editing?.default_driver_pay_pct ?? null)}
                    />
                  </div>
                </div>
              </section>

              <section className="space-y-3">
                <h3 className="text-sm font-semibold text-slate-900">Operasyon Bilgileri</h3>
                <div className="grid gap-3 md:grid-cols-4">
                  <div>
                    <label className="label">Durum</label>
                    <select name="status" className="input" required defaultValue={editing?.status ?? "active"}>
                      {VEHICLE_STATUS_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label">Mileage</label>
                    <input
                      name="current_mileage"
                      type="number"
                      min="0"
                      step="1"
                      className="input"
                      placeholder="482077"
                      defaultValue={numberValue(editing?.current_mileage ?? null)}
                    />
                  </div>
                  <div>
                    <label className="label">Engine Type</label>
                    <input name="engine_model" list="engine-type-suggestions" className="input" defaultValue={editing?.engine_model ?? ""} />
                    <datalist id="engine-type-suggestions">
                      {ENGINE_TYPE_SUGGESTIONS.map((engine) => <option key={engine} value={engine} />)}
                    </datalist>
                  </div>
                  <div>
                    <label className="label">Engine Hour</label>
                    <input name="engine_hours" type="number" min="0" step="0.01" className="input" defaultValue={numberValue(editing?.engine_hours ?? null)} />
                  </div>
                </div>
              </section>

              <section className="space-y-3">
                <h3 className="text-sm font-semibold text-slate-900">Notlar</h3>
                <div>
                  <label className="label">Not</label>
                  <textarea name="notes" className="input" rows={4} defaultValue={editing?.notes ?? ""} />
                </div>
              </section>

              {error && <p className="text-sm text-red-600">{error}</p>}
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setOpen(false)} className="btn-ghost">
                  İptal
                </button>
                <button type="submit" disabled={isPending} className="btn-primary">
                  {isPending ? "Kaydediliyor..." : "Kaydet"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
