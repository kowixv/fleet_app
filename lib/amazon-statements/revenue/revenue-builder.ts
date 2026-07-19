import type { AmazonParsedSourceRow, AmazonParserIssue, AmazonPaymentDetailFields } from "../types";
import type { AmazonSourceMatch } from "../matching/payment-trip-matcher";
import { isFinancialPaymentRow } from "../matching/payment-trip-matcher";
import { matchingIssue } from "../matching/matching-issues";
import { normalizeMatchKey } from "../matching/match-confidence";
import { roundMoney, sha256Hex, stableJson } from "../parsers/normalization";
import { contributionType, revenueGroupingKey, type AmazonRevenueGroupingType } from "./grouping-key";
import { routeSourceFromTripRows } from "./route-source";

export interface AmazonRevenueItemSource {
  paymentRow: AmazonParsedSourceRow<AmazonPaymentDetailFields>;
  contributionType: "parent_base" | "child_accessorial" | "standalone" | "other";
}

export interface AmazonRevenueItem {
  id: string;
  invoiceId: string;
  groupingType: AmazonRevenueGroupingType;
  groupingKey: string;
  tripId: string | null;
  primaryLoadId: string | null;
  startDate: string | null;
  endDate: string | null;
  originFacilityCode: string | null;
  destinationFacilityCode: string | null;
  routeResolutionStatus: "resolved" | "unresolved" | "not_applicable";
  distance: number | null;
  baseAmount: number;
  fuelSurchargeAmount: number;
  tollAmount: number;
  detentionAmount: number;
  tonuAmount: number;
  otherAmount: number;
  grossAmount: number;
  matchStatus: string;
  driverAssignmentStatus: string;
  vehicleAssignmentStatus: string;
  reconciliationStatus: "passed" | "warning" | "failed";
  sourceRevision: string;
  sources: AmazonRevenueItemSource[];
}

export interface AmazonRevenueBuildResult {
  items: AmazonRevenueItem[];
  issues: AmazonParserIssue[];
  unassignedRows: AmazonParsedSourceRow<AmazonPaymentDetailFields>[];
  duplicateSourceContributionCount: number;
}

export function buildAmazonRevenueItems(args: {
  invoiceId: string;
  paymentRows: AmazonParsedSourceRow<AmazonPaymentDetailFields>[];
  matches: AmazonSourceMatch[];
}): AmazonRevenueBuildResult {
  const issues: AmazonParserIssue[] = [];
  const assignedMatches = args.matches.filter((match) => match.status === "exact" || match.status === "inferred" || match.status === "manually_approved");
  const assignedFingerprints = new Set(assignedMatches.map((match) => match.paymentRow.sourceFingerprint));
  const unassignedRows = args.paymentRows.filter((row) => isFinancialPaymentRow(row) && !assignedFingerprints.has(row.sourceFingerprint));
  for (const row of unassignedRows) {
    issues.push(matchingIssue("source_row_missing_from_revenue", "blocking", "Financial source payment row is not assigned to canonical revenue.", {
      classification: row.normalizedValues.rowClassification,
    }));
  }

  const duplicateSourceContributionCount = countDuplicates(assignedMatches.map((match) => match.paymentRow.sourceFingerprint));
  if (duplicateSourceContributionCount > 0) {
    issues.push(matchingIssue("duplicate_revenue_contribution", "blocking", "A source payment row contributed more than once.", { duplicateSourceContributionCount }));
  }

  const groups = new Map<string, AmazonSourceMatch[]>();
  for (const match of assignedMatches) {
    const key = revenueGroupingKey(args.invoiceId, match.paymentRow.normalizedValues).groupingKey;
    groups.set(key, [...(groups.get(key) ?? []), match]);
  }

  const items = [...groups.entries()].map(([groupingKey, groupMatches]) => buildItem(args.invoiceId, groupingKey, groupMatches));
  return { items, issues, unassignedRows, duplicateSourceContributionCount };
}

