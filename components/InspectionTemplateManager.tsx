"use client";

import {
  cloneInspectionTemplate,
} from "@/app/(app)/maintenance/inspection-actions";
import { updateRow } from "@/lib/crud";
import type { InspectionInputType, InspectionTemplateItem } from "@/lib/inspection";
import { useState, useTransition } from "react";

interface TemplateItem extends InspectionTemplateItem {
  unit_of_measure: string | null;
  instructions: string | null;
  select_options: string[];
  sort_order: number;
  active: boolean;
}

interface TemplateRow {
  id: string;
  name: string;
  inspection_type: string;
  version: number;
  items: TemplateItem[];
}

export default function InspectionTemplateManager({
  templates,
  basePath = "/maintenance/settings",
}: {
  templates: TemplateRow[];
  basePath?: string;
}) {
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const selected = templates.find((template) => template.id === templateId) ?? null;

  function cloneTemplate() {
    if (!selected) return;
    const name = window.prompt("New checklist name:", `${selected.name} Copy`);
    if (!name) return;
    startTransition(async () => {
      const result = await cloneInspectionTemplate(selected.id, name);
      setMessage(result.ok ? { type: "ok", text: "Checklist cloned." } : { type: "error", text: result.error });
      if (result.ok) window.location.reload();
    });
  }

  function saveItem(item: TemplateItem) {
    startTransition(async () => {
      const result = await updateRow("inspection_template_items", item.id, { ...item }, basePath);
      setMessage(result?.error ? { type: "error", text: result.error } : { type: "ok", text: "Checklist item saved." });
    });
  }

  if (templates.length === 0) return <div className="text-sm text-slate-400">Checklist template yok.</div>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">Checklist Templates</h2>
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn-ghost" disabled={!templates[0] || pending} onClick={() => setTemplateId(templates[0]?.id ?? null)}>İlk checklist'i aç</button>
        </div>
      </div>
      {message && (
        <p className={`rounded-lg border px-3 py-2 text-sm ${message.type === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700"}`}>
          {message.text}
        </p>
      )}
      <div className="grid gap-3 md:grid-cols-3">
        {templates.map((template) => (
          <ChecklistCard key={template.id} template={template} onEdit={() => setTemplateId(template.id)} />
        ))}
      </div>
      {selected && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-4">
          <div className="card my-8 w-full max-w-5xl space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold">{selected.name} v{selected.version}</h2>
                <p className="text-sm text-slate-500">{selected.items.length} checklist item</p>
              </div>
              <div className="flex gap-2">
                <button type="button" className="btn-ghost" disabled={pending} onClick={cloneTemplate}>Clone</button>
                <button type="button" className="btn-ghost" onClick={() => setTemplateId(null)}>Kapat</button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px]">
                <thead className="border-b border-slate-200 bg-slate-50">
                  <tr>
                    <th className="th">Sort</th>
                    <th className="th">Section</th>
                    <th className="th">Label</th>
                    <th className="th">Type</th>
                    <th className="th">Thresholds</th>
                    <th className="th">Active</th>
                    <th className="th text-right">Save</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {[...selected.items].sort((a, b) => a.sort_order - b.sort_order).map((item) => (
                    <EditableTemplateItem key={item.id} item={item} onSave={saveItem} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function checklistLabel(name: string) {
  const lower = name.toLowerCase();
  if (lower.includes("daily") || lower.includes("pre-trip")) return "Daily / Pre-trip";
  if (lower.includes("weekly")) return "Weekly";
  if (lower.includes("pm-a") || lower.includes("pm a")) return "PM-A";
  if (lower.includes("pm-b") || lower.includes("pm b")) return "PM-B";
  if (lower.includes("6-month") || lower.includes("heavy")) return "6-month";
  if (lower.includes("annual")) return "Annual";
  return name;
}

function ChecklistCard({ template, onEdit }: { template: TemplateRow; onEdit: () => void }) {
  const activeItems = template.items.filter((item) => item.active).length;
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">{checklistLabel(template.name)}</h3>
          <p className="mt-1 text-sm text-slate-500">{template.name} v{template.version}</p>
          <p className="mt-1 text-xs text-slate-500">{activeItems} aktif item</p>
        </div>
        <button type="button" className="btn-ghost text-xs" onClick={onEdit}>Düzenle</button>
      </div>
    </div>
  );
}

function EditableTemplateItem({ item, onSave }: { item: TemplateItem; onSave: (item: TemplateItem) => void }) {
  const [draft, setDraft] = useState(item);
  function patch(update: Partial<TemplateItem>) {
    setDraft((current) => ({ ...current, ...update }));
  }
  return (
    <tr>
      <td className="td"><input className="input w-20" type="number" value={draft.sort_order} onChange={(event) => patch({ sort_order: Number(event.target.value) })} /></td>
      <td className="td"><input className="input min-w-32" value={draft.section} onChange={(event) => patch({ section: event.target.value })} /></td>
      <td className="td"><input className="input min-w-56" value={draft.label} onChange={(event) => patch({ label: event.target.value })} /></td>
      <td className="td">
        <select className="input" value={draft.input_type} onChange={(event) => patch({ input_type: event.target.value as InspectionInputType })}>
          <option value="pass_fail">Pass/Fail</option>
          <option value="checkbox">Checkbox</option>
          <option value="number">Number</option>
          <option value="text">Text</option>
          <option value="select">Select</option>
        </select>
      </td>
      <td className="td">
        <div className="flex gap-1">
          <input className="input w-24" type="number" placeholder="Warn" value={draft.warning_threshold ?? ""} onChange={(event) => patch({ warning_threshold: event.target.value === "" ? null : Number(event.target.value) })} />
          <input className="input w-24" type="number" placeholder="Critical" value={draft.critical_threshold ?? ""} onChange={(event) => patch({ critical_threshold: event.target.value === "" ? null : Number(event.target.value) })} />
        </div>
      </td>
      <td className="td"><input type="checkbox" checked={draft.active} onChange={(event) => patch({ active: event.target.checked })} className="h-4 w-4 accent-brand" /></td>
      <td className="td text-right"><button type="button" className="text-brand hover:underline" onClick={() => onSave(draft)}>Save</button></td>
    </tr>
  );
}
