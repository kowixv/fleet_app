import type { AmazonParsedSourceRow, AmazonTripStop, AmazonTripsRowFields } from "../types";
import { normalizeMatchKey } from "../matching/match-confidence";

export interface RouteSource {
  originFacilityCode: string | null;
  destinationFacilityCode: string | null;
  routeResolutionStatus: "resolved" | "unresolved" | "not_applicable";
}

export function routeSourceFromTripRows(rows: AmazonParsedSourceRow<AmazonTripsRowFields>[]): RouteSource {
  const stops = rows.flatMap((row) => row.normalizedValues.stops).sort(compareStops);
  if (stops.length === 0) {
    return { originFacilityCode: null, destinationFacilityCode: null, routeResolutionStatus: "unresolved" };
  }
  const originFacilityCode = normalizeMatchKey(stops[0].facilityCode);
  const destinationFacilityCode = normalizeMatchKey(stops[stops.length - 1].facilityCode);
  return {
    originFacilityCode,
    destinationFacilityCode,
    routeResolutionStatus: originFacilityCode && destinationFacilityCode ? "resolved" : "unresolved",
  };
}

function compareStops(a: AmazonTripStop, b: AmazonTripStop): number {
  if (a.sequence !== b.sequence) return a.sequence - b.sequence;
  return String(a.plannedArrival ?? a.actualArrival ?? "").localeCompare(String(b.plannedArrival ?? b.actualArrival ?? ""));
}
