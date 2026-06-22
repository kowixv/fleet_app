/**
 * Settlement engine — config-driven, no payment model is hardcoded.
 *
 * Every rate/fee/commission comes from `SettlementConfig` (resolved per vehicle/
 * settlement). The `settlementType` only selects which *structural template* of line
 * items applies; all numbers are configurable. This is the heart of the app: the same
 * function computes a company-driver %, an owner-operator net, a managed-investor profit,
 * and an external-carrier statement.
 *
 * Rate resolution priority (done by the caller, see resolveConfig):
 *   Settlement Override -> Vehicle Assignment -> Driver Default -> Company Default
 */

export type SettlementType =
  | "company_driver"
  | "box_truck_driver"
  | "owner_operator"
  | "managed_investor"
  | "external_carrier_statement";

export type Payee = "driver" | "owner" | "investor" | "carrier";

export interface LoadInput {
  id?: string;
  reference?: string; // Trip / Load ID
  route?: string; // e.g. "MEM1 -> KRB2"
  type?: string; // e.g. "Single load", "Trip base", "Cancelled"
  grossAmount: number;
}

export interface ExpenseInput {
  category: string; // fuel | def | fees | insurance | eld | ifta | tolls | maintenance | repair | misc | ...
  amount: number;
  labelEn?: string;
  labelTr?: string;
}

export interface ManagementCommission {
  type: "flat" | "percent" | "none";
  amount: number; // flat dollars, or percent as a fraction (0.05 = 5%)
  /** Model 5 rule: only charge the commission when the base (external net) is > 0. */
  onlyIfPositiveBase?: boolean;
}

export interface SettlementConfig {
  settlementType: SettlementType;
  /** Fee our company takes off the gross (owner_operator). 0.12, 0.10, or 0. */
  companyFeePct: number;
  /** Whether companyFeePct is revenue we keep (counts toward commission earned). Default true. */
  companyFeeIsOurRevenue?: boolean;
  /** Driver pay percentage of gross (company/box-truck/managed models). */
  driverPayPct: number | null;
  /** Fee a *different* carrier takes (managed_investor) — NOT our revenue. */
  externalCarrierFeePct: number;
  /** Our management commission (managed_investor / external_carrier_statement). */
  managementCommission: ManagementCommission;
}

export interface SettlementInput {
  config: SettlementConfig;
  loads?: LoadInput[];
  /** Expenses that apply to THIS settlement (caller decides targeting/deduction). */
  expenses?: ExpenseInput[];
  /** External carrier net pay (external_carrier_statement model). */
  externalNetPay?: number;
}

export interface LineItem {
  key: string;
  labelEn: string;
  labelTr: string;
  /** Signed: negative = deduction from net, positive = addition. */
  amount: number;
  /** True when this line is money we (the management company) keep. */
  isOurRevenue?: boolean;
}

export interface SettlementResult {
  settlementType: SettlementType;
  payee: Payee;
  grossRevenue: number;
  lineItems: LineItem[];
  totalDeductions: number; // sum of the negative line items, as a positive number
  ourCommissionEarned: number;
  netPay: number;
}

/** Round to cents, avoiding binary float artifacts. */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function sumLoads(loads: LoadInput[] | undefined): number {
  return round2((loads ?? []).reduce((s, l) => s + (l.grossAmount || 0), 0));
}

function expenseLine(e: ExpenseInput): LineItem {
  const label = e.category
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return {
    key: `expense_${e.category}`,
    labelEn: e.labelEn ?? label,
    labelTr: e.labelTr ?? label,
    amount: -round2(e.amount),
  };
}

function commissionAmount(c: ManagementCommission, base: number): number {
  if (c.type === "none") return 0;
  if (c.onlyIfPositiveBase && base <= 0) return 0;
  if (c.type === "flat") return round2(c.amount);
  return round2(base * c.amount); // percent
}

/**
 * Compute a settlement. Pure function — same input always yields same output.
 */
