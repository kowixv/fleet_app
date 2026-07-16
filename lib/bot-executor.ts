/**
 * Executor for AI-detected Telegram management commands.
 *
 * Runs with the service-role client (RLS bypassed), so EVERY query is scoped
 * explicitly by organization_id. Mirrors the validation done by the web CRUD
 * layer (lib/crud-allowlist.ts) and the settlement flow
 * (app/(app)/settlements/actions.ts).
 */
import {
  computeSettlement,
  type LoadInput,
  type ExpenseInput,
  type SettlementType,
} from "@/lib/settlement/engine";
import { resolveConfig } from "@/lib/settlement/resolve";
import { STALE_SETTLEMENT_PREVIEW_MESSAGE, stableSettlementRevision } from "@/lib/settlement/revision";
import {
  activeUsageGroupsBlockedBy,
  configSnapshot,
  expenseAppliesToUsageGroup,
  usageGroupForSettlementType,
} from "@/lib/settlement/workflow";
import { usd } from "@/lib/format";
import { localISODate } from "@/lib/format";
import { escapeHtml } from "@/lib/telegram";
import { weekRange } from "@/lib/bot-intent";
import type { BotIntent } from "@/lib/bot-intent";

export interface PendingCommand {
  id?: string;
  organization_id: string;
  chat_id: string;
  intent: BotIntent;
  payload: Record<string, unknown>;
  step?: number;
  awaiting?: string | null;
}

type Result = { ok: boolean; message: string };
type PreparedSettlement = Result & {
  payload?: Record<string, unknown>;
  rpc?: Record<string, unknown>;
  revision?: string;
};

const PERSON_TYPES = ["company_driver", "owner_operator", "investor", "external_carrier_driver"];
const VEHICLE_TYPES = ["truck", "box_truck", "hotshot", "trailer", "other"];
const OWNERSHIP_TYPES = [
  "company_owned", "owner_operator", "investor_managed",
  "external_carrier_statement", "partner_carrier",
];
const PERSON_STATUS = ["active", "inactive"];

// ---------- value coercion ----------
function str(v: unknown): string | null {
  if (typeof v !== "string") return v == null ? null : String(v);
  const t = v.trim();
  return t === "" || t.toLowerCase() === "null" ? null : t;
}
function num(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(typeof v === "string" ? v.replace(/[^0-9.\-]/g, "") : v);
  return Number.isFinite(n) ? n : null;
}
/** Percent normaliser: a value > 1 is treated as whole-percent (33 -> 0.33). */
function pctFraction(v: unknown): number | null {
  const n = num(v);
  if (n === null) return null;
  return n > 1 ? n / 100 : n;
}

// ---------- org-scoped lookups ----------
async function findVehicle(supabase: any, orgId: string, unit: unknown) {
  const u = str(unit);
  if (!u) return { row: null as any, count: 0 };
  const { data } = await supabase
    .from("vehicles")
    .select("*")
    .eq("organization_id", orgId)
    .ilike("unit_number", u);
  return { row: data?.[0] ?? null, count: data?.length ?? 0 };
}
async function findSettlementVehicle(supabase: any, orgId: string, data: Record<string, unknown>) {
  const vehicleId = str(data.vehicle_id);
  if (vehicleId) {
    const { data: rows } = await supabase
      .from("vehicles")
      .select("*")
      .eq("organization_id", orgId)
      .eq("id", vehicleId);
    return { row: rows?.[0] ?? null, count: rows?.length ?? 0 };
  }
  return findVehicle(supabase, orgId, data.vehicle_unit);
}
async function findPerson(supabase: any, orgId: string, name: unknown) {
  const n = str(name);
  if (!n) return { row: null as any, count: 0 };
  const { data } = await supabase
    .from("people")
    .select("*")
    .eq("organization_id", orgId)
    .ilike("full_name", n);
  return { row: data?.[0] ?? null, count: data?.length ?? 0 };
}

/**
 * Execute a confirmed pending command and return a user-facing message.
 * For create_settlement, payload was pre-built by prepareSettlement().
 */
