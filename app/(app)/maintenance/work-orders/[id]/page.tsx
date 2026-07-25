import MaintenanceNav from "@/components/MaintenanceNav";
import {
  WORK_ORDER_PRIORITIES,
  allowedWorkOrderTransitions,
  calculateWorkOrderTiming,
  isWorkOrderStatus,
  workOrderPriorityLabel,
  workOrderSourceLabel,
  workOrderStatusLabel,
  workOrderStatusTone,
} from "@/lib/maintenance-work-orders";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  addWorkOrderPart,
  addWorkOrderTask,
  decideWorkOrderApproval,
  submitWorkOrderEstimate,
  transitionMaintenanceWorkOrder,
  transitionWorkOrderPart,
  transitionWorkOrderTask,
  updateMaintenanceWorkOrder,
} from "../actions";

export const dynamic = "force-dynamic";
const money = (value: unknown) => value == null ? "—" : `$${Number(value).toFixed(2)}`;
const local = (value: string | null) => value ? new Date(value).toLocaleString("tr-TR") : "—";
const inputDate = (value: string | null) => value ? new Date(value).toISOString().slice(0, 16) : "";

export default async function WorkOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const [woRes, vehiclesRes, profilesRes, tasksRes, partsRes, eventsRes, approvalsRes] = await Promise.all([
    supabase.from("maintenance_work_orders").select("*").eq("id", id).maybeSingle(),
    supabase.from("vehicles").select("id, unit_number").order("unit_number"),
    supabase.from("profiles").select("id, full_name, email").order("full_name"),
    supabase.from("maintenance_work_order_tasks").select("*").eq("work_order_id", id).order("sort_order").order("created_at"),
    supabase.from("maintenance_work_order_parts").select("*").eq("work_order_id", id).order("created_at"),
    supabase.from("maintenance_work_order_status_events").select("*").eq("work_order_id", id).order("created_at", { ascending: false }),
    supabase.from("maintenance_work_order_approvals").select("*").eq("work_order_id", id).order("created_at", { ascending: false }),
  ]);
  if (woRes.error) throw new Error(woRes.error.message);
  if (!woRes.data) notFound();
  const error = vehiclesRes.error ?? profilesRes.error ?? tasksRes.error ?? partsRes.error ?? eventsRes.error ?? approvalsRes.error;
  if (error) throw new Error(`Work order detayları yüklenemedi: ${error.message}`);
  const wo = woRes.data as any;
  if (!isWorkOrderStatus(wo.status)) throw new Error("Work order status geçersiz.");
  const vehicles = (vehiclesRes.data ?? []) as any[];
  const profiles = (profilesRes.data ?? []) as any[];
  const profileById = new Map(profiles.map((p) => [p.id, p.full_name || p.email || "Kullanıcı"]));
  const unit = vehicles.find((v) => v.id === wo.vehicle_id)?.unit_number ?? "—";
  const metrics = calculateWorkOrderTiming(wo);
  const transitions = allowedWorkOrderTransitions(wo.status);

  return <div className="space-y-5">
    <MaintenanceNav title="Bakım Merkezi" />
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><Link href="/maintenance/work-orders" className="text-sm text-brand hover:underline">← Work Orders</Link><h2 className="mt-1 text-xl font-bold">{wo.title}</h2><p className="text-sm text-slate-500">{unit} · {workOrderSourceLabel(wo.source_type)}</p></div>
      <span className={`badge ${workOrderStatusTone(wo.status)}`}>{workOrderStatusLabel(wo.status)}</span>
    </div>

    {wo.dispatch_hold_id && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800"><strong>Dispatch hold aktif bağlantısı var.</strong> Work order kapanınca otomatik temizlenmez; inspection ekranından açıkça clearance gerekir.</div>}

    <div className="grid gap-3 md:grid-cols-4">
      <Metric label="Tahmini maliyet" value={money(wo.estimated_cost)} />
      <Metric label="Onay limiti" value={money(wo.approved_cost_limit)} />
      <Metric label="Final maliyet" value={money(wo.final_cost)} />
      <Metric label="Downtime" value={metrics.currentDowntimeDays == null ? "—" : `${metrics.currentDowntimeDays} gün`} />
      <Metric label="ETA" value={local(wo.estimated_completion)} />
      <Metric label="Tahmin bekleme" value={metrics.daysWaitingForEstimate == null ? "—" : `${metrics.daysWaitingForEstimate} gün`} />
      <Metric label="Parça bekleme" value={metrics.daysWaitingForParts == null ? "—" : `${metrics.daysWaitingForParts} gün`} />
      <Metric label="Tamir süresi" value={metrics.daysInRepair == null ? "—" : `${metrics.daysInRepair} gün`} />
    </div>

    {transitions.length > 0 && <section className="rounded-lg border border-slate-200 bg-white p-4"><h3 className="font-semibold">Hızlı aksiyonlar</h3><div className="mt-3 flex flex-wrap gap-2">{transitions.map((next) => <form key={next} action={transitionMaintenanceWorkOrder.bind(null, id)}><input type="hidden" name="to_status" value={next} /><button className={next === "cancelled" ? "btn-ghost text-red-700" : "btn-primary"}>{workOrderStatusLabel(next)}</button></form>)}</div></section>}

    {wo.status === "awaiting_estimate" && <section className="rounded-lg border border-amber-200 bg-amber-50 p-4"><h3 className="font-semibold">Tahmin gönder</h3><form action={submitWorkOrderEstimate.bind(null, id)} className="mt-3 flex flex-wrap gap-2"><input className="input max-w-52" name="estimated_cost" type="number" min="0" step="0.01" required placeholder="Tutar" /><input className="input min-w-64 flex-1" name="notes" placeholder="Tahmin notu" /><button className="btn-primary">Gönder</button></form></section>}
    {wo.status === "awaiting_approval" && <section className="rounded-lg border border-amber-200 bg-amber-50 p-4"><h3 className="font-semibold">Maliyet onayı</h3><form action={decideWorkOrderApproval.bind(null, id)} className="mt-3 grid gap-2 md:grid-cols-4"><input className="input" name="approved_amount" type="number" min="0" step="0.01" defaultValue={wo.estimated_cost ?? ""} /><input className="input" name="notes" placeholder="Onay notu" /><input className="input" name="rejection_reason" placeholder="Red nedeni (red için)" /><div className="flex gap-2"><button className="btn-primary" name="decision" value="approved">Onayla</button><button className="btn-ghost text-red-700" name="decision" value="rejected">Reddet</button></div></form></section>}

    <details className="rounded-lg border border-slate-200 bg-white" open>
      <summary className="cursor-pointer px-4 py-3 font-semibold">İş detayları ve atama</summary>
      <form action={updateMaintenanceWorkOrder.bind(null, id)} className="grid gap-3 border-t border-slate-100 p-4 md:grid-cols-3">
        <input type="hidden" name="vehicle_id" value={wo.vehicle_id} /><input type="hidden" name="source_type" value={wo.source_type} />
        <label className="text-sm md:col-span-2"><span className="label">Başlık</span><input className="input" name="title" defaultValue={wo.title} required /></label>
        <label className="text-sm"><span className="label">Öncelik</span><select className="input" name="priority" defaultValue={wo.priority}>{WORK_ORDER_PRIORITIES.map((p) => <option key={p} value={p}>{workOrderPriorityLabel(p)}</option>)}</select></label>
        <TextArea name="complaint" label="Şikayet" value={wo.complaint} /><TextArea name="diagnosis" label="Teşhis" value={wo.diagnosis} /><TextArea name="recommended_action" label="Önerilen aksiyon" value={wo.recommended_action} />
        <label className="text-sm"><span className="label">Atanan</span><select className="input" name="assigned_user_id" defaultValue={wo.assigned_user_id ?? ""}><option value="">Atanmadı</option>{profiles.map((p) => <option key={p.id} value={p.id}>{p.full_name || p.email}</option>)}</select></label>
        <Input name="shop_vendor" label="Shop / vendor" value={wo.shop_vendor} /><Input name="shop_contact" label="Shop iletişim" value={wo.shop_contact} />
        <Input name="appointment_start" label="Randevu" value={inputDate(wo.appointment_start)} type="datetime-local" /><Input name="estimated_completion" label="Tahmini bitiş" value={inputDate(wo.estimated_completion)} type="datetime-local" /><Input name="final_cost" label="Final maliyet" value={wo.final_cost} type="number" />
        <Input name="downtime_start" label="Downtime başlangıcı" value={inputDate(wo.downtime_start)} type="datetime-local" /><Input name="downtime_end" label="Downtime bitişi" value={inputDate(wo.downtime_end)} type="datetime-local" /><Input name="odometer" label="Odometer" value={wo.odometer} type="number" />
        <Input name="engine_hours" label="Engine hours" value={wo.engine_hours} type="number" /><label className="text-sm md:col-span-2"><span className="label">Notlar</span><textarea className="input min-h-20" name="notes" defaultValue={wo.notes ?? ""} /></label>
        <div className="md:col-span-3"><button className="btn-primary">Detayları kaydet</button></div>
      </form>
    </details>

    <section className="rounded-lg border border-slate-200 bg-white p-4"><h3 className="font-semibold">Checklist / Tasklar</h3>
      <div className="mt-3 space-y-2">{(tasksRes.data ?? []).map((task: any) => <div key={task.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-100 p-3"><div><strong>{task.title}</strong><p className="text-xs text-slate-500">{task.status} · {profileById.get(task.assigned_user_id) ?? "Atanmadı"} · {task.due_date ?? "Tarih yok"}</p></div>{task.status !== "completed" && task.status !== "cancelled" && <form action={transitionWorkOrderTask.bind(null, id, task.id)} className="flex gap-2">{task.status === "pending" && <button className="btn-ghost" name="status" value="in_progress">Başlat</button>}<button className="btn-primary" name="status" value="completed">Tamamla</button><button className="btn-ghost" name="status" value="cancelled">İptal</button></form>}</div>)}</div>
      <form action={addWorkOrderTask.bind(null, id)} className="mt-4 grid gap-2 md:grid-cols-5"><input className="input md:col-span-2" name="title" placeholder="Yeni task" required /><select className="input" name="assigned_user_id"><option value="">Atanmadı</option>{profiles.map((p) => <option key={p.id} value={p.id}>{p.full_name || p.email}</option>)}</select><input className="input" name="due_date" type="date" /><input type="hidden" name="priority" value="normal" /><button className="btn-primary">Task ekle</button></form>
    </section>

    <section className="rounded-lg border border-slate-200 bg-white p-4"><h3 className="font-semibold">Parçalar</h3>
      <div className="mt-3 space-y-2">{(partsRes.data ?? []).map((part: any) => <div key={part.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-100 p-3"><div><strong>{part.part_name}</strong><p className="text-xs text-slate-500">{part.status} · {part.quantity} adet · {money(part.unit_cost)}{part.core_returned ? " · Core iade edildi" : ""}</p></div><form action={transitionWorkOrderPart.bind(null, id, part.id)} className="flex items-center gap-2">{part.core_charge != null && <label className="text-xs"><input name="core_returned" type="checkbox" defaultChecked={part.core_returned} /> Core döndü</label>}{part.status === "needed" && <button className="btn-primary" name="status" value="ordered">Sipariş</button>}{part.status === "ordered" && <button className="btn-primary" name="status" value="received">Teslim al</button>}{part.status === "received" && <button className="btn-primary" name="status" value="installed">Takıldı</button>}</form></div>)}</div>
      <form action={addWorkOrderPart.bind(null, id)} className="mt-4 grid gap-2 md:grid-cols-5"><input className="input md:col-span-2" name="part_name" placeholder="Parça adı" required /><input className="input" name="part_number" placeholder="Part #" /><input className="input" name="quantity" type="number" min="0.01" step="0.01" defaultValue="1" /><input className="input" name="unit_cost" type="number" min="0" step="0.01" placeholder="Birim maliyet" /><button className="btn-primary">Parça ekle</button></form>
    </section>

    <section className="grid gap-4 lg:grid-cols-2"><div className="rounded-lg border border-slate-200 bg-white p-4"><h3 className="font-semibold">Değişmez status geçmişi</h3><div className="mt-3 space-y-3">{(eventsRes.data ?? []).map((event: any) => <div key={event.id} className="border-l-2 border-slate-200 pl-3 text-sm"><p>{event.from_status ? `${workOrderStatusLabel(event.from_status)} → ` : ""}{event.to_status ? workOrderStatusLabel(event.to_status) : event.event_type}</p><p className="text-xs text-slate-500">{local(event.created_at)} · {profileById.get(event.created_by) ?? "Sistem"}</p>{event.notes && <p className="mt-1 text-slate-600">{event.notes}</p>}</div>)}</div></div>
    <div className="rounded-lg border border-slate-200 bg-white p-4"><h3 className="font-semibold">Onay geçmişi</h3><div className="mt-3 space-y-3">{(approvalsRes.data ?? []).map((a: any) => <div key={a.id} className="rounded border border-slate-100 p-3 text-sm"><strong>{a.state}</strong><p>{money(a.estimate_amount)} → {money(a.approved_amount)}</p><p className="text-xs text-slate-500">{local(a.decided_at ?? a.requested_at)}</p>{a.rejection_reason && <p className="text-red-700">{a.rejection_reason}</p>}</div>)}</div></div></section>
  </div>;
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-lg border border-slate-200 bg-white p-3"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 font-semibold">{value}</p></div>; }
function Input({ name, label, value, type = "text" }: { name: string; label: string; value: any; type?: string }) { return <label className="text-sm"><span className="label">{label}</span><input className="input" name={name} type={type} step={type === "number" ? "0.01" : undefined} min={type === "number" ? "0" : undefined} defaultValue={value ?? ""} /></label>; }
function TextArea({ name, label, value }: { name: string; label: string; value: any }) { return <label className="text-sm"><span className="label">{label}</span><textarea className="input min-h-20" name={name} defaultValue={value ?? ""} /></label>; }
