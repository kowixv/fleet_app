/**
 * Risk Score Calculator
 *
 * Computes a low/medium/high risk score for active loads based on
 * multiple signals without requiring an ETA for every calculation.
 */

import type { RiskScore, RiskResult, TrackingMode, GeofenceStatus, AppointmentStatus } from './types';

interface RiskInput {
  trackingMode: TrackingMode;
  geofenceStatus: GeofenceStatus;
  lastUpdateAt: string | null;    // ISO timestamp of last location update
  parkedSince: string | null;     // ISO timestamp of when parked
  deliveryDate: string | null;    // date string "YYYY-MM-DD"
  etaMinutes: number | null;
  distanceHistory: number[];      // last 3 distances — for deviation
  appointmentStatus: AppointmentStatus;
}

export function calculateRiskScore(input: RiskInput): RiskResult {
  const reasons: string[] = [];
  let points = 0;

  const now = Date.now();

  // 1. Tablet offline / no location
  if (input.lastUpdateAt) {
    const ageMin = (now - new Date(input.lastUpdateAt).getTime()) / 60_000;
    if (ageMin > 180) {
      points += 3;
      reasons.push(`No location update for ${formatMinutes(ageMin)}`);
    } else if (ageMin > 90) {
      points += 2;
      reasons.push(`No location update for ${formatMinutes(ageMin)}`);
    }
  }

  // 2. Long rest with active load
  if (input.parkedSince) {
    const parkedMin = (now - new Date(input.parkedSince).getTime()) / 60_000;
    if (parkedMin > 240) {
      points += 3;
      reasons.push(`Driver parked for ${formatMinutes(parkedMin)}`);
    } else if (parkedMin > 90) {
      points += 2;
      reasons.push(`Driver parked for ${formatMinutes(parkedMin)}`);
    } else if (parkedMin > 45) {
      points += 1;
      reasons.push(`Driver parked for ${formatMinutes(parkedMin)}`);
    }
  }

  // 3. Appointment / ETA risk
  if (input.appointmentStatus === 'late') {
    points += 3;
    reasons.push('Load is late for appointment');
  } else if (input.appointmentStatus === 'at_risk') {
    points += 2;
    reasons.push('Load is at risk of missing appointment');
  } else if (input.appointmentStatus === 'tight') {
    points += 1;
    reasons.push('Tight window to appointment');
  }

  // 4. Route deviation
  if (isDeviating(input.distanceHistory)) {
    points += 2;
    reasons.push('Vehicle is deviating from route');
  }

  // 5. ETA exceeds delivery date
  if (input.etaMinutes !== null && input.deliveryDate) {
    const deliveryTs = new Date(input.deliveryDate + 'T23:59:00').getTime();
    const etaTs = now + input.etaMinutes * 60_000;
    if (etaTs > deliveryTs) {
      points += 2;
      reasons.push('ETA past delivery date');
    }
  }

  // 6. Offline mode
  if (input.trackingMode === 'offline') {
    points += 1;
    reasons.push('Tablet appears offline');
  }

  const score: RiskScore =
    points >= 4 ? 'high' :
    points >= 2 ? 'medium' :
    'low';

  return { score, reasons };
}

/**
 * Calculate appointment status from delivery_date, pickup_date, ETA, and tracking context.
 * Returns 'unknown' if there's not enough information.
 */
export function calculateAppointmentStatus(input: {
  deliveryDate: string | null;
  etaMinutes: number | null;
  lastUpdateAt: string | null;
  trackingMode: TrackingMode;
  geofenceStatus: GeofenceStatus;
}): AppointmentStatus {
  const { deliveryDate, etaMinutes, lastUpdateAt, geofenceStatus } = input;

  if (!deliveryDate) return 'unknown';

  const deliveryTs = new Date(deliveryDate + 'T23:59:00').getTime();
  const now = Date.now();
  const hoursUntilDelivery = (deliveryTs - now) / (60 * 60 * 1000);

  // Already delivered or departed
  if (geofenceStatus === 'arrived_delivery' || geofenceStatus === 'departed_delivery') {
    return hoursUntilDelivery > 0 ? 'on_time' : 'late';
  }

  if (hoursUntilDelivery < 0) return 'late';

  // If we have ETA, compare precisely
  if (etaMinutes !== null) {
    const etaHours = etaMinutes / 60;
    const bufferHours = hoursUntilDelivery - etaHours;
    if (bufferHours > 4) return 'early';
    if (bufferHours > 1) return 'on_time';
    if (bufferHours > 0) return 'tight';
    return 'at_risk';
  }

  // No ETA — estimate from hours remaining + stale location
  if (!lastUpdateAt) return 'unknown';
  const ageMin = (now - new Date(lastUpdateAt).getTime()) / 60_000;

  if (hoursUntilDelivery > 12) return 'on_time';
  if (hoursUntilDelivery > 6) return ageMin > 120 ? 'at_risk' : 'on_time';
  if (hoursUntilDelivery > 2) return ageMin > 60 ? 'at_risk' : 'tight';
  return 'at_risk';
}

function isDeviating(distanceHistory: number[]): boolean {
  if (distanceHistory.length < 3) return false;
  const [d1, d2, d3] = distanceHistory.slice(-3);
  return (d2 - d1) > 0.5 && (d3 - d2) > 0.5;
}

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}