export async function executeCommand(supabase: any, pending: PendingCommand): Promise<Result> {
  const orgId = pending.organization_id;
  const data = (pending.payload?.data as Record<string, unknown>) ?? {};

  try {
    switch (pending.intent) {
      case "add_person":
        return await addPerson(supabase, orgId, data);
      case "add_vehicle":
        return await addVehicle(supabase, orgId, data);
      case "add_expense":
        return await addExpense(supabase, orgId, data);
      case "update_vehicle_mileage":
        return await updateMileage(supabase, orgId, data);
      case "update_person":
        return await updatePerson(supabase, orgId, data);
      case "delete_entity":
        return await deleteEntity(supabase, orgId, data);
      case "create_settlement":
        return await runSettlement(supabase, orgId, pending.payload);
      default:
        return { ok: false, message: "Bu komut desteklenmiyor." };
    }
  } catch (e: any) {
    console.error("bot-executor error", pending.intent, e);
    return { ok: false, message: `⚠️ İşlem başarısız: ${escapeHtml(e?.message ?? "bilinmeyen hata")}` };
  }
}

// ---------- intent handlers ----------
async function addPerson(supabase: any, orgId: string, data: Record<string, unknown>): Promise<Result> {
  const full_name = str(data.full_name);
  const type = str(data.type) ?? "company_driver";
  if (!full_name) return { ok: false, message: "İsim gerekli." };
  if (!PERSON_TYPES.includes(type))
    return { ok: false, message: `Geçersiz kişi tipi: ${escapeHtml(type)}` };

  const { error } = await supabase.from("people").insert({
    organization_id: orgId,
    full_name,
    type,
    phone: str(data.phone),
    email: str(data.email),
    default_pay_pct: pctFraction(data.default_pay_pct),
    status: "active",
  });
  if (error) return { ok: false, message: `⚠️ Eklenemedi: ${escapeHtml(error.message)}` };
  return { ok: true, message: `✅ <b>${escapeHtml(full_name)}</b> (${escapeHtml(type)}) eklendi.` };
}

async function addVehicle(supabase: any, orgId: string, data: Record<string, unknown>): Promise<Result> {
  const unit_number = str(data.unit_number);
  const vehicle_type = str(data.vehicle_type) ?? "truck";
  if (!unit_number) return { ok: false, message: "Unit numarası gerekli." };
  if (!VEHICLE_TYPES.includes(vehicle_type))
    return { ok: false, message: `Geçersiz araç tipi: ${escapeHtml(vehicle_type)}` };
  const ownership_type = str(data.ownership_type);
  if (ownership_type && !OWNERSHIP_TYPES.includes(ownership_type))
    return { ok: false, message: `Geçersiz sahiplik tipi: ${escapeHtml(ownership_type)}` };

  const { error } = await supabase.from("vehicles").insert({
    organization_id: orgId,
    unit_number,
    vehicle_type,
    ownership_type: ownership_type ?? undefined,
    vin: str(data.vin),
    make: str(data.make),
    model: str(data.model),
    year: num(data.year),
    plate: str(data.plate),
    status: "active",
  });
  if (error) return { ok: false, message: `⚠️ Eklenemedi: ${escapeHtml(error.message)}` };
  return { ok: true, message: `✅ Araç <b>${escapeHtml(unit_number)}</b> (${escapeHtml(vehicle_type)}) eklendi.` };
}

async function addExpense(supabase: any, orgId: string, data: Record<string, unknown>): Promise<Result> {
  const category = str(data.category);
  const amount = num(data.amount);
  if (!category) return { ok: false, message: "Gider kategorisi gerekli." };
  if (amount === null) return { ok: false, message: "Geçerli bir tutar gerekli." };

  const veh = await findVehicle(supabase, orgId, data.vehicle_unit);
  const drv = await findPerson(supabase, orgId, data.driver_name);

  const { error } = await supabase.from("expenses").insert({
    organization_id: orgId,
    category,
    amount,
    date: str(data.date) ?? localISODate(new Date()),
    vehicle_id: veh.row?.id ?? null,
    driver_id: drv.row?.id ?? null,
    notes: str(data.notes),
    deduct_from_settlement: true,
  });
  if (error) return { ok: false, message: `⚠️ Eklenemedi: ${escapeHtml(error.message)}` };
  const where = veh.row ? ` (Unit ${escapeHtml(veh.row.unit_number)})` : "";
  return { ok: true, message: `✅ Gider eklendi: ${escapeHtml(category)} ${usd(amount)}${where}.` };
}

