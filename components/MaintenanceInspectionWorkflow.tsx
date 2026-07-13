"use client";

import {
  cloneInspectionTemplate,
  completeVehicleInspection,
  createInspectionWorkOrderDraft,
  saveVehicleInspectionDraft,
  startVehicleInspection,
} from "@/app/(app)/maintenance/inspection-actions";
import { updateRow } from "@/lib/crud";
import {
  classifyInspectionResult,
  hasDoNotDispatchFinding,
  validateRequiredInspectionResults,
  type FindingSeverity,
  type InspectionInputType,
  type InspectionResultInput,
  type InspectionTemplateItem,
} from "@/lib/inspection";
import { useEffect, useMemo, useState, useTransition } from "react";

interface OptionRow { id: string; unit_number: string }
interface RuleOption { id: string; vehicle_id: string; service_type: string }
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
interface DraftInspection {
  id: string;
  vehicle_id: string;
  template_id: string | null;
  inspection_type: string;
  inspection_date: string;
  inspector: string | null;
  shop: string | null;
  notes: string | null;
  maintenance_rule_id: string | null;
}
interface FindingRow {
  id: string;
  vehicle_id: string;
  severity: FindingSeverity;
  status: string;
  label: string | null;
  notes: string | null;
  recommended_action: string | null;
  work_order_status: string | null;
  vehicles: { unit_number: string } | null;
}
interface TrendRow {
  id: string;
  label: string;
  axle_position: string | null;
  value_number: number | null;
  unit_of_measure: string | null;
  created_at: string;
  vehicle_inspections: { vehicle_id: string; vehicles: { unit_number: string } | null } | null;
}

const TRACKED_TRENDS = [
  "Tire tread depth",
  "Brake stroke or remaining percentage",
  "Brake remaining percentage",
  "MPG",
  "Idle percentage",
  "Regen frequency",
  "DPF differential pressure",
  "Oil consumption",
  "Coolant added since last inspection",
  "Battery CCA",
];

function emptyResult(item: TemplateItem): InspectionResultInput {
  return { template_item_id: item.id, passed: item.input_type === "pass_fail" ? true : null };
}

function resultValue(result: InspectionResultInput, item: TemplateItem): string | boolean {
  if (item.input_type === "pass_fail") return result.passed ?? true;
  if (item.input_type === "checkbox") return result.value_bool ?? false;
  if (item.input_type === "number") return result.value_number == null ? "" : String(result.value_number);
  return result.value_text ?? "";
}

