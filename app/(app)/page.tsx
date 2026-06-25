import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { usd, localISODate } from "@/lib/format";
import { computePM, PM_BADGE } from "@/lib/maintenance";

export const dynamic = "force-dynamic";

function weekRange(now = new Date()) {
  const day = now.getDay(); // 0 Sun..6 Sat
  const diffToMon = (day + 6) % 7;
  const start = new Date(now);
  start.setDate(now.getDate() - diffToMon);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { start: localISODate(start), end: localISODate(end) };
}

export default async function Dashboard() {
  const supabase = await createClient();
  const { start, end } = weekRange();

  const [loadsRes, expRes, importedRes, vehiclesRes, settleRes, rulesRes, settingsRes] =
    await Promise.all([
      supabase.from("loads").select("gross_amount").gte("delivery_date", start).lte("delivery_date", end),
      supabase.from("expenses").select("amount").gte("date", start).lte("date", end),
      supabase.from("imported_loads").select("id", { count: "exact", head: true }).eq("status", "pending"),
      supabase.from("vehicles").select("status"),
      supabase.from("settlements").select("status, our_commission_earned"),
      supabase.from("maintenance_rules").select("*, vehicles(unit_number, current_mileage)").eq("active", true),
      supabase.from("settings").select("pm_due_soon_miles").single(),
    ]);

  const gross = (loadsRes.data ?? []).reduce((s, l) => s + Number(l.gross_amount || 0), 0);
  const expenses = (expRes.data ?? []).reduce((s, e) => s + Number(e.amount || 0), 0);
  const pendingImported = importedRes.count ?? 0;
  const activeVehicles = (vehiclesRes.data ?? []).filter((v) => v.status === "active").length;
  const inRepair = (vehiclesRes.data ?? []).filter((v) => v.status === "in_repair").length;
  const pendingSettlements = (settleRes.data ?? []).filter(
    (s) => s.status === "draft" || s.status === "pending_review",
  ).length;
  const commission = (settleRes.data ?? [])
    .filter((s) => s.status === "finalized" || s.status === "paid")
    .reduce((s, r) => s + Number(r.our_commission_earned || 0), 0);

  const dueSoon = settingsRes.data?.pm_due_soon_miles ?? 2500;
  const pmAlerts = (rulesRes.data ?? [])
    .map((r: any) => ({ r, pm: computePM(r, r.vehicles?.current_mileage ?? 0, dueSoon) }))
    .filter((x) => x.pm.status !== "ok")
    .sort((a, b) => (a.pm.remaining ?? 0) - (b.pm.remaining ?? 0));

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">Dashboard</h1>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Bu Hafta Gross" value={usd(gross)} big />
        <Stat label="Bu Hafta Masraf" value={usd(expenses)} />
        <Stat label="Bu Hafta Net" value={usd(gross - expenses)} />
        <Stat label="Toplam Komisyon" value={usd(commission)} accent />
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <MiniLink href="/imported" label="Bekleyen Telegram Yükü" value={pendingImported} highlight={pendingImported > 0} />
        <MiniLink href="/settlements" label="Bekleyen Settlement" value={pendingSettlements} />
        <MiniLink href="/vehicles" label="Aktif Araç" value={activeVehicles} />
        <MiniLink href="/vehicles" label="Tamirde" value={inRepair} highlight={inRepair > 0} />
      </div>

      <div className="card">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Bakım Uyarıları</h2>
          <Link href="/maintenance" className="text-sm text-brand hover:underline">
            Tümü →
          </Link>
        </div>
        {pmAlerts.length === 0 ? (
          <p className="text-sm text-slate-400">Yaklaşan bakım yok. 👍</p>
        ) : (
          <div className="space-y-2">
            {pmAlerts.slice(0, 8).map(({ r, pm }) => (
              <div key={r.id} className="flex items-center justify-between border-b border-slate-100 pb-2 text-sm">
                <div>
                  <span className="font-medium">Unit {r.vehicles?.unit_number}</span>
                  <span className="text-slate-500"> · {r.service_type}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-slate-500">
                    {pm.remaining ?? "?"} {pm.unit === "miles" ? "mi" : "gün"} kaldı
                  </span>
                  <span className={`badge ${PM_BADGE[pm.status]}`}>{pm.label}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, big, accent }: { label: string; value: string; big?: boolean; accent?: boolean }) {
  return (
    <div className="card">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`mt-1 font-bold ${big ? "text-2xl text-brand" : "text-lg"} ${accent ? "text-emerald-700" : ""}`}>
        {value}
      </p>
    </div>
  );
}

function MiniLink({ href, label, value, highlight }: { href: string; label: string; value: number; highlight?: boolean }) {
  return (
    <Link href={href} className={`card transition hover:shadow ${highlight ? "ring-1 ring-amber-300" : ""}`}>
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${highlight ? "text-amber-600" : "text-slate-800"}`}>{value}</p>
    </Link>
  );
}
