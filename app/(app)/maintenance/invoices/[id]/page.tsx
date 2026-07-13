import Link from "next/link";
import MaintenanceInvoiceReview from "@/components/MaintenanceInvoiceReview";
import MaintenanceNav from "@/components/MaintenanceNav";
import { serviceKey, type ReviewDraftData, type VehicleOption } from "@/lib/maintenance-invoice-review";
import { createClient } from "@/lib/supabase/server";

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
      .select("id, status, file_hash, file_name, parsed_data")
      .eq("id", id)
      .single(),
    supabase
      .from("vehicles")
      .select("id, unit_number, current_mileage")
      .eq("status", "active")
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

      <MaintenanceInvoiceReview
        invoice={invoiceRes.data as {
          id: string;
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
