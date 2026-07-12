import { renderToBuffer } from "@react-pdf/renderer";
import { createClient } from "@/lib/supabase/server";
import {
  StatementDocument,
  titleFor,
  ROLE_LABELS,
  type StatementData,
} from "@/lib/pdf/statement";
import { shortDate } from "@/lib/format";
import React from "react";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: st } = await supabase
    .from("settlements")
    .select("*, vehicles!settlements_vehicle_id_fkey(unit_number), companies!settlements_company_id_fkey(name, scac)")
    .eq("id", id)
    .single();

  if (!st) return new Response("Not found", { status: 404 });

  const [{ data: items }, { data: loads }, { data: expenses }, person] = await Promise.all([
    supabase.from("settlement_items").select("*").eq("settlement_id", id).order("sort_order"),
    supabase.from("loads").select("*").eq("settlement_id", id),
    supabase.from("expenses").select("*").eq("settlement_id", id),
    (async () => {
      const pid = st.owner_id || st.driver_id;
      if (!pid) return { data: null } as any;
      return supabase.from("people").select("full_name").eq("id", pid).single();
    })(),
  ]);

  const data: StatementData = {
    title: titleFor(st.settlement_type),
    companyName: st.companies?.name ?? "Fleet",
    scac: st.companies?.scac ?? null,
    sourceNote: "Prepared from load and expense details.",
    payeeName: person?.data?.full_name ?? "—",
    payeeRole: ROLE_LABELS[st.settlement_type] ?? "",
    unitNumber: st.vehicles?.unit_number ?? null,
    period:
      st.week_start && st.week_end
        ? `${shortDate(st.week_start)} - ${shortDate(st.week_end)}`
        : "—",
    paymentDate: undefined,
    grossRevenue: Number(st.gross_revenue) || 0,
    netPay: Number(st.net_pay) || 0,
    ourCommission: Number(st.our_commission_earned) || 0,
    lineItems: (items ?? []).map((li: any) => ({
      labelEn: li.label_en,
      labelTr: li.label_tr,
      amount: Number(li.amount),
    })),
    loads: (loads ?? []).map((l: any) => ({
      reference: l.load_number,
      route: l.route || `${l.pickup_location ?? ""} -> ${l.delivery_location ?? ""}`,
      type: l.load_source,
      grossAmount: Number(l.gross_amount) || 0,
    })),
    expenses: (expenses ?? []).map((e: any) => ({
      category: e.category,
      amount: Number(e.amount) || 0,
    })),
    notes: st.notes,
  };

  const buffer = await renderToBuffer(
    React.createElement(StatementDocument, { data }) as any,
  );

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="settlement-${id}.pdf"`,
    },
  });
}
