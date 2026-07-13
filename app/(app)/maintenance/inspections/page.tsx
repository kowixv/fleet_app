import MaintenanceInspectionWorkflow from "@/components/MaintenanceInspectionWorkflow";
import MaintenanceNav from "@/components/MaintenanceNav";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function MaintenanceInspectionsPage() {
  const supabase = await createClient();
  const [
    vehiclesResult,
    inspectionTemplatesResult,
    inspectionDraftsResult,
    inspectionFindingsResult,
    inspectionTrendsResult,
    rulesResult,
    completedResult,
  ] = await Promise.all([
    supabase.from("vehicles").select("id, unit_number").eq("status", "active").order("unit_number"),
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
      .eq("status", "draft")
      .order("updated_at", { ascending: false })
      .limit(25),
    supabase
      .from("inspection_findings")
      .select("id, vehicle_id, severity, status, label, notes, recommended_action, work_order_status, vehicles!inspection_findings_vehicle_id_fkey(unit_number)")
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("vehicle_inspection_results")
      .select("id, label, axle_position, value_number, unit_of_measure, created_at, vehicle_inspections!vehicle_inspection_results_inspection_same_org_fk(vehicle_id, vehicles!vehicle_inspections_vehicle_id_fkey(unit_number))")
      .not("value_number", "is", null)
      .order("created_at", { ascending: false })
      .limit(150),
    supabase.from("maintenance_rules").select("id, vehicle_id, service_type").eq("active", true),
    supabase
      .from("vehicle_inspections")
      .select("id, vehicle_id, inspection_type, inspection_date, mileage, engine_hours, inspector, shop, status, vehicles!vehicle_inspections_vehicle_id_fkey(unit_number)")
      .in("status", ["completed", "failed"])
      .order("inspection_date", { ascending: false })
      .limit(100),
  ]);

  const error =
    vehiclesResult.error ??
    inspectionTemplatesResult.error ??
    inspectionDraftsResult.error ??
    inspectionFindingsResult.error ??
    inspectionTrendsResult.error ??
    rulesResult.error ??
    completedResult.error;
  if (error) throw new Error(`Inspection verisi yüklenemedi: ${error.message}`);

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
        findings={(inspectionFindingsResult.data ?? []) as any}
        trends={(inspectionTrendsResult.data ?? []) as any}
        revalidatePath="/maintenance/inspections"
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
            {(completedResult.data ?? []).length === 0 ? (
              <tr><td className="td text-slate-400" colSpan={7}>Tamamlanan inspection yok.</td></tr>
            ) : (completedResult.data ?? []).map((inspection: any) => (
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
    </div>
  );
}
