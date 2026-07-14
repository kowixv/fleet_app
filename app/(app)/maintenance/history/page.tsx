import MaintenanceHistoryActions from "@/components/MaintenanceHistoryActions";
import MaintenanceNav from "@/components/MaintenanceNav";
import { usd } from "@/lib/format";
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

  const supabase = await createClient();
  const vehiclesRes = await supabase.from("vehicles").select("id, unit_number").eq("status", "active").order("unit_number");
  if (vehiclesRes.error) throw new Error(`Unit listesi yüklenemedi: ${vehiclesRes.error.message}`);

  let query = supabase
    .from("maintenance_records")
    .select(`
      id,
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
      downtime_start,
      downtime_end,
      vehicles!maintenance_records_vehicle_id_fkey(unit_number),
      maintenance_invoices(file_name, invoice_number)
    `)
    .is("deleted_at", null)
    .order("performed_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(250);

  if (vehicle !== "all") query = query.eq("vehicle_id", vehicle);
  if (start) query = query.gte("performed_date", start);
  if (end) query = query.lte("performed_date", end);
  if (service) query = query.ilike("service_type", `%${service}%`);
  if (kind === "periodic") query = query.eq("planned", true);
  if (kind === "repair") query = query.eq("planned", false);

  const historyRes = await query;
  if (historyRes.error) throw new Error(`Bakım geçmişi yüklenemedi: ${historyRes.error.message}`);

  const rows = historyRes.data ?? [];
  const vehicles = vehiclesRes.data ?? [];

  return (
    <div className="space-y-5">
      <MaintenanceNav title="Bakım Merkezi" />
      <div>
        <h2 className="font-semibold">Bakım Geçmişi</h2>
        <p className="mt-1 text-sm text-slate-500">Manuel kayıtlar, invoice kaynaklı kayıtlar ve tamamlanmış servis geçmişi.</p>
      </div>

      <form className="card grid gap-3 md:grid-cols-6">
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
    </div>
  );
}
