"use server";

import { requireWriteRole } from "@/lib/auth";
import { computeSettlement, type ExpenseInput, type LoadInput, type SettlementConfig, type SettlementType } from "@/lib/settlement/engine";
import {
  ELIGIBLE_LOAD_STATUSES,
  activeUsageGroupsBlockedBy,
  canTransitionSettlementStatus,
  configSnapshot,
  expenseAppliesToUsageGroup,
  expenseTargetingReason,
  usageGroupForSettlementType,
  validateInclusivePeriod,
  validateNonNegativeMoney,
  validatePercentFraction,
} from "@/lib/settlement/workflow";
import { resolveConfig } from "@/lib/settlement/resolve";
import { STALE_SETTLEMENT_PREVIEW_MESSAGE, stableSettlementRevision } from "@/lib/settlement/revision";
import { createSettlementWithLinksAtomic } from "@/lib/settlement/create-from-selection";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

type SettlementInputPayload = {
  settlement_type?: string;
  vehicle_id?: string | null;
  driver_id?: string | null;
  owner_id?: string | null;
  company_id?: string | null;
  external_carrier_id?: string | null;
  week_start?: string | null;
  week_end?: string | null;
  external_net_pay?: string | number | null;
  ov_driver_pct?: string | number | null;
  ov_company_pct?: string | number | null;
  ov_commission?: string | number | null;
  selected_load_ids?: string[];
  selected_expense_ids?: string[];
  preview_revision?: string | null;
};

type PreviewRow = Record<string, any> & { unavailable_reason?: string; targeting_reason?: string };

function cleanId(value: unknown) {
  const s = typeof value === "string" ? value.trim() : "";
  return s || null;
}

function cleanDate(value: unknown) {
  const s = typeof value === "string" ? value.trim() : "";
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function optionalNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error("Numeric values must be finite.");
  return n;
}

function optionalPercentFromUi(value: unknown, label: string) {
  const n = optionalNumber(value);
  if (n === null) return null;
  return validatePercentFraction(n / 100, label);
}

function settlementType(value: unknown): SettlementType {
  if (
    value === "company_driver" ||
    value === "box_truck_driver" ||
    value === "owner_operator" ||
    value === "managed_investor" ||
    value === "external_carrier_statement"
  ) return value;
  throw new Error("Invalid settlement type.");
}

function lineItemsForPersistence(result: ReturnType<typeof computeSettlement>) {
  return result.lineItems.map((li, i) => ({
    key: li.key,
    label_en: li.labelEn,
    label_tr: li.labelTr,
    amount: li.amount,
    is_our_revenue: li.isOurRevenue ?? false,
    sort_order: i,
  }));
}

function routeForLoad(load: any) {
  return load.route || `${load.pickup_location ?? ""} -> ${load.delivery_location ?? ""}`.trim();
}

async function assertOrgRow(
  supabase: Awaited<ReturnType<typeof createClient>>,
  table: string,
  id: string | null,
  organizationId: string,
  label: string,
  select = "id",
) {
  if (!id) return null;
  const { data, error } = await supabase
    .from(table)
    .select(select)
    .eq("id", id)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error(`${label} does not belong to this organization.`);
  return data as any;
}

