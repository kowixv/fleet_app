import Link from "next/link";
import SettlementForm from "@/components/SettlementForm";
import { fetchOptions, parsePage, DEFAULT_PAGE_SIZE } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { usd, shortDate } from "@/lib/format";

export const dynamic = "force-dynamic";

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-slate-100 text-slate-600",
  pending_review: "bg-amber-100 text-amber-700",
  finalized: "bg-blue-100 text-blue-700",
  paid: "bg-green-100 text-green-700",
  void: "bg-red-100 text-red-600",
};

function payeeName(row: any) {
  if (row.external_carriers?.name) return row.external_carriers.name;
  if (row.owners?.full_name) return row.owners.full_name;
  if (row.drivers?.full_name) return row.drivers.full_name;
  return "-";
}

function queryString(params: Record<string, string | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  const s = search.toString();
  return s ? `?${s}` : "";
}

export default async function SettlementsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string; type?: string; status?: string; unit?: string }>;
}) {
  const params = await searchParams;
  const page = parsePage(params.page);
  const from = (page - 1) * DEFAULT_PAGE_SIZE;
  const supabase = await createClient();
  const opts = await fetchOptions();

  let query = supabase
    .from("settlements")
    .select("*, vehicles!settlements_vehicle_id_fkey(unit_number), drivers:people!settlements_driver_id_fkey(full_name), owners:people!settlements_owner_id_fkey(full_name), external_carriers!settlements_external_carrier_id_fkey(name)", { count: "exact" });
  if (params.type) query = query.eq("settlement_type", params.type);
  if (params.status) query = query.eq("status", params.status);
  if (params.unit) query = query.eq("vehicle_id", params.unit);
  if (params.q) query = query.or(`settlement_type.ilike.%${params.q}%,status.ilike.%${params.q}%`);

  const { data: rows, count } = await query.order("created_at", { ascending: false }).range(from, from + DEFAULT_PAGE_SIZE - 1);
  const list = rows ?? [];
  const total = count ?? 0;
  const draftTotal = list.filter((s: any) => s.status === "draft").reduce((sum: number, s: any) => sum + Number(s.net_pay || 0), 0);
  const pendingReviewCount = list.filter((s: any) => s.status === "pending_review").length;
  const finalizedUnpaid = list.filter((s: any) => s.status === "finalized").reduce((sum: number, s: any) => sum + Number(s.net_pay || 0), 0);
  const paidTotal = list.filter((s: any) => s.status === "paid").reduce((sum: number, s: any) => sum + Number(s.net_pay || 0), 0);

  const pageParams = {
    q: params.q,
    type: params.type,
    status: params.status,
    unit: params.unit,
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Settlements</h1>
        <Link href="/settlements/settings" className="btn-ghost">Settlement Settings</Link>
      </div>
      <SettlementForm
        vehicles={opts.vehicles}
        drivers={opts.drivers}
        owners={opts.owners}
        companies={opts.companies}
        carriers={opts.carriers}
      />

      <div className="grid gap-3 md:grid-cols-4">
        <Stat label="Draft total" value={usd(draftTotal)} />
        <Stat label="Pending Review" value={String(pendingReviewCount)} />
        <Stat label="Finalized unpaid" value={usd(finalizedUnpaid)} />
        <Stat label="Paid total" value={usd(paidTotal)} />
      </div>

      <form className="card grid gap-3 md:grid-cols-5">
        <input name="q" className="input" placeholder="Search" defaultValue={params.q ?? ""} />
        <select name="type" className="input" defaultValue={params.type ?? ""}>
          <option value="">All types</option>
          <option value="company_driver">Company Driver</option>
          <option value="box_truck_driver">Box Truck Driver</option>
          <option value="owner_operator">Owner Operator</option>
          <option value="managed_investor">Managed Investor</option>
          <option value="external_carrier_statement">External Carrier</option>
        </select>
        <select name="status" className="input" defaultValue={params.status ?? ""}>
          <option value="">All statuses</option>
          {Object.keys(STATUS_COLORS).map((status) => <option key={status} value={status}>{status}</option>)}
        </select>
        <select name="unit" className="input" defaultValue={params.unit ?? ""}>
          <option value="">All units</option>
          {opts.vehicles.map((vehicle) => <option key={vehicle.value} value={vehicle.value}>{vehicle.label}</option>)}
        </select>
        <button className="btn-primary">Filter</button>
      </form>

      <div className="card overflow-x-auto p-0">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th">Settlement</th>
              <th className="th">Type</th>
              <th className="th">Payee</th>
              <th className="th">Unit</th>
              <th className="th">Period</th>
              <th className="th text-right">Gross</th>
              <th className="th text-right">Net</th>
              <th className="th text-right">Our Revenue</th>
              <th className="th">Status</th>
              <th className="th">Created</th>
              <th className="th"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {list.length === 0 ? (
              <tr><td className="td text-slate-400" colSpan={11}>No settlements yet.</td></tr>
            ) : (
              list.map((s: any) => (
                <tr key={s.id} className="hover:bg-slate-50">
                  <td className="td font-mono text-xs">{String(s.id).slice(0, 8)}</td>
                  <td className="td">{s.settlement_type}</td>
                  <td className="td">{payeeName(s)}</td>
                  <td className="td">{s.vehicles?.unit_number ?? "-"}</td>
                  <td className="td">{s.week_start ? `${shortDate(s.week_start)} - ${shortDate(s.week_end)}` : "-"}</td>
                  <td className="td text-right">{usd(s.gross_revenue)}</td>
                  <td className="td text-right font-semibold">{usd(s.net_pay)}</td>
                  <td className="td text-right text-emerald-700">{usd(s.our_commission_earned)}</td>
                  <td className="td"><span className={`badge ${STATUS_COLORS[s.status] ?? ""}`}>{s.status}</span></td>
                  <td className="td">{s.created_at ? shortDate(s.created_at) : "-"}</td>
                  <td className="td text-right"><Link href={`/settlements/${s.id}`} className="text-brand hover:underline">Open</Link></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {total > DEFAULT_PAGE_SIZE && (
        <div className="flex items-center justify-between text-sm text-slate-500">
          <span>{from + 1}-{Math.min(from + DEFAULT_PAGE_SIZE, total)} / Total {total}</span>
          <span className="flex gap-2">
            {page > 1 ? <Link href={`/settlements${queryString({ ...pageParams, page: String(page - 1) })}`} className="btn-ghost">Previous</Link> : <span className="btn-ghost opacity-40">Previous</span>}
            {from + DEFAULT_PAGE_SIZE < total ? <Link href={`/settlements${queryString({ ...pageParams, page: String(page + 1) })}`} className="btn-ghost">Next</Link> : <span className="btn-ghost opacity-40">Next</span>}
          </span>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-bold">{value}</p>
    </div>
  );
}
