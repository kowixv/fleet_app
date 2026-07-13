"use client";

import { updateRow } from "@/lib/crud";
import { useState, useTransition } from "react";

interface MaintenanceTemplateItemRow {
  id: string;
  service_type: string;
  maintenance_templates: { name: string } | null;
  default_inspection_template_id: string | null;
}

interface InspectionTemplateOption {
  id: string;
  name: string;
  version: number;
}

export default function MaintenanceTemplateChecklistAssignments({
  items,
  inspectionTemplates,
  basePath = "/maintenance/settings",
}: {
  items: MaintenanceTemplateItemRow[];
  inspectionTemplates: InspectionTemplateOption[];
  basePath?: string;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(items.map((item) => [item.id, item.default_inspection_template_id ?? ""])),
  );
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  function save(itemId: string) {
    startTransition(async () => {
      const result = await updateRow(
        "maintenance_template_items",
        itemId,
        { default_inspection_template_id: values[itemId] || null },
        basePath,
      );
      setMessage(result?.error ? result.error : "Default checklist assignment saved.");
    });
  }

  if (items.length === 0 || inspectionTemplates.length === 0) return null;
  const groups = [
    { title: "PM services", items: items.filter((item) => /\b(pm|inspection|filter|oil|wet)\b/i.test(item.service_type)) },
    { title: "Engine/aftertreatment", items: items.filter((item) => /\b(engine|dpf|def|regen|aftertreatment|coolant|valve)\b/i.test(item.service_type)) },
    { title: "Chassis", items: items.filter((item) => /\b(brake|wheel|axle|suspension|steering|air dryer|drive)\b/i.test(item.service_type)) },
    { title: "Compliance", items: items.filter((item) => /\b(dot|annual|compliance)\b/i.test(item.service_type)) },
  ].map((group, index, all) => {
    if (index < all.length - 1) return group;
    const seen = new Set(all.slice(0, -1).flatMap((g) => g.items.map((item) => item.id)));
    const other = items.filter((item) => !seen.has(item.id) && !group.items.some((existing) => existing.id === item.id));
    return { ...group, items: [...group.items, ...other] };
  });

  return (
    <div className="space-y-3">
      <div>
        <h2 className="font-semibold">Maintenance Template Default Checklists</h2>
        {message && <p className="mt-2 text-sm text-slate-600">{message}</p>}
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {groups.map((group) => (
          <div key={group.title} className="rounded-lg border border-slate-200 bg-white p-4">
            <h3 className="font-semibold">{group.title}</h3>
            <div className="mt-3 space-y-3">
              {group.items.length === 0 ? (
                <p className="text-sm text-slate-400">Bu grupta servis yok.</p>
              ) : group.items.map((item) => (
                <div key={item.id} className="rounded-md border border-slate-100 p-3">
                  <p className="text-sm font-medium">{item.service_type}</p>
                  <p className="text-xs text-slate-500">{item.maintenance_templates?.name ?? "-"}</p>
                <select
                  className="input mt-2"
                  value={values[item.id] ?? ""}
                  onChange={(event) => setValues((current) => ({ ...current, [item.id]: event.target.value }))}
                >
                  <option value="">None</option>
                  {inspectionTemplates.map((template) => (
                    <option key={template.id} value={template.id}>{template.name} v{template.version}</option>
                  ))}
                </select>
                  <div className="mt-2 text-right">
                    <button type="button" className="text-sm text-brand hover:underline" disabled={pending} onClick={() => save(item.id)}>Kaydet</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
