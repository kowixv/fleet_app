import type { AmazonParsedSourceRow, AmazonPaymentDetailFields, AmazonParserIssue, AmazonTripsRowFields } from "../types";
import { MATCH_CONFIDENCE, normalizeMatchKey, type AmazonMatchMethod, type AmazonMatchStatus } from "./match-confidence";
import { dateRangesOverlap, facilityCompatible, hasConflictingVehicles } from "./vehicle-candidate";
import { matchingIssue } from "./matching-issues";

export type PaymentSourceRow = AmazonParsedSourceRow<AmazonPaymentDetailFields>;
export type TripSourceRow = AmazonParsedSourceRow<AmazonTripsRowFields>;

export interface AmazonSourceMatch {
  paymentRow: PaymentSourceRow;
  tripRow: TripSourceRow | null;
  relatedTripRows: TripSourceRow[];
  matchType: "payment_trip";
  matchMethod: AmazonMatchMethod;
  confidenceScore: number;
  status: AmazonMatchStatus;
  reasons: string[];
}

export interface AmazonMatchingResult {
  matches: AmazonSourceMatch[];
  issues: AmazonParserIssue[];
  counts: {
    exactLoadMatches: number;
    exactTripMatches: number;
    inferredMatches: number;
    ambiguousMatches: number;
    unmatchedFinancialRows: number;
  };
}

export function matchPaymentTrips(paymentRows: PaymentSourceRow[], tripRows: TripSourceRow[]): AmazonMatchingResult {
  const financialRows = paymentRows.filter(isFinancialPaymentRow);
  const issues: AmazonParserIssue[] = [];
  const matches: AmazonSourceMatch[] = [];
  const tripsByLoad = groupBy(tripRows, (row) => normalizeMatchKey(row.normalizedValues.loadId));
  const tripsByTrip = groupBy(tripRows, (row) => normalizeMatchKey(row.normalizedValues.tripId));

  for (const [loadId, rows] of tripsByLoad) {
    if (loadId && rows.length > 1) issues.push(matchingIssue("duplicate_load_id", "blocking", "Duplicate Load ID in Trips rows.", { loadIdHash: hashVisible(loadId), count: rows.length }));
  }

  for (const paymentRow of financialRows) {
    const payment = paymentRow.normalizedValues;
    const loadKey = normalizeMatchKey(payment.loadId);
    const tripKey = normalizeMatchKey(payment.tripId);
    const loadCandidates = loadKey ? tripsByLoad.get(loadKey) ?? [] : [];
    if (loadCandidates.length === 1) {
      matches.push(makeMatch(paymentRow, loadCandidates[0], loadCandidates, MATCH_CONFIDENCE.exactLoad));
      continue;
    }
    if (loadCandidates.length > 1) {
      matches.push(makeMatch(paymentRow, null, loadCandidates, MATCH_CONFIDENCE.ambiguousLoad));
      issues.push(matchingIssue("ambiguous_load_match", "blocking", "Payment row has multiple Trips rows with the same Load ID.", { candidateCount: loadCandidates.length }));
      continue;
    }

    const tripCandidates = tripKey ? tripsByTrip.get(tripKey) ?? [] : [];
    if (tripCandidates.length > 0) {
      const conflictReasons = tripConflictReasons(tripCandidates);
      if (conflictReasons.length === 0) {
        matches.push(makeMatch(paymentRow, tripCandidates[0] ?? null, tripCandidates, MATCH_CONFIDENCE.exactTrip));
      } else {
        matches.push(makeMatch(paymentRow, null, tripCandidates, { ...MATCH_CONFIDENCE.ambiguousTrip, reasons: conflictReasons }));
        for (const reason of conflictReasons) {
          issues.push(matchingIssue(reason, "blocking", "Trip ID fallback has conflicting operational candidates.", { tripCandidateCount: tripCandidates.length }));
        }
      }
      continue;
    }

    const inferred = tripRows.filter((tripRow) => dateRangesOverlap(payment, tripRow.normalizedValues) && facilityCompatible(payment, tripRow.normalizedValues));
    if (inferred.length === 1) {
      matches.push(makeMatch(paymentRow, inferred[0], inferred, MATCH_CONFIDENCE.inferredVehicleFacility));
    } else if (inferred.length > 1) {
      matches.push(makeMatch(paymentRow, null, inferred, { ...MATCH_CONFIDENCE.inferredVehicleFacility, status: "ambiguous", score: 0.45, reasons: ["ambiguous_inferred_match"] }));
      issues.push(matchingIssue("ambiguous_load_match", "blocking", "Vehicle/date/facility inference produced multiple candidates.", { candidateCount: inferred.length }));
    } else {
      matches.push(makeMatch(paymentRow, null, [], MATCH_CONFIDENCE.unmatched));
      issues.push(matchingIssue("unmatched_payment_row", "blocking", "Financial payment row has no Trips match.", { classification: payment.rowClassification }));
    }
  }

  return {
    matches,
    issues: dedupeIssues(issues),
    counts: {
      exactLoadMatches: matches.filter((match) => match.matchMethod === "exact_load_id" && match.status === "exact").length,
      exactTripMatches: matches.filter((match) => match.matchMethod === "exact_trip_id" && match.status === "exact").length,
      inferredMatches: matches.filter((match) => match.matchMethod === "vehicle_period_facility" && match.status === "inferred").length,
      ambiguousMatches: matches.filter((match) => match.status === "ambiguous").length,
      unmatchedFinancialRows: matches.filter((match) => match.status === "unmatched").length,
    },
  };
}

export function isFinancialPaymentRow(row: PaymentSourceRow): boolean {
  return row.normalizedValues.rowClassification === "trip_parent"
    || row.normalizedValues.rowClassification === "load_child"
    || row.normalizedValues.rowClassification === "standalone_load";
}

function makeMatch(paymentRow: PaymentSourceRow, tripRow: TripSourceRow | null, relatedTripRows: TripSourceRow[], confidence: {
  method: AmazonMatchMethod;
  status: AmazonMatchStatus;
  score: number;
  reasons: string[];
}): AmazonSourceMatch {
  return {
    paymentRow,
    tripRow,
    relatedTripRows,
    matchType: "payment_trip",
    matchMethod: confidence.method,
    confidenceScore: confidence.score,
    status: confidence.status,
    reasons: confidence.reasons,
  };
}

function tripConflictReasons(rows: TripSourceRow[]): string[] {
  const reasons: string[] = [];
  if (hasConflictingVehicles(rows)) reasons.push("conflicting_trip_vehicle");
  return reasons;
}

function groupBy(rows: TripSourceRow[], keyFor: (row: TripSourceRow) => string | null): Map<string, TripSourceRow[]> {
  const result = new Map<string, TripSourceRow[]>();
  for (const row of rows) {
    const key = keyFor(row);
    if (!key) continue;
    result.set(key, [...(result.get(key) ?? []), row]);
  }
  return result;
}

function dedupeIssues(issues: AmazonParserIssue[]): AmazonParserIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.issueCode}:${JSON.stringify(issue.details)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function hashVisible(value: string): string {
  let hash = 0;
  for (const char of value) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  return Math.abs(hash).toString(16);
}
