import { renderToBuffer } from "@react-pdf/renderer";
import { createClient } from "@/lib/supabase/server";
import { StatementDocument, titleFor, ROLE_LABELS, type StatementData } from "@/lib/pdf/statement";
import { shortDate } from "@/lib/format";
import { displayRowsForStoredSettlement } from "@/lib/settlement/workflow";
import React from "react";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: st } = await supabase
    .from("settlements")
    .select("*, vehicles!settlements_vehicle_id_fkey(unit_number), companies!settlements_company_id_fkey(name, scac), external_carriers!settlements_external_carrier_id_fkey(name)")
    .eq("id", id)
    .single();

  if (!st) return new Response("Not found", { status: 404 });

  const [{ data: items }, loadLinks, expenseLinks, person] = await Promise.all([
    supabase.from("settlement_items").select("*").eq("settlement_id", id).order("sort_order"),
    supabase.from("settlement_load_links").select("usage_group, released_at, loads(*)").eq("settlement_id", id).order("created_at"),
    supabase.from("settlement_expense_links").select("usage_group, released_at, expenses(*)").eq("settlement_id", id).order("created_at"),
    (async () => {
      const pid = st.owner_id || st.driver_id;
      if (!pid) return { data: null } as any;
      return supabase.from("people").select("full_name").eq("id", pid).single();
    })(),
  ]);

  let loads = (loadLinks.data ?? []).map((link: any) => ({ ...link.loads, usageGroup: link.usage_group }));
  let expenses = (expenseLinks.data ?? []).map((link: any) => ({ ...link.expenses, usageGroup: link.usage_group }));
  if (loads.length === 0) {
    const fallback = await supabase.from("loads").select("*").eq("settlement_id", id);
    loads = fallback.data ?? [];
  }
  if (expenses.length === 0) {
    const fallback = await supabase.from("expenses").select("*").eq("settlement_id", id);
    expenses = fallback.data ?? [];
  }

  const lineItems = (items ?? []).map((li: any) => ({
    key: li.key,
    labelEn: li.label_en,
    labelTr: li.label_tr,
    amount: Number(li.amount),
    isOurRevenue: li.is_our_revenue,
  }));
  const calculationRows = displayRowsForStoredSettlement({
    settlement_type: st.settlement_type,
    gross_revenue: st.gross_revenue,
    net_pay: st.net_pay,
  }, lineItems);

  const data: StatementData = {
    title: titleFor(st.settlement_type),
    companyName: st.companies?.name ?? "Fleet",
    scac: st.companies?.scac ?? null,
    sourceNote: "Prepared from linked load and expense details.",
    status: st.status,
    payeeName: st.settlement_type === "external_carrier_statement"
      ? st.external_carriers?.name ?? "-"
      : person?.data?.full_name ?? "-",
    payeeRole: ROLE_LABELS[st.settlement_type] ?? "",
    unitNumber: st.vehicles?.unit_number ?? null,
    period: st.week_start && st.week_end ? `${shortDate(st.week_start)} - ${shortDate(st.week_end)}` : "-",
    paymentDate: undefined,
    grossRevenue: Number(st.gross_revenue) || 0,
    netPay: Number(st.net_pay) || 0,
    ourCommission: Number(st.our_commission_earned) || 0,
    lineItems,
    calculationRows,
    loads: loads.map((l: any) => ({
      reference: l.load_number,
      route: l.route || `${l.pickup_location ?? ""} -> ${l.delivery_location ?? ""}`,
      type: l.load_source,
      grossAmount: Number(l.gross_amount) || 0,
      usageGroup: l.usageGroup ?? "legacy",
    })),
    expenses: expenses.map((e: any) => ({
      category: e.category,
      amount: Number(e.amount) || 0,
      usageGroup: e.usageGroup ?? "legacy",
    })),
    notes: st.notes,
  };

  const buffer = await renderToBuffer(React.createElement(StatementDocument, { data }) as any);

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="settlement-${id}.pdf"`,
    },
  });
}