export default function MaintenanceInspectionWorkflow({
  vehicles,
  templates,
  drafts,
  rules,
  findings,
  trends,
  showTemplateManagement = false,
  revalidatePath = "/maintenance/inspections",
}: {
  vehicles: OptionRow[];
  templates: TemplateRow[];
  drafts: DraftInspection[];
  rules: RuleOption[];
  findings: FindingRow[];
  trends: TrendRow[];
  showTemplateManagement?: boolean;
  revalidatePath?: string;
}) {
  const [vehicleId, setVehicleId] = useState(vehicles[0]?.id ?? "");
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [ruleId, setRuleId] = useState("");
  const [inspectionId, setInspectionId] = useState<string>("");
  const [inspector, setInspector] = useState("");
  const [shop, setShop] = useState("");
  const [notes, setNotes] = useState("");
  const [markRuleServiced, setMarkRuleServiced] = useState(false);
  const [results, setResults] = useState<Record<string, InspectionResultInput>>({});
  const [templateEditorId, setTemplateEditorId] = useState(templates[0]?.id ?? "");
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const selectedTemplate = templates.find((template) => template.id === templateId) ?? null;
  const selectedTemplateItems = useMemo(
    () => selectedTemplate?.items.filter((item) => item.active).sort((a, b) => a.sort_order - b.sort_order) ?? [],
    [selectedTemplate],
  );
  const selectedDraft = drafts.find((draft) => draft.id === inspectionId) ?? null;
  const openCritical = hasDoNotDispatchFinding(findings);
  const visibleRules = rules.filter((rule) => rule.vehicle_id === vehicleId);
  const editorTemplate = templates.find((template) => template.id === templateEditorId) ?? null;

  useEffect(() => {
    setResults(Object.fromEntries(selectedTemplateItems.map((item) => [item.id, emptyResult(item)])));
  }, [selectedTemplateItems]);

  useEffect(() => {
    if (!inspectionId) return;
    const timer = window.setTimeout(() => {
      saveVehicleInspectionDraft(inspectionId, {
        inspector,
        shop,
        notes,
        mark_rule_serviced: markRuleServiced,
        results: Object.values(results),
      }).then((result) => {
        if (!result.ok) setMessage({ type: "error", text: result.error });
      });
    }, 900);
    return () => window.clearTimeout(timer);
  }, [inspectionId, inspector, markRuleServiced, notes, results, shop]);

  function updateResult(item: TemplateItem, patch: Partial<InspectionResultInput>) {
    setResults((current) => ({
      ...current,
      [item.id]: { ...(current[item.id] ?? emptyResult(item)), template_item_id: item.id, ...patch },
    }));
  }

  function startOrResume() {
    startTransition(async () => {
      const result = await startVehicleInspection({
        vehicleId,
        templateId,
        maintenanceRuleId: ruleId || null,
      });
      if (!result.ok) {
        setMessage({ type: "error", text: result.error });
        return;
      }
      setInspectionId(result.inspectionId);
      setMessage({ type: "ok", text: "Inspection taslağı hazır. Autosave aktif." });
    });
  }

  function resumeDraft(draft: DraftInspection) {
    setVehicleId(draft.vehicle_id);
    setTemplateId(draft.template_id ?? templates[0]?.id ?? "");
    setInspectionId(draft.id);
    setInspector(draft.inspector ?? "");
    setShop(draft.shop ?? "");
    setNotes(draft.notes ?? "");
    setRuleId(draft.maintenance_rule_id ?? "");
    setMessage({ type: "ok", text: "Taslak açıldı." });
  }

  function complete() {
    if (!selectedTemplate) return;
    const missing = validateRequiredInspectionResults(selectedTemplateItems, Object.values(results));
    if (missing.length > 0) {
      setMessage({ type: "error", text: `Required fields missing: ${missing.join(", ")}` });
      return;
    }
    startTransition(async () => {
      const result = await completeVehicleInspection(inspectionId, {
        inspector,
        shop,
        notes,
        mark_rule_serviced: markRuleServiced,
        results: Object.values(results),
      });
      setMessage(result.ok ? { type: "ok", text: "Inspection tamamlandı." } : { type: "error", text: result.error });
      if (result.ok) window.location.reload();
    });
  }

  function cloneTemplate() {
    if (!editorTemplate) return;
    const name = window.prompt("Yeni checklist adı:", `${editorTemplate.name} Copy`);
    if (!name) return;
    startTransition(async () => {
      const result = await cloneInspectionTemplate(editorTemplate.id, name);
      setMessage(result.ok ? { type: "ok", text: "Checklist kopyalandı." } : { type: "error", text: result.error });
      if (result.ok) window.location.reload();
    });
  }

  function saveTemplateItem(item: TemplateItem) {
    startTransition(async () => {
      const result = await updateRow("inspection_template_items", item.id, { ...item }, revalidatePath);
      setMessage(result?.error ? { type: "error", text: result.error } : { type: "ok", text: "Checklist satırı kaydedildi." });
    });
  }

  function createWorkOrder(finding: FindingRow) {
    const woNotes = window.prompt("Work-order taslak notu:", finding.recommended_action ?? "") ?? "";
    startTransition(async () => {
      const result = await createInspectionWorkOrderDraft(finding.id, woNotes);
      setMessage(result.ok ? { type: "ok", text: "Work-order taslağı oluşturuldu." } : { type: "error", text: result.error });
    });
  }

  const localFindings = useMemo(() => {
    if (!selectedTemplate) return [];
    return selectedTemplateItems
      .map((item) => {
        const finding = classifyInspectionResult(item, results[item.id] ?? emptyResult(item));
        return finding ? { item, finding } : null;
      })
      .filter(Boolean) as Array<{ item: TemplateItem; finding: { severity: FindingSeverity; recommended_action: string } }>;
  }, [results, selectedTemplate, selectedTemplateItems]);

  return (
    <section className="space-y-4">
      {message && <p className={`rounded-lg border px-3 py-2 text-sm ${message.type === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700"}`}>{message.text}</p>}
      {openCritical && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-red-800">
          <b>SEVKE ÇIKMASIN</b> - Kritik açık inspection bulguları yetkili inceleme gerektirir. Araç durumu otomatik değiştirilmez.
        </div>
      )}

      <div className="card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold">PM Inspections</h2>
          <button type="button" className="btn-ghost" onClick={() => window.print()}>Yazdırılabilir Özet</button>
        </div>
        <div className="grid gap-3 md:grid-cols-4">
          <div>
            <label className="label">Vehicle</label>
            <select className="input" value={vehicleId} onChange={(event) => setVehicleId(event.target.value)}>
              {vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>Unit {vehicle.unit_number}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Checklist</label>
            <select className="input" value={templateId} onChange={(event) => setTemplateId(event.target.value)}>
              {templates.map((template) => <option key={template.id} value={template.id}>{template.name} v{template.version}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Related PM Rule</label>
            <select className="input" value={ruleId} onChange={(event) => setRuleId(event.target.value)}>
              <option value="">Yok</option>
              {visibleRules.map((rule) => <option key={rule.id} value={rule.id}>{rule.service_type}</option>)}
            </select>
          </div>
          <div className="flex items-end">
            <button type="button" className="btn-primary w-full" disabled={pending} onClick={startOrResume}>Inspection Başlat</button>
          </div>
        </div>

        {drafts.length > 0 && (
          <div className="rounded-lg border border-slate-200 p-3">
            <h3 className="mb-2 text-sm font-semibold">Taslağa devam et</h3>
            <div className="flex flex-wrap gap-2">
              {drafts.map((draft) => (
                <button key={draft.id} type="button" className="btn-ghost text-xs" onClick={() => resumeDraft(draft)}>
                  {vehicles.find((vehicle) => vehicle.id === draft.vehicle_id)?.unit_number ?? "Unit"} - {draft.inspection_type}
                </button>
              ))}
            </div>
          </div>
        )}

        {inspectionId && selectedTemplate && (
          <div className="space-y-3">
            <div className="grid gap-3 md:grid-cols-4">
              <input className="input" placeholder="Inspector" value={inspector} onChange={(event) => setInspector(event.target.value)} />
              <input className="input" placeholder="Shop" value={shop} onChange={(event) => setShop(event.target.value)} />
              <input className="input md:col-span-2" placeholder="Notes" value={notes} onChange={(event) => setNotes(event.target.value)} />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4 accent-brand" checked={markRuleServiced} onChange={(event) => setMarkRuleServiced(event.target.checked)} />
                Mark related PM rule serviced
              </label>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px]">
                <thead className="border-b border-slate-200 bg-slate-50">
                  <tr>
                    <th className="th">Section</th>
                    <th className="th">Item</th>
                    <th className="th">Value</th>
                    <th className="th">Threshold</th>
                    <th className="th">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {selectedTemplateItems.map((item) => {
                    const result = results[item.id] ?? emptyResult(item);
                    const finding = classifyInspectionResult(item, result);
                    return (
                      <tr key={item.id}>
                        <td className="td">{item.section}</td>
                        <td className="td">
                          <div className="font-medium">{item.label}{item.required ? " *" : ""}</div>
                          {item.instructions && <p className="text-xs text-slate-500">{item.instructions}</p>}
                          {finding && <p className="mt-1 text-xs font-semibold text-red-700">{finding.severity}: {finding.recommended_action}</p>}
                        </td>
                        <td className="td">{renderInput(item, result, updateResult)}</td>
                        <td className="td text-xs">
                          {item.warning_threshold != null ? `Warn ${item.warning_threshold}` : "-"}
                          {item.critical_threshold != null ? ` / Critical ${item.critical_threshold}` : ""}
                          {item.unit_of_measure ? ` ${item.unit_of_measure}` : ""}
                        </td>
                        <td className="td">
                          <input className="input min-w-40" value={result.notes ?? ""} onChange={(event) => updateResult(item, { notes: event.target.value })} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {localFindings.length > 0 && <p className="text-sm text-amber-700">Tamamlandığında {localFindings.length} bulgu oluşturulacak.</p>}
            <div className="flex justify-end">
              <button type="button" className="btn-primary" disabled={pending} onClick={complete}>Inspection Tamamla</button>
            </div>
          </div>
        )}
      </div>

      <FindingsTable findings={findings} onWorkOrder={createWorkOrder} />
      <TrendTable trends={trends.filter((row) => TRACKED_TRENDS.some((label) => row.label.toLowerCase().includes(label.toLowerCase().split(" ")[0])))} />

      {showTemplateManagement && (
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold">Checklist Template Yönetimi</h2>
          <div className="flex gap-2">
            <select className="input" value={templateEditorId} onChange={(event) => setTemplateEditorId(event.target.value)}>
              {templates.map((template) => <option key={template.id} value={template.id}>{template.name} v{template.version}</option>)}
            </select>
            <button type="button" className="btn-ghost" disabled={pending} onClick={cloneTemplate}>Kopyala</button>
          </div>
        </div>
        {editorTemplate && (
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
                  <th className="th text-right">Kaydet</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {editorTemplate.items.sort((a, b) => a.sort_order - b.sort_order).map((item) => (
                  <EditableTemplateItem key={item.id} item={item} onSave={saveTemplateItem} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      )}
    </section>
  );
}

function renderInput(
  item: TemplateItem,
  result: InspectionResultInput,
  update: (item: TemplateItem, patch: Partial<InspectionResultInput>) => void,
) {
  const value = resultValue(result, item);
  if (item.input_type === "pass_fail") {
    return (
      <select className="input" value={String(value)} onChange={(event) => update(item, { passed: event.target.value === "true" })}>
        <option value="true">Pass</option>
        <option value="false">Fail</option>
      </select>
    );
  }
  if (item.input_type === "checkbox") {
    return <input type="checkbox" className="h-4 w-4 accent-brand" checked={Boolean(value)} onChange={(event) => update(item, { value_bool: event.target.checked })} />;
  }
  if (item.input_type === "number") {
    return <input className="input w-32" type="number" step="0.01" value={String(value)} onChange={(event) => update(item, { value_number: event.target.value === "" ? null : Number(event.target.value) })} />;
  }
  if (item.input_type === "select") {
    return (
      <select className="input" value={String(value)} onChange={(event) => update(item, { value_text: event.target.value })}>
        <option value="">Select</option>
        {item.select_options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    );
  }
  return <input className="input min-w-40" value={String(value)} onChange={(event) => update(item, { value_text: event.target.value })} />;
}

function FindingsTable({ findings, onWorkOrder }: { findings: FindingRow[]; onWorkOrder: (finding: FindingRow) => void }) {
  return (
    <div className="card overflow-x-auto p-0">
      <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
        <h2 className="font-semibold">Açık Inspection Bulguları</h2>
      </div>
      <table className="w-full">
        <thead className="border-b border-slate-200">
          <tr>
            <th className="th">Unit</th>
            <th className="th">Severity</th>
            <th className="th">Bulgu</th>
            <th className="th">İşlem</th>
            <th className="th text-right">Work Order</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {findings.length === 0 ? (
            <tr><td className="td text-slate-400" colSpan={5}>Açık bulgu yok.</td></tr>
          ) : findings.map((finding) => (
            <tr key={finding.id}>
              <td className="td">{finding.vehicles?.unit_number ?? "-"}</td>
              <td className="td"><span className="badge bg-red-100 text-red-700">{finding.severity}</span></td>
              <td className="td">{finding.label ?? "-"}</td>
              <td className="td">{finding.recommended_action ?? finding.notes ?? "-"}</td>
              <td className="td text-right">
                {finding.work_order_status === "draft" ? (
                  <span className="text-xs text-slate-500">Taslak oluşturuldu</span>
                ) : (
                  <button type="button" className="text-xs text-brand hover:underline" onClick={() => onWorkOrder(finding)}>Taslak oluştur</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TrendTable({ trends }: { trends: TrendRow[] }) {
  return (
    <div className="card overflow-x-auto p-0">
      <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
        <h2 className="font-semibold">Inspection Ölçüm Geçmişi</h2>
      </div>
      <table className="w-full">
        <thead className="border-b border-slate-200">
          <tr>
            <th className="th">Date</th>
            <th className="th">Unit</th>
            <th className="th">Ölçüm</th>
            <th className="th">Pozisyon</th>
            <th className="th">Value</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {trends.length === 0 ? (
            <tr><td className="td text-slate-400" colSpan={5}>Ölçüm geçmişi yok.</td></tr>
          ) : trends.slice(0, 80).map((trend) => (
            <tr key={trend.id}>
              <td className="td">{new Date(trend.created_at).toLocaleDateString("en-US")}</td>
              <td className="td">{trend.vehicle_inspections?.vehicles?.unit_number ?? "-"}</td>
              <td className="td">{trend.label}</td>
              <td className="td">{trend.axle_position || "-"}</td>
              <td className="td">{trend.value_number ?? "-"} {trend.unit_of_measure ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
      <td className="td text-right"><button type="button" className="text-brand hover:underline" onClick={() => onSave(draft)}>Kaydet</button></td>
    </tr>
  );
}
