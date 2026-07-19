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

export interface CalculationRow {
  key: string;
  labelEn: string;
  labelTr: string;
  amount: number;
  role: "gross" | "base" | "addition" | "deduction" | "net";
  isOurRevenue?: boolean;
}

export interface RateSummary {
  key: string;
  label: string;
  value: number | null;
  source?: string;
}

export interface SettlementResult {
  settlementType: SettlementType;
  payee: Payee;
  grossRevenue: number;
  calculationBaseLabel: string;
  calculationBaseAmount: number;
  payableLabel: string;
  payableAmount: number;
  calculationRows: CalculationRow[];
  rateSummaries: RateSummary[];
  lineItems: LineItem[];
  totalDeductions: number; // sum of the negative line items, as a positive number
  ourCommissionEarned: number;
  netPay: number;
}

/** Round to cents, avoiding binary float artifacts. */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Preserve basis-point precision in labels without trailing zeroes. */
export function formatPercentage(rateValue: number): string {
  const percentage = round2(rateValue * 100);
  return percentage.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
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

function rate(key: string, label: string, value: number | null): RateSummary {
  return { key, label, value };
}

function netRow(labelEn: string, labelTr: string, amount: number): CalculationRow {
  return { key: "net_pay", labelEn, labelTr, amount, role: "net" };
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
      calculationBaseLabel: "External Carrier Net",
      calculationBaseAmount: externalNet,
      payableLabel: "Final Carrier Payment",
      payableAmount: externalNet,
      calculationRows: [
        {
          key: "external_net_pay",
          labelEn: "External Carrier Net",
          labelTr: "Dis carrier net odeme",
          amount: externalNet,
          role: "base",
        },
        ...(commission > 0
          ? [{
              key: "our_commission",
              labelEn: "Management Commission",
              labelTr: "Yonetim komisyonu",
              amount: -commission,
              role: "deduction" as const,
              isOurRevenue: true,
            }]
          : []),
        netRow("Final Carrier Payment", "Final carrier odemesi", round2(externalNet - commission)),
      ],
      rateSummaries: [
        rate("management_commission", "Management Commission", config.managementCommission.amount),
      ],
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
        labelEn: `Driver pay (${formatPercentage(pct)}%)`,
        labelTr: `Şoför payı (%${formatPercentage(pct)})`,
        amount: driverPay,
      },
      ...expenses.map(expenseLine),
    ];
    const deductions = round2(expenses.reduce((s, e) => s + e.amount, 0));
    return {
      settlementType: t,
      payee: "driver",
      grossRevenue: gross,
      calculationBaseLabel: "Driver Gross Pay",
      calculationBaseAmount: driverPay,
      payableLabel: "Net Driver Pay",
      payableAmount: driverPay,
      calculationRows: [
        {
          key: "fleet_gross",
          labelEn: "Fleet Gross Revenue",
          labelTr: "Fleet brut gelir",
          amount: gross,
          role: "gross",
        },
        {
          key: "driver_pay",
          labelEn: `Driver Gross Pay (${formatPercentage(pct)}%)`,
          labelTr: `Sofor brut payi (%${formatPercentage(pct)})`,
          amount: driverPay,
          role: "base",
        },
        ...expenses.map((e) => ({ ...expenseLine(e), role: "deduction" as const })),
        netRow("Net Driver Pay", "Net sofor odemesi", round2(driverPay - deductions)),
      ],
      rateSummaries: [rate("driver_pay_pct", "Driver Pay", pct)],
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
        labelEn: `Company fee (${formatPercentage(config.companyFeePct)}%)`,
        labelTr: `Şirket kesintisi (%${formatPercentage(config.companyFeePct)})`,
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
      calculationBaseLabel: "Gross Revenue",
      calculationBaseAmount: gross,
      payableLabel: "Net Owner Pay",
      payableAmount: gross,
      calculationRows: [
        {
          key: "gross_revenue",
          labelEn: "Gross Revenue",
          labelTr: "Brut gelir",
          amount: gross,
          role: "base",
        },
        ...lineItems.map((li) => ({
          ...li,
          role: li.amount < 0 ? "deduction" as const : "addition" as const,
        })),
        netRow("Net Owner Pay", "Net owner odemesi", round2(gross - companyFee - expenseTotal - commission)),
      ],
      rateSummaries: [
        rate("company_fee_pct", "Company Fee", config.companyFeePct),
        rate("management_commission", "Management Commission", config.managementCommission.amount),
      ],
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
      labelEn: `External carrier fee (${formatPercentage(config.externalCarrierFeePct)}%)`,
      labelTr: `Dış carrier kesintisi (%${formatPercentage(config.externalCarrierFeePct)})`,
      amount: -extFee,
      isOurRevenue: false,
    },
    {
      key: "driver_pay",
      labelEn: `Driver pay (${formatPercentage(config.driverPayPct ?? 0)}%)`,
      labelTr: `Şoför payı (%${formatPercentage(config.driverPayPct ?? 0)})`,
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
    calculationBaseLabel: "Gross Revenue",
    calculationBaseAmount: gross,
    payableLabel: "Net Investor Profit",
    payableAmount: gross,
    calculationRows: [
      {
        key: "gross_revenue",
        labelEn: "Gross Revenue",
        labelTr: "Brut gelir",
        amount: gross,
        role: "base",
      },
      ...lineItems.map((li) => ({
        ...li,
        role: li.amount < 0 ? "deduction" as const : "addition" as const,
      })),
      netRow("Net Investor Profit", "Net investor kari", round2(gross - extFee - driverPay - expenseTotal - commission)),
    ],
    rateSummaries: [
      rate("external_carrier_fee_pct", "External Carrier Fee", config.externalCarrierFeePct),
      rate("driver_pay_pct", "Driver Pay", config.driverPayPct ?? 0),
      rate("management_commission", "Management Commission", config.managementCommission.amount),
    ],
    lineItems,
    totalDeductions: round2(extFee + driverPay + expenseTotal + commission),
    ourCommissionEarned: commission,
    netPay: round2(gross - extFee - driverPay - expenseTotal - commission),
  };
}
