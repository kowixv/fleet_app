import MaintenanceNav from "@/components/MaintenanceNav";
import {
  createMaintenanceWarrantyClaim,
  transitionMaintenanceWarrantyClaim,
  updateMaintenanceWarrantyClaim,
} from "@/app/(app)/maintenance/decision-actions";
import {
  allowedWarrantyClaimTransitions,
  isWarrantyClaimStatus,
  warrantyClaimStatusLabel,
} from "@/lib/maintenance-decision-support";
import { maintenanceVisibleVehicleStatuses } from "@/lib/maintenance-vehicle-status";
import { shortDate, usd } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

export const dynamic = "force-dynamic";

interface WarrantyClaimRow {
  id: string;
  work_order_id: string | null;
  maintenance_record_id: string | null;
  vehicle_id: string;
  vendor_manufacturer: string;
  claim_number: string | null;
  submitted_date: string | null;
  submitted_amount: number | null;
  approved_amount: number | null;
  received_amount: number | null;
  expected_recovery_date: string | null;
  status: string;
  denial_reason: string | null;
  notes: string | null;
  created_at: string;
}

export default async function MaintenanceWarrantiesPage() {
  const supabase = await createClient();
  const [claimsRes, vehiclesRes, workOrdersRes, recordsRes, eventsRes] = await Promise.all([
    supabase.from("maintenance_warranty_claims").select("*").order("created_at", { ascending: false }),
    supabase.from("vehicles").select("id, unit_number").in("status", maintenanceVisibleVehicleStatuses()).order("unit_number"),
    supabase.from("maintenance_work_orders").select("id, vehicle_id, title, status").order("created_at", { ascending: false }).limit(500),
    supabase.from("maintenance_records").select("id, vehicle_id, service_type, performed_date, shop_name, vendor").order("performed_date", { ascending: false }).limit(500),
    supabase.from("maintenance_warranty_claim_events").select("id, warranty_claim_id, from_status, to_status, notes, created_at").order("created_at", { ascending: false }),
  ]);
  const error = claimsRes.error ?? vehiclesRes.error ?? workOrdersRes.error ?? recordsRes.error ?? eventsRes.error;
  if (error) throw new Error(`Warranty talepleri yüklenemedi: ${error.message}`);
  const claims = (claimsRes.data ?? []) as WarrantyClaimRow[];
  const vehicles = (vehiclesRes.data ?? []) as Array<{ id: string; unit_number: string }>;
  const workOrders = (workOrdersRes.data ?? []) as Array<{ id: string; vehicle_id: string; title: string; status: string }>;
  const records = (recordsRes.data ?? []) as Array<{ id: string; vehicle_id: string; service_type: string | null; performed_date: string | null; shop_name: string | null; vendor: string | null }>;
  const events = (eventsRes.data ?? []) as Array<{ id: string; warranty_claim_id: string; from_status: string | null; to_status: string; notes: string | null; created_at: string }>;
  const unitById = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle.unit_number]));
  const openRecovery = claims.filter((claim) => !["paid", "closed", "denied"].includes(claim.status)).reduce((sum, claim) => sum + Number(claim.approved_amount ?? claim.submitted_amount ?? 0), 0);
  const received = claims.reduce((sum, claim) => sum + Number(claim.received_amount ?? 0), 0);

  return <div className="space-y-5">
    <MaintenanceNav title="Bakım Merkezi" />
    <div><h2 className="text-lg font-semibold">Warranty Claims</h2><p className="text-sm text-slate-500">`warranty_recovery` maliyet alanından ayrı, uçtan uca talep ve tahsilat workflow’u.</p></div>
    <div className="grid gap-3 md:grid-cols-4"><Stat label="Toplam claim" value={String(claims.length)} /><Stat label="Açık recovery" value={usd(openRecovery)} /><Stat label="Tahsil edilen" value={usd(received)} /><Stat label="Geciken recovery" value={String(claims.filter((claim) => claim.expected_recovery_date && claim.expected_recovery_date < new Date().toISOString().slice(0, 10) && !["paid", "closed", "denied"].includes(claim.status)).length)} /></div>

    <details className="rounded-lg border border-slate-200 bg-white" open={claims.length === 0}>
      <summary className="cursor-pointer px-4 py-3 font-semibold">Warranty claim ekle</summary>
      <ClaimForm action={createMaintenanceWarrantyClaim} vehicles={vehicles} workOrders={workOrders} records={records} />
    </details>

    <div className="space-y-3">{claims.map((claim) => {
      if (!isWarrantyClaimStatus(claim.status)) return null;
      const transitions = allowedWarrantyClaimTransitions(claim.status);
      const claimEvents = events.filter((event) => event.warranty_claim_id === claim.id);
      return <details key={claim.id} className="rounded-lg border border-slate-200 bg-white">
        <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-3 p-4">
          <span><strong>{claim.vendor_manufacturer}</strong> · Unit {unitById.get(claim.vehicle_id) ?? "—"}<span className="ml-2 text-sm text-slate-500">{claim.claim_number ?? "Claim # yok"}</span></span>
          <span className="flex items-center gap-3"><span className="badge bg-slate-100 text-slate-700">{warrantyClaimStatusLabel(claim.status)}</span><strong>{usd(claim.received_amount ?? claim.approved_amount ?? claim.submitted_amount ?? 0)}</strong></span>
        </summary>
        <div className="space-y-4 border-t border-slate-100 p-4">
          <div className="flex flex-wrap gap-2">{transitions.map((next) => <form key={next} action={transitionMaintenanceWarrantyClaim.bind(null, claim.id)}><input type="hidden" name="to_status" value={next} /><button className={next === "denied" || next === "closed" ? "btn-ghost" : "btn-primary"}>{warrantyClaimStatusLabel(next)}</button></form>)}</div>
          <ClaimForm action={updateMaintenanceWarrantyClaim.bind(null, claim.id)} vehicles={vehicles} workOrders={workOrders} records={records} claim={claim} />
          <div className="grid gap-3 md:grid-cols-2">
            <div><h4 className="text-sm font-semibold">Kaynak</h4><p className="mt-1 text-sm text-slate-600">{claim.work_order_id ? <Link className="text-brand hover:underline" href={`/maintenance/work-orders/${claim.work_order_id}`}>Bağlı work order</Link> : "Work order yok"} · {claim.maintenance_record_id ? "Bakım kaydı bağlı" : "Bakım kaydı yok"}</p></div>
            <div><h4 className="text-sm font-semibold">Immutable geçmiş</h4><div className="mt-1 space-y-1">{claimEvents.map((event) => <p key={event.id} className="text-xs text-slate-600">{shortDate(event.created_at)} · {event.from_status ? `${event.from_status} → ` : ""}{event.to_status}{event.notes ? ` · ${event.notes}` : ""}</p>)}</div></div>
          </div>
        </div>
      </details>;
    })}</div>
    {claims.length === 0 && <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">Warranty claim yok.</div>}
  </div>;
}

