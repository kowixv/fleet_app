import MaintenanceHistory, { type MaintenanceHistoryRow } from "@/components/MaintenanceHistory";
import MaintenanceInvoiceInbox, { type MaintenanceInvoiceInboxRow } from "@/components/MaintenanceInvoiceInbox";
import MaintenanceRuleManager, { type RuleManagerRow } from "@/components/MaintenanceRuleManager";
import MaintenanceTable, { type MaintenanceRuleRow } from "@/components/MaintenanceTable";
import { createClient } from "@/lib/supabase/server";
import { fetchOptions } from "@/lib/data";

export const dynamic = "force-dynamic";

interface MileageLogRow {
  id: string;
  mileage: number;
  logged_at: string;
  source: string | null;
  vehicles: { unit_number: string } | null;
}

export default async function MaintenancePage() {
  const supabase = await createClient();
  const [rulesResult, settingsResult, historyResult, logsResult, inboxResult, options] = await Promise.all([
    supabase
      .from("maintenance_rules")
      .select("*, vehicles!maintenance_rules_vehicle_id_fkey(unit_number, current_mileage)")
      .order("created_at", { ascending: false }),
    supabase
      .from("settings")
      .select("pm_due_soon_miles, pm_due_soon_days, repair_warning_amount")
      .single(),
    supabase
      .from("maintenance_records")
      .select("*, vehicles!maintenance_records_vehicle_id_fkey(unit_number), maintenance_invoices(file_name, invoice_number)")
      .order("performed_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("vehicle_mileage_logs")
      .select("id, mileage, logged_at, source, vehicles!vehicle_mileage_logs_vehicle_id_fkey(unit_number)")
      .order("logged_at", { ascending: false })
      .limit(50),
    supabase
      .from("maintenance_invoices")
      .select("id, file_name, invoice_number, invoice_date, shop_name, status, parser_warnings, parsed_data, vehicles!maintenance_invoices_vehicle_id_fkey(unit_number)")
      .order("created_at", { ascending: false })
      .limit(100),
    fetchOptions(),
  ]);

  const firstError = rulesResult.error ?? settingsResult.error ?? historyResult.error ?? logsResult.error ?? inboxResult.error;
  if (firstError) throw new Error(`Maintenance verisi yüklenemedi: ${firstError.message}`);

  const rules = (rulesResult.data ?? []) as unknown as RuleManagerRow[];
  const activeRules = rules.filter((rule) => rule.active) as unknown as MaintenanceRuleRow[];
  const settings = settingsResult.data;
  const thresholds = {
    dueSoonMiles: Number(settings?.pm_due_soon_miles ?? 2_000),
    dueSoonDays: Number(settings?.pm_due_soon_days ?? 7),
  };

  return (
    <div className="space-y-7">
      <div>
        <h1 className="text-xl font-bold">Preventive Maintenance</h1>
        <p className="mt-1 text-sm text-slate-500">
          Aktif bakım planları, servis geçmişi, invoice kayıtları ve odometre değişiklikleri.
        </p>
      </div>

      <MaintenanceInvoiceInbox rows={(inboxResult.data ?? []) as unknown as MaintenanceInvoiceInboxRow[]} />

      <div className="card">
        <h2 className="font-semibold">PDF Invoice İçe Aktarma</h2>
        <p className="mt-1 text-sm text-slate-500">
          Proje klasöründe terminal açıp aşağıdaki komutu çalıştırın. Araç, servis ve sonraki bakım soruları terminalde sorulur.
        </p>
        <pre className="mt-3 overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">{`npm run maintenance:invoice -- "C:\\Invoices\\invoice.pdf"`}</pre>
      </div>

      <section className="space-y-3">
        <h2 className="font-semibold">Aktif Bakım Planları</h2>
        <MaintenanceTable rows={activeRules} thresholds={thresholds} />
      </section>

      <MaintenanceRuleManager rows={rules} vehicles={options.vehicles} />

      <section className="space-y-3">
        <h2 className="font-semibold">Bakım Geçmişi</h2>
        <MaintenanceHistory
          rows={(historyResult.data ?? []) as unknown as MaintenanceHistoryRow[]}
          repairWarningAmount={Number(settings?.repair_warning_amount ?? 5_000)}
        />
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">Son Mileage Değişiklikleri</h2>
        <div className="card overflow-x-auto p-0">
          <table className="w-full">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="th">Zaman</th>
                <th className="th">Unit</th>
                <th className="th">Mileage</th>
                <th className="th">Kaynak</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(logsResult.data ?? []).length === 0 ? (
                <tr><td className="td text-slate-400" colSpan={4}>Mileage logu yok.</td></tr>
              ) : ((logsResult.data ?? []) as unknown as MileageLogRow[]).map((log) => (
                <tr key={log.id}>
                  <td className="td whitespace-nowrap">{new Date(log.logged_at).toLocaleString("en-US")}</td>
                  <td className="td font-medium">{log.vehicles?.unit_number ?? "—"}</td>
                  <td className="td">{Number(log.mileage).toLocaleString("en-US")} mi</td>
                  <td className="td">{log.source ?? "manual"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