function buildItem(invoiceId: string, groupingKey: string, matches: AmazonSourceMatch[]): AmazonRevenueItem {
  const rows = matches.map((match) => match.paymentRow);
  const first = rows[0].normalizedValues;
  const grouping = revenueGroupingKey(invoiceId, first);
  const route = routeSourceFromTripRows(matches.flatMap((match) => match.relatedTripRows));
  const baseAmount = sum(rows, (row) => row.normalizedValues.baseRate);
  const fuelSurchargeAmount = sum(rows, (row) => row.normalizedValues.fuelSurcharge);
  const tollAmount = sum(rows, (row) => row.normalizedValues.tolls);
  const detentionAmount = sum(rows, (row) => row.normalizedValues.detention);
  const tonuAmount = sum(rows, (row) => row.normalizedValues.tonu);
  const otherAmount = sum(rows, (row) => row.normalizedValues.others);
  const grossAmount = sum(rows, (row) => row.normalizedValues.grossPay);
  const componentGross = roundMoney(baseAmount + fuelSurchargeAmount + tollAmount + detentionAmount + tonuAmount + otherAmount);
  const tripIds = [...new Set(rows.map((row) => normalizeMatchKey(row.normalizedValues.tripId)).filter(Boolean))] as string[];
  const loadIds = [...new Set(rows.map((row) => normalizeMatchKey(row.normalizedValues.loadId)).filter(Boolean))] as string[];
  const sourceRevision = sha256Hex(stableJson({
    groupingKey,
    sources: rows.map((row) => row.sourceFingerprint).sort(),
    totals: { baseAmount, fuelSurchargeAmount, tollAmount, detentionAmount, tonuAmount, otherAmount, grossAmount },
  }));
  return {
    id: sha256Hex(groupingKey).slice(0, 32),
    invoiceId,
    groupingType: grouping.groupingType,
    groupingKey,
    tripId: tripIds[0] ?? null,
    primaryLoadId: loadIds[0] ?? null,
    startDate: minDate(rows.map((row) => row.normalizedValues.startDate)),
    endDate: maxDate(rows.map((row) => row.normalizedValues.endDate)),
    originFacilityCode: route.originFacilityCode,
    destinationFacilityCode: route.destinationFacilityCode,
    routeResolutionStatus: route.routeResolutionStatus,
    distance: sumNullable(rows, (row) => row.normalizedValues.distanceMiles),
    baseAmount,
    fuelSurchargeAmount,
    tollAmount,
    detentionAmount,
    tonuAmount,
    otherAmount,
    grossAmount,
    matchStatus: matches.some((match) => match.status === "inferred") ? "inferred" : "exact",
    driverAssignmentStatus: "source_only",
    vehicleAssignmentStatus: matches.every((match) => match.relatedTripRows.length > 0) ? "source_only" : "unmatched",
    reconciliationStatus: Math.abs(componentGross - grossAmount) <= 0.01 ? "passed" : "warning",
    sourceRevision,
    sources: rows.map((paymentRow) => ({ paymentRow, contributionType: contributionType(paymentRow.normalizedValues) })),
  };
}

function sum(rows: AmazonParsedSourceRow<AmazonPaymentDetailFields>[], valueFor: (row: AmazonParsedSourceRow<AmazonPaymentDetailFields>) => number | null): number {
  return roundMoney(rows.reduce((total, row) => total + (valueFor(row) ?? 0), 0));
}

function sumNullable(rows: AmazonParsedSourceRow<AmazonPaymentDetailFields>[], valueFor: (row: AmazonParsedSourceRow<AmazonPaymentDetailFields>) => number | null): number | null {
  const values = rows.map(valueFor).filter((value): value is number => value !== null);
  return values.length ? roundMoney(values.reduce((total, value) => total + value, 0)) : null;
}

function minDate(values: Array<string | null>): string | null {
  const dates = values.filter((value): value is string => Boolean(value)).sort();
  return dates[0] ?? null;
}

function maxDate(values: Array<string | null>): string | null {
  const dates = values.filter((value): value is string => Boolean(value)).sort();
  return dates[dates.length - 1] ?? null;
}

function countDuplicates(values: string[]): number {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.values()].filter((count) => count > 1).length;
}
