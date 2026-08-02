import InspectionTemplateManager from "@/components/InspectionTemplateManager";
import Link from "next/link";
import MaintenanceNav from "@/components/MaintenanceNav";
import MileageSnapshotControls from "@/components/MileageSnapshotControls";
import { updateSettings } from "@/app/(app)/settings/actions";
import { updateVehicleMaintenanceDefaults } from "@/app/(app)/vehicles/maintenance-setup-actions";
import { MAINTENANCE_COST_CATEGORIES } from "@/lib/maintenance-cost";
import { formatMaintenanceCategory } from "@/lib/maintenance-terminology";
import { maintenanceVisibleVehicleStatuses } from "@/lib/maintenance-vehicle-status";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function MaintenanceSettingsPage() {
  const supabase = await createClient();
  const [settingsRes, vehiclesRes, inspectionTemplatesRes] = await Promise.all([
    supabase.from("settings").select("*").single(),
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
  ]);

  const error = settingsRes.error ?? vehiclesRes.error ?? inspectionTemplatesRes.error;
  if (error) throw new Error(`Maintenance settings yüklenemedi: ${error.message}`);

  const settings = settingsRes.data;
  const vehicles = (vehiclesRes.data ?? []) as Array<{ id: string; unit_number: string }>;

  return (
    <div className="space-y-5">
      <MaintenanceNav title="Bakım Merkezi" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">Bakım Ayarları</h2>
          <p className="mt-1 text-sm text-slate-500">Günlük iş akışından ayrı yönetici ayarları.</p>
        </div>
        <span className="badge bg-slate-900 text-white">Yönetici Ayarı</span>
      </div>

      <AdminSection title="Uyarı Ayarları" defaultOpen>
        <form action={updateSettings} className="grid max-w-2xl grid-cols-2 gap-3">
          <input name="default_commission" type="hidden" defaultValue={settings?.default_commission ?? 250} />
          <input name="fuel_warning_pct" type="hidden" defaultValue={Math.round((settings?.fuel_warning_pct ?? 0.3) * 100)} />
          <div>
            <label className="label">Yaklaşma uyarısı (mil)</label>
            <input name="pm_due_soon_miles" type="number" defaultValue={settings?.pm_due_soon_miles ?? 2000} className="input" />
          </div>
          <div>
            <label className="label">Yaklaşma uyarısı (gün)</label>
            <input name="pm_due_soon_days" type="number" min="1" step="1" defaultValue={settings?.pm_due_soon_days ?? 7} className="input" />
          </div>
          <div>
            <label className="label">Yaklaşma uyarısı (engine hours)</label>
            <input name="pm_due_soon_engine_hours" type="number" min="1" step="1" defaultValue={settings?.pm_due_soon_engine_hours ?? 100} className="input" />
          </div>
          <div>
            <label className="label">Repair uyarı tutarı ($)</label>
            <input name="repair_warning_amount" type="number" step="0.01" defaultValue={settings?.repair_warning_amount ?? 5000} className="input" />
          </div>
          <div>
            <label className="label">Invoice tutar toleransı ($)</label>
            <input name="maintenance_invoice_allocation_tolerance" type="number" step="0.01" min="0" defaultValue={settings?.maintenance_invoice_allocation_tolerance ?? 1} className="input" />
          </div>
          <div>
            <input name="maintenance_work_order_approval_threshold_present" type="hidden" value="1" />
            <label className="label">Work order onay eşiği ($)</label>
            <input name="maintenance_work_order_approval_threshold" type="number" step="0.01" min="0" defaultValue={settings?.maintenance_work_order_approval_threshold ?? 2500} className="input" />
          </div>
          <input name="maintenance_decision_thresholds_present" type="hidden" value="1" />
          <div>
            <label className="label">Ortalama günlük contribution ($)</label>
            <input name="maintenance_average_daily_contribution" type="number" step="0.01" min="0" defaultValue={settings?.maintenance_average_daily_contribution ?? 600} className="input" />
          </div>
          <div>
            <label className="label">Replacement 12 ay maliyet eşiği ($)</label>
            <input name="maintenance_replacement_cost_12m_threshold" type="number" step="0.01" min="0" defaultValue={settings?.maintenance_replacement_cost_12m_threshold ?? 30000} className="input" />
          </div>
          <div>
            <label className="label">Replacement CPM eşiği ($/mi)</label>
            <input name="maintenance_replacement_cpm_threshold" type="number" step="0.01" min="0" defaultValue={settings?.maintenance_replacement_cpm_threshold ?? 0.35} className="input" />
          </div>
          <div>
            <label className="label">Replacement downtime eşiği (gün)</label>
            <input name="maintenance_replacement_downtime_days_threshold" type="number" step="0.1" min="0" defaultValue={settings?.maintenance_replacement_downtime_days_threshold ?? 30} className="input" />
          </div>
          <div>
            <label className="label">Replacement araç yaşı eşiği (yıl)</label>
            <input name="maintenance_replacement_vehicle_age_years_threshold" type="number" step="0.1" min="0" defaultValue={settings?.maintenance_replacement_vehicle_age_years_threshold ?? 8} className="input" />
          </div>
          <label className="col-span-2 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <input name="dispatch_hold_on_critical_present" type="hidden" value="1" />
            <input
              name="dispatch_hold_on_critical"
              type="checkbox"
              defaultChecked={Boolean(settings?.dispatch_hold_on_critical)}
              className="mt-0.5 h-4 w-4 accent-brand"
            />
            <span>Kritik inspection bulgularında da dispatch hold aç. “Aracı Çıkartma” bulguları bu ayardan bağımsız olarak her zaman hold açar.</span>
          </label>
          <div className="col-span-2">
            <button type="submit" className="btn-primary">Kaydet</button>
          </div>
        </form>
      </AdminSection>

      <AdminSection title="Yeni Araç Bakım Varsayılanları" defaultOpen>
        <form action={updateVehicleMaintenanceDefaults} className="grid max-w-2xl gap-4 md:grid-cols-2">
          <label className="flex items-start gap-2 rounded-lg border border-slate-200 bg-white p-3 text-sm md:col-span-2">
            <input
              name="new_vehicle_auto_maintenance_setup"
              type="checkbox"
              defaultChecked={settings?.new_vehicle_auto_maintenance_setup ?? true}
              className="mt-0.5 h-4 w-4 accent-brand"
            />
            <span>
              <span className="block font-medium">Yeni araçlarda otomatik bakım kurulumu açık</span>
              <span className="mt-0.5 block text-xs text-slate-500">Kapalıysa yeni araç formu “Şimdilik Bakım Kurma” ile açılır.</span>
            </span>
          </label>
          <div>
            <label className="label">Yeni Semi Truck varsayılan paketi</label>
            <select name="new_truck_maintenance_package" className="input" defaultValue={settings?.new_truck_maintenance_package ?? "basic"}>
              <option value="basic">Temel Bakım Paketi</option>
              <option value="full">Tam Bakım Programı</option>
            </select>
          </div>
          <div>
            <label className="label">Yeni Box Truck varsayılan paketi</label>
            <select name="new_box_truck_maintenance_package" className="input" defaultValue={settings?.new_box_truck_maintenance_package ?? "basic"}>
              <option value="basic">Temel Bakım Paketi</option>
              <option value="full">Tam Bakım Programı</option>
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="label">Varsayılan takip başlangıcı</label>
            <select name="new_vehicle_maintenance_baseline_mode" className="input" defaultValue={settings?.new_vehicle_maintenance_baseline_mode ?? "current"}>
              <option value="current">Mevcut mileage, engine hours ve bugünden başlat</option>
              <option value="manual">Son bakım bilgilerini daha sonra gireceğim</option>
            </select>
          </div>
          <div className="md:col-span-2">
            <button type="submit" className="btn-primary">Varsayılanları Kaydet</button>
          </div>
        </form>
      </AdminSection>

      <AdminSection title="Inspection Kontrol Listeleri">
        <InspectionTemplateManager
          templates={(inspectionTemplatesRes.data ?? []).map((template: any) => ({ ...template, items: template.items ?? [] }))}
          basePath="/maintenance/settings"
        />
      </AdminSection>

      <AdminSection title="Maliyet Ayarları">
        <div className="grid gap-2 md:grid-cols-3">
          {MAINTENANCE_COST_CATEGORIES.map((category) => (
            <div key={category} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
              {formatMaintenanceCategory(category)}
            </div>
          ))}
        </div>
      </AdminSection>

      <AdminSection title="Gelişmiş Araçlar">
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold">Bu işlem normal günlük kullanım için gerekli değildir.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link className="btn-ghost bg-white" href="/maintenance/invoices">Invoice Import</Link>
            <Link className="btn-ghost bg-white" href="/maintenance/invoices/bulk">Toplu Geçmiş Invoice Import</Link>
          </div>
        </div>
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
