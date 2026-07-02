/**
 * Position plausibility filter.
 *
 * Browser/device geolocation can return a low-accuracy fix (cell-tower or
 * Wi-Fi based, sometimes hundreds of meters to a few kilometers off) before
 * a GPS lock is acquired — most commonly right after the driver opens the
 * /drive link. Since `unit_locations` is a single "latest position" row per
 * unit, a single bad fix used to overwrite the last known good position and
 * be shown on the map as if it were exact.
 *
 * This filter rejects a new fix only when BOTH:
 *   - its accuracy is unreliable (> MAX_RELIABLE_ACCURACY_M), and
 *   - the implied jump from the last known position is physically impossible
 *     (further than MAX_PLAUSIBLE_SPEED_MPH could have travelled in the
 *     elapsed time), and large enough to rule out ordinary GPS jitter.
 * Small jumps are always accepted even with poor accuracy, so real (if
 * slightly noisy) movement is never blocked.
 */

import { haversineDistanceMiles } from './distance';

/** GPS accuracy > this in meters is considered unreliable. */
export const MAX_RELIABLE_ACCURACY_M = 100;

/** Speed > this in mph is considered physically impossible (GPS error). */
export const MAX_PLAUSIBLE_SPEED_MPH = 150;

/** Jumps smaller than this are always accepted — ordinary GPS jitter, not a teleport. */
const MIN_JUMP_MILES_FOR_REJECTION = 0.5;

export interface PreviousPosition {
  latitude: number;
  longitude: number;
  last_update_at: string;
}

export interface IncomingPosition {
  latitude: number;
  longitude: number;
  accuracy?: number;
  timestamp: string;
}

export interface ResolvedPosition {
  latitude: number;
  longitude: number;
  /** True when the incoming fix was discarded in favor of the previous known-good position. */
  rejected: boolean;
}

/**
 * Decides which lat/lng should actually be persisted/shown for this unit.
 * Returns the incoming fix unless it's both low-accuracy and an implausible
 * jump from the previous position, in which case the previous position wins.
 */
export function resolvePosition(
  prev: PreviousPosition | null,
  incoming: IncomingPosition,
): ResolvedPosition {
  const accuracyReliable = !incoming.accuracy || incoming.accuracy <= MAX_RELIABLE_ACCURACY_M;

  if (!prev || accuracyReliable) {
    return { latitude: incoming.latitude, longitude: incoming.longitude, rejected: false };
  }

  const jumpMiles = haversineDistanceMiles(
    prev.latitude, prev.longitude,
    incoming.latitude, incoming.longitude,
  );

  if (jumpMiles < MIN_JUMP_MILES_FOR_REJECTION) {
    return { latitude: incoming.latitude, longitude: incoming.longitude, rejected: false };
  }

  const elapsedHours = Math.abs(
    new Date(incoming.timestamp).getTime() - new Date(prev.last_update_at).getTime(),
  ) / 3_600_000;
  const impliedSpeedMph = elapsedHours > 0 ? jumpMiles / elapsedHours : Infinity;

  if (impliedSpeedMph > MAX_PLAUSIBLE_SPEED_MPH) {
    return { latitude: prev.latitude, longitude: prev.longitude, rejected: true };
  }

  return { latitude: incoming.latitude, longitude: incoming.longitude, rejected: false };
}
