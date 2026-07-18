import type { AmazonParsedSourceRow, AmazonPaymentDetailFields, AmazonTripStop, AmazonTripsRowFields } from "../types";
import { normalizeMatchKey } from "./match-confidence";

export function normalizedVehicleSet(rows: AmazonParsedSourceRow<AmazonTripsRowFields>[]): string[] {
  return [...new Set(rows.map((row) => normalizeMatchKey(row.normalizedValues.tractorVehicleId)).filter((value): value is string => Boolean(value)))].sort();
}

export function hasConflictingVehicles(rows: AmazonParsedSourceRow<AmazonTripsRowFields>[]): boolean {
  return normalizedVehicleSet(rows).length > 1;
}

export function dateRangesOverlap(payment: AmazonPaymentDetailFields, trip: AmazonTripsRowFields): boolean {
  const paymentStart = payment.startDate ?? payment.endDate;
  const paymentEnd = payment.endDate ?? payment.startDate;
  const tripDates = trip.stops.flatMap((stop) => [stop.plannedArrival, stop.plannedDeparture, stop.actualArrival, stop.actualDeparture])
    .filter((value): value is string => Boolean(value))
    .map((value) => value.slice(0, 10));
  if (!paymentStart || !paymentEnd || tripDates.length === 0) return false;
  return tripDates.some((date) => date >= paymentStart && date <= paymentEnd);
}

export function facilityCompatible(payment: AmazonPaymentDetailFields, trip: AmazonTripsRowFields): boolean {
  const route = normalizeMatchKey(payment.route);
  if (!route) return false;
  return trip.stops.some((stop) => {
    const facility = normalizeMatchKey(stop.facilityCode);
    return Boolean(facility && route.includes(facility));
  });
}

export function firstAndFinalFacility(rows: AmazonParsedSourceRow<AmazonTripsRowFields>[]): { origin: string | null; destination: string | null } {
  const stops = rows.flatMap((row) => row.normalizedValues.stops).sort((a, b) => a.sequence - b.sequence);
  return {
    origin: facilityCode(stops[0]),
    destination: facilityCode(stops[stops.length - 1]),
  };
}

function facilityCode(stop: AmazonTripStop | undefined): string | null {
  return normalizeMatchKey(stop?.facilityCode) ?? null;
}
