"use client";

import { quickCreateMaintenanceVehicle, saveManualMaintenance } from "@/app/(app)/maintenance/actions";
import { MAINTENANCE_COST_CATEGORIES } from "@/lib/maintenance-cost";
import { MAINTENANCE_TERMS } from "@/lib/maintenance-terminology";
import { formatMaintenanceCategory } from "@/lib/maintenance-terminology";
import {
  PERIODIC_SERVICE_OPTIONS,
  REPAIR_SERVICE_OPTIONS,
  manualMaintenanceCategory,
  manualServiceKey,
  manualServiceKeys,
  normalizeUnitNumber,
  type ManualMaintenanceKind,
} from "@/lib/manual-maintenance";
import { todayISO } from "@/lib/tz";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";

interface VehicleOption {
  id: string;
  unit_number: string;
  current_mileage: number | null;
}

interface ActiveRuleOption {
  vehicle_id: string;
  service_type: string;
}

interface SaveSummary {
  title: string;
  unitNumber: string | null;
  serviceType: string;
  kind: ManualMaintenanceKind;
  mileage: number;
  cost: number | null;
  previousCurrentMileage: number | null;
  currentMileage: number | null;
  currentMileageChanged: boolean;
  planUpdated: boolean;
  planCreated: boolean;
  missingRule: boolean;
  historyOnly: boolean;
  recordCreated: boolean;
  idempotent: boolean;
  rule: {
    serviceType: string;
    nextDueMileage: number | null;
    nextDueDate: string | null;
    nextDueEngineHours: number | null;
  } | null;
}

function newSubmissionKey() {
  return crypto.randomUUID();
}

function formatMiles(value: number | null | undefined) {
  return value == null ? "-" : `${Number(value).toLocaleString("en-US")} mil`;
}

function formatMoney(value: number | null | undefined) {
  return value == null ? "-" : `$${Number(value).toFixed(2)}`;
}

function vehicleLabel(vehicle: VehicleOption) {
  return `${vehicle.unit_number}${vehicle.current_mileage == null ? "" : ` - ${Number(vehicle.current_mileage).toLocaleString("en-US")} mi`}`;
}

const MAINTENANCE_CAUSE_OPTIONS = [
  ["normal_wear", "Normal Wear"],
  ["component_failure", "Component Failure"],
  ["road_hazard", "Road Hazard"],
  ["driver_damage", "Driver Damage"],
  ["accident_collision", "Accident / Collision"],
  ["previous_repair_failure", "Previous Repair Failure"],
  ["unknown", "Unknown"],
] as const;

function nextDueText(summary: SaveSummary) {
  if (!summary.rule) return null;
  const parts = [
    summary.rule.nextDueMileage == null ? null : formatMiles(summary.rule.nextDueMileage),
    summary.rule.nextDueDate,
    summary.rule.nextDueEngineHours == null ? null : `${Number(summary.rule.nextDueEngineHours).toLocaleString("en-US")} engine hours`,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" veya ") : null;
}

function SaveSummaryCard({ summary }: { summary: SaveSummary }) {
  const due = nextDueText(summary);
  const mileageLine = summary.currentMileageChanged
    ? `Current mileage güncellendi: ${formatMiles(summary.previousCurrentMileage)} -> ${formatMiles(summary.currentMileage)}`
    : summary.previousCurrentMileage != null && summary.mileage < summary.previousCurrentMileage
      ? `Current vehicle mileage ${formatMiles(summary.previousCurrentMileage)} olarak kaldı. Current mileage düşürülmedi.`
      : "Current mileage değişmedi.";

  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
      <h3 className="font-semibold">{summary.title}</h3>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li>Bakım geçmişi kaydı oluşturuldu.</li>
        <li>Unit {summary.unitNumber ?? "-"}</li>
        <li>{summary.serviceType} - {formatMiles(summary.mileage)}</li>
        {summary.cost != null && <li>Cost: {formatMoney(summary.cost)}</li>}
        <li>{mileageLine}</li>
        <li>
          {summary.planUpdated
            ? `${summary.rule?.serviceType ?? summary.serviceType} bakım hatırlatıcısı güncellendi.`
            : summary.historyOnly
              ? "Geçmiş kaydı olarak kaydedildi. Bakım hatırlatıcısı değişmedi."
              : "Bakım hatırlatıcısı değişmedi."}
        </li>
        {summary.missingRule && <li>Bu bakım için hatırlatıcı bulunamadı.</li>}
        {due && <li>Sonraki bakım: {due}</li>}
        {summary.idempotent && <li>Bu işlem daha önce kaydedildi; duplicate kayıt oluşturulmadı.</li>}
      </ul>
    </div>
  );
}

