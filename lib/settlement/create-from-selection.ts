import "server-only";

import { createServiceClient } from "@/lib/supabase/server";
import type { SettlementType } from "@/lib/settlement/engine";
import type { SettlementUsageGroup } from "@/lib/settlement/workflow";

export interface SharedSettlementCreationPayload {
  organizationId: string;
  createdBy: string;
  settlementType: SettlementType;
  usageGroup: SettlementUsageGroup | null;
  companyId: string | null;
  externalCarrierId: string | null;
  vehicleId: string | null;
  driverId: string | null;
  ownerId: string | null;
  weekStart: string | null;
  weekEnd: string | null;
  config: Record<string, unknown>;
  grossRevenue: number;
  totalDeductions: number;
  ourCommissionEarned: number;
  netPay: number;
  externalNetPay: number | null;
  lineItems: Array<{
    key: string;
    label_en: string;
    label_tr: string;
    amount: number;
    is_our_revenue: boolean;
    sort_order: number;
  }>;
  selectedLoadIds: string[];
  selectedExpenseIds: string[];
}

export type SharedSettlementCreationResult =
  | { ok: true; settlementId: string }
  | { ok: false; error: string };

/**
 * Single server-side bridge to the hardened settlement creation RPC.
 *
 * The existing settlement UI and Amazon candidate conversion both route through
 * this function, so link-table accounting lanes stay owned by
 * create_settlement_with_links_atomic rather than duplicated in JavaScript.
 */
export async function createSettlementWithLinksAtomic(
  payload: SharedSettlementCreationPayload,
): Promise<SharedSettlementCreationResult> {
  const service = createServiceClient();
  const { data, error } = await service.rpc("create_settlement_with_links_atomic", {
    p_organization_id: payload.organizationId,
    p_created_by: payload.createdBy,
    p_settlement_type: payload.settlementType,
    p_usage_group: payload.usageGroup,
    p_company_id: payload.companyId,
    p_external_carrier_id: payload.externalCarrierId,
    p_vehicle_id: payload.vehicleId,
    p_driver_id: payload.driverId,
    p_owner_id: payload.ownerId,
    p_week_start: payload.weekStart,
    p_week_end: payload.weekEnd,
    p_config: payload.config,
    p_gross_revenue: payload.grossRevenue,
    p_total_deductions: payload.totalDeductions,
    p_our_commission_earned: payload.ourCommissionEarned,
    p_net_pay: payload.netPay,
    p_external_net_pay: payload.externalNetPay,
    p_line_items: payload.lineItems,
    p_load_ids: payload.selectedLoadIds,
    p_expense_ids: payload.selectedExpenseIds,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, settlementId: String(data) };
}
