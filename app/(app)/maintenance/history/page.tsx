import MaintenanceHistoryActions from "@/components/MaintenanceHistoryActions";
import MaintenanceNav from "@/components/MaintenanceNav";
import MaintenancePagination from "@/components/MaintenancePagination";
import { usd } from "@/lib/format";
import {
  decodeMaintenanceCursor,
  maintenanceKeysetFilter,
  maintenancePageHref,
  MAINTENANCE_PAGE_SIZE,
  nextMaintenanceCursor,
} from "@/lib/maintenance/pagination";
import { maintenanceVisibleVehicleStatuses } from "@/lib/maintenance-vehicle-status";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function MaintenanceHistoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const vehicle = first(params.vehicle) ?? "all";
  const start = first(params.start) ?? "";
  const end = first(params.end) ?? "";
  const service = first(params.service) ?? "";
  const kind = first(params.kind) ?? "all";
  const archive = first(params.archive) ?? "current";
  const cursor = decodeMaintenanceCursor(params.cursor);

  const supabase = await createClient();
  let vehiclesQuery = supabase.from("vehicles").select("id, unit_number, status").order("unit_number");
  if (archive !== "include") vehiclesQuery = vehiclesQuery.in("status", maintenanceVisibleVehicleStatuses());
  const vehiclesRes = await vehiclesQuery;
  if (vehiclesRes.error) throw new Error(`Unit listesi yüklenemedi: ${vehiclesRes.error.message}`);

  let query = supabase
    .from("maintenance_records")
    .select(`
      id,
      created_at,
      rule_id,
      service_type,
      performed_date,
      mileage,
      cost,
      total_cost,
      shop_name,
      vendor,
      source,
      planned,
      category,
      parts_used,
      part_name,
      notes,
      invoice_number,
      invoice_id,
      labor_cost,
      parts_cost,
      shop_fees,
      tax_cost,
      towing_cost,
      road_service_cost,
      hotel_travel_cost,
      diagnostic_cost,
      freight_shipping_cost,
      core_charge_cost,
      environmental_fee_cost,
      machine_shop_cost,
      sublet_cost,
      other_cost,
      warranty_recovery,
      refund_credit,
      downtime_start,
      downtime_end,
      cause,
      breakdown_occurred,
      vehicles!maintenance_records_vehicle_id_fkey(unit_number),
      maintenance_invoices(file_name, invoice_number)
    `, { count: "exact" })
    .is("deleted_at", null)
    .is("undone_at", null)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(MAINTENANCE_PAGE_SIZE + 1);

  if (vehicle !== "all") query = query.eq("vehicle_id", vehicle);
  if (start) query = query.gte("performed_date", start);
  if (end) query = query.lte("performed_date", end);
  if (service) query = query.ilike("service_type", `%${service}%`);
  if (kind === "periodic") query = query.eq("planned", true);
  if (kind === "repair") query = query.eq("planned", false);
  let totalQuery = supabase
    .from("maintenance_records")
    .select("id", { count: "exact", head: true })
    .is("deleted_at", null)
    .is("undone_at", null);
  if (vehicle !== "all") totalQuery = totalQuery.eq("vehicle_id", vehicle);
  if (start) totalQuery = totalQuery.gte("performed_date", start);
  if (end) totalQuery = totalQuery.lte("performed_date", end);
  if (service) totalQuery = totalQuery.ilike("service_type", `%${service}%`);
  if (kind === "periodic") totalQuery = totalQuery.eq("planned", true);
  if (kind === "repair") totalQuery = totalQuery.eq("planned", false);
  if (cursor) query = query.or(maintenanceKeysetFilter("created_at", cursor));

  const [historyRes, totalRes] = await Promise.all([query, totalQuery]);
  const historyError = historyRes.error ?? totalRes.error;
  if (historyError) throw new Error(`Bakım geçmişi yüklenemedi: ${historyError.message}`);

  const page = nextMaintenanceCursor(historyRes.data ?? [], (row) => row.created_at);
  const rows = page.rows;
  const vehicles = vehiclesRes.data ?? [];
  const nextHref = page.nextCursor
    ? maintenancePageHref("/maintenance/history", params, "cursor", page.nextCursor)
    : null;

  return (
    <div className="space-y-5">
      <MaintenanceNav title="Bakım Merkezi" />
      <div>
        <h2 className="font-semibold">Bakım Geçmişi</h2>
        <p className="mt-1 text-sm text-slate-500">Manuel kayıtlar, invoice kaynaklı kayıtlar ve tamamlanmış servis geçmişi.</p>
      </div>

      <form className="card grid gap-3 md:grid-cols-7">
        <div>
          <label className="label">Unit</label>
          <select className="input" name="vehicle" defaultValue={vehicle}>
            <option value="all">Hepsi</option>
            {vehicles.map((item) => <option key={item.id} value={item.id}>{item.unit_number}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Başlangıç</label>
          <input className="input" name="start" type="date" defaultValue={start} />
        </div>
        <div>
          <label className="label">Bitiş</label>
          <input className="input" name="end" type="date" defaultValue={end} />
        </div>
        <div>
          <label className="label">Servis</label>
          <input className="input" name="service" defaultValue={service} placeholder="PM-A, DPF..." />
        </div>
        <div>
          <label className="label">Tür</label>
          <select className="input" name="kind" defaultValue={kind}>
            <option value="all">Hepsi</option>
            <option value="periodic">Periyodik</option>
            <option value="repair">Tamir</option>
          </select>
        </div>
        <div className="flex items-end">
          <button className="btn-primary w-full" type="submit">Filtrele</button>
        </div>
        <div>
          <label className="label">Arşiv</label>
          <select className="input" name="archive" defaultValue={archive}>
            <option value="current">Aktif bakım araçları</option>
            <option value="include">Pasif / arşiv dahil</option>
          </select>
        </div>
      </form>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-500">Bakım geçmişi bulunamadı.</div>
      ) : (
        <div className="space-y-2">
          {rows.map((row: any) => {
            const cost = row.total_cost ?? row.cost;
            const parts = row.parts_used?.length ? row.parts_used.join(", ") : row.part_name;
            return (
              <details key={row.id} className="rounded-lg border border-slate-200 bg-white p-4">
                <summary className="cursor-pointer">
                  <span className="font-medium">{row.performed_date ?? "-"} · Unit {row.vehicles?.unit_number ?? "-"}</span>
                  <span className="ml-3 text-sm text-slate-500">{row.service_type ?? "-"} · {row.planned ? "Periyodik" : "Tamir"} · {cost == null ? "-" : usd(Number(cost))}</span>
                </summary>
                <div className="mt-3 grid gap-2 text-sm text-slate-600 md:grid-cols-3">
                  <p>Mileage: {row.mileage == null ? "-" : `${Number(row.mileage).toLocaleString("en-US")} mi`}</p>
                  <p>Shop: {row.shop_name ?? row.vendor ?? "-"}</p>
                  <p>Kaynak: {row.source === "manual_maintenance" ? "Manuel" : row.source ?? "-"}</p>
                  <p>Parçalar: {parts || "-"}</p>
                  <p>Labor: {usd(Number(row.labor_cost ?? 0))}</p>
                  <p>Parts cost: {usd(Number(row.parts_cost ?? 0))}</p>
                  <p>Shop fees: {usd(Number(row.shop_fees ?? 0))}</p>
                  <p>Tax: {usd(Number(row.tax_cost ?? 0))}</p>
                  <p>Invoice: {row.invoice_number ?? row.maintenance_invoices?.invoice_number ?? row.maintenance_invoices?.file_name ?? "-"}</p>
                  <p className="md:col-span-3">Not: {row.notes ?? "-"}</p>
                  <div className="md:col-span-3">
                    <MaintenanceHistoryActions row={row} />
                  </div>
                </div>
              </details>
            );
          })}
        </div>
      )}
      <MaintenancePagination
        totalCount={totalRes.count ?? rows.length}
        shownCount={rows.length}
        nextHref={nextHref}
      />
    </div>
  );
}
