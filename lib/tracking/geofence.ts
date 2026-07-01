/**
 * Geofence Engine
 *
 * Invisible zone checks using Haversine distance — no Google Maps API needed.
 * Produces geofence status transitions and event types.
 */

import { haversineDistanceMiles } from './distance';
import type { GeofenceStatus, TrackingEventType, GeofenceCheckResult } from './types';

/** 5-mile "near" radius */
const NEAR_RADIUS_MI = 5;
/** 0.5-mile "arrived" radius */
const ARRIVED_RADIUS_MI = 0.5;
/** Departure detected when unit moves > 1 mile outside ARRIVED zone */
const DEPARTED_RADIUS_MI = 1.5;

interface GeofenceInput {
  lat: number;
  lng: number;
  pickupLat: number | null;
  pickupLng: number | null;
  deliveryLat: number | null;
  deliveryLng: number | null;
  currentStatus: GeofenceStatus;
}

export function checkGeofence(input: GeofenceInput): GeofenceCheckResult {
  const {
    lat, lng,
    pickupLat, pickupLng,
    deliveryLat, deliveryLng,
    currentStatus,
  } = input;

  const events: TrackingEventType[] = [];
  let newStatus = currentStatus;

  const dPickup = (pickupLat != null && pickupLng != null)
    ? haversineDistanceMiles(lat, lng, pickupLat, pickupLng)
    : null;

  const dDelivery = (deliveryLat != null && deliveryLng != null)
    ? haversineDistanceMiles(lat, lng, deliveryLat, deliveryLng)
    : null;

  switch (currentStatus) {
    case 'en_route_to_pickup':
      if (dPickup !== null) {
        if (dPickup <= ARRIVED_RADIUS_MI) {
          newStatus = 'arrived_pickup';
          events.push('ARRIVED_PICKUP');
        } else if (dPickup <= NEAR_RADIUS_MI) {
          newStatus = 'near_pickup';
          events.push('NEAR_PICKUP');
        }
      }
      break;

    case 'near_pickup':
      if (dPickup !== null) {
        if (dPickup <= ARRIVED_RADIUS_MI) {
          newStatus = 'arrived_pickup';
          events.push('ARRIVED_PICKUP');
        } else if (dPickup > NEAR_RADIUS_MI) {
          // Left the near zone without arriving — back to en_route
          newStatus = 'en_route_to_pickup';
        }
      }
      break;

    case 'arrived_pickup':
      if (dPickup !== null && dPickup > DEPARTED_RADIUS_MI) {
        newStatus = 'departed_pickup';
        events.push('DEPARTED_PICKUP');
        // Immediately check if near delivery
        if (dDelivery !== null && dDelivery <= NEAR_RADIUS_MI) {
          newStatus = 'near_delivery';
          events.push('NEAR_DELIVERY');
        } else {
          newStatus = 'en_route_to_delivery';
        }
      }
      break;

    case 'departed_pickup':
    case 'en_route_to_delivery':
      if (dDelivery !== null) {
        if (dDelivery <= ARRIVED_RADIUS_MI) {
          newStatus = 'arrived_delivery';
          events.push('ARRIVED_DELIVERY');
        } else if (dDelivery <= NEAR_RADIUS_MI) {
          newStatus = 'near_delivery';
          events.push('NEAR_DELIVERY');
        }
      }
      break;

    case 'near_delivery':
      if (dDelivery !== null) {
        if (dDelivery <= ARRIVED_RADIUS_MI) {
          newStatus = 'arrived_delivery';
          events.push('ARRIVED_DELIVERY');
        } else if (dDelivery > NEAR_RADIUS_MI) {
          newStatus = 'en_route_to_delivery';
        }
      }
      break;

    case 'arrived_delivery':
      if (dDelivery !== null && dDelivery > DEPARTED_RADIUS_MI) {
        newStatus = 'departed_delivery';
        events.push('DEPARTED_DELIVERY');
      }
      break;

    case 'departed_delivery':
      // Terminal state for this load — no further transitions
      break;
  }

  return { newStatus, events };
}

/** Returns the distance to the current target (pickup or delivery) in miles. */
export function distanceToCurrentTarget(
  lat: number, lng: number,
  geofenceStatus: GeofenceStatus,
  pickupLat: number | null, pickupLng: number | null,
  deliveryLat: number | null, deliveryLng: number | null,
): number | null {
  const targetingPickup =
    geofenceStatus === 'en_route_to_pickup' ||
    geofenceStatus === 'near_pickup' ||
    geofenceStatus === 'arrived_pickup';

  if (targetingPickup) {
    if (pickupLat == null || pickupLng == null) return null;
    return haversineDistanceMiles(lat, lng, pickupLat, pickupLng);
  } else {
    if (deliveryLat == null || deliveryLng == null) return null;
    return haversineDistanceMiles(lat, lng, deliveryLat, deliveryLng);
  }
}

/**
 * Route deviation check — no Google Routes API.
 * Returns true if distance to target has increased for 2 consecutive updates.
 */
export function isRouteDeviation(distanceHistory: number[]): boolean {
  if (distanceHistory.length < 3) return false;
  const [d1, d2, d3] = distanceHistory.slice(-3);
  // Both consecutive deltas are positive (increasing distance) and meaningful (> 0.5 mi each)
  return (d2 - d1) > 0.5 && (d3 - d2) > 0.5;
}
