import Link from "next/link";
import ManualMaintenanceEntry from "@/components/ManualMaintenanceEntry";
import MaintenanceNav from "@/components/MaintenanceNav";
import { usd } from "@/lib/format";
import { computePM, type PMResult, type PMStatus, type PMThresholds } from "@/lib/maintenance";
import { MAINTENANCE_TERMS } from "@/lib/maintenance-terminology";
import { createClient } from "@/lib/supabase/server";
import { todayISO } from "@/lib/tz";

export const dynamic = "force-dynamic";

interface RuleRow {
  id: string;
  service_type: string;
  interval_miles: number | null;
  interval_days: number | null;
  interval_engine_hours: number | null;
  last_done_mileage: number | null;
  last_done_date: string | null;
  last_done_engine_hours: number | null;
  vehicle_id: string;
  vehicles: { unit_number: string; current_mileage: number | null } | null;
}

interface FindingRow {
  id: string;
  severity: string;
  label: string | null;
  recommended_action: string | null;
  vehicles: { unit_number: string } | null;
}

interface ActionItem {
  kind: "finding" | "maintenance";
  priority: number;
  unit: string;
  issue: string;
  detail: string;
  href: string;
  action: string;
  badge: { label: string; className: string };
}

const STATUS_BADGE: Record<PMStatus, { label: string; className: string }> = {
  ok: { label: "Tamam", className: "bg-green-100 text-green-700" },
  warning: { label: "Yaklaşıyor", className: "bg-yellow-100 text-yellow-700" },
  due_soon: { label: "Yakında", className: "bg-amber-100 text-amber-700" },
  due_now: { label: "Bugün", className: "bg-orange-100 text-orange-700" },
  overdue: { label: "Gecikmiş", className: "bg-red-100 text-red-700" },
};

function formatNumber(value: number) {
  return Math.abs(value).toLocaleString("en-US");
}

function unitLabel(unit: PMResult["unit"]) {
  if (unit === "miles") return "mil";
  if (unit === "days") return "gün";
  return "engine saat";
}

function formatAttentionAmount(pm: PMResult): string {
  if (pm.remaining == null || pm.triggeredBy == null) return "Kontrol gerekli";
  const amount = formatNumber(pm.remaining);
  const unit = unitLabel(pm.triggeredBy);
  if (pm.remaining < 0) return `${amount} ${unit} gecikti`;
  if (pm.remaining === 0) return "Bugün yapılmalı";
  return `${amount} ${unit} kaldı`;
}

function buildPMActions(
  rules: RuleRow[],
  thresholds: PMThresholds,
  engineHoursByVehicle: Record<string, number | null>,
): ActionItem[] {
  const priority: Record<PMStatus, number> = { overdue: 20, due_now: 21, due_soon: 30, warning: 35, ok: 99 };
  return rules
    .map((rule) => ({
      rule,
      pm: computePM(
        rule,
        Number(rule.vehicles?.current_mileage ?? 0),
        thresholds,
        todayISO(),
        engineHoursByVehicle[rule.vehicle_id] ?? null,
      ),
    }))
    .filter(({ pm }) => pm.status === "overdue" || pm.status === "due_now" || pm.status === "due_soon")
    .map(({ rule, pm }) => ({
      kind: "maintenance",
      priority: priority[pm.status],
      unit: rule.vehicles?.unit_number ?? "-",
      issue: rule.service_type,
      detail: formatAttentionAmount(pm),
      href: `/maintenance?add=1&vehicleId=${rule.vehicle_id}&type=periodic&service=${encodeURIComponent(rule.service_type)}`,
      action: "Bakım Ekle",
      badge: STATUS_BADGE[pm.status],
    }));
}

function SummaryCard({ label, value, tone }: { label: string; value: number; tone: "red" | "amber" | "slate" }) {
  const toneClass =
    tone === "red"
      ? "border-red-200 bg-red-50 text-red-800"
      : tone === "amber"
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : "border-slate-200 bg-white text-slate-800";
  if (value === 0 && tone === "slate") return null;
  return (
    <div className={`rounded-lg border p-4 ${toneClass}`}>
      <p className="text-sm font-medium">{label}</p>
      <p className="mt-2 text-3xl font-bold">{value}</p>
    </div>
  );
}

function QuickAction({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="flex min-h-24 items-center justify-between rounded-lg border border-slate-200 bg-white p-4 text-left font-semibold shadow-sm transition hover:border-brand/50 hover:text-brand"
    >
      <span>{label}</span>
      <span aria-hidden="true" className="text-xl">-&gt;</span>
    </Link>
  );
}

