import type { AmazonParsedSourceRow, AmazonTripsRowFields } from "../types";
import { normalizeMatchKey } from "./match-confidence";

export function normalizedDriverSet(rows: AmazonParsedSourceRow<AmazonTripsRowFields>[]): string[] {
  return [...new Set(rows.flatMap((row) => row.normalizedValues.driverTokens.map((token) => normalizeMatchKey(token) ?? "")).filter(Boolean))].sort();
}

export function hasConflictingDrivers(rows: AmazonParsedSourceRow<AmazonTripsRowFields>[]): boolean {
  return normalizedDriverSet(rows).length > 1;
}

export function teamRows(rows: AmazonParsedSourceRow<AmazonTripsRowFields>[]): AmazonParsedSourceRow<AmazonTripsRowFields>[] {
  return rows.filter((row) => row.normalizedValues.requiresTeamAssignmentRule);
}
