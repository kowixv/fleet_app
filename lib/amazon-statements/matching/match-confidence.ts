export type AmazonMatchMethod = "exact_load_id" | "exact_trip_id" | "vehicle_period_facility" | "manual";
export type AmazonMatchStatus = "exact" | "inferred" | "ambiguous" | "unmatched" | "manually_approved" | "rejected";

export interface MatchConfidence {
  method: AmazonMatchMethod;
  status: AmazonMatchStatus;
  score: number;
  reasons: string[];
}

export const MATCH_CONFIDENCE = {
  exactLoad: { method: "exact_load_id", status: "exact", score: 1, reasons: ["exact_load_id"] },
  exactTrip: { method: "exact_trip_id", status: "exact", score: 0.95, reasons: ["exact_trip_id"] },
  inferredVehicleFacility: { method: "vehicle_period_facility", status: "inferred", score: 0.8, reasons: ["vehicle_period_facility"] },
  ambiguousLoad: { method: "exact_load_id", status: "ambiguous", score: 0.2, reasons: ["duplicate_load_id_candidates"] },
  ambiguousTrip: { method: "exact_trip_id", status: "ambiguous", score: 0.2, reasons: ["conflicting_trip_candidates"] },
  unmatched: { method: "manual", status: "unmatched", score: 0, reasons: ["unmatched_financial_payment_row"] },
} satisfies Record<string, MatchConfidence>;

export function normalizeMatchKey(value: string | null | undefined): string | null {
  const normalized = String(value ?? "").trim().toUpperCase();
  return normalized ? normalized : null;
}
