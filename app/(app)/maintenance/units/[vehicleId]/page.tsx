import Link from "next/link";
import MaintenanceInspectionWorkflow from "@/components/MaintenanceInspectionWorkflow";
import MaintenanceNav from "@/components/MaintenanceNav";
import UnitMaintenancePlans from "@/components/UnitMaintenancePlans";
import UnitMileageInline from "@/components/UnitMileageInline";
import VehicleMaintenanceCostPanel from "@/components/VehicleMaintenanceCostPanel";
import VehicleThumbnail from "@/components/VehicleThumbnail";
import DispatchHoldClearForm from "@/components/DispatchHoldClearForm";
import {
  computePM,
  formatPMRemaining,
  PM_BADGE,
  type PMResult,
  type PMStatus,
} from "@/lib/maintenance";
import { expandEffectiveMaintenanceRules } from "@/lib/maintenance-reminders";
import { usd } from "@/lib/format";
import { MAINTENANCE_TERMS } from "@/lib/maintenance-terminology";
import { findingSeverityLabel } from "@/lib/inspection";
import { createClient } from "@/lib/supabase/server";
import { todayISO } from "@/lib/tz";
import { getMaintenanceCostAnalytics } from "@/lib/maintenance/service";
import MaintenancePagination from "@/components/MaintenancePagination";
import {
  decodeMaintenanceCursor,
  maintenanceKeysetFilter,
  maintenancePageHref,
  MAINTENANCE_PAGE_SIZE,
  nextMaintenanceCursor,
} from "@/lib/maintenance/pagination";

export const dynamic = "force-dynamic";

type Tab = "summary" | "plans" | "history" | "inspections" | "costs" | "mileage";

interface OpenDispatchHold {
  id: string;
  reason: string;
  severity: "critical" | "do_not_dispatch";
  source_type: string;
  source_id: string;
  created_at: string;
  clearance_notes: string | null;
}

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "summary", label: "Özet" },
  { id: "plans", label: "Hatırlatıcılar" },
  { id: "history", label: "Geçmiş" },
  { id: "inspections", label: "Inspectionlar" },
  { id: "costs", label: "Maliyetler" },
  { id: "mileage", label: "Mileage" },
];

function selectedTab(value: string | string[] | undefined): Tab {
  const raw = Array.isArray(value) ? value[0] : value;
  return TABS.some((tab) => tab.id === raw) ? raw as Tab : "summary";
}

function tabHref(vehicleId: string, tab: Tab) {
  return `/maintenance/units/${vehicleId}${tab === "summary" ? "" : `?tab=${tab}`}`;
}

