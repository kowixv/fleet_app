"use client";

import { useState } from "react";
import { createRow, updateRow, deleteRow } from "@/lib/crud";
import { usd } from "@/lib/format";

export type FieldType =
  | "text"
  | "number"
  | "percent"
  | "money"
  | "date"
  | "select"
  | "checkbox"
  | "textarea";

export interface Field {
  name: string;
  label: string;
  type?: FieldType;
  options?: { value: string; label: string }[];
  required?: boolean;
  step?: string;
  hideInTable?: boolean;
}

export interface Pagination {
  page: number; // 1-based
  pageSize: number;
  total: number;
}

interface Props {
  title: string;
  table: string;
  basePath: string; // for revalidation + pagination links
  fields: Field[];
  rows: Record<string, any>[];
  addLabel?: string;
  pagination?: Pagination;
}

function toFormValue(field: Field, raw: any): any {
  if (raw === null || raw === undefined) return field.type === "checkbox" ? false : "";
  if (field.type === "percent") return Math.round(Number(raw) * 1000) / 10; // 0.33 -> 33
  return raw;
}

function fromFormValue(field: Field, v: FormDataEntryValue | null): any {
  if (field.type === "checkbox") return v === "on";
  if (v === null || v === "") return null;
  if (field.type === "percent") return Number(v) / 100;
  if (field.type === "number" || field.type === "money") return Number(v);
  return v;
}

export default function ResourceManager({
  title,
  table,
  basePath,
  fields,
  rows,
  addLabel = "Ekle",
  pagination,
}: Props) {
  const [editing, setEditing] = useState<Record<string, any> | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const tableFields = fields.filter((f) => !f.hideInTable);

  function startAdd() {
    setEditing(null);
    setError("");
    setOpen(true);
  }
  function startEdit(row: Record<string, any>) {
    setEditing(row);
    setError("");
    setOpen(true);
  }

  async function onSubmit(formData: FormData) {
    setBusy(true);
    setError("");
    const values: Record<string, any> = {};
    for (const f of fields) values[f.name] = fromFormValue(f, formData.get(f.name));
    const res = editing
      ? await updateRow(table, editing.id, values, basePath)
      : await createRow(table, values, basePath);
    setBusy(false);
    if (res?.error) setError(res.error);
    else setOpen(false);
  }

  async function onDelete(id: string) {
    if (!confirm("Silinsin mi?")) return;
    const res = await deleteRow(table, id, basePath);
    if (res?.error) alert(`Silinemedi: ${res.error}`);
  }

  function renderCell(f: Field, row: Record<string, any>) {
    const v = row[f.name];
    if (v === null || v === undefined || v === "") return "—";
    if (f.type === "percent") return `${(Number(v) * 100).toFixed(0)}%`;
    if (f.type === "money") return usd(Number(v));
    if (f.type === "checkbox") return v ? "✓" : "—";
    if (f.type === "select") {
      const opt = f.options?.find((o) => o.value === String(v));
      return opt?.label ?? v;
    }
    return String(v);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">{title}</h1>
        <button onClick={startAdd} className="btn-primary">
          + {addLabel}
        </button>
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              {tableFields.map((f) => (
                <th key={f.name} className="th">
                  {f.label}
                </th>
              ))}
              <th className="th text-right">İşlem</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 ? (
              <tr>
                <td className="td text-slate-400" colSpan={tableFields.length + 1}>
                  Henüz kayıt yok.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="hover:bg-slate-50">
                  {tableFields.map((f) => (
                    <td key={f.name} className="td">
                      {renderCell(f, row)}
                    </td>
                  ))}
                  <td className="td text-right">
                    <button
                      onClick={() => startEdit(row)}
                      className="mr-3 text-brand hover:underline"
                    >
                      Düzenle
                    </button>
                    <button
                      onClick={() => onDelete(row.id)}
                      className="text-red-600 hover:underline"
                    >
                      Sil
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {pagination && pagination.total > pagination.pageSize && (
        <div className="flex items-center justify-between text-sm text-slate-500">
          <span>
            {(pagination.page - 1) * pagination.pageSize + 1}
            –{Math.min(pagination.page * pagination.pageSize, pagination.total)}
            {" / "}Toplam {pagination.total}
          </span>
          <span className="flex gap-2">
            {pagination.page > 1 ? (
              <a href={`${basePath}?page=${pagination.page - 1}`} className="btn-ghost">
                ← Önceki
              </a>
            ) : (
              <span className="btn-ghost opacity-40">← Önceki</span>
            )}
            {pagination.page * pagination.pageSize < pagination.total ? (
              <a href={`${basePath}?page=${pagination.page + 1}`} className="btn-ghost">
                Sonraki →
              </a>
            ) : (
              <span className="btn-ghost opacity-40">Sonraki →</span>
            )}
          </span>
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-4">
          <div className="card my-8 w-full max-w-lg">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-semibold">
                {editing ? "Düzenle" : addLabel}
              </h2>
              <button onClick={() => setOpen(false)} className="text-slate-400">
                ✕
              </button>
            </div>
            <form action={onSubmit} className="grid grid-cols-2 gap-3">
              {fields.map((f) => {
                const val = toFormValue(f, editing?.[f.name]);
                const span = f.type === "textarea" ? "col-span-2" : "";
                return (
                  <div key={f.name} className={span}>
                    <label className="label">{f.label}</label>
                    {f.type === "select" ? (
                      <select
                        name={f.name}
                        defaultValue={val ?? ""}
                        required={f.required}
                        className="input"
                      >
                        <option value="">—</option>
                        {f.options?.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    ) : f.type === "textarea" ? (
                      <textarea name={f.name} defaultValue={val} className="input" rows={2} />
                    ) : f.type === "checkbox" ? (
                      <input
                        name={f.name}
                        type="checkbox"
                        defaultChecked={!!val}
                        className="h-4 w-4 accent-brand"
                      />
                    ) : (
                      <input
                        name={f.name}
                        type={
                          f.type === "date"
                            ? "date"
                            : f.type === "number" || f.type === "money" || f.type === "percent"
                              ? "number"
                              : "text"
                        }
                        step={f.step ?? (f.type === "money" || f.type === "percent" ? "0.01" : undefined)}
                        defaultValue={val}
                        required={f.required}
                        className="input"
                      />
                    )}
                  </div>
                );
              })}
              {error && <p className="col-span-2 text-sm text-red-600">{error}</p>}
              <div className="col-span-2 mt-2 flex justify-end gap-2">
                <button type="button" onClick={() => setOpen(false)} className="btn-ghost">
                  İptal
                </button>
                <button type="submit" disabled={busy} className="btn-primary">
                  {busy ? "Kaydediliyor…" : "Kaydet"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