export default function ManualMaintenanceEntry({
  vehicles,
  activeRules,
  initiallyOpen = false,
  initialVehicleId,
  initialKind = "periodic",
  initialServiceType,
  buttonLabel = MAINTENANCE_TERMS.addMaintenance,
  buttonClassName = "btn-primary",
}: {
  vehicles: VehicleOption[];
  activeRules: ActiveRuleOption[];
  initiallyOpen?: boolean;
  initialVehicleId?: string;
  initialKind?: ManualMaintenanceKind;
  initialServiceType?: string;
  buttonLabel?: string;
  buttonClassName?: string;
}) {
  const router = useRouter();
  const initialVehicle = vehicles.find((vehicle) => vehicle.id === initialVehicleId) ?? vehicles[0] ?? null;
  const [open, setOpen] = useState(initiallyOpen);
  const [kind, setKind] = useState<ManualMaintenanceKind>(initialKind);
  const [vehicleId, setVehicleId] = useState(initialVehicle?.id ?? "");
  const [unitQuery, setUnitQuery] = useState(initialVehicle?.unit_number ?? "");
  const [serviceType, setServiceType] = useState(initialServiceType ?? PERIODIC_SERVICE_OPTIONS[0].value);
  const [category, setCategory] = useState(manualMaintenanceCategory(initialKind, initialServiceType ?? PERIODIC_SERVICE_OPTIONS[0].value));
  const [parts, setParts] = useState([""]);
  const [submissionKey, setSubmissionKey] = useState(newSubmissionKey);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [summary, setSummary] = useState<SaveSummary | null>(null);
  const [showQuickCreate, setShowQuickCreate] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [quickMessage, setQuickMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [quickCreatedVehicleId, setQuickCreatedVehicleId] = useState<string | null>(null);
  const [isQuickPending, startQuickTransition] = useTransition();

  useEffect(() => {
    if (initiallyOpen) setOpen(true);
  }, [initiallyOpen]);

  useEffect(() => {
    const selected = vehicles.find((vehicle) => vehicle.id === vehicleId);
    if (selected && !unitQuery) setUnitQuery(selected.unit_number);
  }, [unitQuery, vehicleId, vehicles]);

  useEffect(() => {
    setCategory(manualMaintenanceCategory(kind, serviceType));
  }, [kind, serviceType]);

  const services = kind === "periodic" ? PERIODIC_SERVICE_OPTIONS : REPAIR_SERVICE_OPTIONS;
  const normalizedQuery = normalizeUnitNumber(unitQuery);
  const selectedVehicle = vehicles.find((vehicle) => vehicle.id === vehicleId) ?? null;
  const unitMatch = vehicles.find((vehicle) => normalizeUnitNumber(vehicle.unit_number) === normalizedQuery) ?? null;
  const needsQuickCreate = Boolean(normalizedQuery) && !unitMatch;
  const hasActiveRule = useMemo(() => {
    if (kind !== "periodic" || !vehicleId || !serviceType) return false;
    const selectedKeys = new Set(manualServiceKeys(kind, serviceType));
    return activeRules.some((rule) => rule.vehicle_id === vehicleId && selectedKeys.has(manualServiceKey(rule.service_type)));
  }, [activeRules, kind, serviceType, vehicleId]);

  function handleUnitChange(value: string) {
    setUnitQuery(value);
    const normalized = normalizeUnitNumber(value);
    const match = vehicles.find((vehicle) => normalizeUnitNumber(vehicle.unit_number) === normalized);
    setVehicleId(match?.id ?? "");
    if (normalized && !match) setShowQuickCreate(true);
  }

  function resetForNext() {
    setSubmissionKey(newSubmissionKey());
    setParts([""]);
  }

  function submit(formData: FormData) {
    setMessage(null);
    setSummary(null);
    if (!vehicleId) {
      setMessage({ type: "error", text: "Önce listeden bir Unit seçin veya Yeni Unit Oluştur ile kaydedin." });
      setShowQuickCreate(true);
      return;
    }
    parts.forEach((part) => formData.append("parts_used", part));
    formData.set("submission_key", submissionKey);
    formData.set("entry_kind", kind);
    formData.set("vehicle_id", vehicleId);
    formData.set("service_type", serviceType);
    startTransition(async () => {
      const result = await saveManualMaintenance(formData);
      if (!result.ok) {
        setMessage({ type: "error", text: result.error });
        return;
      }
      setSummary(result.summary as SaveSummary);
      resetForNext();
      router.refresh();
    });
  }

  function quickCreate(formData: FormData) {
    startQuickTransition(async () => {
      const result = await quickCreateMaintenanceVehicle(formData);
      if (!result.ok) {
        setQuickMessage({ type: "error", text: result.error });
        return;
      }
      const vehicleId = typeof result.result?.vehicle_id === "string" ? result.result.vehicle_id : null;
      setQuickCreatedVehicleId(vehicleId);
      setQuickMessage({ type: "ok", text: "Unit başarıyla oluşturuldu." });
      router.refresh();
    });
  }

  return (
    <>
      <button type="button" className={buttonClassName} onClick={() => setOpen(true)}>
        {buttonLabel}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/40 px-3 py-6">
          <div className="mx-auto max-w-3xl rounded-lg bg-white shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
              <div>
                <h2 className="text-lg font-bold">{MAINTENANCE_TERMS.addMaintenance}</h2>
                <p className="mt-1 text-sm text-slate-500">Günlük bakım ve tamir kayıtları için kısa form.</p>
              </div>
              <button type="button" className="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100" onClick={() => setOpen(false)}>
                Kapat
              </button>
            </div>

            <div className="space-y-4 px-5 py-4">
              {message && (
                <p className={`rounded-lg border px-3 py-2 text-sm ${message.type === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700"}`}>
                  {message.text}
                </p>
              )}
              {summary && <SaveSummaryCard summary={summary} />}

              <form action={submit} className="space-y-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <label className="label">Unit</label>
                    <input
                      className="input"
                      list="manual-unit-options"
                      required
                      value={unitQuery}
                      onChange={(event) => handleUnitChange(event.target.value)}
                      placeholder="Unit seç veya yaz"
                    />
                    <datalist id="manual-unit-options">
                      {vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.unit_number}>{vehicleLabel(vehicle)}</option>)}
                    </datalist>
                    {selectedVehicle && (
                      <p className="mt-1 text-xs text-slate-500">Current mileage: {formatMiles(selectedVehicle.current_mileage)}</p>
                    )}
                    {needsQuickCreate && (
                      <button type="button" className="mt-2 text-sm font-medium text-brand hover:underline" onClick={() => setShowQuickCreate(true)}>
                        Yeni Unit Oluştur
                      </button>
                    )}
                  </div>
                  <div>
                    <label className="label">İşlem Türü</label>
                    <select
                      className="input"
                      required
                      value={kind}
                      onChange={(event) => {
                        const nextKind = event.target.value as ManualMaintenanceKind;
                        setKind(nextKind);
                        setServiceType((nextKind === "periodic" ? PERIODIC_SERVICE_OPTIONS : REPAIR_SERVICE_OPTIONS)[0].value);
                      }}
                    >
                      <option value="periodic">{MAINTENANCE_TERMS.periodicMaintenance}</option>
                      <option value="repair">{MAINTENANCE_TERMS.repair}</option>
                    </select>
                  </div>
                  <div>
                    <label className="label">{MAINTENANCE_TERMS.serviceType}</label>
                    <input
                      className="input"
                      list="manual-service-options"
                      required
                      value={serviceType}
                      onChange={(event) => setServiceType(event.target.value)}
                    />
                    <datalist id="manual-service-options">
                      {services.map((service) => <option key={service.value} value={service.value}>{service.label}</option>)}
                    </datalist>
                  </div>
                  <div>
                    <label className="label">Maintenance Category</label>
                    <select className="input" name="category" value={category} onChange={(event) => setCategory(event.target.value)}>
                      {MAINTENANCE_COST_CATEGORIES.map((item) => (
                        <option key={item} value={item}>{formatMaintenanceCategory(item)}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label">{MAINTENANCE_TERMS.performedDate}</label>
                    <input className="input" name="performed_date" type="date" required defaultValue={todayISO()} />
                  </div>
                  <div>
                    <label className="label">{MAINTENANCE_TERMS.performedMileage}</label>
                    <input className="input" name="mileage" inputMode="numeric" pattern="[0-9]*" required defaultValue={selectedVehicle?.current_mileage ?? ""} />
                  </div>
                  <div>
                    <label className="label">{MAINTENANCE_TERMS.totalCost}</label>
                    <input className="input" name="cost" type="number" min="0" step="0.01" placeholder="Opsiyonel" />
                  </div>
                  <div>
                    <label className="label">Planlı / Plansız</label>
                    <select key={kind} className="input" name="planned" defaultValue={kind === "periodic" ? "planned" : "unscheduled"}>
                      <option value="planned">Planlı</option>
                      <option value="unscheduled">Plansız</option>
                    </select>
                  </div>
                </div>

                {kind === "periodic" ? (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                    <label className="flex items-center gap-2 font-medium">
                      <input type="checkbox" name="update_plan" defaultChecked />
                      {MAINTENANCE_TERMS.updateNextDue}
                    </label>
                    <details className="mt-2">
                      <summary className="cursor-pointer text-brand">Detay</summary>
                      <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3 text-slate-600">
                        {hasActiveRule ? (
                          <p>Bu kayıt aynı bakım hatırlatıcısını günceller.</p>
                        ) : (
                          <div className="space-y-2">
                            <p>Bu bakım için hatırlatıcı bulunamadı.</p>
                            <div className="flex flex-wrap gap-2">
                              <span className="badge bg-slate-100 text-slate-700">Sadece geçmişe kaydet</span>
                              <a className="text-brand hover:underline" href={`/maintenance/reminders${vehicleId ? `?vehicleId=${vehicleId}&service=${encodeURIComponent(serviceType)}` : ""}`}>
                                Hatırlatıcı oluştur
                              </a>
                            </div>
                          </div>
                        )}
                      </div>
                    </details>
                  </div>
                ) : (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                    Bu kayıt bakım hatırlatıcısını değiştirmez.
                  </div>
                )}

                <details className="rounded-lg border border-slate-200">
                  <summary className="cursor-pointer px-4 py-3 font-medium">Detaylı Maliyet ve Arıza Bilgileri</summary>
                  <div className="grid gap-3 border-t border-slate-100 p-4 md:grid-cols-2">
                    <div>
                      <label className="label">Shop</label>
                      <input className="input" name="shop_name" />
                    </div>
                    <div>
                      <label className="label">Cause</label>
                      <select className="input" name="cause" defaultValue="">
                        <option value="">Seçilmedi</option>
                        {MAINTENANCE_CAUSE_OPTIONS.map(([value, label]) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </select>
                    </div>
                    <label className="flex items-center gap-2 text-sm md:col-span-2">
                      <input type="checkbox" className="h-4 w-4 accent-brand" name="breakdown_occurred" />
                      Breakdown occurred
                    </label>
                    <div>
                      <label className="label">Invoice / Repair Order Number</label>
                      <input className="input" name="invoice_number" />
                    </div>
                    <div className="md:col-span-2">
                      <label className="label">Parts</label>
                      <div className="space-y-2">
                        {parts.map((part, index) => (
                          <input
                            key={index}
                            className="input"
                            value={part}
                            onChange={(event) => setParts((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))}
                            placeholder="Parça adı / numarası"
                          />
                        ))}
                      </div>
                      <button type="button" className="btn-ghost mt-2" onClick={() => setParts((current) => [...current, ""])}>
                        Parça Satırı Ekle
                      </button>
                    </div>
                    <div>
                      <label className="label">Labor Cost</label>
                      <input className="input" name="labor_cost" type="number" min="0" step="0.01" />
                    </div>
                    <div>
                      <label className="label">Parts Cost</label>
                      <input className="input" name="parts_cost" type="number" min="0" step="0.01" />
                    </div>
                    <div>
                      <label className="label">Fees</label>
                      <input className="input" name="shop_fees" type="number" min="0" step="0.01" />
                    </div>
                    <div>
                      <label className="label">Tax</label>
                      <input className="input" name="tax_cost" type="number" min="0" step="0.01" />
                    </div>
                    <div>
                      <label className="label">Diagnostic Cost</label>
                      <input className="input" name="diagnostic_cost" type="number" min="0" step="0.01" />
                    </div>
                    <div>
                      <label className="label">Towing</label>
                      <input className="input" name="towing_cost" type="number" min="0" step="0.01" />
                    </div>
                    <div>
                      <label className="label">Road Service</label>
                      <input className="input" name="road_service_cost" type="number" min="0" step="0.01" />
                    </div>
                    <div>
                      <label className="label">Freight / Shipping</label>
                      <input className="input" name="freight_shipping_cost" type="number" min="0" step="0.01" />
                    </div>
                    <div>
                      <label className="label">Core Charge</label>
                      <input className="input" name="core_charge_cost" type="number" min="0" step="0.01" />
                    </div>
                    <div>
                      <label className="label">Environmental Fee</label>
                      <input className="input" name="environmental_fee_cost" type="number" min="0" step="0.01" />
                    </div>
                    <div>
                      <label className="label">Machine Shop</label>
                      <input className="input" name="machine_shop_cost" type="number" min="0" step="0.01" />
                    </div>
                    <div>
                      <label className="label">Sublet</label>
                      <input className="input" name="sublet_cost" type="number" min="0" step="0.01" />
                    </div>
                    <div>
                      <label className="label">Hotel / Travel</label>
                      <input className="input" name="hotel_travel_cost" type="number" min="0" step="0.01" />
                    </div>
                    <div>
                      <label className="label">Other Cost</label>
                      <input className="input" name="other_cost" type="number" min="0" step="0.01" />
                    </div>
                    <div>
                      <label className="label">Warranty Recovery</label>
                      <input className="input" name="warranty_recovery" type="number" min="0" step="0.01" />
                    </div>
                    <div>
                      <label className="label">Refund / Credit</label>
                      <input className="input" name="refund_credit" type="number" min="0" step="0.01" />
                    </div>
                    <div>
                      <label className="label">Downtime start</label>
                      <input className="input" name="downtime_start" type="datetime-local" />
                    </div>
                    <div>
                      <label className="label">Downtime end</label>
                      <input className="input" name="downtime_end" type="datetime-local" />
                    </div>
                    <div className="md:col-span-2">
                      <label className="label">Notes</label>
                      <textarea className="input min-h-24" name="notes" />
                    </div>
                  </div>
                </details>

                <div className="flex flex-wrap justify-end gap-2">
                  <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>Vazgeç</button>
                  <button type="submit" className="btn-primary" disabled={isPending}>
                    {isPending ? "Kaydediliyor..." : "Kaydet"}
                  </button>
                </div>
              </form>

              {(showQuickCreate || needsQuickCreate || vehicles.length === 0) && (
                <section className="rounded-lg border border-brand/30 bg-brand/5 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold">Yeni Unit Oluştur</h3>
                      <p className="mt-1 text-sm text-slate-600">Unit listede yoksa önce kısa kayıt açın, sonra bakımı kaydedin.</p>
                    </div>
                    {!needsQuickCreate && (
                      <button type="button" className="text-sm text-slate-500 hover:text-slate-900" onClick={() => setShowQuickCreate(false)}>
                        Gizle
                      </button>
                    )}
                  </div>
                  <form action={quickCreate} className="mt-3 grid gap-3 md:grid-cols-2">
                    {quickMessage && (
                      <p className={`md:col-span-2 rounded-lg border px-3 py-2 text-sm ${quickMessage.type === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700"}`}>
                        {quickMessage.text}
                      </p>
                    )}
                    <div>
                      <label className="label">Unit Number</label>
                      <input className="input" name="unit_number" required defaultValue={normalizedQuery} onBlur={(event) => { event.currentTarget.value = normalizeUnitNumber(event.currentTarget.value); }} />
                    </div>
                    <div>
                      <label className="label">Current Mileage</label>
                      <input className="input" name="current_mileage" inputMode="numeric" pattern="[0-9]*" required />
                    </div>
                    <details className="md:col-span-2 rounded-lg border border-slate-100 bg-white p-3">
                      <summary className="cursor-pointer text-sm font-medium">Ek Araç Bilgileri</summary>
                      <div className="mt-3">
                        <label className="label">VIN</label>
                        <input className="input" name="vin" />
                      </div>
                    </details>
                    {quickMessage?.type === "ok" && (
                      <div className="md:col-span-2 flex flex-wrap gap-2">
                        <a className="btn-ghost" href={`/maintenance/reminders${quickCreatedVehicleId ? `?vehicleId=${quickCreatedVehicleId}` : ""}`}>
                          Bakım Hatırlatıcısı Ekle
                        </a>
                        <button type="button" className="btn-ghost" onClick={() => setShowQuickCreate(false)}>
                          Şimdilik Geç
                        </button>
                      </div>
                    )}
                    <div className="md:col-span-2">
                      <button className="btn-primary" type="submit" disabled={isQuickPending}>
                        {isQuickPending ? "Kaydediliyor..." : "Yeni Unit Kaydet"}
                      </button>
                    </div>
                  </form>
                </section>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
