import type { SettlementConfig, SettlementType } from "./engine";

interface VehicleLike {
  default_driver_pay_pct: number | null;
  company_fee_pct: number | null;
  company_fee_is_our_revenue: boolean | null;
  external_carrier_fee_pct: number | null;
  management_commission_type: "none" | "flat" | "percent" | null;
  management_commission_amount: number | null;
}
interface PersonLike {
  default_pay_pct: number | null;
}
interface Overrides {
  driverPayPct?: number | null;
  companyFeePct?: number | null;
  commissionAmount?: number | null;
}

/**
 * Resolve the settlement config using the priority:
 *   Settlement Override -> Vehicle Assignment -> Driver/Company Default
 */
export function resolveConfig(
  settlementType: SettlementType,
  vehicle: VehicleLike | null,
  person: PersonLike | null,
  overrides: Overrides = {},
  defaultCommission = 250,
): SettlementConfig {
  const driverPayPct =
    overrides.driverPayPct ??
    vehicle?.default_driver_pay_pct ??
    person?.default_pay_pct ??
    null;

  const companyFeePct =
    overrides.companyFeePct ?? vehicle?.company_fee_pct ?? 0;

  // Commission: external-carrier statements default to the flat $250 rule.
  let commission: SettlementConfig["managementCommission"];
  if (settlementType === "external_carrier_statement") {
    commission = {
      type: "flat",
      amount: overrides.commissionAmount ?? vehicle?.management_commission_amount ?? defaultCommission,
      onlyIfPositiveBase: true,
    };
  } else if (vehicle?.management_commission_type && vehicle.management_commission_type !== "none") {
    commission = {
      type: vehicle.management_commission_type,
      amount: overrides.commissionAmount ?? vehicle.management_commission_amount ?? 0,
    };
  } else {
    commission = { type: "none", amount: 0 };
  }

  return {
    settlementType,
    companyFeePct: Number(companyFeePct) || 0,
    companyFeeIsOurRevenue: vehicle?.company_fee_is_our_revenue ?? true,
    driverPayPct: driverPayPct === null ? null : Number(driverPayPct),
    externalCarrierFeePct: Number(vehicle?.external_carrier_fee_pct ?? 0) || 0,
    managementCommission: commission,
  };
}
