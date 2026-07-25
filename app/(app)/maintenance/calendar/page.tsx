import MaintenanceNav from "@/components/MaintenanceNav";
import { workOrderStatusLabel } from "@/lib/maintenance-work-orders";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

export const dynamic = "force-dynamic";

type CalendarEvent = {
  date: string;
  kind: "appointment" | "completion" | "reminder";
  title: string;
  unit: string;
  href: string;
  overdue: boolean;
};

export default async function MaintenanceCalendarPage() {
  const supabase = await createClient();
  const [workOrdersRes, rulesRes, vehiclesRes] = await Promise.all([
    supabase.from("maintenance_work_orders")
      .select("id, vehicle_id, title, status, appointment_start, estimated_completion")
      .not("status", "in", '("closed","cancelled")'),
    supabase.from("maintenance_rules")
      .select("id, vehicle_id, service_type, interval_days, last_done_date, active")
      .eq("active", true)
      .not("vehicle_id", "is", null),
    supabase.from("vehicles").select("id, unit_number"),
  ]);
  const error = workOrdersRes.error ?? rulesRes.error ?? vehiclesRes.error;
  if (error) throw new Error(`Bakım takvimi yüklenemedi: ${error.message}`);
  const unitById = new Map((vehiclesRes.data ?? []).map((v: any) => [v.id, v.unit_number]));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const events: CalendarEvent[] = [];
  for (const wo of (workOrdersRes.data ?? []) as any[]) {
    if (wo.appointment_start) events.push({
      date: wo.appointment_start, kind: "appointment", title: `${wo.title} · ${workOrderStatusLabel(wo.status)}`,
      unit: unitById.get(wo.vehicle_id) ?? "—", href: `/maintenance/work-orders/${wo.id}`,
      overdue: new Date(wo.appointment_start) < today,
    });
    if (wo.estimated_completion) events.push({
      date: wo.estimated_completion, kind: "completion", title: `${wo.title} · tahmini bitiş`,
      unit: unitById.get(wo.vehicle_id) ?? "—", href: `/maintenance/work-orders/${wo.id}`,
      overdue: new Date(wo.estimated_completion) < today,
    });
  }
  for (const rule of (rulesRes.data ?? []) as any[]) {
    if (!rule.last_done_date || !rule.interval_days) continue;
    const due = new Date(`${rule.last_done_date}T12:00:00Z`);
    due.setUTCDate(due.getUTCDate() + Number(rule.interval_days));
    events.push({
      date: due.toISOString(), kind: "reminder", title: rule.service_type,
      unit: unitById.get(rule.vehicle_id) ?? "—",
      href: `/maintenance/reminders?vehicleId=${rule.vehicle_id}`,
      overdue: due < today,
    });
  }
  events.sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const grouped = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    const key = event.date.slice(0, 7);
    grouped.set(key, [...(grouped.get(key) ?? []), event]);
  }

  return <div className="space-y-5">
    <MaintenanceNav title="Bakım Merkezi" />
    <div><h2 className="text-lg font-semibold">Bakım Takvimi</h2><p className="text-sm text-slate-500">Work order randevuları, tahmini bitişler ve tarih bazlı bakım hatırlatıcıları.</p></div>
    <div className="flex flex-wrap gap-2 text-xs"><Legend color="bg-blue-500" text="Randevu" /><Legend color="bg-emerald-500" text="Tahmini bitiş" /><Legend color="bg-amber-500" text="Hatırlatıcı" /><Legend color="bg-red-500" text="Gecikmiş" /></div>
    {[...grouped.entries()].map(([month, monthEvents]) => <section key={month} className="rounded-lg border border-slate-200 bg-white">
      <h3 className="border-b border-slate-100 px-4 py-3 font-semibold">{new Date(`${month}-02T12:00:00Z`).toLocaleDateString("tr-TR", { month: "long", year: "numeric" })}</h3>
      <div className="divide-y divide-slate-100">{monthEvents.map((event, index) => <Link key={`${event.kind}-${event.date}-${index}`} href={event.href} className="grid gap-2 p-4 hover:bg-slate-50 md:grid-cols-[8rem_7rem_1fr]">
        <span className={event.overdue ? "font-semibold text-red-700" : "font-medium"}>{new Date(event.date).toLocaleDateString("tr-TR", { day: "2-digit", month: "short" })}</span>
        <span className="text-sm font-semibold">{event.unit}</span>
        <span className="text-sm"><i className={`mr-2 inline-block h-2 w-2 rounded-full ${event.overdue ? "bg-red-500" : event.kind === "appointment" ? "bg-blue-500" : event.kind === "completion" ? "bg-emerald-500" : "bg-amber-500"}`} />{event.title}</span>
      </Link>)}</div>
    </section>)}
    {!events.length && <div className="rounded-lg border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500">Takvimde planlanmış bakım olayı yok.</div>}
  </div>;
}

function Legend({ color, text }: { color: string; text: string }) {
  return <span className="rounded-full bg-white px-3 py-1 shadow-sm"><i className={`mr-2 inline-block h-2 w-2 rounded-full ${color}`} />{text}</span>;
}