async function buildSettlementPreview(input: SettlementInputPayload, organizationId: string) {
  const supabase = await createClient();
  const type = settlementType(input.settlement_type);
  const usageGroup = usageGroupForSettlementType(type);
  const vehicleId = cleanId(input.vehicle_id);
  const driverId = cleanId(input.driver_id);
  const ownerId = cleanId(input.owner_id);
  const companyId = cleanId(input.company_id);
  const externalCarrierId = cleanId(input.external_carrier_id);
  const weekStart = cleanDate(input.week_start);
  const weekEnd = cleanDate(input.week_end);
  const externalNetPay = optionalNumber(input.external_net_pay);
  const overrides = {
    driverPayPct: optionalPercentFromUi(input.ov_driver_pct, "Driver pay override"),
    companyFeePct: optionalPercentFromUi(input.ov_company_pct, "Company fee override"),
    commissionAmount: validateNonNegativeMoney(optionalNumber(input.ov_commission), "Commission override"),
  };

  if (type === "external_carrier_statement") {
    if (!externalCarrierId) throw new Error("External carrier is required.");
    if (externalNetPay === null || externalNetPay < 0) throw new Error("External net pay must be zero or greater.");
  } else {
    if (!vehicleId) throw new Error("Vehicle is required.");
    validateInclusivePeriod(weekStart, weekEnd);
  }
  if ((type === "company_driver" || type === "box_truck_driver") && !driverId) throw new Error("Driver is required.");
  if (type === "owner_operator" && !ownerId) throw new Error("Owner is required.");
  if (type === "managed_investor" && !ownerId) throw new Error("Investor is required.");

  const vehicle = await assertOrgRow(
    supabase,
    "vehicles",
    vehicleId,
    organizationId,
    "Vehicle",
    "*, companies!vehicles_company_id_fkey(id, name), people!vehicles_owner_id_fkey(id, full_name, type), external_carriers!vehicles_external_carrier_id_fkey(id, name)",
  );
  if (type === "box_truck_driver" && vehicle?.vehicle_type !== "box_truck") {
    throw new Error("Box Truck Driver settlements require a box truck vehicle.");
  }

  const driver = await assertOrgRow(supabase, "people", driverId, organizationId, "Driver", "id, full_name, type, default_pay_pct");
  if (driver && !["company_driver", "external_carrier_driver"].includes(driver.type)) {
    throw new Error("Selected driver has an invalid person type.");
  }

  const owner = await assertOrgRow(supabase, "people", ownerId, organizationId, "Owner / Investor", "id, full_name, type, default_pay_pct");
  if (type === "owner_operator" && owner?.type !== "owner_operator") throw new Error("Owner Operator settlements require an owner_operator person.");
  if (type === "managed_investor" && owner?.type !== "investor") throw new Error("Managed Investor settlements require an investor person.");

  await assertOrgRow(supabase, "companies", companyId, organizationId, "Company", "id, name");
  await assertOrgRow(supabase, "external_carriers", externalCarrierId, organizationId, "External carrier", "id, name");

  const { data: settings } = await supabase
    .from("settings")
    .select("default_commission")
    .eq("organization_id", organizationId)
    .maybeSingle();

  const config: SettlementConfig = resolveConfig(
    type,
    vehicle,
    owner ?? driver,
    {
      driverPayPct: overrides.driverPayPct,
      companyFeePct: overrides.companyFeePct,
      commissionAmount: overrides.commissionAmount,
    },
    settings?.default_commission ?? 250,
  );

  const sources = {
    driver_pay_pct: overrides.driverPayPct !== null ? "settlement_override" : vehicle?.default_driver_pay_pct != null ? "vehicle_settlement_configuration" : driver?.default_pay_pct != null ? "person_default" : "fallback",
    company_fee_pct: overrides.companyFeePct !== null ? "settlement_override" : vehicle?.company_fee_pct != null ? "vehicle_settlement_configuration" : "fallback",
    management_commission_amount: overrides.commissionAmount !== null ? "settlement_override" : vehicle?.management_commission_amount != null ? "vehicle_settlement_configuration" : "organization_default",
  };

  let availableLoads: PreviewRow[] = [];
  let unavailableLoads: PreviewRow[] = [];
  let availableExpenses: PreviewRow[] = [];
  let unavailableExpenses: PreviewRow[] = [];

  if (usageGroup && vehicleId && weekStart && weekEnd) {
    const { data: loadsRaw, error: loadsError } = await supabase
      .from("loads")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("vehicle_id", vehicleId)
      .gte("delivery_date", weekStart)
      .lte("delivery_date", weekEnd)
      .order("delivery_date", { ascending: true });
    if (loadsError) throw new Error(loadsError.message);

    const loads = loadsRaw ?? [];
    const loadIds = loads.map((load: any) => load.id);
    const activeLoadIds = new Set<string>();
    if (loadIds.length > 0) {
      const { data: links, error } = await supabase
        .from("settlement_load_links")
        .select("load_id")
        .eq("organization_id", organizationId)
        .in("usage_group", activeUsageGroupsBlockedBy(usageGroup))
        .is("released_at", null)
        .in("load_id", loadIds);
      if (error) throw new Error(error.message);
      for (const link of links ?? []) activeLoadIds.add((link as any).load_id);
    }

    for (const load of loads) {
      const gross = Number(load.gross_amount);
      let unavailableReason = "";
      if (!(ELIGIBLE_LOAD_STATUSES as readonly string[]).includes(load.status)) unavailableReason = "invalid load status";
      else if (!Number.isFinite(gross) || gross < 0) unavailableReason = "invalid gross amount";
      else if (activeLoadIds.has(load.id)) unavailableReason = "already used in this usage group";
      const row = { ...load, unavailable_reason: unavailableReason || undefined };
      if (unavailableReason) unavailableLoads.push(row);
      else availableLoads.push(row);
    }

    const { data: expensesRaw, error: expensesError } = await supabase
      .from("expenses")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("vehicle_id", vehicleId)
      .gte("date", weekStart)
      .lte("date", weekEnd)
      .eq("deduct_from_settlement", true)
      .order("date", { ascending: true });
    if (expensesError) throw new Error(expensesError.message);

    const expenses = expensesRaw ?? [];
    const expenseIds = expenses.map((expense: any) => expense.id);
    const activeExpenseIds = new Set<string>();
    if (expenseIds.length > 0) {
      const { data: links, error } = await supabase
        .from("settlement_expense_links")
        .select("expense_id")
        .eq("organization_id", organizationId)
        .in("usage_group", activeUsageGroupsBlockedBy(usageGroup))
        .is("released_at", null)
        .in("expense_id", expenseIds);
      if (error) throw new Error(error.message);
      for (const link of links ?? []) activeExpenseIds.add((link as any).expense_id);
    }

    for (const expense of expenses) {
      let unavailableReason = "";
      if (!expenseAppliesToUsageGroup(expense, usageGroup)) unavailableReason = "wrong expense targeting";
      else if (activeExpenseIds.has(expense.id)) unavailableReason = "already used in this usage group";
      const row = { ...expense, targeting_reason: expenseTargetingReason(expense), unavailable_reason: unavailableReason || undefined };
      if (unavailableReason) unavailableExpenses.push(row);
      else availableExpenses.push(row);
    }
  }

  const selectedLoadIds = new Set(input.selected_load_ids ?? availableLoads.map((load) => load.id));
  const selectedExpenseIds = new Set(input.selected_expense_ids ?? availableExpenses.map((expense) => expense.id));
  const selectedLoads = availableLoads.filter((load) => selectedLoadIds.has(load.id));
  const selectedExpenses = availableExpenses.filter((expense) => selectedExpenseIds.has(expense.id));
  const staleLoadIds = [...selectedLoadIds].filter((id) => !availableLoads.some((load) => load.id === id));
  const staleExpenseIds = [...selectedExpenseIds].filter((id) => !availableExpenses.some((expense) => expense.id === id));

  const loadInputs: LoadInput[] = selectedLoads.map((load) => ({
    id: load.id,
    reference: load.load_number,
    route: routeForLoad(load),
    type: load.load_source,
    grossAmount: Number(load.gross_amount) || 0,
  }));
  const expenseInputs: ExpenseInput[] = selectedExpenses.map((expense) => ({
    category: expense.category,
    amount: Number(expense.amount) || 0,
    labelEn: expense.notes || expense.category,
    labelTr: expense.notes || expense.category,
  }));

  const result = computeSettlement({
    config,
    loads: loadInputs,
    expenses: expenseInputs,
    externalNetPay: externalNetPay ?? undefined,
  });
  const configForPersistence = configSnapshot(config, sources);
  const lineItems = lineItemsForPersistence(result);
  const revision = stableSettlementRevision({
    business: { type, usageGroup, vehicleId, driverId, ownerId, companyId, externalCarrierId, weekStart, weekEnd, externalNetPay },
    overrides,
    config: configForPersistence,
    selectedLoads: selectedLoads.map((load) => ({
      id: load.id,
      vehicle_id: load.vehicle_id,
      driver_id: load.driver_id,
      status: load.status,
      load_number: load.load_number,
      delivery_date: load.delivery_date,
      gross_amount: load.gross_amount,
      total_miles: load.total_miles,
      company_id: load.company_id,
      external_carrier_id: load.external_carrier_id,
    })),
    selectedExpenses: selectedExpenses.map((expense) => ({
      id: expense.id,
      vehicle_id: expense.vehicle_id,
      driver_id: expense.driver_id,
      owner_id: expense.owner_id,
      date: expense.date,
      category: expense.category,
      amount: expense.amount,
      deduct_from_settlement: expense.deduct_from_settlement,
      deduct_from_driver: expense.deduct_from_driver,
      deduct_from_owner: expense.deduct_from_owner,
      deduct_from_investor: expense.deduct_from_investor,
      company_id: expense.company_id,
      external_carrier_id: expense.external_carrier_id,
    })),
    result: {
      grossRevenue: result.grossRevenue,
      totalDeductions: result.totalDeductions,
      ourCommissionEarned: result.ourCommissionEarned,
      netPay: result.netPay,
      calculationBaseAmount: result.calculationBaseAmount,
      calculationBaseLabel: result.calculationBaseLabel,
      payableLabel: result.payableLabel,
      calculationRows: result.calculationRows,
    },
    lineItems,
  });

  return {
    input: { type, usageGroup, vehicleId, driverId, ownerId, companyId, externalCarrierId, weekStart, weekEnd, externalNetPay },
    config,
    configSnapshot: configForPersistence,
    availableLoads,
    unavailableLoads,
    availableExpenses,
    unavailableExpenses,
    selectedLoadIds: selectedLoads.map((load) => load.id),
    selectedExpenseIds: selectedExpenses.map((expense) => expense.id),
    staleLoadIds,
    staleExpenseIds,
    revision,
    result,
    lineItems,
    warnings: [
      selectedLoads.length === 0 && usageGroup ? "No eligible loads selected." : null,
      staleLoadIds.length > 0 || staleExpenseIds.length > 0 ? "Selection changed since preview." : null,
    ].filter(Boolean),
  };
}

