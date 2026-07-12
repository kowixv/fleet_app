import MaintenanceTable from "@/components/MaintenanceTable";
import ResourceManager, { Field } from "@/components/ResourceManager";
import { createClient } from "@/lib/supabase/server";
import { fetchOptions } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function MaintenancePage() {
  const supabase = await createClient();
  const [{ data: rules }, { data: settings }, opts] = await Promise.all([
    supabase
      .from("maintenance_rules")
      .select("*, vehicles!maintenance_rules_vehicle_id_fkey(unit_number, current_mileage)")
      .order("created_at", { ascending: false }),
    supabase.from("settings").select("pm_due_soon_miles").single(),
    fetchOptions(),
  ]);

  const dueSoon = settings?.pm_due_soon_miles ?? 2500;

  const ruleFields: Field[] = [
    { name: "vehicle_id", label: "Araç", type: "select", options: opts.vehicles, required: true },
    { name: "service_type", label: "Servis Tipi", required: true },
    {
      name: "interval_type",
      label: "Interval Tipi",
      type: "select",
      required: true,
      options: [
        { value: "mileage", label: "Mileage" },
        { value: "date", label: "Tarih" },
      ],
    },
    { name: "interval_miles", label: "Her X mil", type: "number" },
    { name: "interval_days", label: "Her X gün", type: "number" },
    { name: "last_done_mileage", label: "Son yapılan mileage", type: "number" },
    { name: "last_done_date", label: "Son yapılan tarih", type: "date" },
  ];

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold">Preventive Maintenance</h1>

      <MaintenanceTable rows={(rules as any) ?? []} dueSoonMiles={dueSoon} />

      <div>
        <h2 className="mb-2 font-semibold">Bakım Kuralları</h2>
        <ResourceManager
          title=""
          table="maintenance_rules"
          basePath="/maintenance"
          addLabel="Kural"
          fields={ruleFields}
          rows={(rules as any) ?? []}
        />
      </div>
    </div>
  );
}
