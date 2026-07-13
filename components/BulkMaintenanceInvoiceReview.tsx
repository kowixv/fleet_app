"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import { finalizeBulkMaintenanceInvoiceUnit } from "@/app/(app)/maintenance/invoice-actions";
import type { BulkUnitGroup, ExistingVehicleForBulk } from "@/lib/maintenance-bulk-import";

export default function BulkMaintenanceInvoiceReview({
  groups,
  vehicles,
}: {
  groups: BulkUnitGroup[];
  vehicles: ExistingVehicleForBulk[];
}) {
  const [drafts, setDrafts] = useState(() =>
    groups.map((group) => ({
      key: group.group_key,
      unit: group.canonical_unit_number ?? "",
      vehicleId: group.vehicle?.id ?? "",
      vin: group.vin ?? "",
      autoCreate: group.status !== "existing_vehicle",
      applyTemplate: true,
      proposedMileage: group.proposed_current_mileage == null ? "" : String(group.proposed_current_mileage),
      excludedInvoices: new Set<string>(),
      excludedServices: new Set<string>(),
    })),
  );
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [summary, setSummary] = useState<unknown[]>([]);
  const [pending, startTransition] = useTransition();

  const editableGroups = useMemo(
    () => groups.map((group) => ({ group, draft: drafts.find((draft) => draft.key === group.group_key)! })),
    [groups, drafts],
  );

  function patch(key: string, update: Partial<(typeof drafts)[number]>) {
    setDrafts((current) => current.map((draft) => draft.key === key ? { ...draft, ...update } : draft));
  }

  function toggleSet(key: string, field: "excludedInvoices" | "excludedServices", value: string) {
    setDrafts((current) => current.map((draft) => {
      if (draft.key !== key) return draft;
      const next = new Set(draft[field]);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return { ...draft, [field]: next };
    }));
  }

  function confirmAll() {
    startTransition(async () => {
      const batchId = crypto.randomUUID();
      const results: unknown[] = [];
      for (const { group, draft } of editableGroups) {
        if (group.status === "blocked") {
          results.push({ unit: draft.unit, ok: false, error: "Blokajlı grup düzeltilmeden işlenmedi." });
          continue;
        }
        const records = group.services
          .filter((service) => !draft.excludedServices.has(`${service.invoice_id}:${service.row.id}`))
          .filter((service) => !draft.excludedInvoices.has(service.invoice_id))
          .map((service) => ({
            invoice_id: service.invoice_id,
            service_type: service.row.service_type,
            parts_used: service.row.parts_used,
            performed_date: service.performed_date,
            mileage: service.mileage,
            cost: service.row.cost,
            shop_name: group.invoices.find((invoice) => invoice.id === service.invoice_id)?.shop_name ?? null,
            notes: service.row.notes,
            category: service.row.category,
            planned: service.row.planned,
            parts_cost: service.row.parts_cost,
            labor_cost: service.row.labor_cost,
            shop_fees: service.row.shop_fees,
            tax_cost: service.row.tax_cost,
            towing_cost: service.row.towing_cost,
            road_service_cost: service.row.road_service_cost,
            hotel_travel_cost: service.row.hotel_travel_cost,
            other_cost: service.row.other_cost,
            warranty_recovery: service.row.warranty_recovery,
            total_cost: service.row.total_cost,
            status: service.row.status,
          }));
        const baselines = group.mapped_baselines.map((baseline) => ({
          service_type: baseline.service_type,
          last_done_date: baseline.date,
          last_done_mileage: baseline.mileage,
          invoice_id: baseline.invoice_id,
        }));
        const result = await finalizeBulkMaintenanceInvoiceUnit({
          batch_id: batchId,
          canonical_unit_number: draft.unit,
          vehicle_id: draft.vehicleId || null,
          vin: draft.vin || null,
          auto_create_vehicle: draft.autoCreate,
          apply_template: draft.applyTemplate,
          proposed_current_mileage: draft.proposedMileage === "" ? null : Number(draft.proposedMileage),
          invoice_ids: group.invoices.filter((invoice) => !draft.excludedInvoices.has(invoice.id)).map((invoice) => invoice.id),
          records,
          baselines,
        });
        results.push({ unit: draft.unit, ...result });
      }
      setSummary(results);
      setMessage({ type: results.some((result: any) => !result.ok) ? "error" : "ok", text: "Toplu import işlemi tamamlandı." });
    });
  }

  return (
    <div className="space-y-4">
      {message && (
        <p className={`rounded-lg border px-3 py-2 text-sm ${message.type === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700"}`}>
          {message.text}
        </p>
      )}
      {editableGroups.map(({ group, draft }) => (
        <section key={group.group_key} className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Unit {draft.unit || "Düzeltme gerekli"}</h2>
              <p className="mt-1 text-sm text-slate-500">
                {group.invoices.length} invoice · {group.services.length} bakım geçmişi · {group.mapped_baselines.length} plan baseline
              </p>
            </div>
            <span className={`badge ${group.status === "blocked" ? "bg-red-100 text-red-700" : group.status === "new_vehicle" ? "bg-amber-100 text-amber-700" : "bg-green-100 text-green-700"}`}>
              {group.status === "blocked" ? "Düzeltme gerekli" : group.status === "new_vehicle" ? "New vehicle" : "Existing"}
            </span>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-4">
            <Field label="Canonical unit">
              <input className="input" value={draft.unit} onChange={(event) => patch(group.group_key, { unit: event.target.value.toUpperCase() })} />
            </Field>
            <Field label="Mevcut araç seç">
              <select className="input" value={draft.vehicleId} onChange={(event) => patch(group.group_key, { vehicleId: event.target.value, autoCreate: !event.target.value })}>
                <option value="">Yeni araç / otomatik eşleştir</option>
                {vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.unit_number}</option>)}
              </select>
            </Field>
            <Field label="VIN">
              <input className="input" value={draft.vin} onChange={(event) => patch(group.group_key, { vin: event.target.value.toUpperCase() })} />
            </Field>
            <Field label="Proposed mileage">
              <input className="input" type="number" step="1" value={draft.proposedMileage} onChange={(event) => patch(group.group_key, { proposedMileage: event.target.value })} />
            </Field>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-4">
            <Stat label="DB mileage" value={group.vehicle?.current_mileage == null ? "-" : group.vehicle.current_mileage.toLocaleString("en-US")} />
            <Stat label="Highest invoice mileage" value={group.highest_invoice_mileage == null ? "-" : group.highest_invoice_mileage.toLocaleString("en-US")} />
            <Stat label="Template" value={draft.applyTemplate ? "Uygulanacak" : "Kapalı"} />
            <Stat label="History only" value={String(group.unmapped_services.length)} />
          </div>

          <div className="mt-4 flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" className="h-4 w-4 accent-brand" checked={draft.autoCreate} onChange={(event) => patch(group.group_key, { autoCreate: event.target.checked })} />
              Eksik aracı oluştur
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" className="h-4 w-4 accent-brand" checked={draft.applyTemplate} onChange={(event) => patch(group.group_key, { applyTemplate: event.target.checked })} />
              Peterbilt 579 + X15 template uygula
            </label>
          </div>

          {[...group.conflicts, ...group.warnings].length > 0 && (
            <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              {[...group.conflicts, ...group.warnings].map((warning) => <p key={warning}>{warning}</p>)}
            </div>
          )}

          <details className="mt-4 text-sm">
            <summary className="cursor-pointer text-brand">Invoice ve servis detayları</summary>
            <div className="mt-3 space-y-3">
              {group.invoices.map((invoice) => (
                <label key={invoice.id} className="flex items-center gap-2">
                  <input type="checkbox" className="h-4 w-4 accent-brand" checked={!draft.excludedInvoices.has(invoice.id)} onChange={() => toggleSet(group.group_key, "excludedInvoices", invoice.id)} />
                  {invoice.file_name} · {invoice.invoice_date ?? "-"}
                </label>
              ))}
              <div className="space-y-2">
                {group.services.map((service) => (
                  <label key={`${service.invoice_id}:${service.row.id}`} className="flex items-center gap-2 rounded-md border border-slate-100 p-2">
                    <input type="checkbox" className="h-4 w-4 accent-brand" checked={!draft.excludedServices.has(`${service.invoice_id}:${service.row.id}`)} onChange={() => toggleSet(group.group_key, "excludedServices", `${service.invoice_id}:${service.row.id}`)} />
                    <span>{service.service_type} · {service.performed_date ?? "-"} · {service.mileage?.toLocaleString("en-US") ?? "-"}</span>
                  </label>
                ))}
              </div>
            </div>
          </details>
        </section>
      ))}

      <div className="sticky bottom-3 rounded-lg border border-slate-200 bg-white p-4 shadow-lg">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-600">Her unit ayrı transaction ile işlenir; bir unit hata verirse diğerleri devam eder.</p>
          <button type="button" className="btn-primary" disabled={pending || groups.length === 0} onClick={confirmAll}>
            {pending ? "İşleniyor..." : "Onayla ve Tümünü İşle"}
          </button>
        </div>
        {summary.length > 0 && (
          <pre className="mt-3 max-h-60 overflow-auto rounded bg-slate-950 p-3 text-xs text-white">{JSON.stringify(summary, null, 2)}</pre>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label>
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="font-semibold">{value}</p>
    </div>
  );
}