export async function previewSettlement(input: SettlementInputPayload) {
  try {
    const profile = await requireWriteRole();
    return { ok: true as const, preview: await buildSettlementPreview(input, profile.organization_id) };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function createSettlementFromSelection(input: SettlementInputPayload): Promise<{ ok: false; error: string } | void> {
  let settlementId: string | null = null;
  try {
    const profile = await requireWriteRole();
    const preview = await buildSettlementPreview(input, profile.organization_id);
    if (preview.staleLoadIds.length > 0 || preview.staleExpenseIds.length > 0) {
      return { ok: false, error: STALE_SETTLEMENT_PREVIEW_MESSAGE };
    }
    if (!input.preview_revision || input.preview_revision !== preview.revision) {
      return { ok: false, error: STALE_SETTLEMENT_PREVIEW_MESSAGE };
    }

    const created = await createSettlementWithLinksAtomic({
      organizationId: profile.organization_id,
      createdBy: profile.id,
      settlementType: preview.input.type,
      usageGroup: preview.input.usageGroup,
      companyId: preview.input.companyId,
      externalCarrierId: preview.input.externalCarrierId,
      vehicleId: preview.input.vehicleId,
      driverId: preview.input.driverId,
      ownerId: preview.input.ownerId,
      weekStart: preview.input.weekStart,
      weekEnd: preview.input.weekEnd,
      config: preview.configSnapshot,
      grossRevenue: preview.result.grossRevenue,
      totalDeductions: preview.result.totalDeductions,
      ourCommissionEarned: preview.result.ourCommissionEarned,
      netPay: preview.result.netPay,
      externalNetPay: preview.input.externalNetPay,
      lineItems: preview.lineItems,
      selectedLoadIds: preview.selectedLoadIds,
      selectedExpenseIds: preview.selectedExpenseIds,
    });
    if (!created.ok) return { ok: false, error: created.error };
    settlementId = created.settlementId;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  revalidatePath("/settlements");
  redirect(`/settlements/${settlementId}`);
}

export async function updateSettlementStatus(id: string, status: string) {
  try {
    await requireWriteRole();
    const supabase = await createClient();
    const { data: current, error: readError } = await supabase.from("settlements").select("status").eq("id", id).single();
    if (readError) return { error: readError.message };
    if (!canTransitionSettlementStatus(current.status, status)) return { error: "Invalid settlement status transition." };
    const { error } = await supabase.rpc("transition_settlement_status", {
      p_settlement_id: id,
      p_new_status: status,
      p_void_reason: null,
    });
    if (error) return { error: error.message };
    revalidatePath(`/settlements/${id}`);
    revalidatePath("/settlements");
    return { ok: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export async function voidSettlement(id: string, reason: string) {
  try {
    await requireWriteRole();
    const trimmed = reason.trim();
    if (trimmed.length < 3) return { error: "Void reason is required." };
    const supabase = await createClient();
    const { error } = await supabase.rpc("transition_settlement_status", {
      p_settlement_id: id,
      p_new_status: "void",
      p_void_reason: trimmed,
    });
    if (error) return { error: error.message };
    revalidatePath(`/settlements/${id}`);
    revalidatePath("/settlements");
    return { ok: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export async function deleteDraftSettlement(id: string) {
  try {
    await requireWriteRole();
    const supabase = await createClient();
    const { error } = await supabase.rpc("delete_draft_settlement", { p_settlement_id: id });
    if (error) return { error: error.message };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  revalidatePath("/settlements");
  redirect("/settlements");
}

export async function saveVehicleSettlementConfig(input: Record<string, unknown>) {
  try {
    const profile = await requireWriteRole();
    const vehicleId = cleanId(input.vehicle_id);
    if (!vehicleId) return { ok: false as const, error: "Vehicle is required." };
    const ownershipType = String(input.ownership_type || "");
    if (!["company_owned", "owner_operator", "investor_managed", "external_carrier_statement", "partner_carrier"].includes(ownershipType)) {
      return { ok: false as const, error: "Invalid ownership type." };
    }
    const commissionType = String(input.management_commission_type || "none");
    if (!["none", "flat", "percent"].includes(commissionType)) return { ok: false as const, error: "Invalid commission type." };

    const companyId = cleanId(input.company_id);
    const ownerId = cleanId(input.owner_id);
    const externalCarrierId = cleanId(input.external_carrier_id);
    const supabase = await createClient();
    await assertOrgRow(supabase, "vehicles", vehicleId, profile.organization_id, "Vehicle");
    await assertOrgRow(supabase, "companies", companyId, profile.organization_id, "Company");
    await assertOrgRow(supabase, "people", ownerId, profile.organization_id, "Owner / Investor");
    await assertOrgRow(supabase, "external_carriers", externalCarrierId, profile.organization_id, "External carrier");

    const commissionAmount = commissionType === "percent"
      ? validatePercentFraction((optionalNumber(input.management_commission_amount) ?? 0) / 100, "Management commission")
      : validateNonNegativeMoney(optionalNumber(input.management_commission_amount) ?? 0, "Management commission");

    const patch = {
      ownership_type: ownershipType,
      company_id: companyId,
      owner_id: ownerId,
      external_carrier_id: externalCarrierId,
      default_driver_pay_pct: optionalPercentFromUi(input.default_driver_pay_pct, "Default driver pay"),
      company_fee_pct: optionalPercentFromUi(input.company_fee_pct, "Company fee"),
      company_fee_is_our_revenue: input.company_fee_is_our_revenue === "on" || input.company_fee_is_our_revenue === true,
      external_carrier_fee_pct: optionalPercentFromUi(input.external_carrier_fee_pct, "External carrier fee"),
      management_commission_type: commissionType,
      management_commission_amount: commissionType === "percent" ? commissionAmount : commissionAmount,
    };
    const { error } = await supabase
      .from("vehicles")
      .update(patch)
      .eq("id", vehicleId)
      .eq("organization_id", profile.organization_id);
    if (error) return { ok: false as const, error: error.message };
    revalidatePath("/settlements/settings");
    revalidatePath("/settlements");
    return { ok: true as const };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function setSettlementStatus(id: string, status: string) {
  return updateSettlementStatus(id, status);
}

export async function deleteSettlement(id: string) {
  return deleteDraftSettlement(id);
}
