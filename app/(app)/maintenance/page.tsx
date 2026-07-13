import Link from "next/link";
import MaintenanceNav from "@/components/MaintenanceNav";
import {
  computePM,
  type PMResult,
  type PMStatus,
  type PMThresholds,
} from "@/lib/maintenance";
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

interface InvoiceRow {
  id: string;
  file_name: string;
  invoice_number: string | null;
  invoice_date: string | null;
  shop_name: string | null;
  vehicles: { unit_number: string } | null;
}

interface PMAction {
  kind: "maintenance";
  priority: number;
  unit: string;
  issue: string;
  detail: string;
  href: string;
  action: string;
  badge: { label: string; className: string };
}

interface SimpleAction {
  kind: "finding" | "invoice";
  priority: number;
  unit: string;
  issue: string;
  detail: string;
  href: string;
  action: string;
  badge: { label: string; className: string };
}

type ActionItem = PMAction | SimpleAction;

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
  if (pm.remaining === 0) return `Bugün yapılmalı`;
  return `${amount} ${unit} kaldı`;
}

function buildPMActions(
  rules: RuleRow[],
  thresholds: PMThresholds,
  engineHoursByVehicle: Record<string, number | null>,
): PMAction[] {
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
      kind: "maintenance" as const,
      priority: priority[pm.status],
      unit: rule.vehicles?.unit_number ?? "-",
      issue: rule.service_type,
      detail: formatAttentionAmount(pm),
      href: `/maintenance/units/${rule.vehicle_id}?tab=plans`,
      action: pm.status === "due_soon" ? "Planı Aç" : "Bakımı Kaydet",
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

export default async function MaintenanceOverviewPage() {
  const supabase = await createClient();
  const [rulesResult, settingsResult, profilesResult, findingsResult, inboxResult] = await Promise.all([
    supabase
      .from("maintenance_rules")
      .select("id, service_type, interval_miles, interval_days, interval_engine_hours, last_done_mileage, last_done_date, last_done_engine_hours, vehicle_id, vehicles!maintenance_rules_vehicle_id_fkey(unit_number, current_mileage)")
      .eq("active", true),
    supabase
      .from("settings")
      .select("pm_due_soon_miles, pm_due_soon_days, pm_due_soon_engine_hours")
      .single(),
    supabase.from("vehicle_maintenance_profiles").select("vehicle_id, engine_hours"),
    supabase
      .from("inspection_findings")
      .select("id, severity, label, recommended_action, vehicles!inspection_findings_vehicle_id_fkey(unit_number)")
      .eq("status", "open")
      .in("severity", ["critical", "do_not_dispatch"])
      .order("created_at", { ascending: false })
      .limit(12),
    supabase
      .from("maintenance_invoices")
      .select("id, file_name, invoice_number, invoice_date, shop_name, vehicles!maintenance_invoices_vehicle_id_fkey(unit_number)")
      .eq("status", "pending_review")
      .order("created_at", { ascending: false })
      .limit(12),
  ]);

  const firstError =
    rulesResult.error ??
    settingsResult.error ??
    profilesResult.error ??
    findingsResult.error ??
    inboxResult.error;
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

  const pmActions = buildPMActions((rulesResult.data ?? []) as unknown as RuleRow[], thresholds, engineHoursByVehicle);
  const overdueCount = pmActions.filter((item) => item.badge.label === "Gecikmiş" || item.badge.label === "Bugün").length;
  const dueSoonCount = pmActions.filter((item) => item.badge.label === "Yakında").length;
  const findings = (findingsResult.data ?? []) as unknown as FindingRow[];
  const invoices = (inboxResult.data ?? []) as unknown as InvoiceRow[];

  const findingActions: SimpleAction[] = findings.map((finding) => ({
    kind: "finding" as const,
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
  const invoiceActions: SimpleAction[] = invoices.map((invoice) => ({
    kind: "invoice" as const,
    priority: 40,
    unit: invoice.vehicles?.unit_number ?? "-",
    issue: invoice.shop_name ?? invoice.invoice_number ?? invoice.file_name,
    detail: invoice.invoice_date ? `${invoice.invoice_date} tarihli invoice inceleme bekliyor` : "İnceleme bekliyor",
    href: `/maintenance/invoices/${invoice.id}`,
    action: "İncele",
    badge: { label: "Invoice", className: "bg-slate-100 text-slate-700" },
  }));
  const actions = [...findingActions, ...pmActions, ...invoiceActions]
    .sort((a, b) => a.priority - b.priority || a.unit.localeCompare(b.unit))
    .slice(0, 16);

  return (
    <div className="space-y-6">
      <MaintenanceNav title="Bakım Merkezi" />

      <header>
        <p className="text-sm text-slate-500">Bugün ilgilenmeniz gereken araçlar ve bakım işlemleri.</p>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Hızlı işlemler">
        <QuickAction href="/vehicles" label="Mileage Güncelle" />
        <QuickAction href="/maintenance/invoices" label="PDF Invoice Yükle" />
        <QuickAction href="/maintenance/inspections" label="Inspection Başlat" />
        <QuickAction href="/maintenance/units" label="Manuel Bakım Kaydet" />
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Dikkat özeti">
        <SummaryCard label="Gecikmiş" value={overdueCount} tone={overdueCount > 0 ? "red" : "slate"} />
        <SummaryCard label="7 gün / 2.000 mil içinde" value={dueSoonCount} tone={dueSoonCount > 0 ? "amber" : "slate"} />
        <SummaryCard label="Açık kritik bulgu" value={findings.length} tone={findings.length > 0 ? "red" : "slate"} />
        <SummaryCard label="İnceleme bekleyen invoice" value={invoices.length} tone={invoices.length > 0 ? "amber" : "slate"} />
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Bugünün İş Listesi</h2>
          <details className="text-sm text-slate-500">
            <summary className="cursor-pointer text-brand">Detay</summary>
            <p className="mt-2 max-w-xl">
              Öncelik sırası: sevke çıkmaması gereken kritik bulgular, gecikmiş bakımlar, yaklaşan bakımlar ve inceleme bekleyen invoice kayıtları.
            </p>
          </details>
        </div>

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

      <section className="grid gap-3 md:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500">
          {findings.length === 0 ? "Açık kritik bulgu yok." : `${findings.length} kritik bulgu iş listesinde.`}
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500">
          {invoices.length === 0 ? "İnceleme bekleyen invoice yok." : `${invoices.length} invoice inceleme bekliyor.`}
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500">
          {pmActions.length === 0 ? "Bugün ilgilenilecek bakım yok." : `${pmActions.length} bakım işlemi dikkat istiyor.`}
        </div>
      </section>
    </div>
  );
}