async function updateMileage(supabase: any, orgId: string, data: Record<string, unknown>): Promise<Result> {
  const mileage = num(data.mileage);
  if (mileage === null || !Number.isInteger(mileage)) {
    return { ok: false, message: "Geçerli bir tam sayı mileage değeri gerekli." };
  }
  const veh = await findVehicle(supabase, orgId, data.unit_number);
  if (!veh.row) return { ok: false, message: `Araç bulunamadı: ${escapeHtml(str(data.unit_number) ?? "")}` };
  if (veh.count > 1) return { ok: false, message: "Birden fazla araç eşleşti; lütfen belirginleştirin." };

  const { error } = await supabase.rpc("set_vehicle_mileage", {
    p_vehicle_id: veh.row.id,
    p_mileage: mileage,
    p_source: "telegram",
    p_organization_id: orgId,
  });
  if (error) return { ok: false, message: `⚠️ Güncellenemedi: ${escapeHtml(error.message)}` };
  return {
    ok: true,
    message: `✅ Unit <b>${escapeHtml(veh.row.unit_number)}</b> mileage değeri ${mileage.toLocaleString("en-US")} mi olarak güncellendi.`,
  };
}

async function updatePerson(supabase: any, orgId: string, data: Record<string, unknown>): Promise<Result> {
  const person = await findPerson(supabase, orgId, data.name);
  if (!person.row) return { ok: false, message: `Kişi bulunamadı: ${escapeHtml(str(data.name) ?? "")}` };
  if (person.count > 1) return { ok: false, message: "Birden fazla kişi eşleşti; lütfen belirginleştirin." };

  const patch: Record<string, unknown> = {};
  if (str(data.full_name)) patch.full_name = str(data.full_name);
  if (str(data.phone)) patch.phone = str(data.phone);
  if (str(data.email)) patch.email = str(data.email);
  if (data.default_pay_pct != null) patch.default_pay_pct = pctFraction(data.default_pay_pct);
  if (str(data.type)) {
    const t = str(data.type)!;
    if (!PERSON_TYPES.includes(t)) return { ok: false, message: `Geçersiz kişi tipi: ${escapeHtml(t)}` };
    patch.type = t;
  }
  if (str(data.status)) {
    const s = str(data.status)!;
    if (!PERSON_STATUS.includes(s)) return { ok: false, message: `Geçersiz durum: ${escapeHtml(s)}` };
    patch.status = s;
  }
  if (Object.keys(patch).length === 0)
    return { ok: false, message: "Güncellenecek alan belirtilmedi." };

  const { error } = await supabase
    .from("people")
    .update(patch)
    .eq("id", person.row.id)
    .eq("organization_id", orgId);
  if (error) return { ok: false, message: `⚠️ Güncellenemedi: ${escapeHtml(error.message)}` };
  return { ok: true, message: `✅ <b>${escapeHtml(person.row.full_name)}</b> güncellendi.` };
}

