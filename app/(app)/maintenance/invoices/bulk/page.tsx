import BulkMaintenanceInvoiceReview from "@/components/BulkMaintenanceInvoiceReview";
import MaintenanceNav from "@/components/MaintenanceNav";
import { groupBulkInvoices, serviceKey, type BaselineEvent, type BulkInvoiceDraft, type ExistingVehicleForBulk } from "@/lib/maintenance-bulk-import";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function BulkMaintenanceInvoiceReviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const rawIds = String(Array.isArray(params.ids) ? params.ids[0] : params.ids ?? "");
  const ids = rawIds.split(",").map((id) => id.trim()).filter(Boolean);
  const supabase = await createClient();

  const [invoicesRes, vehiclesRes, mileageHistoryRes, rulesRes] = await Promise.all([
    ids.length
      ? supabase
          .from("maintenance_invoices")
          .select("id, file_name, file_hash, invoice_date, shop_name, vehicle_id, parsed_data")
          .in("id", ids)
          .eq("status", "pending_review")
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("vehicles")
      .select("id, unit_number, vin, current_mileage")
      .eq("status", "active")
      .order("unit_number"),
    supabase
      .from("maintenance_records")
      .select("vehicle_id, mileage")
      .not("invoice_id", "is", null)
      .not("mileage", "is", null),
    supabase
      .from("maintenance_rules")
      .select("vehicle_id, service_type, last_done_date, last_done_mileage")
      .eq("active", true),
  ]);

  const error = invoicesRes.error ?? vehiclesRes.error ?? mileageHistoryRes.error ?? rulesRes.error;
  if (error) throw new Error(`Toplu invoice inceleme yüklenemedi: ${error.message}`);

  const invoices = (invoicesRes.data ?? []) as unknown as BulkInvoiceDraft[];
  const priorByVehicle = new Map<string, number[]>();
  for (const row of (mileageHistoryRes.data ?? []) as Array<{ vehicle_id: string; mileage: number | null }>) {
    if (row.mileage == null) continue;
    priorByVehicle.set(row.vehicle_id, [...(priorByVehicle.get(row.vehicle_id) ?? []), Number(row.mileage)]);
  }
  const baselinesByVehicle = new Map<string, BaselineEvent[]>();
  for (const row of (rulesRes.data ?? []) as Array<{ vehicle_id: string; service_type: string; last_done_date: string | null; last_done_mileage: number | null }>) {
    baselinesByVehicle.set(row.vehicle_id, [
      ...(baselinesByVehicle.get(row.vehicle_id) ?? []),
      {
        service_key: serviceKey(row.service_type),
        service_type: row.service_type,
        date: row.last_done_date,
        mileage: row.last_done_mileage == null ? null : Number(row.last_done_mileage),
      },
    ]);
  }
  const vehicles = ((vehiclesRes.data ?? []) as unknown as ExistingVehicleForBulk[]).map((vehicle) => ({
    ...vehicle,
    prior_completed_invoice_mileages: priorByVehicle.get(vehicle.id) ?? [],
    existing_baselines: baselinesByVehicle.get(vehicle.id) ?? [],
  }));
  const groups = groupBulkInvoices(invoices, vehicles);

  return (
    <div className="space-y-5">
      <MaintenanceNav title="Bakım Merkezi" />
      <div>
        <h1 className="text-xl font-bold">Toplu Geçmiş Invoice İnceleme</h1>
        <p className="mt-1 text-sm text-slate-500">
          Unit bazında gruplanan invoice kayıtlarını kontrol edin, sonra tek onayla işleyin.
        </p>
      </div>
      {ids.length === 0 || invoices.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-500">
          İnceleme için pending invoice seçilmedi.
        </div>
      ) : (
        <BulkMaintenanceInvoiceReview groups={groups} vehicles={vehicles} />
      )}
    </div>
  );
}