function ClaimForm({
  action,
  vehicles,
  workOrders,
  records,
  claim,
}: {
  action: (formData: FormData) => Promise<void>;
  vehicles: Array<{ id: string; unit_number: string }>;
  workOrders: Array<{ id: string; vehicle_id: string; title: string; status: string }>;
  records: Array<{ id: string; vehicle_id: string; service_type: string | null; performed_date: string | null; shop_name: string | null; vendor: string | null }>;
  claim?: WarrantyClaimRow;
}) {
  return <form action={action} className="grid gap-3 p-4 md:grid-cols-4">
    <label className="text-sm"><span className="label">Unit</span><select className="input" name="vehicle_id" defaultValue={claim?.vehicle_id ?? ""} required><option value="">Seçin</option>{vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.unit_number}</option>)}</select></label>
    <label className="text-sm"><span className="label">Work order</span><select className="input" name="work_order_id" defaultValue={claim?.work_order_id ?? ""}><option value="">Yok</option>{workOrders.map((wo) => <option key={wo.id} value={wo.id}>{wo.title} · {wo.status}</option>)}</select></label>
    <label className="text-sm"><span className="label">Bakım kaydı</span><select className="input" name="maintenance_record_id" defaultValue={claim?.maintenance_record_id ?? ""}><option value="">Yok</option>{records.map((record) => <option key={record.id} value={record.id}>{record.performed_date ?? "—"} · {record.service_type ?? "Bakım"} · {record.vendor ?? record.shop_name ?? "Shop yok"}</option>)}</select></label>
    <label className="text-sm"><span className="label">Vendor / manufacturer</span><input className="input" name="vendor_manufacturer" defaultValue={claim?.vendor_manufacturer ?? ""} required /></label>
    <label className="text-sm"><span className="label">Claim number</span><input className="input" name="claim_number" defaultValue={claim?.claim_number ?? ""} /></label>
    <label className="text-sm"><span className="label">Gönderim tarihi</span><input className="input" name="submitted_date" type="date" defaultValue={claim?.submitted_date ?? ""} /></label>
    <Money name="submitted_amount" label="Talep tutarı" value={claim?.submitted_amount} /><Money name="approved_amount" label="Onaylanan tutar" value={claim?.approved_amount} /><Money name="received_amount" label="Tahsil edilen tutar" value={claim?.received_amount} />
    <label className="text-sm"><span className="label">Beklenen recovery</span><input className="input" name="expected_recovery_date" type="date" defaultValue={claim?.expected_recovery_date ?? ""} /></label>
    <label className="text-sm"><span className="label">Denial reason</span><input className="input" name="denial_reason" defaultValue={claim?.denial_reason ?? ""} /></label>
    <label className="text-sm"><span className="label">Notlar</span><input className="input" name="notes" defaultValue={claim?.notes ?? ""} /></label>
    <div className="md:col-span-4"><button className="btn-primary">{claim ? "Claim detaylarını kaydet" : "Claim oluştur"}</button></div>
  </form>;
}

function Money({ name, label, value }: { name: string; label: string; value?: number | null }) { return <label className="text-sm"><span className="label">{label}</span><input className="input" name={name} type="number" min="0" step="0.01" defaultValue={value ?? ""} /></label>; }
function Stat({ label, value }: { label: string; value: string }) { return <div className="rounded-lg border border-slate-200 bg-white p-3"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 font-bold">{value}</p></div>; }
