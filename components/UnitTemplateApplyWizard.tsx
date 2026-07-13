"use client";

import { applyMaintenanceTemplateToVehicle } from "@/app/(app)/vehicles/actions";
import {
  previewTemplateItems,
  templateItemIntervalLabel,
  type ExistingMaintenanceRuleSummary,
  type MaintenanceProfileSummary,
  type MaintenanceTemplateItemSummary,
} from "@/lib/maintenance-template";
import { todayISO } from "@/lib/tz";
import { useMemo, useState, useTransition } from "react";

interface VehicleRow {
  id: string;
  unit_number: string;
  current_mileage: number | null;
}

interface TemplateRow {
  id: string;
  name: string;
  warning: string | null;
  items: MaintenanceTemplateItemSummary[];
}

type DraftItem = MaintenanceTemplateItemSummary & {
  enabled: boolean;
  duplicate_rule_id: string | null;
  recommendation: string | null;
  recommendation_warning: string | null;
};

export default function UnitTemplateApplyWizard({
  vehicle,
  profile,
  templates,
  activeRules,
}: {
  vehicle: VehicleRow;
  profile: MaintenanceProfileSummary | null;
  templates: TemplateRow[];
  activeRules: ExistingMaintenanceRuleSummary[];
}) {
  const peterbilt = templates.find((template) => template.name.includes("Peterbilt 579")) ?? templates[0] ?? null;
  const [open, setOpen] = useState(false);
  const [templateId, setTemplateId] = useState(peterbilt?.id ?? "");
  const [items, setItems] = useState<DraftItem[]>([]);
  const [step, setStep] = useState<"review" | "confirm">("review");
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const selectedTemplate = templates.find((template) => template.id === templateId) ?? null;

  const preview = useMemo(() => {
    if (!selectedTemplate) return [];
    return previewTemplateItems({
      items: selectedTemplate.items,
      existingRules: activeRules,
      vehicleId: vehicle.id,
      profile,
    });
  }, [activeRules, profile, selectedTemplate, vehicle.id]);

  function openWizard() {
    setItems(preview.map((item) => ({ ...item })));
    setStep("review");
    setOpen(true);
  }

  function updateItem(id: string, patch: Partial<DraftItem>) {
    setItems((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
    setStep("review");
  }

  function apply() {
    if (!selectedTemplate) return;
    const selected = items.filter((item) => item.enabled && !item.duplicate_rule_id);
    if (selected.length === 0) {
      setMessage({ type: "error", text: "Uygulanacak yeni bakım planı yok." });
      return;
    }
    if (step === "review") {
      setStep("confirm");
      return;
    }
    startTransition(async () => {
      const result = await applyMaintenanceTemplateToVehicle(
        vehicle.id,
        selectedTemplate.id,
        selected.map((item) => ({
          enabled: true,
          template_item_id: item.id,
          service_type: item.service_type,
          service_category: item.service_category,
          description: item.description,
          checklist_reference: item.default_checklist_reference,
          interval_miles: item.interval_miles,
          interval_days: item.interval_days,
          interval_engine_hours: item.interval_engine_hours,
          last_done_mileage: item.interval_miles == null ? null : vehicle.current_mileage ?? 0,
          last_done_date: item.interval_days == null ? null : todayISO(),
          last_done_engine_hours: item.interval_engine_hours == null ? null : profile?.engine_hours ?? null,
        })),
      );
      if (!result.ok) {
        setMessage({ type: "error", text: result.error });
        return;
      }
      setMessage({ type: "ok", text: "Template uygulandı." });
      setOpen(false);
      window.location.reload();
    });
  }

  if (!selectedTemplate) return null;

  return (
    <>
      {message && <p className={`text-xs ${message.type === "ok" ? "text-emerald-700" : "text-red-600"}`}>{message.text}</p>}
      <button type="button" className="btn-ghost" onClick={openWizard}>Template Uygula</button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-4">
          <div className="card my-8 w-full max-w-3xl space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-semibold">Template Uygula</h2>
                <p className="text-sm text-slate-500">VIN/build-sheet özellikleri her zaman önceliklidir.</p>
              </div>
              <button type="button" className="text-slate-400" onClick={() => setOpen(false)}>x</button>
            </div>
            <select className="input" value={templateId} onChange={(event) => setTemplateId(event.target.value)}>
              {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
            </select>
            {selectedTemplate.warning && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{selectedTemplate.warning}</p>
            )}
            <div className="space-y-2">
              {items.map((item) => (
                <label key={item.id} className={`block rounded-lg border p-3 ${item.duplicate_rule_id ? "bg-slate-50 text-slate-500" : "bg-white"}`}>
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 accent-brand"
                      checked={item.enabled && !item.duplicate_rule_id}
                      disabled={!!item.duplicate_rule_id}
                      onChange={(event) => updateItem(item.id, { enabled: event.target.checked })}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{item.service_type}</span>
                        {item.duplicate_rule_id && <span className="badge bg-amber-100 text-amber-700">Mevcut plan var</span>}
                      </div>
                      <p className="text-sm text-slate-500">{templateItemIntervalLabel(item)}</p>
                      {item.recommendation && <p className="text-xs text-slate-500">{item.recommendation}</p>}
                    </div>
                  </div>
                  <details className="mt-2 text-xs text-slate-500">
                    <summary className="cursor-pointer text-brand">Gelişmiş ayarlar</summary>
                    <div className="mt-2 grid gap-2 sm:grid-cols-3">
                      <input className="input" type="number" placeholder="Mil" value={item.interval_miles ?? ""} onChange={(event) => updateItem(item.id, { interval_miles: event.target.value ? Number(event.target.value) : null })} />
                      <input className="input" type="number" placeholder="Gün" value={item.interval_days ?? ""} onChange={(event) => updateItem(item.id, { interval_days: event.target.value ? Number(event.target.value) : null })} />
                      <input className="input" type="number" placeholder="Saat" value={item.interval_engine_hours ?? ""} onChange={(event) => updateItem(item.id, { interval_engine_hours: event.target.value ? Number(event.target.value) : null })} />
                    </div>
                  </details>
                </label>
              ))}
            </div>
            {step === "confirm" && (
              <p className="rounded-lg border border-brand/30 bg-brand/5 p-3 text-sm">
                {items.filter((item) => item.enabled && !item.duplicate_rule_id).length} yeni plan oluşturulacak. Mevcut aktif planlar sessizce değiştirilmez.
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>İptal</button>
              <button type="button" className="btn-primary" disabled={pending} onClick={apply}>
                {step === "confirm" ? "Onayla ve Uygula" : "Önizle"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