export function computeSettlement(input: SettlementInput): SettlementResult {
  const { config } = input;
  const expenses = input.expenses ?? [];
  const t = config.settlementType;

  // ----- External carrier statement: input is an external net pay number -----
  if (t === "external_carrier_statement") {
    const externalNet = round2(input.externalNetPay ?? 0);
    const commission = commissionAmount(config.managementCommission, externalNet);
    const lineItems: LineItem[] = [
      {
        key: "external_net_pay",
        labelEn: "External net pay",
        labelTr: "Dış carrier net ödeme",
        amount: externalNet,
      },
    ];
    if (commission > 0) {
      lineItems.push({
        key: "our_commission",
        labelEn: "Our commission",
        labelTr: "Komisyonumuz",
        amount: -commission,
        isOurRevenue: true,
      });
    }
    return {
      settlementType: t,
      payee: "carrier",
      grossRevenue: externalNet,
      lineItems,
      totalDeductions: commission,
      ourCommissionEarned: commission,
      netPay: round2(externalNet - commission),
    };
  }

  const gross = sumLoads(input.loads);

  // ----- Company driver / Box truck driver: net = gross * pct - driver deductions -----
  if (t === "company_driver" || t === "box_truck_driver") {
    const pct = config.driverPayPct ?? 0;
    const driverPay = round2(gross * pct);
    const lineItems: LineItem[] = [
      {
        key: "driver_pay",
        labelEn: `Driver pay (${(pct * 100).toFixed(0)}%)`,
        labelTr: `Şoför payı (%${(pct * 100).toFixed(0)})`,
        amount: driverPay,
      },
      ...expenses.map(expenseLine),
    ];
    const deductions = round2(expenses.reduce((s, e) => s + e.amount, 0));
    return {
      settlementType: t,
      payee: "driver",
      grossRevenue: gross,
      lineItems,
      totalDeductions: deductions,
      ourCommissionEarned: 0,
      netPay: round2(driverPay - deductions),
    };
  }

  // ----- Owner operator: net = gross - companyFee - expenses -----
  if (t === "owner_operator") {
    const companyFee = round2(gross * config.companyFeePct);
    const feeIsOurs = config.companyFeeIsOurRevenue ?? true;
    const commission = commissionAmount(config.managementCommission, gross);
    const lineItems: LineItem[] = [
      {
        key: "company_fee",
        labelEn: `Company fee (${(config.companyFeePct * 100).toFixed(0)}%)`,
        labelTr: `Şirket kesintisi (%${(config.companyFeePct * 100).toFixed(0)})`,
        amount: -companyFee,
        isOurRevenue: feeIsOurs,
      },
      ...expenses.map(expenseLine),
    ];
    if (commission > 0) {
      lineItems.push({
        key: "our_commission",
        labelEn: "Management commission",
        labelTr: "Yönetim komisyonu",
        amount: -commission,
        isOurRevenue: true,
      });
    }
    const expenseTotal = round2(expenses.reduce((s, e) => s + e.amount, 0));
    return {
      settlementType: t,
      payee: "owner",
      grossRevenue: gross,
      lineItems,
      totalDeductions: round2(companyFee + expenseTotal + commission),
      ourCommissionEarned: round2((feeIsOurs ? companyFee : 0) + commission),
      netPay: round2(gross - companyFee - expenseTotal - commission),
    };
  }

  // ----- Managed / investor vehicle: profit to investor after everything -----
  // gross - externalCarrierFee - driverPay - expenses - ourCommission
  const extFee = round2(gross * config.externalCarrierFeePct);
  const driverPay = round2(gross * (config.driverPayPct ?? 0));
  const commission = commissionAmount(config.managementCommission, gross);
  const lineItems: LineItem[] = [
    {
      key: "external_carrier_fee",
      labelEn: `External carrier fee (${(config.externalCarrierFeePct * 100).toFixed(0)}%)`,
      labelTr: `Dış carrier kesintisi (%${(config.externalCarrierFeePct * 100).toFixed(0)})`,
      amount: -extFee,
      isOurRevenue: false,
    },
    {
      key: "driver_pay",
      labelEn: `Driver pay (${((config.driverPayPct ?? 0) * 100).toFixed(0)}%)`,
      labelTr: `Şoför payı (%${((config.driverPayPct ?? 0) * 100).toFixed(0)})`,
      amount: -driverPay,
    },
    ...expenses.map(expenseLine),
  ];
  if (commission > 0) {
    lineItems.push({
      key: "our_commission",
      labelEn: "Our commission",
      labelTr: "Komisyonumuz",
      amount: -commission,
      isOurRevenue: true,
    });
  }
  const expenseTotal = round2(expenses.reduce((s, e) => s + e.amount, 0));
  return {
    settlementType: "managed_investor",
    payee: "investor",
    grossRevenue: gross,
    lineItems,
    totalDeductions: round2(extFee + driverPay + expenseTotal + commission),
    ourCommissionEarned: commission,
    netPay: round2(gross - extFee - driverPay - expenseTotal - commission),
  };
}