function OtherActionsMenu() {
  return (
    <details className="min-h-24 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <summary className="flex cursor-pointer list-none items-center justify-between font-semibold text-slate-800">
        <span>{MAINTENANCE_TERMS.otherActions}</span>
        <span aria-hidden="true" className="text-xl">+</span>
      </summary>
      <div className="mt-3 space-y-2 text-sm">
        <Link className="block rounded-md px-2 py-1.5 hover:bg-slate-100" href="/maintenance/invoices">PDF Invoice Yükle</Link>
        <Link className="block rounded-md px-2 py-1.5 hover:bg-slate-100" href="/maintenance/invoices">Invoice Inbox</Link>
        <Link className="block rounded-md px-2 py-1.5 hover:bg-slate-100" href="/maintenance/invoices/bulk">Toplu Invoice Import</Link>
      </div>
    </details>
  );
}

function ActionRow({ item }: { item: ActionItem }) {
  return (
    <li className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">Unit {item.unit}</span>
            <span className={`badge ${item.badge.className}`}>{item.badge.label}</span>
          </div>
          <p className="mt-1 font-medium text-slate-800">{item.issue}</p>
          <p className="mt-1 text-sm text-slate-500">{item.detail}</p>
        </div>
        <Link href={item.href} className="btn-primary whitespace-nowrap text-center">
          {item.action}
        </Link>
      </div>
    </li>
  );
}

function HighCostRepair({ row }: { row: any }) {
  const cost = row.total_cost ?? row.cost ?? 0;
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">Unit {row.vehicles?.unit_number ?? "-"}</span>
        <span className="font-semibold text-red-700">{usd(Number(cost))}</span>
      </div>
      <p className="mt-1 font-medium text-slate-800">{row.service_type ?? "Tamir"}</p>
      <p className="mt-1 text-slate-500">{row.performed_date ?? "-"} · {row.shop_name ?? "Shop yok"}</p>
      {row.invoice_number && <p className="mt-1 text-slate-500">Invoice / RO: {row.invoice_number}</p>}
    </div>
  );
}

function RecentRecord({ row }: { row: any }) {
  const cost = row.total_cost ?? row.cost;
  return (
    <details className="rounded-lg border border-slate-200 bg-white p-4">
      <summary className="cursor-pointer">
        <span className="font-medium">Unit {row.vehicles?.unit_number ?? "-"}</span>
        <span className="ml-3 text-sm text-slate-500">{row.performed_date ?? "-"} · {row.service_type ?? "-"}</span>
      </summary>
      <div className="mt-3 grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
        <p>Mileage: {row.mileage == null ? "-" : `${Number(row.mileage).toLocaleString("en-US")} mi`}</p>
        <p>Maliyet: {cost == null ? "-" : `$${Number(cost).toFixed(2)}`}</p>
        <p>Shop: {row.shop_name ?? "-"}</p>
      </div>
    </details>
  );
}

