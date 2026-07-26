import MaintenanceInspectionWorkflow from "@/components/MaintenanceInspectionWorkflow";
import MaintenanceNav from "@/components/MaintenanceNav";
import MaintenancePagination from "@/components/MaintenancePagination";
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

export default async function MaintenanceInspectionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const findingCursor = decodeMaintenanceCursor(params.finding_cursor);
  const inspectionCursor = decodeMaintenanceCursor(params.inspection_cursor);
  const supabase = await createClient();
  let findingsQuery = supabase
    .from("inspection_findings")
    .select("id, vehicle_id, severity, status, label, notes, recommended_action, work_order_status, work_order_id, created_at, vehicles!inspection_findings_vehicle_id_fkey(unit_number)", { count: "exact" })
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(MAINTENANCE_PAGE_SIZE + 1);
  if (findingCursor) findingsQuery = findingsQuery.or(maintenanceKeysetFilter("created_at", findingCursor));
  let completedQuery = supabase
    .from("vehicle_inspections")
    .select("id, vehicle_id, inspection_type, inspection_date, mileage, engine_hours, inspector, shop, status, created_at, vehicles!vehicle_inspections_vehicle_id_fkey(unit_number)", { count: "exact" })
    .in("status", ["completed", "failed"])
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(MAINTENANCE_PAGE_SIZE + 1);
  if (inspectionCursor) completedQuery = completedQuery.or(maintenanceKeysetFilter("created_at", inspectionCursor));
  const [
    vehiclesResult,
    inspectionTemplatesResult,
    inspectionDraftsResult,
    inspectionFindingsResult,
    inspectionTrendsResult,
    rulesResult,
    completedResult,
    findingTotalResult,
    inspectionTotalResult,
  ] = await Promise.all([
    supabase.from("vehicles").select("id, unit_number").in("status", maintenanceVisibleVehicleStatuses()).order("unit_number"),
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
      .select("id, vehicle_id, template_id, inspection_type, inspection_date, inspector, shop, notes, maintenance_rule_id, mark_rule_serviced, updated_at")
      .eq("status", "draft")
      .order("updated_at", { ascending: false })
      .limit(25),
    findingsQuery,
    supabase
      .from("vehicle_inspection_results")
      .select("id, label, axle_position, value_number, unit_of_measure, created_at, vehicle_inspections!vehicle_inspection_results_inspection_same_org_fk(vehicle_id, vehicles!vehicle_inspections_vehicle_id_fkey(unit_number))")
      .not("value_number", "is", null)
      .order("created_at", { ascending: false })
      .limit(150),
    supabase.from("maintenance_rules").select("id, vehicle_id, service_type").eq("active", true),
    completedQuery,
    supabase
      .from("inspection_findings")
      .select("id", { count: "exact", head: true })
      .eq("status", "open"),
    supabase
      .from("vehicle_inspections")
      .select("id", { count: "exact", head: true })
      .in("status", ["completed", "failed"]),
  ]);

  const error =
    vehiclesResult.error ??
    inspectionTemplatesResult.error ??
    inspectionDraftsResult.error ??
    inspectionFindingsResult.error ??
    inspectionTrendsResult.error ??
    rulesResult.error ??
    completedResult.error ??
    findingTotalResult.error ??
    inspectionTotalResult.error;
  if (error) throw new Error(`Inspection verisi yüklenemedi: ${error.message}`);
  const findingsPage = nextMaintenanceCursor(inspectionFindingsResult.data ?? [], (row) => row.created_at);
  const inspectionsPage = nextMaintenanceCursor(completedResult.data ?? [], (row) => row.created_at);
  const findingsNextHref = findingsPage.nextCursor
    ? maintenancePageHref("/maintenance/inspections", params, "finding_cursor", findingsPage.nextCursor)
    : null;
  const inspectionsNextHref = inspectionsPage.nextCursor
    ? maintenancePageHref("/maintenance/inspections", params, "inspection_cursor", inspectionsPage.nextCursor)
    : null;

  return (
    <div className="space-y-5">
      <MaintenanceNav title="Bakım Merkezi" />
      <div>
        <h2 className="font-semibold">Inspection ve Bulgular</h2>
        <p className="mt-1 text-sm text-slate-500">Inspection başlatın, taslakları sürdürün, açık bulguları ve ölçüm geçmişini görün.</p>
      </div>

      <MaintenanceInspectionWorkflow
        vehicles={(vehiclesResult.data ?? []) as any}
        templates={(inspectionTemplatesResult.data ?? []).map((template: any) => ({
          id: template.id,
          name: template.name,
          inspection_type: template.inspection_type,
          version: template.version,
          items: template.items ?? [],
        }))}
        drafts={(inspectionDraftsResult.data ?? []) as any}
        rules={(rulesResult.data ?? []) as any}
        findings={findingsPage.rows as any}
        trends={(inspectionTrendsResult.data ?? []) as any}
        revalidatePath="/maintenance/inspections"
      />
      <MaintenancePagination
        totalCount={findingTotalResult.count ?? findingsPage.rows.length}
        shownCount={findingsPage.rows.length}
        nextHref={findingsNextHref}
        label="açık bulgu"
      />

      <div className="card overflow-x-auto p-0">
        <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
          <h2 className="font-semibold">Tamamlanan Inspectionlar</h2>
        </div>
        <table className="w-full">
          <thead className="border-b border-slate-200">
            <tr>
              <th className="th">Tarih</th>
              <th className="th">Araç</th>
              <th className="th">Tür</th>
              <th className="th">Mileage</th>
              <th className="th">Engine Hours</th>
              <th className="th">Inspector</th>
              <th className="th">Durum</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {inspectionsPage.rows.length === 0 ? (
              <tr><td className="td text-slate-400" colSpan={7}>Tamamlanan inspection yok.</td></tr>
            ) : inspectionsPage.rows.map((inspection: any) => (
              <tr key={inspection.id}>
                <td className="td">{inspection.inspection_date}</td>
                <td className="td font-medium">Unit {inspection.vehicles?.unit_number ?? "-"}</td>
                <td className="td">{inspection.inspection_type}</td>
                <td className="td">{inspection.mileage == null ? "-" : Number(inspection.mileage).toLocaleString("en-US")}</td>
                <td className="td">{inspection.engine_hours == null ? "-" : Number(inspection.engine_hours).toLocaleString("en-US")}</td>
                <td className="td">{inspection.inspector ?? "-"}</td>
                <td className="td"><span className="badge bg-slate-100 text-slate-700">{inspection.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <MaintenancePagination
        totalCount={inspectionTotalResult.count ?? inspectionsPage.rows.length}
        shownCount={inspectionsPage.rows.length}
        nextHref={inspectionsNextHref}
        label="tamamlanan inspection"
      />
    </div>
  );
}
