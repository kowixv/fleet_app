"use client";

import { deleteManualMaintenanceRecord, editManualMaintenanceRecord } from "@/app/(app)/maintenance/actions";
import { MAINTENANCE_TERMS } from "@/lib/maintenance-terminology";
import { formatMaintenanceCategory } from "@/lib/maintenance-terminology";
import { MAINTENANCE_COST_CATEGORIES } from "@/lib/maintenance-cost";
import { PERIODIC_SERVICE_OPTIONS, REPAIR_SERVICE_OPTIONS, type ManualMaintenanceKind } from "@/lib/manual-maintenance";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

interface EditableRecord {
  id: string;
  source: string | null;
  service_type: string | null;
  planned: boolean | null;
  performed_date: string | null;
  mileage: number | null;
  cost: number | null;
  total_cost: number | null;
  shop_name: string | null;
  invoice_number: string | null;
  notes: string | null;
  parts_used: string[] | null;
  labor_cost: number | null;
  parts_cost: number | null;
  diagnostic_cost: number | null;
  shop_fees: number | null;
  tax_cost: number | null;
  towing_cost: number | null;
  road_service_cost: number | null;
  hotel_travel_cost: number | null;
  freight_shipping_cost: number | null;
  core_charge_cost: number | null;
  environmental_fee_cost: number | null;
  machine_shop_cost: number | null;
  sublet_cost: number | null;
  other_cost: number | null;
  warranty_recovery: number | null;
  refund_credit: number | null;
  downtime_start: string | null;
  downtime_end: string | null;
  category: string | null;
  cause: string | null;
  breakdown_occurred: boolean | null;
  vehicles?: { unit_number: string | null } | null;
}

const MONEY_FIELDS = [
  ["parts_cost", "Parts"],
  ["labor_cost", "Labor"],
  ["diagnostic_cost", "Diagnostic"],
  ["shop_fees", "Shop fees"],
  ["tax_cost", "Tax"],
  ["towing_cost", "Towing"],
  ["road_service_cost", "Road service"],
  ["hotel_travel_cost", "Hotel / travel"],
  ["freight_shipping_cost", "Freight / shipping"],
  ["core_charge_cost", "Core charge"],
  ["environmental_fee_cost", "Environmental fee"],
  ["machine_shop_cost", "Machine shop"],
  ["sublet_cost", "Sublet"],
  ["other_cost", "Other"],
  ["warranty_recovery", "Warranty recovery"],
  ["refund_credit", "Refund / credit"],
] as const;

const CAUSE_OPTIONS = [
  ["", "Belirtilmedi"],
  ["normal_wear", "Normal aşınma"],
  ["component_failure", "Parça arızası"],
  ["road_hazard", "Yol hasarı"],
  ["driver_damage", "Sürücü hasarı"],
  ["accident_collision", "Kaza / çarpışma"],
  ["previous_repair_failure", "Önceki onarım hatası"],
  ["unknown", "Bilinmiyor"],
] as const;

function dateTimeLocal(value: string | null | undefined): string {
  return value ? value.slice(0, 16) : "";
}

function formatMiles(value: number | null | undefined) {
  return value == null ? "-" : `${Number(value).toLocaleString("en-US")} mil`;
}

function formatMoney(value: number | null | undefined) {
  return value == null ? "-" : `$${Number(value).toFixed(2)}`;
}

function nextDueText(rule: any | null | undefined) {
  if (!rule) return null;
  const parts = [
    rule.nextDueMileage == null ? null : formatMiles(rule.nextDueMileage),
    rule.nextDueDate ?? null,
    rule.nextDueEngineHours == null ? null : `${Number(rule.nextDueEngineHours).toLocaleString("en-US")} engine hours`,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" veya ") : null;
}

