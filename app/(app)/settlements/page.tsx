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

export default async function SettlementsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const page = parsePage(pageParam);
  const from = (page - 1) * DEFAULT_PAGE_SIZE;
  const supabase = await createClient();
  const [opts, { data: rows, count }] = await Promise.all([
    fetchOptions(),
    supabase
      .from("settlements")
      .select("*, vehicles!settlements_vehicle_id_fkey(unit_number)", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, from + DEFAULT_PAGE_SIZE - 1),
  ]);
  const total = count ?? 0;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Settlements</h1>
      <SettlementForm
        vehicles={opts.vehicles}
        drivers={opts.drivers}
        owners={opts.owners}
        companies={opts.companies}
        carriers={opts.carriers}
      />

      <div className="card overflow-x-auto p-0">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th">Tip</th>
              <th className="th">Unit</th>
              <th className="th">Dönem</th>
              <th className="th text-right">Gross</th>
              <th className="th text-right">Net</th>
              <th className="th text-right">Komisyon</th>
              <th className="th">Durum</th>
              <th className="th"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(rows ?? []).length === 0 ? (
              <tr><td className="td text-slate-400" colSpan={8}>Henüz settlement yok.</td></tr>
            ) : (
              (rows ?? []).map((s: any) => (
                <tr key={s.id} className="hover:bg-slate-50">
                  <td className="td">{s.settlement_type}</td>
                  <td className="td">{s.vehicles?.unit_number ?? "—"}</td>
                  <td className="td">
                    {s.week_start ? `${shortDate(s.week_start)} – ${shortDate(s.week_end)}` : "—"}
                  </td>
                  <td className="td text-right">{usd(s.gross_revenue)}</td>
                  <td className="td text-right font-semibold">{usd(s.net_pay)}</td>
                  <td className="td text-right text-emerald-700">{usd(s.our_commission_earned)}</td>
                  <td className="td">
                    <span className={`badge ${STATUS_COLORS[s.status] ?? ""}`}>{s.status}</span>
                  </td>
                  <td className="td text-right">
                    <Link href={`/settlements/${s.id}`} className="text-brand hover:underline">
                      Aç
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {total > DEFAULT_PAGE_SIZE && (
        <div className="flex items-center justify-between text-sm text-slate-500">
          <span>
            {from + 1}–{Math.min(from + DEFAULT_PAGE_SIZE, total)} / Toplam {total}
          </span>
          <span className="flex gap-2">
            {page > 1 ? (
              <Link href={`/settlements?page=${page - 1}`} className="btn-ghost">← Önceki</Link>
            ) : (
              <span className="btn-ghost opacity-40">← Önceki</span>
            )}
            {from + DEFAULT_PAGE_SIZE < total ? (
              <Link href={`/settlements?page=${page + 1}`} className="btn-ghost">Sonraki →</Link>
            ) : (
              <span className="btn-ghost opacity-40">Sonraki →</span>
            )}
          </span>
        </div>
      )}
    </div>
  );
}
