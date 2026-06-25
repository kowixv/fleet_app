"use server";

import { createClient } from "@/lib/supabase/server";
import { requireWriteRole } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { computeSettlement, type LoadInput, type ExpenseInput, type SettlementType } from "@/lib/settlement/engine";
import { resolveConfig } from "@/lib/settlement/resolve";

const num = (v: FormDataEntryValue | null) =>
  v === null || v === "" ? null : Number(v);

export async function createSettlement(
  formData: FormData,
): Promise<{ error: string } | void> {
  const profile = await requireWriteRole();
  const supabase = await createClient();

  const settlementType = String(formData.get("settlement_type")) as SettlementType;
  const vehicleId = (formData.get("vehicle_id") as string) || null;
  const driverId = (formData.get("driver_id") as string) || null;
  const ownerId = (formData.get("owner_id") as string) || null;
  const companyId = (formData.get("company_id") as string) || null;
  const externalCarrierId = (formData.get("external_carrier_id") as string) || null;
  const weekStart = (formData.get("week_start") as string) || null;
  const weekEnd = (formData.get("week_end") as string) || null;
  const externalNetPay = num(formData.get("external_net_pay"));

  const ovDriver = num(formData.get("ov_driver_pct"));
  const ovCompany = num(formData.get("ov_company_pct"));
  const ovCommission = num(formData.get("ov_commission"));

  // Resolve config inputs
  const { data: vehicle } = vehicleId
    ? await supabase.from("vehicles").select("*").eq("id", vehicleId).single()
    : { data: null };
  const personId = ownerId || driverId;
  const { data: person } = personId
    ? await supabase.from("people").select("*").eq("id", personId).single()
    : { data: null };

  // Settings for default commission
  const { data: settings } = await supabase
    .from("settings").select("default_commission").eq("organization_id", profile.organization_id).single();

  const config = resolveConfig(
    settlementType,
    vehicle as any,
    person as any,
    {
      driverPayPct: ovDriver === null ? undefined : ovDriver / 100,
      companyFeePct: ovCompany === null ? undefined : ovCompany / 100,
      commissionAmount: ovCommission === null ? undefined : ovCommission,
    },
    settings?.default_commission ?? 250,
  );

  // Gather loads + expenses for the period (skip for external carrier statement)
  let loads: any[] = [];
  let expenses: any[] = [];
  if (settlementType !== "external_carrier_statement" && vehicleId && weekStart && weekEnd) {
    const loadsRes = await supabase
      .from("loads")
      .select("*")
      .eq("vehicle_id", vehicleId)
      .gte("delivery_date", weekStart)
      .lte("delivery_date", weekEnd)
      .is("settlement_id", null)
      .in("status", ["delivered", "paid", "booked"]);
    loads = loadsRes.data ?? [];

    const expRes = await supabase
      .from("expenses")
      .select("*")
      .eq("vehicle_id", vehicleId)
      .gte("date", weekStart)
      .lte("date", weekEnd)
      .is("settlement_id", null)
      .eq("deduct_from_settlement", true);
    const allExpenses: any[] = expRes.data ?? [];

    // Filter expenses by targeting flags. An expense with none of the targeting
    // flags set is considered universal (applies to any settlement type).
    // If at least one targeting flag is set, it only applies to matching types.
    expenses = allExpenses.filter((e) => {
      const hasTargeting = e.deduct_from_driver || e.deduct_from_owner || e.deduct_from_investor;
      if (!hasTargeting) return true;
      if (settlementType === "company_driver" || settlementType === "box_truck_driver") {
        return e.deduct_from_driver;
      }
      if (settlementType === "owner_operator") {
        return e.deduct_from_owner;
      }
      if (settlementType === "managed_investor") {
        return e.deduct_from_investor;
      }
      return false;
    });
  }

  const loadInputs: LoadInput[] = loads.map((l) => ({
    id: l.id,
    reference: l.load_number,
    route: l.route || `${l.pickup_location ?? ""} -> ${l.delivery_location ?? ""}`,
    type: l.load_source,
    grossAmount: Number(l.gross_amount) || 0,
  }));
  const expenseInputs: ExpenseInput[] = expenses.map((e) => ({
    category: e.category,
    amount: Number(e.amount) || 0,
  }));

  const result = computeSettlement({
    config,
    loads: loadInputs,
    expenses: expenseInputs,
    externalNetPay: externalNetPay ?? undefined,
  });

  // Persist settlement atomically in the database.
  const lineItems = result.lineItems.map((li, i) => ({
    key: li.key,
    label_en: li.labelEn,
    label_tr: li.labelTr,
    amount: li.amount,
    is_our_revenue: li.isOurRevenue ?? false,
    sort_order: i,
  }));

  const { data: settlementId, error } = await supabase.rpc("create_settlement_atomic", {
    p_settlement_type: settlementType,
    p_company_id: companyId,
    p_external_carrier_id: externalCarrierId,
    p_vehicle_id: vehicleId,
    p_driver_id: driverId,
    p_owner_id: ownerId,
    p_week_start: weekStart,
    p_week_end: weekEnd,
    p_config: config as any,
    p_gross_revenue: result.grossRevenue,
    p_total_deductions: result.totalDeductions,
    p_our_commission_earned: result.ourCommissionEarned,
    p_net_pay: result.netPay,
    p_external_net_pay: externalNetPay,
    p_line_items: lineItems,
    p_load_ids: loads.map((l) => l.id),
    p_expense_ids: expenses.map((e) => e.id),
  });

  if (error || !settlementId) {
    return { error: error?.message ?? "Settlement oluşturulamadı." };
  }
  revalidatePath("/settlements");
  redirect(`/settlements/${settlementId}`);
}

export async function setSettlementStatus(id: string, status: string) {
  await requireWriteRole();
  const supabase = await createClient();
  // Lock: a paid settlement can only be voided.
  const { data: cur } = await supabase.from("settlements").select("status").eq("id", id).single();
  if (cur?.status === "paid" && status !== "void")
    return { error: "Paid settlement düzenlenemez." };
  const { error } = await supabase.from("settlements").update({ status }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath(`/settlements/${id}`);
  revalidatePath("/settlements");
  return { ok: true };
}

export async function deleteSettlement(id: string) {
  await requireWriteRole();
  const supabase = await createClient();
  const { data: s } = await supabase.from("settlements").select("status").eq("id", id).single();
  if (s?.status === "finalized" || s?.status === "paid")
    return { error: "Finalized/Paid settlement silinemez." };
  // Release linked loads/expenses
  await supabase.from("loads").update({ settlement_id: null }).eq("settlement_id", id);
  await supabase.from("expenses").update({ settlement_id: null }).eq("settlement_id", id);
  await supabase.from("settlements").delete().eq("id", id);
  revalidatePath("/settlements");
  redirect("/settlements");
}
