import MaintenanceNav from "@/components/MaintenanceNav";
import {
  WORK_ORDER_PRIORITIES,
  WORK_ORDER_STATUSES,
  calculateWorkOrderTiming,
  isWorkOrderStatus,
  workOrderPriorityLabel,
  workOrderStatusLabel,
  workOrderStatusTone,
} from "@/lib/maintenance-work-orders";
import { maintenanceVisibleVehicleStatuses } from "@/lib/maintenance-vehicle-status";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { createMaintenanceWorkOrder } from "./actions";

export const dynamic = "force-dynamic";
const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;

export default async function WorkOrdersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const supabase = await createClient();
  const status = first(params.status);
  const priority = first(params.priority);
  const vehicleId = first(params.vehicle);
  const assigneeId = first(params.assignee);
  const view = first(params.view) === "list" ? "list" : "board";
  let query = supabase.from("maintenance_work_orders").select("*").order("updated_at", { ascending: false });
  if (status && isWorkOrderStatus(status)) query = query.eq("status", status);
  if (priority && WORK_ORDER_PRIORITIES.includes(priority as any)) query = query.eq("priority", priority);
  if (vehicleId) query = query.eq("vehicle_id", vehicleId);
  if (assigneeId) query = query.eq("assigned_user_id", assigneeId);
  const [workOrdersRes, vehiclesRes, profilesRes] = await Promise.all([
    query,
    supabase.from("vehicles").select("id, unit_number, status").in("status", maintenanceVisibleVehicleStatuses()).order("unit_number"),
    supabase.from("profiles").select("id, full_name, email").order("full_name"),
  ]);
  const error = workOrdersRes.error ?? vehiclesRes.error ?? profilesRes.error;
  if (error) throw new Error(`Work orders yüklenemedi: ${error.message}`);
  const workOrders = (workOrdersRes.data ?? []) as any[];
  const vehicles = (vehiclesRes.data ?? []) as any[];
  const profiles = (profilesRes.data ?? []) as any[];
  const vehicleById = new Map(vehicles.map((row) => [row.id, row.unit_number]));
  const profileById = new Map(profiles.map((row) => [row.id, row.full_name || row.email || "Kullanıcı"]));

  return <div className="space-y-5">
    <MaintenanceNav title="Bakım Merkezi" />
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-lg font-semibold">Work Orders</h2><p className="text-sm text-slate-500">Bakım işlerini atayın, onaylayın ve kapanışa kadar izleyin.</p></div>
      <div className="flex gap-2"><Link className={view === "board" ? "btn-primary" : "btn-ghost"} href="/maintenance/work-orders?view=board">Kanban</Link><Link className={view === "list" ? "btn-primary" : "btn-ghost"} href="/maintenance/work-orders?view=list">Liste</Link></div>
    </div>

    <details className="rounded-lg border border-slate-200 bg-white" open={first(params.new) === "1"}>
      <summary className="cursor-pointer px-4 py-3 font-semibold">Yeni work order</summary>
      <form action={createMaintenanceWorkOrder} className="grid gap-3 border-t border-slate-100 p-4 md:grid-cols-3">
        <label className="text-sm"><span className="label">Unit</span><select name="vehicle_id" className="input" required><option value="">Seçin</option>{vehicles.map((v) => <option key={v.id} value={v.id}>{v.unit_number}</option>)}</select></label>
        <label className="text-sm"><span className="label">Kaynak</span><select name="source_type" className="input" defaultValue="manual"><option value="manual">Manuel</option><option value="breakdown">Arıza / Breakdown</option></select></label>
        <label className="text-sm"><span className="label">Öncelik</span><select name="priority" className="input" defaultValue="normal">{WORK_ORDER_PRIORITIES.map((p) => <option key={p} value={p}>{workOrderPriorityLabel(p)}</option>)}</select></label>
        <label className="text-sm md:col-span-2"><span className="label">Başlık</span><input name="title" className="input" required minLength={3} /></label>
        <label className="text-sm"><span className="label">Atanan</span><select name="assigned_user_id" className="input"><option value="">Atanmadı</option>{profiles.map((p) => <option key={p.id} value={p.id}>{p.full_name || p.email}</option>)}</select></label>
        <label className="text-sm md:col-span-3"><span className="label">Şikayet / açıklama</span><textarea name="complaint" className="input min-h-20" /></label>
        <label className="text-sm"><span className="label">Tahmini maliyet</span><input name="estimated_cost" type="number" min="0" step="0.01" className="input" /></label>
        <label className="text-sm"><span className="label">Randevu</span><input name="appointment_start" type="datetime-local" className="input" /></label>
        <label className="text-sm"><span className="label">Tahmini bitiş</span><input name="estimated_completion" type="datetime-local" className="input" /></label>
        <div className="md:col-span-3"><button className="btn-primary" type="submit">Work order oluştur</button></div>
      </form>
    </details>

    <form className="grid gap-2 rounded-lg border border-slate-200 bg-white p-3 md:grid-cols-5">
      <input type="hidden" name="view" value={view} />
      <select name="status" className="input" defaultValue={status ?? ""}><option value="">Tüm statusler</option>{WORK_ORDER_STATUSES.map((s) => <option key={s} value={s}>{workOrderStatusLabel(s)}</option>)}</select>
      <select name="priority" className="input" defaultValue={priority ?? ""}><option value="">Tüm öncelikler</option>{WORK_ORDER_PRIORITIES.map((p) => <option key={p} value={p}>{workOrderPriorityLabel(p)}</option>)}</select>
      <select name="vehicle" className="input" defaultValue={vehicleId ?? ""}><option value="">Tüm unitler</option>{vehicles.map((v) => <option key={v.id} value={v.id}>{v.unit_number}</option>)}</select>
      <select name="assignee" className="input" defaultValue={assigneeId ?? ""}><option value="">Tüm atamalar</option>{profiles.map((p) => <option key={p.id} value={p.id}>{p.full_name || p.email}</option>)}</select>
      <button className="btn-ghost" type="submit">Filtrele</button>
    </form>

    {view === "list" ? <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white"><table className="min-w-full text-sm"><thead className="bg-slate-50 text-left text-slate-500"><tr><th className="p-3">İş</th><th className="p-3">Unit</th><th className="p-3">Status</th><th className="p-3">Atanan</th><th className="p-3">Maliyet</th><th className="p-3">ETA</th></tr></thead><tbody>{workOrders.map((wo) => <WorkOrderRow key={wo.id} wo={wo} unit={vehicleById.get(wo.vehicle_id)} assignee={profileById.get(wo.assigned_user_id)} />)}</tbody></table></div> : (
      <div className="grid gap-3 xl:grid-cols-4">{WORK_ORDER_STATUSES.filter((s) => workOrders.some((wo) => wo.status === s)).map((column) => <section key={column} className="rounded-lg bg-slate-100 p-3">
        <h3 className="mb-3 flex justify-between text-sm font-semibold"><span>{workOrderStatusLabel(column)}</span><span>{workOrders.filter((wo) => wo.status === column).length}</span></h3>
        <div className="space-y-2">{workOrders.filter((wo) => wo.status === column).map((wo) => {
          const metrics = calculateWorkOrderTiming(wo);
          return <Link key={wo.id} href={`/maintenance/work-orders/${wo.id}`} className="block rounded-lg border border-slate-200 bg-white p-3 hover:border-brand">
            <div className="flex items-start justify-between gap-2"><span className="font-medium">{wo.title}</span><span className="text-xs font-semibold">{vehicleById.get(wo.vehicle_id) ?? "—"}</span></div>
            <p className="mt-2 text-xs text-slate-500">{workOrderPriorityLabel(wo.priority)} · {profileById.get(wo.assigned_user_id) ?? "Atanmadı"}</p>
            {metrics.currentDowntimeDays != null && <p className="mt-2 text-xs text-red-600">Downtime: {metrics.currentDowntimeDays} gün</p>}
          </Link>;
        })}</div>
      </section>)}</div>
    )}
    {!workOrders.length && <div className="rounded-lg border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500">Filtreye uygun work order yok.</div>}
  </div>;
}

function WorkOrderRow({ wo, unit, assignee }: { wo: any; unit?: string; assignee?: string }) {
  return <tr className="border-t border-slate-100">
    <td className="p-3"><Link className="font-medium text-brand hover:underline" href={`/maintenance/work-orders/${wo.id}`}>{wo.title}</Link><div className="text-xs text-slate-500">{workOrderPriorityLabel(wo.priority)}</div></td>
    <td className="p-3">{unit ?? "—"}</td><td className="p-3"><span className={`badge ${workOrderStatusTone(wo.status)}`}>{workOrderStatusLabel(wo.status)}</span></td>
    <td className="p-3">{assignee ?? "Atanmadı"}</td><td className="p-3">{wo.final_cost != null ? `$${Number(wo.final_cost).toFixed(2)}` : wo.estimated_cost != null ? `~$${Number(wo.estimated_cost).toFixed(2)}` : "—"}</td>
    <td className="p-3">{wo.estimated_completion ? new Date(wo.estimated_completion).toLocaleString("tr-TR") : "—"}</td>
  </tr>;
}
