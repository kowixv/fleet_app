/**
 * Core location processing pipeline.
 * Called from POST /api/tracking/location after tablet auth.
 *
 * Orchestrates: mode engine → geofence → alert generation → DB writes.
 */

import { createServiceClient } from '@/lib/supabase/server';
import { computeTrackingMode, computeParkedSince, updateConsecutivePositions, updateDistanceHistory, applyGeofenceToMode } from './mode-engine';
import { checkGeofence, distanceToCurrentTarget, isRouteDeviation } from './geofence';
import { filterNewAlerts, getRestEvents } from './alert-manager';
import { calculateRiskScore, calculateAppointmentStatus } from './risk-score';
import { resolvePosition, MAX_PLAUSIBLE_SPEED_MPH, MAX_RELIABLE_ACCURACY_M } from './position-filter';
import type { LocationPayload, LoadTracking, UnitLocation, TrackingMode, TrackingEventType } from './types';

export interface ProcessLocationResult {
  ok: boolean;
  mode: TrackingMode;
  error?: string;
}

export async function processLocation(
  unitId: string,
  orgId: string,
  payload: LocationPayload,
): Promise<ProcessLocationResult> {
  const supabase = createServiceClient();

  // ── Validate payload ──────────────────────────────────────────────────────
  if (payload.speed > MAX_PLAUSIBLE_SPEED_MPH) {
    return { ok: false, error: 'Impossible speed rejected', mode: 'offline' };
  }
  const accuracyReliable = !payload.accuracy || payload.accuracy <= MAX_RELIABLE_ACCURACY_M;

  // ── Fetch active load for this unit ───────────────────────────────────────
  const { data: loads } = await supabase
    .from('loads')
    .select(`
      id, organization_id,
      pickup_lat, pickup_lng,
      delivery_lat, delivery_lng,
      pickup_date, delivery_date,
      status
    `)
    .eq('organization_id', orgId)
    .eq('vehicle_id', unitId)
    .in('status', ['booked', 'delivered'])
    .order('pickup_date', { ascending: false })
    .limit(1);

  const activeLoad = loads?.[0] ?? null;
  const hasActiveLoad = !!activeLoad;

  // ── Fetch current load_tracking (if active load exists) ──────────────────
  let loadTracking: LoadTracking | null = null;
  if (activeLoad) {
    const { data: lt } = await supabase
      .from('load_tracking')
      .select('*')
      .eq('load_id', activeLoad.id)
      .maybeSingle();
    loadTracking = lt as LoadTracking | null;
  }

  // ── Fetch previous unit_location for context ──────────────────────────────
  const { data: prevLocation } = await supabase
    .from('unit_locations')
    .select('tracking_mode, latitude, longitude, accuracy, last_update_at')
    .eq('unit_id', unitId)
    .maybeSingle();

  const previousMode = prevLocation?.tracking_mode ?? null;

  // ── Resolve position (reject implausible low-accuracy jumps) ─────────────
  // A single low-accuracy fix (e.g. cell/Wi-Fi based, before GPS locks) that
  // implies an impossible jump from the last known position is discarded in
  // favor of the last known-good position, so it can't "teleport" the unit
  // on the dispatcher's map. Everything downstream (mode engine, geofence,
  // events, and the persisted row) uses this resolved position.
  const resolved = resolvePosition(
    prevLocation
      ? {
          latitude: prevLocation.latitude,
          longitude: prevLocation.longitude,
          last_update_at: prevLocation.last_update_at,
        }
      : null,
    { latitude: payload.latitude, longitude: payload.longitude, accuracy: payload.accuracy, timestamp: payload.timestamp },
  );
  const lat = resolved.latitude;
  const lng = resolved.longitude;

  // ── Distance to current target ────────────────────────────────────────────
  const dToTarget = activeLoad && loadTracking
    ? distanceToCurrentTarget(
        lat, lng,
        loadTracking.geofence_status,
        activeLoad.pickup_lat, activeLoad.pickup_lng,
        activeLoad.delivery_lat, activeLoad.delivery_lng,
      )
    : null;

  const prevDistances = loadTracking?.distance_history ?? [];
  const prevDistance = prevDistances.length > 0 ? prevDistances[prevDistances.length - 1] : null;

  // ── Mode Engine ────────────────────────────────────────────────────────────
  const newParkedSince = accuracyReliable
    ? computeParkedSince(payload.speed, loadTracking?.parked_since ?? null)
    : loadTracking?.parked_since ?? null;

  const consecutivePositions = loadTracking?.consecutive_positions ?? [];
  const newSnapshot = {
    lat,
    lng,
    ts: payload.timestamp,
    speed: payload.speed,
  };

  const updatedPositions = accuracyReliable
    ? updateConsecutivePositions(consecutivePositions, newSnapshot)
    : consecutivePositions;

  const modeResult = computeTrackingMode({
    speed: payload.speed,
    accuracy: payload.accuracy ?? null,
    hasActiveLoad,
    consecutivePositions: updatedPositions,
    parkedSince: newParkedSince,
    distanceToTarget: dToTarget,
    previousDistanceToTarget: prevDistance,
  });

  // ── Geofence ───────────────────────────────────────────────────────────────
  let updatedLoadTracking = loadTracking;
  let geofenceEvents: TrackingEventType[] = [];

  // Mode persisted to unit_locations / shown on the dashboard. Starts as the
  // base mode and is upgraded to a geofence-aware mode (approaching_*) inside
  // the block below. Rest/mode detection keeps using the base modeResult.mode.
  let finalMode: TrackingMode = modeResult.mode;

  if (activeLoad && loadTracking && accuracyReliable) {
    const gfResult = checkGeofence({
      lat,
      lng,
      pickupLat: activeLoad.pickup_lat,
      pickupLng: activeLoad.pickup_lng,
      deliveryLat: activeLoad.delivery_lat,
      deliveryLng: activeLoad.delivery_lng,
      currentStatus: loadTracking.geofence_status,
    });
    geofenceEvents = gfResult.events;

    // Update distance history for route deviation
    const updatedDistanceHistory = dToTarget !== null
      ? updateDistanceHistory(prevDistances, dToTarget)
      : prevDistances;

    // Route deviation — only check when moving (not parked/maneuver)
    const canDeviateCheck = !['parked_rest', 'parking_maneuver', 'no_active_load'].includes(modeResult.mode);
    const routeDeviation = canDeviateCheck && isRouteDeviation(updatedDistanceHistory);
    if (routeDeviation) {
      geofenceEvents.push('ROUTE_DEVIATION_WARNING');
    }

    // Rest events
    const restEvents = getRestEvents(previousMode, modeResult.mode, modeResult.parked_since);
    geofenceEvents.push(...restEvents);

    // Apply geofence proximity to mode
    finalMode = applyGeofenceToMode(
      modeResult.mode,
      activeLoad.pickup_lat !== null && activeLoad.pickup_lng !== null
        ? distanceToCurrentTarget(lat, lng, 'en_route_to_pickup', activeLoad.pickup_lat, activeLoad.pickup_lng, null, null)
        : null,
      activeLoad.delivery_lat !== null && activeLoad.delivery_lng !== null
        ? distanceToCurrentTarget(lat, lng, 'en_route_to_delivery', null, null, activeLoad.delivery_lat, activeLoad.delivery_lng)
        : null,
      gfResult.newStatus,
    );

    // Calculate appointment status
    const appointmentStatus = calculateAppointmentStatus({
      deliveryDate: activeLoad.delivery_date,
      etaMinutes: loadTracking.eta_minutes,
      lastUpdateAt: payload.timestamp,
      trackingMode: finalMode,
      geofenceStatus: gfResult.newStatus,
    });

    // Risk score
    const riskResult = calculateRiskScore({
      trackingMode: finalMode,
      geofenceStatus: gfResult.newStatus,
      lastUpdateAt: payload.timestamp,
      parkedSince: modeResult.parked_since,
      deliveryDate: activeLoad.delivery_date,
      etaMinutes: loadTracking.eta_minutes,
      distanceHistory: updatedDistanceHistory,
      appointmentStatus,
    });

    // Prepare load_tracking update
    const ltPatch = {
      geofence_status: gfResult.newStatus,
      consecutive_positions: updatedPositions,
      parked_since: modeResult.parked_since,
      distance_history: updatedDistanceHistory,
      risk_score: riskResult.score,
      risk_reasons: riskResult.reasons,
      appointment_status: appointmentStatus,
    };

    await supabase
      .from('load_tracking')
      .update(ltPatch)
      .eq('id', loadTracking.id);

    // Dedup alerts: fetch existing events for this load
    const { data: existingEvents } = await supabase
      .from('tracking_events')
      .select('event_type, created_at')
      .eq('load_id', activeLoad.id);

    const newEvents = filterNewAlerts(geofenceEvents, existingEvents ?? []);

    // Insert events one at a time: the partial unique index on one-time events
    // (ARRIVED/DEPARTED) can reject a row under a race, and a single batch
    // insert is all-or-nothing — a lone conflict would drop the other events.
    for (const event_type of newEvents) {
      const { error: insertErr } = await supabase.from('tracking_events').insert({
        organization_id: orgId,
        unit_id: unitId,
        load_id: activeLoad.id,
        event_type,
        metadata: {
          lat,
          lng,
          speed: payload.speed,
          tracking_mode: finalMode,
        },
      });
      // 23505 = unique_violation — expected when a one-time event already exists.
      if (insertErr && insertErr.code !== '23505') {
        console.error('tracking: event insert failed', event_type, insertErr);
      }
    }
  }

  // ── Upsert unit_locations ─────────────────────────────────────────────────
  await supabase
    .from('unit_locations')
    .upsert(
      {
        organization_id: orgId,
        unit_id: unitId,
        latitude: lat,
        longitude: lng,
        speed: payload.speed,
        heading: payload.heading ?? null,
        accuracy: payload.accuracy ?? null,
        altitude: payload.altitude ?? null,
        tracking_mode: finalMode,
        last_update_at: payload.timestamp,
        tablet_device_id: payload.device_id ?? null,
      },
      { onConflict: 'organization_id,unit_id' },
    );

  return { ok: true, mode: finalMode };
}
