"use client";

import {
  applyMaintenanceTemplateToVehicle,
  upsertVehicleMaintenanceProfile,
} from "@/app/(app)/vehicles/actions";
import {
  previewTemplateItems,
  templateItemIntervalLabel,
  type ExistingMaintenanceRuleSummary,
  type MaintenanceProfileSummary,
  type MaintenanceTemplateItemSummary,
} from "@/lib/maintenance-template";
import { todayISO } from "@/lib/tz";
import { useEffect, useMemo, useState, useTransition } from "react";

interface VehicleRow {
  id: string;
  unit_number: string;
  current_mileage: number | null;
  vin?: string | null;
  year?: number | null;
  make?: string | null;
  model?: string | null;
}

interface ProfileRow extends MaintenanceProfileSummary {
  vin: string | null;
  model_year: number | null;
  make: string | null;
  model: string | null;
  engine_model: string | null;
  engine_esn: string | null;
  transmission_model: string | null;
  transmission_serial: string | null;
  front_axle_model: string | null;
  rear_axle_model: string | null;
  dpf_serial: string | null;
  turbo_part_number: string | null;
  idle_hours: number | null;
  coolant_specification: string | null;
  axle_oil_specification: string | null;
  last_dot_annual_inspection_date: string | null;
  notes: string | null;
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

const EMPTY_PROFILE: Omit<ProfileRow, "vehicle_id"> = {
  duty_cycle: "normal_otr",
  vin: null,
  model_year: null,
  make: null,
  model: null,
  engine_model: null,
  engine_esn: null,
  transmission_model: null,
  transmission_serial: null,
  front_axle_model: null,
  rear_axle_model: null,
  dpf_serial: null,
  turbo_part_number: null,
  engine_hours: null,
  idle_hours: null,
  idle_percentage: null,
  rolling_30_day_mpg: null,
  coolant_specification: null,
  axle_oil_specification: null,
  last_dot_annual_inspection_date: null,
  notes: null,
};

const PROFILE_FIELDS: Array<{ name: keyof Omit<ProfileRow, "vehicle_id" | "duty_cycle">; label: string; type?: string }> = [
  { name: "vin", label: "VIN" },
  { name: "model_year", label: "Model Year", type: "number" },
  { name: "make", label: "Make" },
  { name: "model", label: "Model" },
  { name: "engine_model", label: "Engine Model" },
  { name: "engine_esn", label: "Engine ESN" },
  { name: "transmission_model", label: "Transmission Model" },
  { name: "transmission_serial", label: "Transmission Serial" },
  { name: "front_axle_model", label: "Front Axle Model" },
  { name: "rear_axle_model", label: "Rear Axle Model" },
  { name: "dpf_serial", label: "DPF Serial" },
  { name: "turbo_part_number", label: "Turbo Part #" },
  { name: "engine_hours", label: "Engine Hours", type: "number" },
  { name: "idle_hours", label: "Idle Hours", type: "number" },
  { name: "idle_percentage", label: "Idle %", type: "number" },
  { name: "rolling_30_day_mpg", label: "Rolling 30-day MPG", type: "number" },
  { name: "coolant_specification", label: "Coolant Specification" },
  { name: "axle_oil_specification", label: "Axle Oil Specification" },
  { name: "last_dot_annual_inspection_date", label: "Last DOT Annual", type: "date" },
];

function valueForInput(value: string | number | null | undefined) {
  return value == null ? "" : String(value);
}

export default function VehicleMaintenanceProfileManager({
  vehicles,
  profiles,
  templates,
  activeRules,
}: {
  vehicles: VehicleRow[];
  profiles: ProfileRow[];
  templates: TemplateRow[];
  activeRules: ExistingMaintenanceRuleSummary[];
}) {
  const [vehicleId, setVehicleId] = useState(vehicles[0]?.id ?? "");
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [form, setForm] = useState<Record<string, string>>({});
  const [items, setItems] = useState<DraftItem[]>([]);
  const [confirmApply, setConfirmApply] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const selectedVehicle = vehicles.find((vehicle) => vehicle.id === vehicleId) ?? null;
  const selectedTemplate = templates.find((template) => template.id === templateId) ?? null;
  const savedProfile = profiles.find((profile) => profile.vehicle_id === vehicleId) ?? null;
  const profileForRecommendation = useMemo(
    () => savedProfile ?? ({ vehicle_id: vehicleId, ...EMPTY_PROFILE } as ProfileRow),
    [savedProfile, vehicleId],
  );

  const preview = useMemo(
    () =>
      selectedTemplate
        ? previewTemplateItems({
            items: selectedTemplate.items,
            existingRules: activeRules,
            vehicleId,
            profile: profileForRecommendation,
          })
        : [],
    [activeRules, profileForRecommendation, selectedTemplate, vehicleId],
  );

  useEffect(() => {
    const source = savedProfile ?? {
      vehicle_id: vehicleId,
      ...EMPTY_PROFILE,
      vin: selectedVehicle?.vin ?? null,
      model_year: selectedVehicle?.year ?? null,
      make: selectedVehicle?.make ?? null,
      model: selectedVehicle?.model ?? null,
    };
    setForm(Object.fromEntries(Object.entries(source).map(([key, value]) => [key, valueForInput(value as string | number | null)])));
    setConfirmApply(false);
  }, [savedProfile, selectedVehicle, vehicleId]);

  useEffect(() => {
    setItems(preview.map((item) => ({ ...item })));
    setConfirmApply(false);
  }, [preview]);

  function updateItem(id: string, patch: Partial<DraftItem>) {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
    setConfirmApply(false);
  }

  function saveProfile() {
    startTransition(async () => {
      const result = await upsertVehicleMaintenanceProfile({ ...form, vehicle_id: vehicleId });
      setMessage(result.ok ? { type: "ok", text: "Maintenance profile kaydedildi." } : { type: "error", text: result.error });
    });
  }

  function applyTemplate() {
    if (!selectedTemplate || !selectedVehicle) return;
    const selected = items.filter((item) => item.enabled && !item.duplicate_rule_id);
    if (selected.length === 0) {
      setMessage({ type: "error", text: "Uygulanacak yeni kural yok." });
      return;
    }
    if (!confirmApply) {
      setConfirmApply(true);
      return;
    }

    const currentMileage = selectedVehicle.current_mileage ?? 0;
    const currentEngineHours = savedProfile?.engine_hours ?? null;
    const today = todayISO();
    startTransition(async () => {
      const result = await applyMaintenanceTemplateToVehicle(
        selectedVehicle.id,
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
          last_done_mileage: item.interval_miles == null ? null : currentMileage,
          last_done_date: item.interval_days == null ? null : today,
          last_done_engine_hours: item.interval_engine_hours == null ? null : currentEngineHours,
        })),
      );
      setConfirmApply(false);
      setMessage(result.ok ? { type: "ok", text: "Template uygulandi." } : { type: "error", text: result.error });
    });
  }

  if (vehicles.length === 0) return null;

  return (
    <section className="space-y-4">
      {message && (
        <p className={`rounded-lg border px-3 py-2 text-sm ${message.type === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700"}`}>
          {message.text}
        </p>
      )}

      <div className="card space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">Unit Maintenance Profile</h2>
            <p className="text-sm text-slate-500">VIN/build-sheet bilgileri ve engine-hour bazli bakim referansi.</p>
          </div>
          <select className="input max-w-48" value={vehicleId} onChange={(event) => setVehicleId(event.target.value)}>
            {vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>Unit {vehicle.unit_number}</option>)}
          </select>
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <div>
            <label className="label">Duty Cycle</label>
            <select className="input" value={form.duty_cycle ?? "normal_otr"} onChange={(event) => setForm((current) => ({ ...current, duty_cycle: event.target.value }))}>
              <option value="heavy">Heavy</option>
              <option value="short_haul">Short-haul</option>
              <option value="normal_otr">Normal OTR</option>
              <option value="light">Light</option>
            </select>
          </div>
          {PROFILE_FIELDS.map((field) => (
            <div key={field.name}>
              <label className="label">{field.label}</label>
              <input
                className="input"
                type={field.type ?? "text"}
                step={field.type === "number" ? "0.01" : undefined}
                value={form[field.name] ?? ""}
                onChange={(event) => setForm((current) => ({ ...current, [field.name]: event.target.value }))}
              />
            </div>
          ))}
          <div className="md:col-span-4">
            <label className="label">Notes</label>
            <textarea className="input" rows={2} value={form.notes ?? ""} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} />
          </div>
        </div>
        <div className="flex justify-end">
          <button type="button" className="btn-primary" disabled={pending} onClick={saveProfile}>
            {pending ? "Kaydediliyor..." : "Profile Kaydet"}
          </button>
        </div>
      </div>

      <div className="card space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">Apply Template</h2>
            <p className="text-sm text-slate-500">Mevcut aktif kurallar korunur; duplicate servisler sessizce overwrite edilmez.</p>
          </div>
          <select className="input max-w-sm" value={templateId} onChange={(event) => setTemplateId(event.target.value)}>
            {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
          </select>
        </div>

        {selectedTemplate?.warning && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{selectedTemplate.warning}</p>
        )}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1050px]">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="th">Use</th>
                <th className="th">Service</th>
                <th className="th">Intervals</th>
                <th className="th">Category</th>
                <th className="th">Recommendation / Warning</th>
                <th className="th">Existing</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((item) => (
                <tr key={item.id}>
                  <td className="td">
                    <input
                      type="checkbox"
                      checked={item.enabled && !item.duplicate_rule_id}
                      disabled={!!item.duplicate_rule_id}
                      onChange={(event) => updateItem(item.id, { enabled: event.target.checked })}
                      className="h-4 w-4 accent-brand"
                    />
                  </td>
                  <td className="td">
                    <input className="input min-w-48" value={item.service_type} onChange={(event) => updateItem(item.id, { service_type: event.target.value })} />
                    <p className="mt-1 text-xs text-slate-500">{item.description}</p>
                  </td>
                  <td className="td">
                    <div className="grid grid-cols-3 gap-1">
                      <input className="input w-28" type="number" placeholder="Miles" value={item.interval_miles ?? ""} onChange={(event) => updateItem(item.id, { interval_miles: event.target.value ? Number(event.target.value) : null })} />
                      <input className="input w-24" type="number" placeholder="Days" value={item.interval_days ?? ""} onChange={(event) => updateItem(item.id, { interval_days: event.target.value ? Number(event.target.value) : null })} />
                      <input className="input w-28" type="number" placeholder="Hours" value={item.interval_engine_hours ?? ""} onChange={(event) => updateItem(item.id, { interval_engine_hours: event.target.value ? Number(event.target.value) : null })} />
                    </div>
                    <p className="mt-1 text-xs text-slate-500">{templateItemIntervalLabel(item)}</p>
                  </td>
                  <td className="td">{item.service_category ?? "-"}</td>
                  <td className="td text-sm">
                    {item.recommendation && <p className="font-medium text-slate-700">{item.recommendation}</p>}
                    {(item.warning || item.recommendation_warning || item.configurable || item.duty_cycle_adjusted) && (
                      <p className="text-amber-700">{item.recommendation_warning ?? item.warning ?? "Configurable; VIN/build-sheet specs take precedence."}</p>
                    )}
                  </td>
                  <td className="td text-sm">
                    {item.duplicate_rule_id ? <span className="text-amber-700">Active rule exists; skipped</span> : <span className="text-emerald-700">New rule</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {confirmApply && (
          <div className="rounded-lg border border-brand/30 bg-brand/5 p-3 text-sm">
            Final preview: {items.filter((item) => item.enabled && !item.duplicate_rule_id).length} active rule will be created for Unit {selectedVehicle?.unit_number}. Existing active rules will be skipped.
          </div>
        )}

        <div className="flex justify-end">
          <button type="button" className="btn-primary" disabled={pending} onClick={applyTemplate}>
            {confirmApply ? "Final Confirm & Apply" : "Preview Template Apply"}
          </button>
        </div>
      </div>
    </section>
  );
}
