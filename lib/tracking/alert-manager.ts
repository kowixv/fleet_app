/**
 * Alert Manager
 *
 * Generates tracking events/alerts with deduplication logic.
 * - One-time events (ARRIVED_PICKUP, etc.) are protected by a DB unique constraint.
 * - Repeatable events (REST_EXTENDED, NO_LOCATION_UPDATE, etc.) have a cooldown window.
 */

import type { TrackingEventType } from './types';

/** Cooldown in milliseconds for repeatable alert types */
const ALERT_COOLDOWN: Partial<Record<TrackingEventType, number>> = {
  REST_STARTED: 0,          // fire once (app logic handles it)
  REST_EXTENDED: 60 * 60 * 1000,        // re-alert every 1 hour
  MOVEMENT_RESUMED: 0,
  NO_LOCATION_UPDATE: 90 * 60 * 1000,   // re-alert every 90 min
  TABLET_OFFLINE: 3 * 60 * 60 * 1000,  // re-alert every 3 hours
  ROUTE_DEVIATION_WARNING: 30 * 60 * 1000, // re-alert every 30 min
  NEAR_PICKUP: 0,
  NEAR_DELIVERY: 0,
};

/** Events protected by a DB unique constraint — never try to insert twice */
const ONE_TIME_EVENTS: Set<TrackingEventType> = new Set([
  'ARRIVED_PICKUP',
  'DEPARTED_PICKUP',
  'ARRIVED_DELIVERY',
  'DEPARTED_DELIVERY',
]);

interface ExistingEvent {
  event_type: TrackingEventType;
  created_at: string;
}

/**
 * Filter a list of candidate events against existing events for a load.
 * Returns only the events that should actually be inserted.
 */
export function filterNewAlerts(
  candidates: TrackingEventType[],
  existingEvents: ExistingEvent[],
): TrackingEventType[] {
  const now = Date.now();
  return candidates.filter((eventType) => {
    // One-time events: skip if any matching event exists at all
    if (ONE_TIME_EVENTS.has(eventType)) {
      return !existingEvents.some((e) => e.event_type === eventType);
    }

    // Cooldown-based events: skip if a matching event was inserted within cooldown
    const cooldown = ALERT_COOLDOWN[eventType] ?? 24 * 60 * 60 * 1000;
    const lastEvent = existingEvents
      .filter((e) => e.event_type === eventType)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];

    if (!lastEvent) return true;
    return (now - new Date(lastEvent.created_at).getTime()) > cooldown;
  });
}

/**
 * Determines whether a NO_LOCATION_UPDATE alert should fire.
 * Fires if last update is older than 90 minutes.
 */
export function shouldAlertNoLocationUpdate(lastUpdateAt: string | null): boolean {
  if (!lastUpdateAt) return false;
  const ageMs = Date.now() - new Date(lastUpdateAt).getTime();
  return ageMs > 90 * 60 * 1000;
}

/**
 * Determines whether a TABLET_OFFLINE alert should fire.
 * Fires if last update is older than 3 hours.
 */
export function shouldAlertTabletOffline(lastUpdateAt: string | null): boolean {
  if (!lastUpdateAt) return false;
  const ageMs = Date.now() - new Date(lastUpdateAt).getTime();
  return ageMs > 3 * 60 * 60 * 1000;
}

/**
 * Determines REST_STARTED / REST_EXTENDED events based on mode transitions.
 */
export function getRestEvents(
  previousMode: string | null,
  currentMode: string,
  parkedSince: string | null,
): TrackingEventType[] {
  const events: TrackingEventType[] = [];

  if (currentMode === 'parked_rest') {
    if (previousMode !== 'parked_rest') {
      events.push('REST_STARTED');
    } else if (parkedSince) {
      // Check if 1-hour milestone
      const parkedMs = Date.now() - new Date(parkedSince).getTime();
      const parkedHours = parkedMs / (60 * 60 * 1000);
      if (parkedHours >= 1) {
        events.push('REST_EXTENDED');
      }
    }
  } else if (previousMode === 'parked_rest' && currentMode !== 'parked_rest') {
    events.push('MOVEMENT_RESUMED');
  }

  return events;
}
