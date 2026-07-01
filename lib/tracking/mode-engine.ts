/**
 * Tracking Mode Engine
 *
 * Determines the current tracking mode for a unit based on speed,
 * position history, active load state, and time parked.
 *
 * Key design principle: slow speed alone does NOT mean rest.
 * Rest is only confirmed after 45+ min of no meaningful movement
 * with multiple consecutive position confirmations.
 */

import { haversineDistanceMiles } from './distance';
import type {
  TrackingMode,
  ModeEngineResult,
  PositionSnapshot,
  LoadTracking,
} from './types';

/** Radius in miles — positions within this are considered "same location" */
const SAME_LOCATION_RADIUS_MI = 0.3;

/** Minutes of low speed before considering rest (45 min) */
const REST_THRESHOLD_MINUTES = 45;

/** Speed threshold mph — below this = low speed */
const LOW_SPEED_MPH = 5;

/** Speed above this = moving */
const MOVING_SPEED_MPH = 15;

/** Consecutive position count required to confirm rest */
const REST_CONFIRM_POSITIONS = 3;

interface ModeEngineInput {
  speed: number;          // mph
  accuracy: number | null; // meters — high values (>100m) reduce confidence
  hasActiveLoad: boolean;
  consecutivePositions: PositionSnapshot[];  // last N positions from load_tracking
  parkedSince: string | null;                // ISO timestamp
  distanceToTarget: number | null;           // miles to pickup or delivery
  previousDistanceToTarget: number | null;
}

export function computeTrackingMode(input: ModeEngineInput): ModeEngineResult {
  const {
    speed,
    hasActiveLoad,
    consecutivePositions,
    parkedSince,
    distanceToTarget,
    previousDistanceToTarget,
  } = input;

  if (!hasActiveLoad) {
    return { mode: 'no_active_load', parked_since: null };
  }

  // Moving fast — definitely moving
  if (speed > MOVING_SPEED_MPH) {
    return { mode: 'moving', parked_since: null };
  }

  // Moderate speed — could be slow traffic or warehouse yard
  if (speed > LOW_SPEED_MPH) {
    return { mode: 'slow_traffic', parked_since: null };
  }

  // Low speed path (≤ 5 mph)
  // Check how long we've been at low speed / parked
  const now = Date.now();
  const parkedMs = parkedSince ? now - new Date(parkedSince).getTime() : 0;
  const parkedMinutes = parkedMs / 60_000;

  // Not parked long enough yet
  if (parkedMinutes < REST_THRESHOLD_MINUTES) {
    return { mode: 'parking_maneuver', parked_since: parkedSince ?? new Date().toISOString() };
  }

  // Enough time has passed — check for consecutive stable positions
  if (consecutivePositions.length < REST_CONFIRM_POSITIONS) {
    return { mode: 'parking_maneuver', parked_since: parkedSince };
  }

  const allWithinRadius = allPositionsWithinRadius(consecutivePositions, SAME_LOCATION_RADIUS_MI);
  if (!allWithinRadius) {
    // There was meaningful movement — reset parked_since
    return { mode: 'parking_maneuver', parked_since: new Date().toISOString() };
  }

  // Check that vehicle is not making progress toward destination
  const makingProgress = distanceToTarget !== null &&
    previousDistanceToTarget !== null &&
    (previousDistanceToTarget - distanceToTarget) > 0.1;  // reducing by > 0.1 mi

  if (makingProgress) {
    return { mode: 'parking_maneuver', parked_since: parkedSince };
  }

  // All conditions met — confirmed rest
  return { mode: 'parked_rest', parked_since: parkedSince };
}

/** Update the consecutive positions buffer (max 5 entries). */
export function updateConsecutivePositions(
  existing: PositionSnapshot[],
  newPosition: PositionSnapshot,
): PositionSnapshot[] {
  const updated = [...existing, newPosition];
  return updated.slice(-5);
}

/** Update the distance history buffer (max 3 entries). */
export function updateDistanceHistory(
  existing: number[],
  newDistance: number,
): number[] {
  const updated = [...existing, newDistance];
  return updated.slice(-3);
}

/**
 * Returns true if all positions in the array are within `radiusMiles`
 * of each other (centroid-based check).
 */
function allPositionsWithinRadius(positions: PositionSnapshot[], radiusMiles: number): boolean {
  if (positions.length < 2) return true;
  const latAvg = positions.reduce((s, p) => s + p.lat, 0) / positions.length;
  const lngAvg = positions.reduce((s, p) => s + p.lng, 0) / positions.length;
  return positions.every(
    (p) => haversineDistanceMiles(p.lat, p.lng, latAvg, lngAvg) <= radiusMiles,
  );
}

/**
 * Returns the updated parked_since value:
 * - If speed > LOW_SPEED_MPH → null (vehicle is moving)
 * - If parked_since exists → keep it (don't reset unless moving)
 * - Otherwise → set to now
 */
export function computeParkedSince(
  speed: number,
  currentParkedSince: string | null,
): string | null {
  if (speed > LOW_SPEED_MPH) return null;
  return currentParkedSince ?? new Date().toISOString();
}

/** Determine effective tracking mode accounting for geofence proximity. */
export function applyGeofenceToMode(
  baseMode: TrackingMode,
  distanceToPickup: number | null,
  distanceToDelivery: number | null,
  geofenceStatus: LoadTracking['geofence_status'],
): TrackingMode {
  // Approaching zones override moving/slow_traffic
  if (
    baseMode === 'moving' ||
    baseMode === 'slow_traffic' ||
    baseMode === 'parking_maneuver'
  ) {
    if (
      (geofenceStatus === 'en_route_to_pickup' || geofenceStatus === 'near_pickup') &&
      distanceToPickup !== null && distanceToPickup <= 5
    ) {
      return 'approaching_pickup';
    }
    if (
      (geofenceStatus === 'en_route_to_delivery' ||
        geofenceStatus === 'near_delivery' ||
        geofenceStatus === 'departed_pickup') &&
      distanceToDelivery !== null && distanceToDelivery <= 5
    ) {
      return 'approaching_delivery';
    }
  }
  return baseMode;
}
