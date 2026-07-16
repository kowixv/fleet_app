import {
  round2,
  type CalculationRow,
  type LineItem,
  type SettlementConfig,
  type SettlementResult,
  type SettlementType,
} from "./engine";

export type SettlementUsageGroup = "driver" | "owner" | "investor";
export type SettlementStatus = "draft" | "pending_review" | "finalized" | "paid" | "void";
export type RateSource = "settlement_override" | "vehicle_settlement_configuration" | "person_default" | "organization_default" | "fallback";

export const SETTLEMENT_TYPES: SettlementType[] = [
  "company_driver",
  "box_truck_driver",
  "owner_operator",
  "managed_investor",
  "external_carrier_statement",
];

export const ELIGIBLE_LOAD_STATUSES = ["delivered", "paid"] as const;

export const STATUS_TRANSITIONS: Record<SettlementStatus, SettlementStatus[]> = {
  draft: ["pending_review", "finalized", "void"],
  pending_review: ["draft", "finalized", "void"],
  finalized: ["paid", "void"],
  paid: ["void"],
  void: [],
};

export function usageGroupForSettlementType(type: SettlementType): SettlementUsageGroup | null {
  if (type === "company_driver" || type === "box_truck_driver") return "driver";
  if (type === "owner_operator") return "owner";
  if (type === "managed_investor") return "investor";
  return null;
}

export function activeUsageGroupsBlockedBy(usageGroup: SettlementUsageGroup): SettlementUsageGroup[] {
  if (usageGroup === "driver") return ["driver"];
  return ["owner", "investor"];
}

export function canTransitionSettlementStatus(from: string, to: string): boolean {
  if (!isSettlementStatus(from) || !isSettlementStatus(to)) return false;
  return STATUS_TRANSITIONS[from].includes(to);
}

export function isSettlementStatus(value: string): value is SettlementStatus {
  return value === "draft" || value === "pending_review" || value === "finalized" || value === "paid" || value === "void";
}

export function expenseTargetingReason(expense: {
  deduct_from_driver?: boolean | null;
  deduct_from_owner?: boolean | null;
  deduct_from_investor?: boolean | null;
}): "Driver" | "Owner" | "Investor" | "Universal" | "Mixed" {
  const targets = [
    expense.deduct_from_driver ? "Driver" : null,
    expense.deduct_from_owner ? "Owner" : null,
    expense.deduct_from_investor ? "Investor" : null,
  ].filter(Boolean) as Array<"Driver" | "Owner" | "Investor">;
  if (targets.length === 0) return "Universal";
  if (targets.length === 1) return targets[0];
  return "Mixed";
}

export function expenseAppliesToUsageGroup(
  expense: {
    deduct_from_driver?: boolean | null;
    deduct_from_owner?: boolean | null;
    deduct_from_investor?: boolean | null;
  },
  usageGroup: SettlementUsageGroup,
): boolean {
  const hasTarget = Boolean(expense.deduct_from_driver || expense.deduct_from_owner || expense.deduct_from_investor);
  if (!hasTarget) return true;
  if (usageGroup === "driver") return Boolean(expense.deduct_from_driver);
  if (usageGroup === "owner") return Boolean(expense.deduct_from_owner);
  return Boolean(expense.deduct_from_investor);
}

export function validatePercentFraction(value: number | null | undefined, label: string): number | null {
  if (value == null) return null;
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label} must be between 0 and 100%.`);
  }
  return value;
}

export function validateNonNegativeMoney(value: number | null | undefined, label: string): number | null {
  if (value == null) return null;
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be zero or greater.`);
  }
  return round2(value);
}

export function validateInclusivePeriod(weekStart: string | null, weekEnd: string | null) {
  if (!weekStart || !weekEnd) throw new Error("Week start and week end are required.");
  if (weekEnd < weekStart) throw new Error("Week end cannot be before week start.");
}

export function configSnapshot(config: SettlementConfig, sources: Record<string, RateSource | string> = {}) {
  return {
    settlement_type: config.settlementType,
    driver_pay_pct: config.driverPayPct,
    company_fee_pct: config.companyFeePct,
    company_fee_is_our_revenue: config.companyFeeIsOurRevenue ?? true,
    external_carrier_fee_pct: config.externalCarrierFeePct,
    management_commission_type: config.managementCommission.type,
    management_commission_amount: config.managementCommission.amount,
    management_commission_only_if_positive_base: config.managementCommission.onlyIfPositiveBase ?? false,
    sources,
  };
}

export function displayRowsForStoredSettlement(settlement: {
  settlement_type: SettlementType;
  gross_revenue: number | string | null;
  net_pay: number | string | null;
}, items: LineItem[]): CalculationRow[] {
  const gross = Number(settlement.gross_revenue) || 0;
  const net = Number(settlement.net_pay) || 0;
  if (settlement.settlement_type === "company_driver" || settlement.settlement_type === "box_truck_driver") {
    const driverPay = items.find((item) => item.key === "driver_pay")?.amount ?? 0;
    return [
      { key: "fleet_gross", labelEn: "Fleet Gross Revenue", labelTr: "Fleet brut gelir", amount: gross, role: "gross" },
      { key: "driver_pay", labelEn: "Driver Gross Pay", labelTr: "Sofor brut payi", amount: driverPay, role: "base" },
      ...items.filter((item) => item.key !== "driver_pay").map((item) => ({ ...item, role: item.amount < 0 ? "deduction" as const : "addition" as const })),
      { key: "net_pay", labelEn: "Net Driver Pay", labelTr: "Net sofor odemesi", amount: net, role: "net" },
    ];
  }
  if (settlement.settlement_type === "external_carrier_statement") {
    const externalNet = items.find((item) => item.key === "external_net_pay")?.amount ?? gross;
    return [
      { key: "external_net_pay", labelEn: "External Carrier Net", labelTr: "Dis carrier net odeme", amount: externalNet, role: "base" },
      ...items.filter((item) => item.key !== "external_net_pay").map((item) => ({ ...item, role: item.amount < 0 ? "deduction" as const : "addition" as const })),
      { key: "net_pay", labelEn: "Final Carrier Payment", labelTr: "Final carrier odemesi", amount: net, role: "net" },
    ];
  }
  const netLabel = settlement.settlement_type === "managed_investor" ? "Net Investor Profit" : "Net Owner Pay";
  return [
    { key: "gross_revenue", labelEn: "Gross Revenue", labelTr: "Brut gelir", amount: gross, role: "base" },
    ...items.map((item) => ({ ...item, role: item.amount < 0 ? "deduction" as const : "addition" as const })),
    { key: "net_pay", labelEn: netLabel, labelTr: netLabel, amount: net, role: "net" },
  ];
}

export function displayedCalculationReconciles(result: SettlementResult): boolean {
  const base = result.calculationRows.find((row) => row.role === "base")?.amount ?? 0;
  const signed = result.calculationRows
    .filter((row) => row.role === "addition" || row.role === "deduction")
    .reduce((sum, row) => sum + row.amount, base);
  return round2(signed) === result.netPay;
}
