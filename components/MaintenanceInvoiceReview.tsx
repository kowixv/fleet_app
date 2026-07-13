"use client";

import { useMemo, useState, useTransition } from "react";
import {
  buildFinalImportRecords,
  deleteServiceRow,
  mergeServiceRows,
  mileageWarnings,
  type ReviewDraftData,
  type ReviewServiceRow,
  type VehicleOption,
} from "@/lib/maintenance-invoice-review";
import { finalizeMaintenanceInvoiceReview, cancelMaintenanceInvoiceReview, undoMaintenanceInvoiceImport } from "@/app/(app)/maintenance/invoice-actions";

interface ExistingRule {
  vehicle_id: string;
  service_key: string;
  id: string;
  summary: string;
}

export default function MaintenanceInvoiceReview({
  invoice,
  vehicles,
  existingRules,
}: {
  invoice: {
    id: string;
    status: string;
    file_hash: string;
    file_name: string;
    parsed_data: { review?: ReviewDraftData } | null;
  };
  vehicles: VehicleOption[];
  existingRules: ExistingRule[];
}) {
  const review = invoice.parsed_data?.review;
  const [vehicleId, setVehicleId] = useState(review?.suggested_vehicle_id ?? vehicles[0]?.id ?? "");
  const [vendor, setVendor] = useState(review?.vendor ?? "");
  const [invoiceDate, setInvoiceDate] = useState(review?.invoice_date ?? "");
  const [invoiceMileage, setInvoiceMileage] = useState(review?.mileage == null ? "" : String(review.mileage));
  const [rows, setRows] = useState<ReviewServiceRow[]>(review?.services ?? []);
  const [preview, setPreview] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const vehicle = vehicles.find((item) => item.id === vehicleId) ?? null;
  const warnings = useMemo(
    () => mileageWarnings({
      currentMileage: vehicle?.current_mileage ?? null,
      invoiceMileage: invoiceMileage === "" ? null : Number(invoiceMileage),
    }),
    [vehicle?.current_mileage, invoiceMileage],
  );
  const finalRecords = useMemo(() => buildFinalImportRecords({
    rows,
    vehicleId,
    vehicleCurrentMileage: vehicle?.current_mileage ?? null,
    invoiceMileage: invoiceMileage === "" ? null : Number(invoiceMileage),
    vendor: vendor || null,
    invoiceDate: invoiceDate || null,
  }), [rows, vehicleId, vehicle?.current_mileage, invoiceMileage, vendor, invoiceDate]);

  if (!review) return <div className="card text-red-600">Review verisi bulunamadı.</div>;

  function updateRow(id: string, patch: Partial<ReviewServiceRow>) {
    setRows((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row));
  }

  function addRow() {
    const id = `manual-${Date.now()}`;
    setRows((current) => [
      ...current,
      {
        id,
        service_type: "Yeni Servis",
        parts_used: [],
        performed_date: invoiceDate || null,
        mileage: invoiceMileage === "" ? null : Number(invoiceMileage),
        cost: 0,
        shop_name: undefined as never,
        notes: null,
        default_action: "history",
        mode: "history",
        next_due_mileage: null,
        next_due_date: null,
        existing_rule_id: null,
        existing_rule_summary: null,
        existing_rule_decision: null,
      },
    ]);
  }

  function mergeIntoPrevious(id: string) {
    const index = rows.findIndex((row) => row.id === id);
    if (index <= 0) return;
    setRows((current) => mergeServiceRows(current, id, current[index - 1].id));
  }

  function submit() {
    if (!vehicleId) {
      setMessage({ type: "error", text: "Araç seçin." });
      return;
    }
    if (!preview) {
      setPreview(true);
      return;
    }
    startTransition(async () => {
      const result = await finalizeMaintenanceInvoiceReview(invoice.id, {
        vehicle_id: vehicleId,
        invoice_hash: invoice.file_hash,
        vendor: vendor || null,
        invoice_date: invoiceDate || null,
        invoice_mileage: invoiceMileage === "" ? null : Number(invoiceMileage),
        services: rows,
        records: finalRecords,
        create_expense: false,
      });
      setMessage(result.ok ? { type: "ok", text: "Import tamamlandı." } : { type: "error", text: result.error });
      if (result.ok) window.location.href = "/maintenance";
    });
  }

  function cancel() {
    startTransition(async () => {
      const result = await cancelMaintenanceInvoiceReview(invoice.id);
      setMessage(result.ok ? { type: "ok", text: "Taslak iptal edildi." } : { type: "error", text: result.error });
    });
  }

  function undo() {
    startTransition(async () => {
      const result = await undoMaintenanceInvoiceImport(invoice.id);
      setMessage(result.ok ? { type: "ok", text: "Import geri alındı." } : { type: "error", text: result.error });
    });
  }

  return (
    <div className="space-y-5">
      {message && <p className={`rounded-lg border px-3 py-2 text-sm ${message.type === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700"}`}>{message.text}</p>}

      <div className="card grid gap-3 md:grid-cols-5">
        <div>
          <label className="label">Organization</label>
          <input className="input" value={review.organization_id.slice(0, 8)} readOnly />
        </div>
        <div>
          <label className="label">Unit</label>
          <select className="input" value={vehicleId} onChange={(event) => setVehicleId(event.target.value)}>
            <option value="">Seçin</option>
            {vehicles.map((item) => <option key={item.id} value={item.id}>{item.unit_number}</option>)}
          </select>
          <p className="mt-1 text-xs text-slate-500">Current: {vehicle?.current_mileage == null ? "—" : `${Number(vehicle.current_mileage).toLocaleString("en-US")} mi`}</p>
        </div>
        <div>
          <label className="label">Vendor</label>
          <input className="input" value={vendor} onChange={(event) => setVendor(event.target.value)} />
        </div>
        <div>
          <label className="label">Invoice Date</label>
          <input className="input" type="date" value={invoiceDate} onChange={(event) => setInvoiceDate(event.target.value)} />
        </div>
        <div>
          <label className="label">Mileage</label>
          <input className="input" type="number" step="1" value={invoiceMileage} onChange={(event) => setInvoiceMileage(event.target.value)} />
        </div>
      </div>

      <div className="card">
        <div className="flex flex-wrap gap-3 text-sm">
          <span>Invoice: <b>{review.invoice_number ?? "—"}</b></span>
          <span>Total: <b>{review.total == null ? "—" : `$${Number(review.total).toFixed(2)}`}</b></span>
          <span>Confidence: <b>{Math.round(review.parser.confidence * 100)}%</b></span>
          <span>Source: <b>{review.parser.source}</b></span>
        </div>
        {[...review.warnings, ...warnings].length > 0 && (
          <ul className="mt-3 list-disc pl-5 text-sm text-amber-700">
            {[...review.warnings, ...warnings].map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}
          </ul>
        )}
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[1100px]">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th">Service</th>
              <th className="th">Parts</th>
              <th className="th">Mode</th>
              <th className="th">Next</th>
              <th className="th">Date/Mileage/Cost</th>
              <th className="th">Existing Rule</th>
              <th className="th text-right">İşlem</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => {
              const rule = existingRules.find((item) => item.vehicle_id === vehicleId && item.service_key === row.service_type.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim());
              return (
                <tr key={row.id}>
                  <td className="td"><input className="input min-w-44" value={row.service_type} onChange={(event) => updateRow(row.id, { service_type: event.target.value })} /></td>
                  <td className="td"><textarea className="input min-w-52" value={row.parts_used.join("\n")} onChange={(event) => updateRow(row.id, { parts_used: event.target.value.split("\n").map((part) => part.trim()).filter(Boolean) })} /></td>
                  <td className="td">
                    <select className="input" value={row.mode} onChange={(event) => updateRow(row.id, { mode: event.target.value as ReviewServiceRow["mode"], next_due_mileage: null, next_due_date: null })}>
                      <option value="plan">Plan</option>
                      <option value="history">Geçmiş</option>
                      <option value="skip">Atla</option>
                    </select>
                  </td>
                  <td className="td">
                    {row.mode === "plan" ? (
                      <div className="space-y-1">
                        <input className="input w-32" type="number" placeholder="Next mi" value={row.next_due_mileage ?? ""} onChange={(event) => updateRow(row.id, { next_due_mileage: event.target.value ? Number(event.target.value) : null, next_due_date: null })} />
                        <input className="input w-36" type="date" value={row.next_due_date ?? ""} onChange={(event) => updateRow(row.id, { next_due_date: event.target.value || null, next_due_mileage: null })} />
                      </div>
                    ) : <span className="text-slate-400">Gerekmez</span>}
                  </td>
                  <td className="td">
                    <div className="grid gap-1">
                      <input className="input w-36" type="date" value={row.performed_date ?? ""} onChange={(event) => updateRow(row.id, { performed_date: event.target.value || null })} />
                      <input className="input w-32" type="number" placeholder="Mileage" value={row.mileage ?? ""} onChange={(event) => updateRow(row.id, { mileage: event.target.value ? Number(event.target.value) : null })} />
                      <input className="input w-28" type="number" step="0.01" placeholder="Cost" value={row.cost ?? ""} onChange={(event) => updateRow(row.id, { cost: event.target.value ? Number(event.target.value) : null })} />
                      <input className="input w-48" placeholder="Notes" value={row.notes ?? ""} onChange={(event) => updateRow(row.id, { notes: event.target.value || null })} />
                    </div>
                  </td>
                  <td className="td">
                    {rule ? (
                      <div className="space-y-1 text-xs">
                        <p>{rule.summary}</p>
                        <select className="input" value={row.existing_rule_decision ?? "update_existing"} onChange={(event) => updateRow(row.id, { existing_rule_decision: event.target.value as ReviewServiceRow["existing_rule_decision"] })}>
                          <option value="update_existing">Update existing plan</option>
                          <option value="history_only">Keep plan, save history</option>
                          <option value="skip">Skip</option>
                        </select>
                      </div>
                    ) : <span className="text-slate-400">Yok</span>}
                  </td>
                  <td className="td text-right">
                    <button type="button" className="mr-3 text-brand hover:underline" onClick={() => mergeIntoPrevious(row.id)}>Merge</button>
                    <button type="button" className="text-red-600 hover:underline" onClick={() => setRows((current) => deleteServiceRow(current, row.id))}>Sil</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap justify-between gap-3">
        <button type="button" className="btn-ghost" onClick={addRow}>+ Eksik Servis</button>
        <div className="flex gap-2">
          {invoice.status === "completed" ? (
            <button type="button" className="btn-ghost text-red-600" disabled={pending} onClick={undo}>Undo Completed Import</button>
          ) : (
            <button type="button" className="btn-ghost" disabled={pending} onClick={cancel}>Cancel</button>
          )}
          <button type="button" className="btn-primary" disabled={pending || invoice.status !== "pending_review"} onClick={submit}>
            {preview ? "Final Confirm & Save" : "Final Preview"}
          </button>
        </div>
      </div>

      {preview && (
        <div className="card border-brand/30">
          <h2 className="font-semibold">Final Preview</h2>
          <p className="mt-1 text-sm text-slate-500">{finalRecords.length} maintenance record yazılacak. Plan seçilen satırlarda aktif kural oluşturulur/güncellenir.</p>
          <ul className="mt-3 space-y-1 text-sm">
            {finalRecords.map((record, index) => (
              <li key={`${record.service_type}-${index}`}>
                {record.service_type}: {record.resolution === "overwrite" ? "plan" : "geçmiş"} · {record.parts_used.join(", ") || "parts yok"}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