export default function MaintenanceHistoryActions({ row }: { row: EditableRecord }) {
  const router = useRouter();
  const currentKind: ManualMaintenanceKind = row.planned === false ? "repair" : "periodic";
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [actionSummary, setActionSummary] = useState<any | null>(null);
  const [showDelete, setShowDelete] = useState(false);
  const [editKind, setEditKind] = useState<ManualMaintenanceKind>(currentKind);
  const [editService, setEditService] = useState(row.service_type ?? (currentKind === "periodic" ? PERIODIC_SERVICE_OPTIONS[0].value : REPAIR_SERVICE_OPTIONS[0].value));
  const [kindChangeConfirmed, setKindChangeConfirmed] = useState(false);
  const [isDeleting, startDeleteTransition] = useTransition();
  const [isEditing, startEditTransition] = useTransition();
  const canModify = row.source === "manual_maintenance";
  const serviceOptions = editKind === "periodic" ? PERIODIC_SERVICE_OPTIONS : REPAIR_SERVICE_OPTIONS;
  const kindChanged = editKind !== currentKind;
  const deleteCost = row.total_cost ?? row.cost ?? null;

  useEffect(() => {
    if (!serviceOptions.some((option) => option.value === editService)) {
      setEditService(serviceOptions[0]?.value ?? "");
    }
  }, [editService, serviceOptions]);

  if (!canModify) return <span className="text-xs text-slate-400">Arşiv</span>;

  function edit(formData: FormData) {
    setMessage(null);
    setActionSummary(null);
    if (kindChanged && !kindChangeConfirmed) {
      setMessage({ type: "error", text: "Periyodik bakım ile tamir/ariza arasında değişiklik için onay kutusunu işaretleyin." });
      return;
    }
    formData.set("entry_kind", editKind);
    formData.set("service_type", editService);
    startEditTransition(async () => {
      const result = await editManualMaintenanceRecord(formData);
      if (!result.ok) {
        setMessage({ type: "error", text: result.error });
        return;
      }
      setActionSummary({ type: "edit", ...result.summary });
      router.refresh();
    });
  }

  function remove() {
    setMessage(null);
    setActionSummary(null);
    startDeleteTransition(async () => {
      const result = await deleteManualMaintenanceRecord(row.id);
      if (!result.ok) {
        setMessage({ type: "error", text: result.error });
        return;
      }
      setActionSummary({ type: "delete", ...result.summary });
      setShowDelete(false);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <details className="rounded-lg border border-slate-200 bg-slate-50">
        <summary className="cursor-pointer px-3 py-2 font-medium">Düzenle</summary>
        <form action={edit} className="grid gap-3 border-t border-slate-200 p-3 md:grid-cols-2">
          <input type="hidden" name="record_id" value={row.id} />
          <div>
            <label className="label">İşlem Türü</label>
            <select
              className="input"
              value={editKind}
              onChange={(event) => {
                const nextKind = event.target.value as ManualMaintenanceKind;
                setEditKind(nextKind);
                setKindChangeConfirmed(false);
                setEditService((nextKind === "periodic" ? PERIODIC_SERVICE_OPTIONS : REPAIR_SERVICE_OPTIONS)[0].value);
              }}
            >
              <option value="periodic">{MAINTENANCE_TERMS.periodicMaintenance}</option>
              <option value="repair">{MAINTENANCE_TERMS.repair}</option>
            </select>
          </div>
          <div>
            <label className="label">{MAINTENANCE_TERMS.serviceType}</label>
            <input className="input" list={`history-service-options-${row.id}`} required value={editService} onChange={(event) => setEditService(event.target.value)} />
            <datalist id={`history-service-options-${row.id}`}>
              {serviceOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </datalist>
          </div>
          {kindChanged && (
            <label className="md:col-span-2 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <input type="checkbox" checked={kindChangeConfirmed} onChange={(event) => setKindChangeConfirmed(event.target.checked)} />
              <span>Bu değişiklik bakım planı hesabını yeniden değerlendirebilir. Yalnızca ilgili bakım planı güncellenir; ilgisiz planlar değiştirilmez.</span>
            </label>
          )}
          <div>
            <label className="label">Tarih</label>
            <input className="input" name="performed_date" type="date" required defaultValue={row.performed_date ?? ""} />
          </div>
          <div>
            <label className="label">Mileage</label>
            <input className="input" name="mileage" inputMode="numeric" pattern="[0-9]*" required defaultValue={row.mileage ?? ""} />
          </div>
          <div>
            <label className="label">Maliyet</label>
            <input className="input" name="cost" type="number" min="0" step="0.01" defaultValue={row.total_cost ?? row.cost ?? ""} />
          </div>
          <div>
            <label className="label">Plan durumu</label>
            <select className="input" name="planned" defaultValue={row.planned === false ? "unplanned" : "planned"}>
              <option value="planned">Planlı</option>
              <option value="unplanned">Plansız</option>
            </select>
          </div>
          <div>
            <label className="label">Shop</label>
            <input className="input" name="shop_name" defaultValue={row.shop_name ?? ""} />
          </div>
          <div>
            <label className="label">Invoice / RO No</label>
            <input className="input" name="invoice_number" defaultValue={row.invoice_number ?? ""} />
          </div>
          <div>
            <label className="label">Parts</label>
            <input className="input" name="parts_used" defaultValue={row.parts_used?.join(", ") ?? ""} />
          </div>
          {MONEY_FIELDS.map(([name, label]) => (
            <div key={name}>
              <label className="label">{label}</label>
              <input className="input" name={name} type="number" min="0" step="0.01" defaultValue={row[name] ?? ""} />
            </div>
          ))}
          <div>
            <label className="label">Downtime başlangıç</label>
            <input className="input" name="downtime_start" type="datetime-local" defaultValue={dateTimeLocal(row.downtime_start)} />
          </div>
          <div>
            <label className="label">Downtime bitiş</label>
            <input className="input" name="downtime_end" type="datetime-local" defaultValue={dateTimeLocal(row.downtime_end)} />
          </div>
          <div>
            <label className="label">Kategori</label>
            <select className="input" name="category" defaultValue={row.category ?? "other"}>
              {MAINTENANCE_COST_CATEGORIES.map((category) => (
                <option key={category} value={category}>{formatMaintenanceCategory(category)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Neden</label>
            <select className="input" name="cause" defaultValue={row.cause ?? ""}>
              {CAUSE_OPTIONS.map(([value, label]) => <option key={value || "none"} value={value}>{label}</option>)}
            </select>
          </div>
          <label className="md:col-span-2 flex items-center gap-2 text-sm">
            <input type="checkbox" name="breakdown_occurred" defaultChecked={Boolean(row.breakdown_occurred)} className="h-4 w-4 accent-brand" />
            Breakdown oluştu
          </label>
          <div className="md:col-span-2">
            <label className="label">Notes</label>
            <textarea className="input min-h-20" name="notes" defaultValue={row.notes ?? ""} />
          </div>
          <div className="md:col-span-2">
            <button type="submit" className="btn-primary" disabled={isEditing}>
              {isEditing ? "Kaydediliyor..." : "Güncelle"}
            </button>
          </div>
        </form>
      </details>

      {!showDelete ? (
        <button type="button" className="btn-ghost text-red-700" onClick={() => setShowDelete(true)}>
          Sil
        </button>
      ) : (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
          <p className="font-semibold">Bu bakım kaydı silinecek.</p>
          <p className="mt-1">
            Sistem kalan bakım geçmişine göre son yapılan bakım ve sonraki bakım tarihini yeniden hesaplayacak. Güncel araç mileage'ı otomatik olarak düşürülmeyecek.
          </p>
          <dl className="mt-3 grid gap-2 sm:grid-cols-2">
            <div><dt className="font-medium">Unit</dt><dd>{row.vehicles?.unit_number ?? "-"}</dd></div>
            <div><dt className="font-medium">Service</dt><dd>{row.service_type ?? "-"}</dd></div>
            <div><dt className="font-medium">Date</dt><dd>{row.performed_date ?? "-"}</dd></div>
            <div><dt className="font-medium">Mileage</dt><dd>{formatMiles(row.mileage)}</dd></div>
            <div><dt className="font-medium">Cost</dt><dd>{formatMoney(deleteCost)}</dd></div>
          </dl>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="btn-ghost" onClick={() => setShowDelete(false)}>Vazgeç</button>
            <button type="button" className="btn-primary bg-red-700 hover:bg-red-800" disabled={isDeleting} onClick={remove}>
              {isDeleting ? "Siliniyor..." : "Sil ve Yeniden Hesapla"}
            </button>
          </div>
        </div>
      )}

      {actionSummary && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          <p className="font-semibold">{actionSummary.type === "delete" ? "Kayıt silindi" : "Kayıt güncellendi"}</p>
          {actionSummary.type === "delete" ? (
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Current mileage korundu.</li>
              <li>{actionSummary.planRecalculated ? "Bakım planı kalan geçmişe göre yeniden hesaplandı." : "Bakım planı değişmedi."}</li>
              {nextDueText(actionSummary.rule) && <li>Yeni sonraki bakım: {nextDueText(actionSummary.rule)}</li>}
            </ul>
          ) : (
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>{actionSummary.previousServiceType} {"->"} {actionSummary.serviceType}</li>
              <li>Current mileage korunur veya yalnızca daha yüksekse güncellenir.</li>
              <li>{actionSummary.planRecalculated ? "İlgili bakım planı yeniden hesaplandı." : "Bakım planı değişmedi."}</li>
              {nextDueText(actionSummary.rule) && <li>Sonraki bakım: {nextDueText(actionSummary.rule)}</li>}
            </ul>
          )}
        </div>
      )}

      {message && (
        <p className={`text-xs ${message.type === "ok" ? "text-emerald-700" : "text-red-700"}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