async function deleteEntity(supabase: any, orgId: string, data: Record<string, unknown>): Promise<Result> {
  const entity = (str(data.entity_type) ?? "").toLowerCase();
  const name = str(data.name);
  if (!name) return { ok: false, message: "Silinecek kaydın adı/numarası gerekli." };

  const map: Record<string, { table: string; col: string; label: string }> = {
    person: { table: "people", col: "full_name", label: "Kişi" },
    driver: { table: "people", col: "full_name", label: "Kişi" },
    vehicle: { table: "vehicles", col: "unit_number", label: "Araç" },
    load: { table: "loads", col: "load_number", label: "Yük" },
  };
  const cfg = map[entity];
  if (!cfg) return { ok: false, message: `Bu tür silinemiyor: ${escapeHtml(entity)}` };

  const { data: rows } = await supabase
    .from(cfg.table)
    .select("id")
    .eq("organization_id", orgId)
    .ilike(cfg.col, name);
  if (!rows?.length) return { ok: false, message: `${cfg.label} bulunamadı: ${escapeHtml(name)}` };
  if (rows.length > 1) return { ok: false, message: `Birden fazla kayıt eşleşti (${rows.length}); lütfen belirginleştirin.` };

  const { error } = await supabase
    .from(cfg.table)
    .delete()
    .eq("id", rows[0].id)
    .eq("organization_id", orgId);
  if (error) return { ok: false, message: `⚠️ Silinemedi: ${escapeHtml(error.message)}` };
  return { ok: true, message: `✅ ${cfg.label} silindi: ${escapeHtml(name)}` };
}

// ---------- settlement ----------
function deriveSettlementType(vehicle: any, override: unknown): SettlementType {
  const o = str(override) as SettlementType | null;
  const valid: SettlementType[] = [
    "company_driver", "box_truck_driver", "owner_operator",
    "managed_investor", "external_carrier_statement",
  ];
  if (o && valid.includes(o)) return o;
  switch (vehicle?.ownership_type) {
    case "owner_operator": return "owner_operator";
    case "investor_managed": return "managed_investor";
    case "external_carrier_statement":
    case "partner_carrier": return "external_carrier_statement";
    case "company_owned":
    default:
      return vehicle?.vehicle_type === "box_truck" ? "box_truck_driver" : "company_driver";
  }
}

/**
 * Resolve a vehicle + week, gather unsettled loads/expenses, compute the
 * settlement, and return a preview message plus a confirmation-safe payload.
 * Returns ok:false (no payload) when something is missing.
 */
function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.map((item) => str(item)).filter(Boolean) as string[];
}

