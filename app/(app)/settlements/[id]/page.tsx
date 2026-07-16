import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { usd, shortDate } from "@/lib/format";
import { displayRowsForStoredSettlement } from "@/lib/settlement/workflow";
import StatusActions from "./StatusActions";

export const dynamic = "force-dynamic";

function routeForLoad(load: any) {
  return load.route || `${load.pickup_location ?? ""} -> ${load.delivery_location ?? ""}`.trim();
}

function payeeName(st: any, people: any, carrier: any) {
  if (st.settlement_type === "external_carrier_statement") return carrier?.name ?? "-";
  if (st.owner_id) return people?.find((person: any) => person.id === st.owner_id)?.full_name ?? "-";
  if (st.driver_id) return people?.find((person: any) => person.id === st.driver_id)?.full_name ?? "-";
  return "-";
}

export default async function SettlementDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: st } = await supabase
    .from("settlements")
    .select("*, vehicles!settlements_vehicle_id_fkey(unit_number), companies!settlements_company_id_fkey(name), external_carriers!settlements_external_carrier_id_fkey(name)")
    .eq("id", id)
    .single();
  if (!st) notFound();

  const peopleIds = [st.owner_id, st.driver_id].filter(Boolean) as string[];
  const [{ data: itemsRaw }, loadLinksRes, expenseLinksRes, peopleRes] = await Promise.all([
    supabase.from("settlement_items").select("*").eq("settlement_id", id).order("sort_order"),
    supabase.from("settlement_load_links").select("usage_group, released_at, loads(*)").eq("settlement_id", id).order("created_at"),
    supabase.from("settlement_expense_links").select("usage_group, released_at, expenses(*)").eq("settlement_id", id).order("created_at"),
    peopleIds.length > 0
      ? supabase.from("people").select("id, full_name").in("id", peopleIds)
      : Promise.resolve({ data: [] } as any),
  ]);

  let loads = (loadLinksRes.data ?? []).map((link: any) => ({ ...link.loads, usage_group: link.usage_group, released_at: link.released_at }));
  let expenses = (expenseLinksRes.data ?? []).map((link: any) => ({ ...link.expenses, usage_group: link.usage_group, released_at: link.released_at }));
  if (loads.length === 0) {
    const { data } = await supabase.from("loads").select("*").eq("settlement_id", id);
    loads = data ?? [];
  }
  if (expenses.length === 0) {
    const { data } = await supabase.from("expenses").select("*").eq("settlement_id", id);
    expenses = data ?? [];
  }

  const items = (itemsRaw ?? []).map((item: any) => ({
    key: item.key,
    labelEn: item.label_en,
    labelTr: item.label_tr,
    amount: Number(item.amount) || 0,
    isOurRevenue: item.is_our_revenue,
  }));
  const calculationRows = displayRowsForStoredSettlement({
    settlement_type: st.settlement_type,
    gross_revenue: st.gross_revenue,
    net_pay: st.net_pay,
  }, items);
  const snapshot = st.config ?? {};

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <Link href="/settlements" className="text-sm text-brand hover:underline">Back to Settlements</Link>
          <h1 className="mt-1 text-xl font-bold capitalize">{st.settlement_type.replace(/_/g, " ")}</h1>
          <p className="text-sm text-slate-500">
            Payee {payeeName(st, peopleRes.data ?? [], st.external_carriers)} · Unit {st.vehicles?.unit_number ?? "-"} · {st.week_start ? `${shortDate(st.week_start)} - ${shortDate(st.week_end)}` : "-"}
          </p>
        </div>
        <a href={`/api/settlements/${id}/pdf`} target="_blank" rel="noreferrer" className="btn-primary">Download PDF</a>
      </div>

      <div className="grid gap-4 md:grid-cols-5">
        <Stat label="Fleet Gross" value={usd(st.gross_revenue)} />
        <Stat label="Payable Base" value={usd(calculationRows.find((row) => row.role === "base")?.amount ?? st.gross_revenue)} />
        <Stat label="Deductions" value={usd(st.total_deductions)} />
        <Stat label="Our Revenue" value={usd(st.our_commission_earned)} accent />
        <Stat label="Net Pay" value={usd(st.net_pay)} big />
      </div>

      <div className="card">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Status</h2>
          <span className="badge bg-slate-100 text-slate-600">{st.status}</span>
        </div>
        <StatusActions id={id} status={st.status} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card lg:col-span-2">
          <h2 className="mb-3 font-semibold">Calculation</h2>
          <table className="w-full">
            <tbody className="divide-y divide-slate-100">
              {calculationRows.map((row) => (
                <tr key={row.key} className={row.role === "net" ? "bg-slate-50" : ""}>
                  <td className={`td ${row.role === "net" ? "font-bold" : ""}`}>{row.labelEn}</td>
                  <td className={`td text-right ${row.role === "net" ? "font-bold" : ""}`}>{usd(row.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          <h2 className="mb-3 font-semibold">Config Snapshot</h2>
          <dl className="space-y-2 text-sm">
            <Row label="Driver Pay %" value={pct(snapshot.driver_pay_pct)} />
            <Row label="Company Fee %" value={pct(snapshot.company_fee_pct)} />
            <Row label="External Fee %" value={pct(snapshot.external_carrier_fee_pct)} />
            <Row label="Commission" value={`${snapshot.management_commission_type ?? "-"} ${snapshot.management_commission_amount ?? ""}`} />
          </dl>
        </div>
      </div>

      <div className="card overflow-x-auto p-0">
        <h2 className="p-4 font-semibold">Loads ({loads.length})</h2>
        <table className="w-full">
          <thead><tr><th className="th">Load #</th><th className="th">Route</th><th className="th">Date</th><th className="th">Usage</th><th className="th text-right">Gross</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {loads.length === 0 ? <tr><td className="td text-slate-400" colSpan={5}>No linked loads.</td></tr> : loads.map((load: any) => (
              <tr key={load.id}>
                <td className="td">{load.load_number ?? "-"}</td>
                <td className="td">{routeForLoad(load)}</td>
                <td className="td">{load.delivery_date ? shortDate(load.delivery_date) : "-"}</td>
                <td className="td">{load.usage_group ?? "legacy"}{load.released_at ? " (released)" : ""}</td>
                <td className="td text-right">{usd(load.gross_amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card overflow-x-auto p-0">
        <h2 className="p-4 font-semibold">Expenses ({expenses.length})</h2>
        <table className="w-full">
          <thead><tr><th className="th">Date</th><th className="th">Category</th><th className="th">Notes</th><th className="th">Usage</th><th className="th text-right">Amount</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {expenses.length === 0 ? <tr><td className="td text-slate-400" colSpan={5}>No linked expenses.</td></tr> : expenses.map((expense: any) => (
              <tr key={expense.id}>
                <td className="td">{expense.date ? shortDate(expense.date) : "-"}</td>
                <td className="td">{expense.category}</td>
                <td className="td">{expense.notes ?? "-"}</td>
                <td className="td">{expense.usage_group ?? "legacy"}{expense.released_at ? " (released)" : ""}</td>
                <td className="td text-right">{usd(expense.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2 className="mb-3 font-semibold">Audit</h2>
        <div className="grid gap-2 text-sm text-slate-600 md:grid-cols-2">
          <span>Created: {st.created_at ? shortDate(st.created_at) : "-"}</span>
          <span>Finalized: {st.finalized_at ? shortDate(st.finalized_at) : "-"}</span>
          <span>Paid: {st.paid_at ? shortDate(st.paid_at) : "-"}</span>
          <span>Voided: {st.voided_at ? shortDate(st.voided_at) : "-"}</span>
          {st.void_reason ? <span className="md:col-span-2">Void reason: {st.void_reason}</span> : null}
        </div>
      </div>
    </div>
  );
}

function pct(value: unknown) {
  if (value == null) return "-";
  return `${(Number(value) * 100).toFixed(2)}%`;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

function Stat({ label, value, big, accent }: { label: string; value: string; big?: boolean; accent?: boolean }) {
  return (
    <div className="card">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`mt-1 font-bold ${big ? "text-2xl text-brand" : "text-lg"} ${accent ? "text-emerald-700" : ""}`}>{value}</p>
    </div>
  );
}
