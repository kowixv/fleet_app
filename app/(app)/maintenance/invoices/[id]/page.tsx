import Link from "next/link";
import MaintenanceInvoiceReview from "@/components/MaintenanceInvoiceReview";
import { createClient } from "@/lib/supabase/server";
import { serviceKey, type ReviewDraftData, type VehicleOption } from "@/lib/maintenance-invoice-review";

export const dynamic = "force-dynamic";

export default async function MaintenanceInvoiceReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const [invoiceRes, vehiclesRes, rulesRes] = await Promise.all([
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
      .select("id, vehicle_id, service_type, interval_type, interval_miles, interval_days, last_done_mileage, last_done_date")
      .eq("active", true),
  ]);

  const error = invoiceRes.error ?? vehiclesRes.error ?? rulesRes.error;
  if (error) throw new Error(`Invoice review yüklenemedi: ${error.message}`);
  if (!invoiceRes.data) throw new Error("Invoice bulunamadı.");

  const existingRules = (rulesRes.data ?? []).map((rule) => ({
    vehicle_id: rule.vehicle_id as string,
    service_key: serviceKey(rule.service_type as string),
    id: rule.id as string,
    summary: rule.interval_type === "mileage"
      ? `${Number(rule.interval_miles ?? 0).toLocaleString("en-US")} mi; last ${Number(rule.last_done_mileage ?? 0).toLocaleString("en-US")}`
      : `${rule.interval_days ?? 0} gün; last ${rule.last_done_date ?? "—"}`,
  }));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Maintenance Invoice Review</h1>
          <p className="mt-1 text-sm text-slate-500">{invoiceRes.data.file_name}</p>
        </div>
        <div className="flex gap-3 text-sm">
          <Link className="text-brand hover:underline" href={`/api/maintenance/invoices/${id}`} target="_blank">PDF Aç</Link>
          <Link className="text-brand hover:underline" href="/maintenance">Inbox</Link>
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
      />
    </div>
  );
}
