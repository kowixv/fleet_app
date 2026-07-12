import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { usd, shortDate } from "@/lib/format";
import StatusActions from "./StatusActions";

export const dynamic = "force-dynamic";

export default async function SettlementDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: st } = await supabase
    .from("settlements")
    .select("*, vehicles!settlements_vehicle_id_fkey(unit_number), companies!settlements_company_id_fkey(name)")
    .eq("id", id)
    .single();
  if (!st) notFound();

  const [{ data: items }, { data: loads }, { data: expenses }] = await Promise.all([
    supabase.from("settlement_items").select("*").eq("settlement_id", id).order("sort_order"),
    supabase.from("loads").select("*").eq("settlement_id", id),
    supabase.from("expenses").select("*").eq("settlement_id", id),
  ]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/settlements" className="text-sm text-brand hover:underline">
            ← Settlements
          </Link>
          <h1 className="mt-1 text-xl font-bold capitalize">
            {st.settlement_type.replace(/_/g, " ")}
          </h1>
          <p className="text-sm text-slate-500">
            {st.vehicles?.unit_number ? `Unit ${st.vehicles.unit_number} · ` : ""}
            {st.week_start ? `${shortDate(st.week_start)} – ${shortDate(st.week_end)}` : ""}
          </p>
        </div>
        <a
          href={`/api/settlements/${id}/pdf`}
          target="_blank"
          rel="noreferrer"
          className="btn-primary"
        >
          PDF İndir
        </a>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <Stat label="Gross" value={usd(st.gross_revenue)} />
        <Stat label="Kesintiler" value={usd(st.total_deductions)} />
        <Stat label="Komisyonumuz" value={usd(st.our_commission_earned)} accent />
        <Stat label="Net Ödeme" value={usd(st.net_pay)} big />
      </div>

      <div className="card">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Durum</h2>
          <span className="badge bg-slate-100 text-slate-600">{st.status}</span>
        </div>
        <StatusActions id={id} status={st.status} />
      </div>

      <div className="card">
        <h2 className="mb-3 font-semibold">Hesaplama Dökümü</h2>
        <table className="w-full">
          <tbody className="divide-y divide-slate-100">
            <tr>
              <td className="td">Brüt gelir</td>
              <td className="td text-right font-semibold">{usd(st.gross_revenue)}</td>
            </tr>
            {(items ?? []).map((li: any) => (
              <tr key={li.id}>
                <td className="td">
                  {li.label_en}
                  {li.is_our_revenue ? (
                    <span className="ml-2 text-xs text-emerald-600">(bizim gelir)</span>
                  ) : null}
                </td>
                <td className="td text-right">{usd(li.amount)}</td>
              </tr>
            ))}
            <tr className="bg-slate-50">
              <td className="td font-bold">Net Ödeme</td>
              <td className="td text-right font-bold">{usd(st.net_pay)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {(loads ?? []).length > 0 && (
        <div className="card">
          <h2 className="mb-3 font-semibold">Loads ({loads!.length})</h2>
          <table className="w-full">
            <thead>
              <tr>
                <th className="th">Load #</th>
                <th className="th">Güzergah</th>
                <th className="th text-right">Gross</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loads!.map((l: any) => (
                <tr key={l.id}>
                  <td className="td">{l.load_number ?? "—"}</td>
                  <td className="td">{l.route ?? `${l.pickup_location ?? ""} → ${l.delivery_location ?? ""}`}</td>
                  <td className="td text-right">{usd(l.gross_amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(expenses ?? []).length > 0 && (
        <div className="card">
          <h2 className="mb-3 font-semibold">Masraflar ({expenses!.length})</h2>
          <table className="w-full">
            <tbody className="divide-y divide-slate-100">
              {expenses!.map((e: any) => (
                <tr key={e.id}>
                  <td className="td capitalize">{e.category}</td>
                  <td className="td text-right">{usd(e.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  big,
  accent,
}: {
  label: string;
  value: string;
  big?: boolean;
  accent?: boolean;
}) {
  return (
    <div className="card">
      <p className="text-xs text-slate-500">{label}</p>
      <p
        className={`mt-1 font-bold ${big ? "text-2xl text-brand" : "text-lg"} ${
          accent ? "text-emerald-700" : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}
