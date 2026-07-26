import BulkMaintenanceInvoiceUpload from "@/components/BulkMaintenanceInvoiceUpload";
import MaintenanceInvoiceInbox, { type MaintenanceInvoiceInboxRow } from "@/components/MaintenanceInvoiceInbox";
import MaintenanceNav from "@/components/MaintenanceNav";
import MaintenancePagination from "@/components/MaintenancePagination";
import {
  decodeMaintenanceCursor,
  maintenanceKeysetFilter,
  maintenancePageHref,
  MAINTENANCE_PAGE_SIZE,
  nextMaintenanceCursor,
} from "@/lib/maintenance/pagination";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function MaintenanceInvoicesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const cursor = decodeMaintenanceCursor(params.cursor);
  const supabase = await createClient();
  let query = supabase
    .from("maintenance_invoices")
    .select(
      "id, file_name, invoice_number, invoice_date, shop_name, status, pipeline_status, retry_count, last_error, next_attempt_at, parser_warnings, parsed_data, created_at, vehicles!maintenance_invoices_vehicle_id_fkey(unit_number)",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(MAINTENANCE_PAGE_SIZE + 1);
  if (cursor) query = query.or(maintenanceKeysetFilter("created_at", cursor));
  const [inboxResult, totalResult] = await Promise.all([
    query,
    supabase.from("maintenance_invoices").select("id", { count: "exact", head: true }),
  ]);
  const error = inboxResult.error ?? totalResult.error;
  if (error) throw new Error(`Invoice inbox yüklenemedi: ${error.message}`);

  const page = nextMaintenanceCursor(inboxResult.data ?? [], (row) => row.created_at);
  const nextHref = page.nextCursor
    ? maintenancePageHref("/maintenance/invoices", params, "cursor", page.nextCursor)
    : null;

  return (
    <div className="space-y-5">
      <MaintenanceNav title="Bakım Merkezi" />
      <div>
        <h2 className="font-semibold">Invoice Inbox ve PDF Yükleme</h2>
        <p className="mt-1 text-sm text-slate-500">
          Yüklemeler hızlıca sıraya alınır; parse durumu, retry ve son hata inbox üzerinden izlenir.
        </p>
      </div>
      <BulkMaintenanceInvoiceUpload />
      <MaintenanceInvoiceInbox rows={page.rows as MaintenanceInvoiceInboxRow[]} />
      <MaintenancePagination
        totalCount={totalResult.count ?? page.rows.length}
        shownCount={page.rows.length}
        nextHref={nextHref}
      />
    </div>
  );
}
