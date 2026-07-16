import SettlementSettingsManager from "@/components/SettlementSettingsManager";
import { fetchOptions } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function SettlementSettingsPage() {
  const supabase = await createClient();
  const [opts, vehiclesRes] = await Promise.all([
    fetchOptions(),
    supabase
      .from("vehicles")
      .select("id, unit_number, ownership_type, company_id, external_carrier_id, owner_id, default_driver_pay_pct, company_fee_pct, company_fee_is_our_revenue, external_carrier_fee_pct, management_commission_type, management_commission_amount")
      .order("unit_number"),
  ]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Settlement Settings</h1>
          <p className="text-sm text-slate-500">Persistent settlement defaults by unit.</p>
        </div>
        <Link href="/settlements" className="btn-ghost">Back to Settlements</Link>
      </div>
      <SettlementSettingsManager
        vehicles={vehiclesRes.data ?? []}
        companies={opts.companies}
        owners={opts.owners}
        carriers={opts.carriers}
      />
    </div>
  );
}
