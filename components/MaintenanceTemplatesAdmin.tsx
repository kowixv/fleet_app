"use client";

import { createRow, updateRow } from "@/lib/crud";
import { useState, useTransition } from "react";

interface TemplateRow {
  id: string;
  name: string;
  description: string | null;
  warning: string | null;
  items: Array<{
    id: string;
    service_type: string;
    service_category: string | null;
    interval_miles: number | null;
    interval_days: number | null;
    interval_engine_hours: number | null;
    configurable: boolean;
    duty_cycle_adjusted: boolean;
    active: boolean;
    sort_order: number;
  }>;
}

const EMPTY = { name: "", description: "", warning: "" };

export default function MaintenanceTemplatesAdmin({
  templates,
  basePath = "/maintenance/settings",
}: {
  templates: TemplateRow[];
  basePath?: string;
}) {
  const [editing, setEditing] = useState<TemplateRow | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function startCreate() {
    setEditing(null);
    setForm(EMPTY);
    setOpen(true);
  }

  function startEdit(template: TemplateRow) {
    setEditing(template);
    setForm({
      name: template.name,
      description: template.description ?? "",
      warning: template.warning ?? "",
    });
    setOpen(true);
  }

  function save() {
    if (!form.name.trim()) {
      setMessage({ type: "error", text: "Template adı gerekli." });
      return;
    }
    startTransition(async () => {
      const values = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        warning: form.warning.trim() || null,
      };
      const result = editing
        ? await updateRow("maintenance_templates", editing.id, values, basePath)
        : await createRow("maintenance_templates", values, basePath);
      if (result?.error) {
        setMessage({ type: "error", text: result.error });
        return;
      }
      setMessage({ type: "ok", text: "Template kaydedildi." });
      setOpen(false);
      window.location.reload();
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold">Maintenance Templates</h2>
        <button type="button" className="btn-primary" onClick={startCreate}>+ Template</button>
      </div>
      {message && (
        <p className={`rounded-lg border px-3 py-2 text-sm ${message.type === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700"}`}>
          {message.text}
        </p>
      )}
      <div className="grid gap-3 lg:grid-cols-2">
        {templates.length === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-400">Maintenance template yok.</div>
        ) : templates.map((template) => {
          const items = [...(template.items ?? [])].sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0));
          return (
            <div key={template.id} className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold">{template.name}</h3>
                  <p className="mt-1 text-sm text-slate-500">{template.description ?? "Açıklama yok."}</p>
                </div>
                <button type="button" className="btn-ghost text-xs" onClick={() => startEdit(template)}>Düzenle</button>
              </div>
              {template.warning && <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{template.warning}</p>}
              <details className="mt-3 text-sm text-slate-600">
                <summary className="cursor-pointer text-brand">Detay</summary>
                <div className="mt-2 space-y-1">
                  {items.filter((item) => item.active).map((item) => (
                    <p key={item.id}>{item.service_type}</p>
                  ))}
                </div>
              </details>
            </div>
          );
        })}
      </div>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="card w-full max-w-lg space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">{editing ? "Template Düzenle" : "Template Oluştur"}</h2>
              <button type="button" className="text-slate-400" onClick={() => setOpen(false)}>x</button>
            </div>
            <div>
              <label className="label">Ad</label>
              <input className="input" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
            </div>
            <div>
              <label className="label">Açıklama</label>
              <textarea className="input" rows={2} value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} />
            </div>
            <div>
              <label className="label">Uyarı</label>
              <textarea className="input" rows={2} value={form.warning} onChange={(event) => setForm((current) => ({ ...current, warning: event.target.value }))} />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>İptal</button>
              <button type="button" className="btn-primary" disabled={pending} onClick={save}>{pending ? "Kaydediliyor..." : "Kaydet"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
