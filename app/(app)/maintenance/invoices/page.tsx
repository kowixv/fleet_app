import BulkMaintenanceInvoiceUpload from "@/components/BulkMaintenanceInvoiceUpload";
import MaintenanceInvoiceInbox, { type MaintenanceInvoiceInboxRow } from "@/components/MaintenanceInvoiceInbox";
import MaintenanceNav from "@/components/MaintenanceNav";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function MaintenanceInvoicesPage() {
  const supabase = await createClient();
  const inboxResult = await supabase
    .from("maintenance_invoices")
    .select("id, file_name, invoice_number, invoice_date, shop_name, status, parser_warnings, parsed_data, vehicles!maintenance_invoices_vehicle_id_fkey(unit_number)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (inboxResult.error) throw new Error(`Invoice inbox yüklenemedi: ${inboxResult.error.message}`);

  return (
    <div className="space-y-5">
      <MaintenanceNav title="Bakım Merkezi" />
      <div>
        <h2 className="font-semibold">Invoice Inbox ve PDF Yükleme</h2>
        <p className="mt-1 text-sm text-slate-500">PDF yükleyin, inceleme bekleyen taslakları tamamlayın veya tamamlanmış importları geri alın.</p>
      </div>
      <BulkMaintenanceInvoiceUpload />
      <MaintenanceInvoiceInbox rows={(inboxResult.data ?? []) as unknown as MaintenanceInvoiceInboxRow[]} />
    </div>
  );
}