export default async function MaintenanceOverviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
  const supabase = await createClient();
  const [rulesResult, settingsResult, profilesResult, findingsResult, vehiclesResult, recentResult, highCostResult] = await Promise.all([
    supabase
      .from("maintenance_rules")
      .select("id, service_type, interval_miles, interval_days, interval_engine_hours, last_done_mileage, last_done_date, last_done_engine_hours, vehicle_id, vehicles!maintenance_rules_vehicle_id_fkey(unit_number, current_mileage)")
      .eq("active", true),
    supabase
      .from("settings")
      .select("pm_due_soon_miles, pm_due_soon_days, pm_due_soon_engine_hours, repair_warning_amount")
      .single(),
    supabase.from("vehicle_maintenance_profiles").select("vehicle_id, engine_hours"),
    supabase
      .from("inspection_findings")
      .select("id, severity, label, recommended_action, vehicles!inspection_findings_vehicle_id_fkey(unit_number)")
      .eq("status", "open")
      .in("severity", ["critical", "do_not_dispatch"])
      .order("created_at", { ascending: false })
      .limit(12),
    supabase.from("vehicles").select("id, unit_number, current_mileage").eq("status", "active").order("unit_number"),
    supabase
      .from("maintenance_records")
      .select("id, service_type, performed_date, mileage, cost, total_cost, shop_name, source, vehicles!maintenance_records_vehicle_id_fkey(unit_number)")
      .is("deleted_at", null)
      .order("performed_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("maintenance_records")
      .select("id, service_type, performed_date, mileage, cost, total_cost, shop_name, invoice_number, planned, vehicles!maintenance_records_vehicle_id_fkey(unit_number)")
      .is("deleted_at", null)
      .eq("planned", false)
      .order("performed_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const firstError =
    rulesResult.error ??
    settingsResult.error ??
    profilesResult.error ??
    findingsResult.error ??
    vehiclesResult.error ??
    recentResult.error ??
    highCostResult.error;
  if (firstError) throw new Error(`Bakım merkezi yüklenemedi: ${firstError.message}`);

  const settings = settingsResult.data;
  const thresholds = {
    dueSoonMiles: Number(settings?.pm_due_soon_miles ?? 2_000),
    dueSoonDays: Number(settings?.pm_due_soon_days ?? 7),
    dueSoonEngineHours: Number(settings?.pm_due_soon_engine_hours ?? 100),
  };
  const engineHoursByVehicle = Object.fromEntries(
    ((profilesResult.data ?? []) as Array<{ vehicle_id: string; engine_hours: number | null }>).map((profile) => [
      profile.vehicle_id,
      profile.engine_hours == null ? null : Number(profile.engine_hours),
    ]),
  );
  const ruleRows = (rulesResult.data ?? []) as unknown as RuleRow[];
  const pmActions = buildPMActions(ruleRows, thresholds, engineHoursByVehicle);
  const overdueCount = pmActions.filter((item) => item.badge.label === "Gecikmiş" || item.badge.label === "Bugün").length;
  const dueSoonCount = pmActions.filter((item) => item.badge.label === "Yakında").length;
  const findings = (findingsResult.data ?? []) as unknown as FindingRow[];
  const vehicles = (vehiclesResult.data ?? []) as Array<{ id: string; unit_number: string; current_mileage: number | null }>;
  const activeRules = ruleRows.map((rule) => ({ vehicle_id: rule.vehicle_id, service_type: rule.service_type }));

  const findingActions: ActionItem[] = findings.map((finding) => ({
    kind: "finding",
    priority: finding.severity === "do_not_dispatch" ? 0 : 10,
    unit: finding.vehicles?.unit_number ?? "-",
    issue: finding.label ?? "Kritik inspection bulgusu",
    detail: finding.recommended_action ?? "Açık kritik bulgu var",
    href: "/maintenance/inspections",
    action: "Bulguyu Aç",
    badge: {
      label: finding.severity === "do_not_dispatch" ? "Sevke Çıkmasın" : "Kritik",
      className: "bg-red-100 text-red-700",
    },
  }));
  const actions = [...findingActions, ...pmActions]
    .sort((a, b) => a.priority - b.priority || a.unit.localeCompare(b.unit))
    .slice(0, 16);
  const recent = recentResult.data ?? [];
  const repairWarningAmount = Number(settings?.repair_warning_amount ?? 0);
  const highCostRepairs = (highCostResult.data ?? [])
    .filter((row: any) => Number(row.total_cost ?? row.cost ?? 0) >= repairWarningAmount && Number(row.total_cost ?? row.cost ?? 0) > 0)
    .slice(0, 5);

  return (
    <div className="space-y-6">
      <MaintenanceNav title="Bakım Merkezi" />

      <header>
        <p className="text-sm text-slate-500">Bugün ilgilenmeniz gereken araçlar ve bakım işlemleri.</p>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Hızlı işlemler">
        <ManualMaintenanceEntry
          vehicles={vehicles}
          activeRules={activeRules}
          initiallyOpen={first(params.add) === "1"}
          initialVehicleId={first(params.vehicleId)}
          initialKind={first(params.type) === "repair" ? "repair" : "periodic"}
          initialServiceType={first(params.service)}
          buttonLabel={MAINTENANCE_TERMS.addMaintenance}
          buttonClassName="flex min-h-24 items-center justify-between rounded-lg border border-brand bg-brand p-4 text-left font-semibold text-white shadow-sm transition hover:bg-brand/90"
        />
        <QuickAction href="/vehicles" label={MAINTENANCE_TERMS.updateMileage} />
        <QuickAction href="/maintenance/inspections" label={MAINTENANCE_TERMS.startInspection} />
        <OtherActionsMenu />
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Dikkat özeti">
        <SummaryCard label="Gecikmiş" value={overdueCount} tone={overdueCount > 0 ? "red" : "slate"} />
        <SummaryCard label="7 gün / 2.000 mil içinde" value={dueSoonCount} tone={dueSoonCount > 0 ? "amber" : "slate"} />
        <SummaryCard label="Açık kritik bulgu" value={findings.length} tone={findings.length > 0 ? "red" : "slate"} />
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">Bugünün İş Listesi</h2>
        {actions.length === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-500">
            Bugün ilgilenilecek bakım yok.
          </div>
        ) : (
          <ol className="space-y-3">
            {actions.map((item, index) => (
              <ActionRow key={`${item.kind}-${item.href}-${index}`} item={item} />
            ))}
          </ol>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">Yüksek Maliyetli Son Tamirler</h2>
        {highCostRepairs.length === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-500">
            Son dönemde yüksek maliyetli işlem yok.
          </div>
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {highCostRepairs.map((row: any) => <HighCostRepair key={row.id} row={row} />)}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold">Son Bakım Kayıtları</h2>
          <Link className="text-sm font-medium text-brand hover:underline" href="/maintenance/history">Tümünü Aç</Link>
        </div>
        {recent.length === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-500">Henüz bakım geçmişi yok.</div>
        ) : (
          <div className="space-y-2">
            {recent.map((row: any) => <RecentRecord key={row.id} row={row} />)}
          </div>
        )}
      </section>
    </div>
  );
}