async function buildPreparedSettlement(
  supabase: any,
  orgId: string,
  data: Record<string, unknown>,
): Promise<PreparedSettlement> {
  const veh = await findSettlementVehicle(supabase, orgId, data);
  if (!veh.row) return { ok: false, message: `Araç bulunamadı: ${escapeHtml(str(data.vehicle_unit) ?? "")}` };
  if (veh.count > 1) return { ok: false, message: "Birden fazla araç eşleşti; lütfen belirginleştirin." };
  const vehicle = veh.row;

  const settlementType = deriveSettlementType(vehicle, data.settlement_type);
  const range =
    str(data.week_start) && str(data.week_end)
      ? { start: str(data.week_start)!, end: str(data.week_end)! }
      : weekRange(str(data.week));

  // Resolve config (vehicle assignment -> driver/owner default -> company default).
  const personId = vehicle.owner_id ?? vehicle.assigned_driver_id ?? null;
  const { data: person } = personId
    ? await supabase.from("people").select("*").eq("id", personId).eq("organization_id", orgId).single()
    : { data: null };
  const { data: settings } = await supabase
    .from("settings").select("default_commission").eq("organization_id", orgId).maybeSingle();

  const config = resolveConfig(
    settlementType,
    vehicle as any,
    person as any,
    {},
    settings?.default_commission ?? 250,
  );

  // Gather unsettled loads + expenses in the period (skip for external statements).
  let loads: any[] = [];
  let expenses: any[] = [];
  const selectedLoadIds = stringArray(data.selected_load_ids);
  const selectedExpenseIds = stringArray(data.selected_expense_ids);
  if (settlementType !== "external_carrier_statement") {
    const usageGroup = usageGroupForSettlementType(settlementType);
    if (!usageGroup) return { ok: false, message: "Bu settlement tipi normal load/expense kullanmaz." };
    const loadsRes = await supabase
      .from("loads").select("*")
      .eq("organization_id", orgId)
      .eq("vehicle_id", vehicle.id)
      .gte("delivery_date", range.start)
      .lte("delivery_date", range.end)
      .in("status", ["delivered", "paid"]);
    const candidateLoads = loadsRes.data ?? [];
    if (candidateLoads.length > 0) {
      const { data: activeLinks } = await supabase
        .from("settlement_load_links")
        .select("load_id")
        .eq("organization_id", orgId)
        .in("usage_group", activeUsageGroupsBlockedBy(usageGroup))
        .is("released_at", null)
        .in("load_id", candidateLoads.map((load: any) => load.id));
      const used = new Set((activeLinks ?? []).map((link: any) => link.load_id));
      loads = candidateLoads.filter((load: any) => !used.has(load.id));
    }
    if (selectedLoadIds) {
      const availableLoadIds = new Set(loads.map((load: any) => load.id));
      if (selectedLoadIds.some((id) => !availableLoadIds.has(id))) {
        return { ok: false, message: STALE_SETTLEMENT_PREVIEW_MESSAGE };
      }
      const selected = new Set(selectedLoadIds);
      loads = loads.filter((load: any) => selected.has(load.id));
    }

    const expRes = await supabase
      .from("expenses").select("*")
      .eq("organization_id", orgId)
      .eq("vehicle_id", vehicle.id)
      .gte("date", range.start)
      .lte("date", range.end)
      .eq("deduct_from_settlement", true);
    const allExpenses: any[] = expRes.data ?? [];
    const targetedExpenses = allExpenses.filter((e) => expenseAppliesToUsageGroup(e, usageGroup));
    if (targetedExpenses.length > 0) {
      const { data: activeLinks } = await supabase
        .from("settlement_expense_links")
        .select("expense_id")
        .eq("organization_id", orgId)
        .in("usage_group", activeUsageGroupsBlockedBy(usageGroup))
        .is("released_at", null)
        .in("expense_id", targetedExpenses.map((expense: any) => expense.id));
      const used = new Set((activeLinks ?? []).map((link: any) => link.expense_id));
      expenses = targetedExpenses.filter((expense: any) => !used.has(expense.id));
    }
    if (selectedExpenseIds) {
      const availableExpenseIds = new Set(expenses.map((expense: any) => expense.id));
      if (selectedExpenseIds.some((id) => !availableExpenseIds.has(id))) {
        return { ok: false, message: STALE_SETTLEMENT_PREVIEW_MESSAGE };
      }
      const selected = new Set(selectedExpenseIds);
      expenses = expenses.filter((expense: any) => selected.has(expense.id));
    }
  }

  if (loads.length === 0 && settlementType !== "external_carrier_statement") {
    return {
      ok: false,
      message: `Bu dönemde (${range.start} → ${range.end}) Unit ${escapeHtml(vehicle.unit_number)} için settlement'a uygun yük bulunamadı.`,
    };
  }

  const loadInputs: LoadInput[] = loads.map((l) => ({
    id: l.id,
    reference: l.load_number,
    route: l.route || `${l.pickup_location ?? ""} -> ${l.delivery_location ?? ""}`,
    grossAmount: Number(l.gross_amount) || 0,
  }));
  const expenseInputs: ExpenseInput[] = expenses.map((e) => ({
    category: e.category,
    amount: Number(e.amount) || 0,
  }));

  const result = computeSettlement({ config, loads: loadInputs, expenses: expenseInputs });
  const usageGroup = usageGroupForSettlementType(settlementType);
  const configForPersistence = configSnapshot(config);
  const lineItems = result.lineItems.map((li, i) => ({
    key: li.key,
    label_en: li.labelEn,
    label_tr: li.labelTr,
    amount: li.amount,
    is_our_revenue: li.isOurRevenue ?? false,
    sort_order: i,
  }));
  const revision = stableSettlementRevision({
    business: {
      organization_id: orgId,
      settlement_type: settlementType,
      usage_group: usageGroup,
      vehicle_id: vehicle.id,
      driver_id: vehicle.assigned_driver_id ?? null,
      owner_id: vehicle.owner_id ?? null,
      company_id: vehicle.company_id ?? null,
      external_carrier_id: vehicle.external_carrier_id ?? null,
      week_start: range.start,
      week_end: range.end,
      external_net_pay: null,
    },
    config: configForPersistence,
    selectedLoads: loads.map((load: any) => ({
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
    selectedExpenses: expenses.map((expense: any) => ({
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

  const rpc = {
    p_organization_id: orgId,
    p_created_by: null,
    p_settlement_type: settlementType,
    p_usage_group: usageGroup,
    p_company_id: vehicle.company_id ?? null,
    p_external_carrier_id: vehicle.external_carrier_id ?? null,
    p_vehicle_id: vehicle.id,
    p_driver_id: vehicle.assigned_driver_id ?? null,
    p_owner_id: vehicle.owner_id ?? null,
    p_week_start: range.start,
    p_week_end: range.end,
    p_config: configForPersistence,
    p_gross_revenue: result.grossRevenue,
    p_total_deductions: result.totalDeductions,
    p_our_commission_earned: result.ourCommissionEarned,
    p_net_pay: result.netPay,
    p_external_net_pay: null,
    p_line_items: lineItems,
    p_load_ids: loads.map((l) => l.id),
    p_expense_ids: expenses.map((e) => e.id),
  };
  const payload = {
    settlement: {
      organization_id: orgId,
      data: {
        vehicle_unit: vehicle.unit_number,
        vehicle_id: vehicle.id,
        settlement_type: settlementType,
        driver_id: vehicle.assigned_driver_id ?? null,
        owner_id: vehicle.owner_id ?? null,
        company_id: vehicle.company_id ?? null,
        external_carrier_id: vehicle.external_carrier_id ?? null,
        week_start: range.start,
        week_end: range.end,
        external_net_pay: null,
      },
      selected_load_ids: loads.map((l) => l.id),
      selected_expense_ids: expenses.map((e) => e.id),
      preview_revision: revision,
    },
  };

  const message = [
    `🧾 <b>Settlement Önizleme</b> — Unit ${escapeHtml(vehicle.unit_number)}`,
    `Tip: ${escapeHtml(settlementType)}`,
    `Dönem: ${range.start} → ${range.end}`,
    `Yük sayısı: ${loads.length}`,
    `Gross: ${usd(result.grossRevenue)}`,
    `Kesintiler: ${usd(result.totalDeductions)}`,
    `<b>Net: ${usd(result.netPay)}</b>`,
    ``,
    `Oluşturulsun mu?`,
  ].join("\n");

  return { ok: true, message, payload, rpc, revision };
}

export async function prepareSettlement(
  supabase: any,
  orgId: string,
  data: Record<string, unknown>,
): Promise<Result & { payload?: Record<string, unknown> }> {
  const prepared = await buildPreparedSettlement(supabase, orgId, data);
  return { ok: prepared.ok, message: prepared.message, payload: prepared.payload };
}

async function runSettlement(supabase: any, orgId: string, payload: Record<string, unknown>): Promise<Result> {
  const pending = payload?.settlement as Record<string, unknown> | undefined;
  const rpc = pending;
  if (!rpc) return { ok: false, message: "Settlement verisi bulunamadı, lütfen tekrar deneyin." };
  const data = {
    ...((pending?.data as Record<string, unknown> | undefined) ?? {}),
    selected_load_ids: pending?.selected_load_ids,
    selected_expense_ids: pending?.selected_expense_ids,
  };
  const fresh = await buildPreparedSettlement(supabase, orgId, data);
  if (!fresh.ok || !fresh.rpc || !fresh.revision || fresh.revision !== pending?.preview_revision) {
    return { ok: false, message: STALE_SETTLEMENT_PREVIEW_MESSAGE };
  }
  // Belt-and-braces: never trust a stored org id over the command's own org.
  const { data: settlementId, error } = await supabase.rpc("create_settlement_with_links_atomic", {
    ...fresh.rpc,
    p_organization_id: orgId,
  });
  if (error || !settlementId) {
    return { ok: false, message: `⚠️ Settlement oluşturulamadı: ${escapeHtml(error?.message ?? "bilinmeyen hata")}` };
  }
  return { ok: true, message: `✅ Settlement oluşturuldu.\nID: <code>${escapeHtml(settlementId)}</code>` };
}
