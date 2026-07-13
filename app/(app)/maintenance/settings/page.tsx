import InspectionTemplateManager from "@/components/InspectionTemplateManager";
import MaintenanceNav from "@/components/MaintenanceNav";
import MaintenanceRuleManager, { type RuleManagerRow } from "@/components/MaintenanceRuleManager";
import MaintenanceTemplateChecklistAssignments from "@/components/MaintenanceTemplateChecklistAssignments";
import MaintenanceTemplatesAdmin from "@/components/MaintenanceTemplatesAdmin";
import MileageSnapshotControls from "@/components/MileageSnapshotControls";
import { updateSettings } from "@/app/(app)/settings/actions";
import { MAINTENANCE_COST_CATEGORIES } from "@/lib/maintenance-cost";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function MaintenanceSettingsPage() {
  const supabase = await createClient();
  const [
    settingsRes,
    vehiclesRes,
    rulesRes,
    inspectionTemplatesRes,
    maintenanceTemplateItemsRes,
    maintenanceTemplatesRes,
  ] = await Promise.all([
    supabase.from("settings").select("*").single(),
    supabase.from("vehicles").select("id, unit_number").eq("status", "active").order("unit_number"),
    supabase
      .from("maintenance_rules")
      .select("*, vehicles!maintenance_rules_vehicle_id_fkey(unit_number)")
      .order("created_at", { ascending: false }),
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
      .from("maintenance_template_items")
      .select("id, service_type, default_inspection_template_id, maintenance_templates!maintenance_template_items_template_same_org_fk(name)")
      .eq("active", true)
      .order("sort_order"),
    supabase
      .from("maintenance_templates")
      .select(`
        id,
        name,
        description,
        warning,
        items:maintenance_template_items (
          id,
          service_type,
          service_category,
          interval_miles,
          interval_days,
          interval_engine_hours,
          configurable,
          duty_cycle_adjusted,
          active,
          sort_order
        )
      `)
      .order("name"),
  ]);

  const error =
    settingsRes.error ??
    vehiclesRes.error ??
    rulesRes.error ??
    inspectionTemplatesRes.error ??
    maintenanceTemplateItemsRes.error ??
    maintenanceTemplatesRes.error;
  if (error) throw new Error(`Maintenance settings yüklenemedi: ${error.message}`);

  const settings = settingsRes.data;
  const vehicles = (vehiclesRes.data ?? []) as Array<{ id: string; unit_number: string }>;

  return (
    <div className="space-y-5">
      <MaintenanceNav title="Bakım Merkezi" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">Maintenance Settings</h2>
          <p className="mt-1 text-sm text-slate-500">Günlük iş akışından ayrı yönetici ayarları.</p>
        </div>
        <span className="badge bg-slate-900 text-white">Yönetici Ayarı</span>
      </div>

      <AdminSection title="Uyarı Eşikleri" defaultOpen>
        <form action={updateSettings} className="grid max-w-2xl grid-cols-2 gap-3">
          <input name="default_commission" type="hidden" defaultValue={settings?.default_commission ?? 250} />
          <input name="fuel_warning_pct" type="hidden" defaultValue={Math.round((settings?.fuel_warning_pct ?? 0.3) * 100)} />
          <div>
            <label className="label">PM Due Soon (mil)</label>
            <input name="pm_due_soon_miles" type="number" defaultValue={settings?.pm_due_soon_miles ?? 2000} className="input" />
          </div>
          <div>
            <label className="label">PM Due Soon (gün)</label>
            <input name="pm_due_soon_days" type="number" min="1" step="1" defaultValue={settings?.pm_due_soon_days ?? 7} className="input" />
          </div>
          <div>
            <label className="label">PM Due Soon (engine hours)</label>
            <input name="pm_due_soon_engine_hours" type="number" min="1" step="1" defaultValue={settings?.pm_due_soon_engine_hours ?? 100} className="input" />
          </div>
          <div>
            <label className="label">Repair uyarı tutarı ($)</label>
            <input name="repair_warning_amount" type="number" step="0.01" defaultValue={settings?.repair_warning_amount ?? 5000} className="input" />
          </div>
          <div>
            <label className="label">Invoice allocation tolerance ($)</label>
            <input name="maintenance_invoice_allocation_tolerance" type="number" step="0.01" min="0" defaultValue={settings?.maintenance_invoice_allocation_tolerance ?? 1} className="input" />
          </div>
          <div className="col-span-2">
            <button type="submit" className="btn-primary">Kaydet</button>
          </div>
        </form>
      </AdminSection>

      <AdminSection title="Maintenance Templates">
        <MaintenanceTemplatesAdmin
          templates={(maintenanceTemplatesRes.data ?? []).map((template: any) => ({ ...template, items: template.items ?? [] }))}
          basePath="/maintenance/settings"
        />
        <div className="mt-4">
          <MaintenanceRuleManager
            rows={(rulesRes.data ?? []) as unknown as RuleManagerRow[]}
            vehicles={vehicles.map((vehicle) => ({ value: vehicle.id, label: vehicle.unit_number }))}
            basePath="/maintenance/settings"
          />
        </div>
      </AdminSection>

      <AdminSection title="Checklist Templates">
        <InspectionTemplateManager
          templates={(inspectionTemplatesRes.data ?? []).map((template: any) => ({ ...template, items: template.items ?? [] }))}
          basePath="/maintenance/settings"
        />
      </AdminSection>

      <AdminSection title="Default Checklist Assignments">
        <MaintenanceTemplateChecklistAssignments
          items={(maintenanceTemplateItemsRes.data ?? []) as any}
          inspectionTemplates={(inspectionTemplatesRes.data ?? []) as any}
          basePath="/maintenance/settings"
        />
      </AdminSection>

      <AdminSection title="Cost Categories">
        <div className="grid gap-2 md:grid-cols-3">
          {MAINTENANCE_COST_CATEGORIES.map((category) => (
            <div key={category} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
              {category.replace(/_/g, " ")}
            </div>
          ))}
        </div>
      </AdminSection>

      <AdminSection title="Advanced Data Tools">
        <MileageSnapshotControls vehicles={vehicles} />
      </AdminSection>
    </div>
  );
}

function AdminSection({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details className="rounded-lg border border-slate-200 bg-white" open={defaultOpen}>
      <summary className="flex cursor-pointer items-center justify-between px-4 py-3 font-semibold">
        <span>{title}</span>
        <span className="badge bg-slate-100 text-slate-700">Yönetici Ayarı</span>
      </summary>
      <div className="border-t border-slate-100 p-4">
        {children}
      </div>
    </details>
  );
}
