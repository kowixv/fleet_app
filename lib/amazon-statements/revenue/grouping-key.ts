import type { AmazonPaymentDetailFields } from "../types";
import { normalizeMatchKey } from "../matching/match-confidence";

export type AmazonRevenueGroupingType = "trip" | "load";

export interface AmazonRevenueGroupingKey {
  groupingType: AmazonRevenueGroupingType;
  groupingKey: string;
}

export function revenueGroupingKey(invoiceId: string, row: AmazonPaymentDetailFields): AmazonRevenueGroupingKey {
  const tripId = normalizeMatchKey(row.tripId);
  const loadId = normalizeMatchKey(row.loadId);
  if (tripId) return { groupingType: "trip", groupingKey: `${invoiceId}:TRIP:${tripId}` };
  return { groupingType: "load", groupingKey: `${invoiceId}:LOAD:${loadId ?? "UNKNOWN"}` };
}

export function contributionType(row: AmazonPaymentDetailFields): "parent_base" | "child_accessorial" | "standalone" | "other" {
  if (row.rowClassification === "trip_parent") return "parent_base";
  if (row.rowClassification === "load_child") return "child_accessorial";
  if (row.rowClassification === "standalone_load") return "standalone";
  return "other";
}