function daysAgo(days: number): string {
  const [year, month, day] = todayISO().split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function statusPriority(status: PMStatus) {
  return status === "overdue" ? 0 : status === "due_now" ? 1 : status === "due_soon" ? 2 : status === "warning" ? 3 : status === "setup_required" ? 4 : 5;
}

function overallStatus(results: PMResult[]) {
  const status = [...results].sort((a, b) => statusPriority(a.status) - statusPriority(b.status))[0]?.status ?? "ok";
  return { status, label: status === "ok" ? "Tamam" : status === "warning" ? "Yaklaşıyor" : status === "due_soon" ? "Yakında" : status === "due_now" ? "Bugün" : status === "setup_required" ? "Kurulum Gerekli" : "Gecikmiş" };
}

function triggerText(pm: PMResult) {
  if (pm.triggeredBy === "miles") return "Mil sınırı önce doldu";
  if (pm.triggeredBy === "days") return "Tarih sınırı önce doldu";
  if (pm.triggeredBy === "engine_hours") return "Engine saat sınırı önce doldu";
  return "Sınır hesaplanamadı";
}

function firstRelevantRules(rulesWithPm: Array<{ rule: any; pm: PMResult }>, count: number) {
  return [...rulesWithPm]
    .filter(({ pm }) => pm.status !== "ok")
    .sort((a, b) => statusPriority(a.pm.status) - statusPriority(b.pm.status) || (a.pm.remaining ?? 0) - (b.pm.remaining ?? 0))
    .slice(0, count);
}

export default async function MaintenanceUnitDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ vehicleId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { vehicleId } = await params;
  const query = await searchParams;
  const tab = selectedTab(query.tab);
  const supabase = await createClient();
  const [vehicleRes, rulesRes, settingsRes, profileRes, criticalFindingsRes, holdsRes] = await Promise.all([
    supabase.from("vehicles").select("id, unit_number, vehicle_type, current_mileage, vin, year, make, model, truck_color, status").eq("id", vehicleId).single(),
    supabase
      .from("maintenance_rules")
      .select("id, vehicle_id, vehicle_type, service_type, active, interval_miles, interval_days, interval_engine_hours, last_done_mileage, last_done_date, last_done_engine_hours")
      .order("created_at", { ascending: false }),
    supabase.from("settings").select("pm_due_soon_miles, pm_due_soon_days, pm_due_soon_engine_hours, repair_warning_amount").single(),
    supabase.from("vehicle_maintenance_profiles").select("*").eq("vehicle_id", vehicleId).maybeSingle(),
    supabase
      .from("inspection_findings")
      .select("id, vehicle_id, severity, status, label, notes, recommended_action, work_order_status, work_order_id, vehicles!inspection_findings_vehicle_id_fkey(unit_number)")
      .eq("vehicle_id", vehicleId)
      .eq("status", "open")
      .in("severity", ["critical", "do_not_dispatch"])
      .order("created_at", { ascending: false }),
    supabase
      .from("vehicle_dispatch_holds")
      .select("id, reason, severity, source_type, source_id, created_at, clearance_notes")
      .eq("vehicle_id", vehicleId)
      .eq("status", "open")
      .order("created_at", { ascending: false }),
  ]);
  const baseError = vehicleRes.error ?? rulesRes.error ?? settingsRes.error ?? profileRes.error ?? criticalFindingsRes.error ?? holdsRes.error;
  if (baseError) throw new Error(`Araç detayı yüklenemedi: ${baseError.message}`);
  if (!vehicleRes.data) throw new Error("Araç bulunamadı.");

  const vehicle = vehicleRes.data as any;
  const profile = profileRes.data as any;
  const settings = settingsRes.data;
  const thresholds = {
    dueSoonMiles: Number(settings?.pm_due_soon_miles ?? 2_000),
    dueSoonDays: Number(settings?.pm_due_soon_days ?? 7),
    dueSoonEngineHours: Number(settings?.pm_due_soon_engine_hours ?? 100),
  };
  const statesRes = await supabase
    .from("maintenance_rule_vehicle_states")
    .select("id, rule_id, vehicle_id, last_done_mileage, last_done_date, last_done_engine_hours")
    .eq("vehicle_id", vehicleId);
  if (statesRes.error) throw new Error(`Araç hatırlatıcı state yüklenemedi: ${statesRes.error.message}`);
  const rules = expandEffectiveMaintenanceRules(
    ((rulesRes.data ?? []) as any[]).filter((rule) => rule.vehicle_id === vehicleId || (rule.vehicle_id == null && rule.vehicle_type === vehicle.vehicle_type)),
    [vehicle],
    (statesRes.data ?? []) as any[],
    true,
  ).filter((rule) => rule.active);
  const rulesWithPm = rules.map((rule) => ({
    rule,
    pm: computePM(rule, Number(vehicle.current_mileage ?? 0), thresholds, todayISO(), profile?.engine_hours ?? null),
  }));
  const status = overallStatus(rulesWithPm.map(({ pm }) => pm));
  const criticalFindings = (criticalFindingsRes.data ?? []) as any[];
  const dispatchHolds: OpenDispatchHold[] = holdsRes.data ?? [];

  let content: React.ReactNode;
  if (tab === "plans") {
    content = (
      <UnitMaintenancePlans
        rules={rules}
        currentMileage={vehicle.current_mileage}
        engineHours={profile?.engine_hours ?? null}
        thresholds={thresholds}
      />
    );
  } else if (tab === "history") {
    const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
    const historyCursor = decodeMaintenanceCursor(query.history_cursor);
    let historyQuery = supabase
      .from("maintenance_records")
      .select("*, vehicles!maintenance_records_vehicle_id_fkey(unit_number), maintenance_invoices(file_name, invoice_number)", { count: "exact" })
      .eq("vehicle_id", vehicleId)
      .is("deleted_at", null)
      .is("undone_at", null)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(MAINTENANCE_PAGE_SIZE + 1);
    if (first(query.history_start)) historyQuery = historyQuery.gte("performed_date", first(query.history_start)!);
    if (first(query.history_end)) historyQuery = historyQuery.lte("performed_date", first(query.history_end)!);
    if (first(query.history_category) && first(query.history_category) !== "all") historyQuery = historyQuery.eq("category", first(query.history_category)!);
    if (first(query.history_shop)) historyQuery = historyQuery.ilike("shop_name", `%${first(query.history_shop)}%`);
    if (first(query.history_invoice) === "yes") historyQuery = historyQuery.not("invoice_id", "is", null);
    if (first(query.history_invoice) === "no") historyQuery = historyQuery.is("invoice_id", null);
    let historyTotalQuery = supabase
      .from("maintenance_records")
      .select("id", { count: "exact", head: true })
      .eq("vehicle_id", vehicleId)
      .is("deleted_at", null)
      .is("undone_at", null);
    if (first(query.history_start)) historyTotalQuery = historyTotalQuery.gte("performed_date", first(query.history_start)!);
    if (first(query.history_end)) historyTotalQuery = historyTotalQuery.lte("performed_date", first(query.history_end)!);
    if (first(query.history_category) && first(query.history_category) !== "all") historyTotalQuery = historyTotalQuery.eq("category", first(query.history_category)!);
    if (first(query.history_shop)) historyTotalQuery = historyTotalQuery.ilike("shop_name", `%${first(query.history_shop)}%`);
    if (first(query.history_invoice) === "yes") historyTotalQuery = historyTotalQuery.not("invoice_id", "is", null);
    if (first(query.history_invoice) === "no") historyTotalQuery = historyTotalQuery.is("invoice_id", null);
    if (historyCursor) historyQuery = historyQuery.or(maintenanceKeysetFilter("created_at", historyCursor));
    const [historyRes, historyTotalRes] = await Promise.all([historyQuery, historyTotalQuery]);
    const historyError = historyRes.error ?? historyTotalRes.error;
    if (historyError) throw new Error(`Bakım geçmişi yüklenemedi: ${historyError.message}`);
    const historyPage = nextMaintenanceCursor(historyRes.data ?? [], (row) => row.created_at);
    const historyNextHref = historyPage.nextCursor
      ? maintenancePageHref(`/maintenance/units/${vehicleId}`, query, "history_cursor", historyPage.nextCursor)
      : null;
    content = (
      <section className="space-y-4">
        <HistoryPanel rows={historyPage.rows as any[]} params={query} />
        <MaintenancePagination
          totalCount={historyTotalRes.count ?? historyPage.rows.length}
          shownCount={historyPage.rows.length}
          nextHref={historyNextHref}
        />
      </section>
    );
  } else if (tab === "inspections") {
    const findingCursor = decodeMaintenanceCursor(query.finding_cursor);
    const inspectionCursor = decodeMaintenanceCursor(query.inspection_cursor);
    let unitFindingsQuery = supabase
      .from("inspection_findings")
      .select("id, vehicle_id, severity, status, label, notes, recommended_action, work_order_status, work_order_id, created_at, vehicles!inspection_findings_vehicle_id_fkey(unit_number)", { count: "exact" })
      .eq("vehicle_id", vehicleId)
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(MAINTENANCE_PAGE_SIZE + 1);
    if (findingCursor) unitFindingsQuery = unitFindingsQuery.or(maintenanceKeysetFilter("created_at", findingCursor));
    let unitCompletedQuery = supabase
      .from("vehicle_inspections")
      .select("id, inspection_type, inspection_date, mileage, engine_hours, inspector, shop, status, created_at", { count: "exact" })
      .eq("vehicle_id", vehicleId)
      .in("status", ["completed", "failed"])
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(MAINTENANCE_PAGE_SIZE + 1);
    if (inspectionCursor) unitCompletedQuery = unitCompletedQuery.or(maintenanceKeysetFilter("created_at", inspectionCursor));
    const [
      templatesInspectionRes,
      draftsRes,
      inspectionRulesRes,
      findingsRes,
      trendsRes,
      completedRes,
      findingTotalRes,
      inspectionTotalRes,
    ] = await Promise.all([
      supabase
        .from("inspection_templates")
        .select(`
          id,
          name,
          inspection_type,
          version,
          items:inspection_template_items (
            id,
            section,
            label,
            input_type,
            unit_of_measure,
            required,
            warning_threshold,
            critical_threshold,
            axle_position,
            select_options,
            instructions,
            sort_order,
            active
          )
        `)
        .eq("active", true)
        .order("name"),
      supabase
        .from("vehicle_inspections")
        .select("id, vehicle_id, template_id, inspection_type, inspection_date, inspector, shop, notes, maintenance_rule_id")
        .eq("vehicle_id", vehicleId)
        .eq("status", "draft")
        .order("updated_at", { ascending: false })
        .limit(25),
      supabase.from("maintenance_rules").select("id, vehicle_id, service_type").eq("vehicle_id", vehicleId).eq("active", true),
      unitFindingsQuery,
      supabase
        .from("vehicle_inspection_results")
        .select("id, label, axle_position, value_number, unit_of_measure, created_at, vehicle_inspections!vehicle_inspection_results_inspection_same_org_fk(vehicle_id, vehicles!vehicle_inspections_vehicle_id_fkey(unit_number))")
        .not("value_number", "is", null)
        .order("created_at", { ascending: false })
        .limit(150),
      unitCompletedQuery,
      supabase
        .from("inspection_findings")
        .select("id", { count: "exact", head: true })
        .eq("vehicle_id", vehicleId)
        .eq("status", "open"),
      supabase
        .from("vehicle_inspections")
        .select("id", { count: "exact", head: true })
        .eq("vehicle_id", vehicleId)
        .in("status", ["completed", "failed"]),
    ]);
    const error =
      templatesInspectionRes.error ??
      draftsRes.error ??
      inspectionRulesRes.error ??
      findingsRes.error ??
      trendsRes.error ??
      completedRes.error ??
      findingTotalRes.error ??
      inspectionTotalRes.error;
    if (error) throw new Error(`Inspection verisi yüklenemedi: ${error.message}`);
    const findingsPage = nextMaintenanceCursor(findingsRes.data ?? [], (row) => row.created_at);
    const inspectionsPage = nextMaintenanceCursor(completedRes.data ?? [], (row) => row.created_at);
    const findingsNextHref = findingsPage.nextCursor
      ? maintenancePageHref(`/maintenance/units/${vehicleId}`, query, "finding_cursor", findingsPage.nextCursor)
      : null;
    const inspectionsNextHref = inspectionsPage.nextCursor
      ? maintenancePageHref(`/maintenance/units/${vehicleId}`, query, "inspection_cursor", inspectionsPage.nextCursor)
      : null;
    content = (
      <section className="space-y-4">
        <MaintenanceInspectionWorkflow
          vehicles={[vehicle]}
          templates={(templatesInspectionRes.data ?? []).map((template: any) => ({ ...template, items: template.items ?? [] }))}
          drafts={(draftsRes.data ?? []) as any}
          rules={(inspectionRulesRes.data ?? []) as any}
          findings={findingsPage.rows as any}
          trends={(trendsRes.data ?? []) as any}
          revalidatePath={`/maintenance/units/${vehicleId}?tab=inspections`}
        />
        <MaintenancePagination
          totalCount={findingTotalRes.count ?? findingsPage.rows.length}
          shownCount={findingsPage.rows.length}
          nextHref={findingsNextHref}
          label="açık bulgu"
        />
        <SimpleInspectionHistory rows={inspectionsPage.rows as any[]} />
        <MaintenancePagination
          totalCount={inspectionTotalRes.count ?? inspectionsPage.rows.length}
          shownCount={inspectionsPage.rows.length}
          nextHref={inspectionsNextHref}
          label="tamamlanan inspection"
        />
      </section>
    );
  } else if (tab === "costs") {
    const end = todayISO();
    const base = { vehicleId, end, averageDailyContribution: 0, planned: "all" as const };
    const [summary30, summary90, summary365, allTime] = await Promise.all([
      getMaintenanceCostAnalytics(supabase, { ...base, start: daysAgo(30) }),
      getMaintenanceCostAnalytics(supabase, { ...base, start: daysAgo(90) }),
      getMaintenanceCostAnalytics(supabase, { ...base, start: daysAgo(365) }),
      getMaintenanceCostAnalytics(supabase, { ...base, start: "2000-01-01" }),
    ]);
    content = (
      <VehicleMaintenanceCostPanel
        unitNumber={vehicle.unit_number}
        summary30={summary30}
        summary90={summary90}
        summary365={summary365}
        allTime={allTime}
      />
    );
  } else if (tab === "mileage") {
    const mileageCursor = decodeMaintenanceCursor(query.mileage_cursor);
    let logsQuery = supabase
      .from("vehicle_mileage_logs")
      .select("id, mileage, logged_at, source", { count: "exact" })
      .eq("vehicle_id", vehicleId)
      .order("logged_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(MAINTENANCE_PAGE_SIZE + 1);
    if (mileageCursor) logsQuery = logsQuery.or(maintenanceKeysetFilter("logged_at", mileageCursor));
    const [logsRes, logsTotalRes] = await Promise.all([
      logsQuery,
      supabase
        .from("vehicle_mileage_logs")
        .select("id", { count: "exact", head: true })
        .eq("vehicle_id", vehicleId),
    ]);
    const logsError = logsRes.error ?? logsTotalRes.error;
    if (logsError) throw new Error(`Mileage logları yüklenemedi: ${logsError.message}`);
    const mileagePage = nextMaintenanceCursor(logsRes.data ?? [], (row) => row.logged_at);
    const mileageNextHref = mileagePage.nextCursor
      ? maintenancePageHref(`/maintenance/units/${vehicleId}`, query, "mileage_cursor", mileagePage.nextCursor)
      : null;
    content = (
      <section className="space-y-4">
        <div className="card">
          <h2 className="font-semibold">Mileage Düzeltme</h2>
          <p className="mt-1 text-sm text-slate-500">Mileage geçmişe kaydedilir; düşük değer current mileage değerini düşürmez.</p>
          <div className="mt-3">
            <UnitMileageInline vehicleId={vehicle.id} unitNumber={vehicle.unit_number} currentMileage={vehicle.current_mileage} />
          </div>
        </div>
        <MileageHistory rows={mileagePage.rows as any[]} />
        <MaintenancePagination
          totalCount={logsTotalRes.count ?? mileagePage.rows.length}
          shownCount={mileagePage.rows.length}
          nextHref={mileageNextHref}
        />
      </section>
    );
  } else {
    const [historyRes, findingsRes, cost90] = await Promise.all([
      supabase
        .from("maintenance_records")
        .select("*, vehicles!maintenance_records_vehicle_id_fkey(unit_number), maintenance_invoices(file_name, invoice_number)")
        .eq("vehicle_id", vehicleId)
        .is("deleted_at", null)
        .order("performed_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(5),
      supabase
        .from("inspection_findings")
        .select("id, severity, label, notes, recommended_action")
        .eq("vehicle_id", vehicleId)
        .eq("status", "open")
        .order("created_at", { ascending: false })
        .limit(10),
      getMaintenanceCostAnalytics(supabase, {
        vehicleId,
        start: daysAgo(90),
        end: todayISO(),
        averageDailyContribution: 0,
        planned: "all",
      }),
    ]);
    const error = historyRes.error ?? findingsRes.error;
    if (error) throw new Error(`Unit özet yüklenemedi: ${error.message}`);
    content = (
      <section className="grid gap-4 xl:grid-cols-2">
        <SummaryList title="Sıradaki 3 Bakım" rows={firstRelevantRules(rulesWithPm, 3)} />
        <SummaryList title="Gecikmiş Bakımlar" rows={rulesWithPm.filter(({ pm }) => pm.status === "overdue" || pm.status === "due_now")} />
        <LastServices rows={(historyRes.data ?? []) as any[]} />
        <OpenFindings rows={(findingsRes.data ?? []) as any[]} />
        <div className="card xl:col-span-2">
          <h2 className="font-semibold">90 Günlük Bakım Maliyeti</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <Stat label="Toplam" value={usd(cost90.totalCost)} />
            <Stat label="CPM" value={cost90.fleetCpm == null ? "Mileage verisi yetersiz" : `${usd(cost90.fleetCpm)} / mi`} />
            <Stat label="Planlı / Plansız" value={`${usd(cost90.plannedCost)} / ${usd(cost90.unscheduledCost)}`} />
          </div>
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-5">
      <MaintenanceNav title="Bakım Merkezi" />
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <VehicleThumbnail
                make={vehicle.make}
                model={vehicle.model}
                color={vehicle.truck_color}
                vehicleType={vehicle.vehicle_type}
                size="detail"
              />
              <div>
                <p className="text-sm text-slate-500">Unit</p>
                <h1 className="text-2xl font-bold">{vehicle.unit_number}</h1>
                <p className="text-xs text-slate-500">{[vehicle.make, vehicle.model].filter(Boolean).join(" ") || vehicle.vehicle_type}</p>
              </div>
            </div>
            <UnitMileageInline vehicleId={vehicle.id} unitNumber={vehicle.unit_number} currentMileage={vehicle.current_mileage} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Engine Hours" value={profile?.engine_hours == null ? "-" : Number(profile.engine_hours).toLocaleString("en-US")} />
            <Stat label="Duty Cycle" value={profile?.duty_cycle ? String(profile.duty_cycle).replace(/_/g, " ") : "-"} />
            <Stat label="Durum" value={status.label} badgeClass={PM_BADGE[status.status]} />
            <Stat label="Açık Kritik Bulgu" value={String(criticalFindings.length)} badgeClass={criticalFindings.length > 0 ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"} />
          </div>
        </div>
        {dispatchHolds.length > 0 && (
          <div className="mt-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-red-800">
            <p className="text-lg font-bold">SEVKE ÇIKMASIN</p>
            <p className="mt-1 text-sm">Bu unit için açık dispatch hold var. Hold temizlenmeden yeni yük atanamaz.</p>
            <div className="mt-3 space-y-3">
              {dispatchHolds.map((hold) => (
                <div key={hold.id} className="rounded-md border border-red-200 bg-white/70 p-3">
                  <p className="text-sm font-semibold">{hold.reason}</p>
                  <p className="mt-1 text-xs">Önem: {findingSeverityLabel(hold.severity)} · {new Date(hold.created_at).toLocaleString("en-US")}</p>
                  <DispatchHoldClearForm holdId={hold.id} />
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <Link className="btn-primary" href={`/maintenance?add=1&vehicleId=${vehicleId}`}>{MAINTENANCE_TERMS.addMaintenance}</Link>
          <Link className="btn-ghost" href={tabHref(vehicleId, "mileage")}>{MAINTENANCE_TERMS.updateMileage}</Link>
          <Link className="btn-ghost" href={tabHref(vehicleId, "inspections")}>{MAINTENANCE_TERMS.startInspection}</Link>
          <details className="relative">
            <summary className="btn-ghost cursor-pointer list-none">{MAINTENANCE_TERMS.otherActions}</summary>
            <div className="absolute right-0 z-10 mt-2 w-56 rounded-lg border border-slate-200 bg-white p-2 text-sm shadow-lg">
              <Link className="block rounded-md px-2 py-1.5 hover:bg-slate-100" href={`/maintenance/invoices?vehicleId=${vehicleId}`}>Invoice Yükle</Link>
              <Link className="block rounded-md px-2 py-1.5 hover:bg-slate-100" href={`/vehicles/${vehicleId}`}>Unit Ayarları</Link>
              <Link className="block rounded-md px-2 py-1.5 hover:bg-slate-100" href="/maintenance/settings">Gelişmiş İşlemler</Link>
            </div>
          </details>
        </div>
      </section>
      <nav className="flex gap-2 overflow-x-auto border-b border-slate-200 pb-2 text-sm">
        {TABS.map((item) => (
          <Link
            key={item.id}
            href={tabHref(vehicleId, item.id)}
            className={`whitespace-nowrap rounded-md px-3 py-1.5 ${
              item.id === tab ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            }`}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      {content}
    </div>
  );
}

function Stat({ label, value, badgeClass }: { label: string; value: string; badgeClass?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`mt-1 text-lg font-bold ${badgeClass ? `badge ${badgeClass}` : ""}`}>{value}</p>
    </div>
  );
}

function SummaryList({ title, rows }: { title: string; rows: Array<{ rule: any; pm: PMResult }> }) {
  return (
    <div className="card">
      <h2 className="font-semibold">{title}</h2>
      <div className="mt-3 space-y-2">
        {rows.length === 0 ? <p className="text-sm text-slate-400">Kayıt yok.</p> : rows.map(({ rule, pm }) => (
          <div key={rule.id} className="rounded-lg border border-slate-100 p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium">{rule.service_type}</span>
              <span className={`badge ${PM_BADGE[pm.status]}`}>{pm.label}</span>
            </div>
            <p className="mt-1 text-sm text-slate-600">{formatPMRemaining(pm)}</p>
            <p className="mt-1 text-xs text-slate-500">{triggerText(pm)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function LastServices({ rows }: { rows: any[] }) {
  return (
    <div className="card">
      <h2 className="font-semibold">Son 5 Tamamlanan Servis</h2>
      <div className="mt-3 space-y-2">
        {rows.length === 0 ? <p className="text-sm text-slate-400">Servis geçmişi yok.</p> : rows.map((row) => (
          <div key={row.id} className="rounded-lg border border-slate-100 p-3 text-sm">
            <div className="flex justify-between gap-3">
              <span className="font-medium">{row.service_type ?? "-"}</span>
              <span className="text-slate-500">{row.performed_date ?? "-"}</span>
            </div>
            <p className="text-slate-500">{row.shop_name ?? "Shop yok"} · {row.cost == null ? "$0.00" : usd(Number(row.cost))}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function OpenFindings({ rows }: { rows: any[] }) {
  return (
    <div className="card">
      <h2 className="font-semibold">Açık Bulgular</h2>
      <div className="mt-3 space-y-2">
        {rows.length === 0 ? <p className="text-sm text-slate-400">Açık bulgu yok.</p> : rows.map((row) => (
          <div key={row.id} className="rounded-lg border border-slate-100 p-3 text-sm">
            <span className={`badge ${row.severity === "do_not_dispatch" || row.severity === "critical" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>{findingSeverityLabel(row.severity)}</span>
            <p className="mt-1 font-medium">{row.label ?? "-"}</p>
            <p className="text-slate-500">{row.recommended_action ?? row.notes ?? "-"}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function HistoryPanel({ rows, params }: { rows: any[]; params: Record<string, string | string[] | undefined> }) {
  const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
  return (
    <section className="space-y-4">
      <form className="card grid gap-3 md:grid-cols-5">
        <input type="hidden" name="tab" value="history" />
        <div>
          <label className="label">Başlangıç</label>
          <input className="input" type="date" name="history_start" defaultValue={first(params.history_start) ?? ""} />
        </div>
        <div>
          <label className="label">Bitiş</label>
          <input className="input" type="date" name="history_end" defaultValue={first(params.history_end) ?? ""} />
        </div>
        <div>
          <label className="label">Kategori</label>
          <input className="input" name="history_category" defaultValue={first(params.history_category) ?? ""} placeholder="Preventive Maintenance" />
        </div>
        <div>
          <label className="label">Shop</label>
          <input className="input" name="history_shop" defaultValue={first(params.history_shop) ?? ""} />
        </div>
        <div>
          <label className="label">Invoice</label>
          <select className="input" name="history_invoice" defaultValue={first(params.history_invoice) ?? "all"}>
            <option value="all">Hepsi</option>
            <option value="yes">Invoice var</option>
            <option value="no">Invoice yok</option>
          </select>
        </div>
        <div className="md:col-span-5">
          <button className="btn-primary" type="submit">Filtrele</button>
        </div>
      </form>
      <div className="space-y-2">
        {rows.length === 0 ? <div className="card text-sm text-slate-400">Bakım geçmişi bulunamadı.</div> : rows.map((row) => (
          <details key={row.id} className="rounded-lg border border-slate-200 bg-white p-4">
            <summary className="cursor-pointer">
              <span className="font-medium">{row.service_type ?? "-"}</span>
              <span className="ml-3 text-sm text-slate-500">{row.performed_date ?? "-"} · {row.shop_name ?? "Shop yok"} · {usd(Number(row.cost ?? row.total_cost ?? 0))}</span>
            </summary>
            <div className="mt-3 grid gap-2 text-sm text-slate-600 md:grid-cols-2">
              <p>Parts: {row.parts_used?.length ? row.parts_used.join(", ") : row.part_name ?? "-"}</p>
              <p>Invoice: {row.maintenance_invoices?.invoice_number ?? row.maintenance_invoices?.file_name ?? "-"}</p>
              <p>Not: {row.notes ?? "-"}</p>
              <p>Maliyet: {usd(Number(row.cost ?? row.total_cost ?? 0))}</p>
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}

function SimpleInspectionHistory({ rows }: { rows: any[] }) {
  return (
    <div className="card">
      <h2 className="font-semibold">Tamamlanan Inspection Geçmişi</h2>
      <div className="mt-3 space-y-2">
        {rows.length === 0 ? <p className="text-sm text-slate-400">Tamamlanan inspection yok.</p> : rows.map((row) => (
          <div key={row.id} className="rounded-lg border border-slate-100 p-3 text-sm">
            <div className="flex flex-wrap justify-between gap-3">
              <span className="font-medium">{row.inspection_type}</span>
              <span className="text-slate-500">{row.inspection_date}</span>
            </div>
            <p className="text-slate-500">{row.inspector ?? "-"} · {row.shop ?? "-"} · {row.status}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function MileageHistory({ rows }: { rows: any[] }) {
  return (
    <div className="card overflow-x-auto p-0">
      <table className="w-full">
        <thead className="border-b border-slate-200 bg-slate-50">
          <tr>
            <th className="th">Tarih</th>
            <th className="th">Mileage</th>
            <th className="th">Kaynak</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.length === 0 ? (
            <tr><td className="td text-slate-400" colSpan={3}>Mileage logu yok.</td></tr>
          ) : rows.map((log) => (
            <tr key={log.id}>
              <td className="td whitespace-nowrap">{new Date(log.logged_at).toLocaleString("en-US")}</td>
              <td className="td">{Number(log.mileage).toLocaleString("en-US")} mi</td>
              <td className="td">{log.source ?? "manual"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
