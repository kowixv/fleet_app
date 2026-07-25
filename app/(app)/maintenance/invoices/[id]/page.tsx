import Link from "next/link";
import MaintenanceInvoiceReview from "@/components/MaintenanceInvoiceReview";
import MaintenanceNav from "@/components/MaintenanceNav";
import { serviceKey, type ReviewDraftData, type VehicleOption } from "@/lib/maintenance-invoice-review";
import { createClient } from "@/lib/supabase/server";
import { maintenanceVisibleVehicleStatuses } from "@/lib/maintenance-vehicle-status";
import { createMaintenanceWorkOrder } from "@/app/(app)/maintenance/work-orders/actions";

export const dynamic = "force-dynamic";

function intervalSummary(rule: {
  interval_miles: number | null;
  interval_days: number | null;
  interval_engine_hours: number | null;
}) {
  const parts = [
    rule.interval_miles == null ? null : `${Number(rule.interval_miles).toLocaleString("en-US")} mi`,
    rule.interval_days == null ? null : `${rule.interval_days} gün`,
    rule.interval_engine_hours == null ? null : `${Number(rule.interval_engine_hours).toLocaleString("en-US")} engine saat`,
  ].filter(Boolean);
  return parts.join(" veya ") || "Aktif plan";
}

export default async function MaintenanceInvoiceReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const [invoiceRes, vehiclesRes, rulesRes, settingsRes] = await Promise.all([
    supabase
      .from("maintenance_invoices")
      .select("id, vehicle_id, status, file_hash, file_name, parsed_data")
      .eq("id", id)
      .single(),
    supabase
      .from("vehicles")
      .select("id, unit_number, current_mileage")
      .in("status", maintenanceVisibleVehicleStatuses())
      .order("unit_number"),
    supabase
      .from("maintenance_rules")
      .select("id, vehicle_id, service_type, interval_type, interval_miles, interval_days, interval_engine_hours, last_done_mileage, last_done_date, last_done_engine_hours")
      .eq("active", true),
    supabase
      .from("settings")
      .select("maintenance_invoice_allocation_tolerance")
      .single(),
  ]);

  const error = invoiceRes.error ?? vehiclesRes.error ?? rulesRes.error ?? settingsRes.error;
  if (error) throw new Error(`Invoice inceleme ekranı yüklenemedi: ${error.message}`);
  if (!invoiceRes.data) throw new Error("Invoice bulunamadı.");

  const existingRules = (rulesRes.data ?? []).map((rule) => ({
    vehicle_id: rule.vehicle_id as string,
    service_key: serviceKey(rule.service_type as string),
    id: rule.id as string,
    summary: intervalSummary(rule as any),
  }));

  return (
    <div className="space-y-5">
      <MaintenanceNav title="Bakım Merkezi" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Maintenance Invoice İnceleme</h1>
          <p className="mt-1 text-sm text-slate-500">{invoiceRes.data.file_name}</p>
        </div>
        <div className="flex gap-3 text-sm">
          <Link className="text-brand hover:underline" href={`/api/maintenance/invoices/${id}`} target="_blank">PDF aç</Link>
          <Link className="text-brand hover:underline" href="/maintenance/invoices">Inbox'a dön</Link>
        </div>
      </div>

      <details className="rounded-lg border border-slate-200 bg-white">
        <summary className="cursor-pointer px-4 py-3 font-semibold">Invoice review’den work order oluştur</summary>
        <form action={createMaintenanceWorkOrder} className="grid gap-3 border-t border-slate-100 p-4 md:grid-cols-3">
          <input type="hidden" name="source_type" value="invoice_review" />
          <input type="hidden" name="source_id" value={id} />
          <input type="hidden" name="priority" value="normal" />
          <input type="hidden" name="title" value={`${invoiceRes.data.file_name} invoice review`} />
          <label className="text-sm"><span className="label">Unit</span><select className="input" name="vehicle_id" defaultValue={invoiceRes.data.vehicle_id ?? ""} required><option value="">Seçin</option>{(vehiclesRes.data ?? []).map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.unit_number}</option>)}</select></label>
          <label className="text-sm md:col-span-2"><span className="label">Açıklama</span><input className="input" name="complaint" defaultValue={`Invoice incelemesi: ${invoiceRes.data.file_name}`} /></label>
          <div className="md:col-span-3"><button className="btn-primary">Work order oluştur</button></div>
        </form>
      </details>

      <MaintenanceInvoiceReview
        invoice={invoiceRes.data as {
          id: string;
          vehicle_id: string | null;
          status: string;
          file_hash: string;
          file_name: string;
          parsed_data: { review?: ReviewDraftData } | null;
        }}
        vehicles={(vehiclesRes.data ?? []) as VehicleOption[]}
        existingRules={existingRules}
        allocationToleranceDefault={Number(settingsRes.data?.maintenance_invoice_allocation_tolerance ?? 1)}
      />
    </div>
  );
}
