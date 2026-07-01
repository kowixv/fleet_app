/**
 * Shared TypeScript types for the tracking module.
 * Used by both backend lib/tracking/* and frontend components.
 */

export type TrackingMode =
  | 'moving'
  | 'slow_traffic'
  | 'parking_maneuver'
  | 'parked_rest'
  | 'no_active_load'
  | 'approaching_pickup'
  | 'approaching_delivery'
  | 'offline';

export type TrackingStatus = 'active' | 'completed' | 'cancelled';

export type RiskScore = 'low' | 'medium' | 'high';

export type AppointmentStatus =
  | 'early'
  | 'on_time'
  | 'tight'
  | 'at_risk'
  | 'late'
  | 'unknown';

export type GeofenceStatus =
  | 'en_route_to_pickup'
  | 'near_pickup'
  | 'arrived_pickup'
  | 'departed_pickup'
  | 'en_route_to_delivery'
  | 'near_delivery'
  | 'arrived_delivery'
  | 'departed_delivery';

export type TrackingEventType =
  | 'NEAR_PICKUP'
  | 'ARRIVED_PICKUP'
  | 'DEPARTED_PICKUP'
  | 'REST_STARTED'
  | 'REST_EXTENDED'
  | 'MOVEMENT_RESUMED'
  | 'NEAR_DELIVERY'
  | 'ARRIVED_DELIVERY'
  | 'DEPARTED_DELIVERY'
  | 'NO_LOCATION_UPDATE'
  | 'TABLET_OFFLINE'
  | 'ROUTE_DEVIATION_WARNING';

/** Incoming location payload from tablet */
export interface LocationPayload {
  latitude: number;
  longitude: number;
  speed: number;      // mph
  heading?: number;   // degrees 0-360
  accuracy?: number;  // meters
  altitude?: number;
  timestamp: string;  // ISO 8601
  device_id?: string;
}

/** A position snapshot used for consecutive-position analysis */
export interface PositionSnapshot {
  lat: number;
  lng: number;
  ts: string;   // ISO 8601
  speed: number;
}

export interface UnitLocation {
  id: string;
  organization_id: string;
  unit_id: string;
  latitude: number;
  longitude: number;
  speed: number;
  heading: number | null;
  accuracy: number | null;
  tracking_mode: TrackingMode;
  last_update_at: string;
  tablet_device_id: string | null;
}

export interface LoadTracking {
  id: string;
  organization_id: string;
  load_id: string;
  tracking_status: TrackingStatus;
  geofence_status: GeofenceStatus;
  risk_score: RiskScore;
  risk_reasons: string[];
  appointment_status: AppointmentStatus;
  eta_minutes: number | null;
  eta_calculated_at: string | null;
  distance_history: number[];
  consecutive_positions: PositionSnapshot[];
  parked_since: string | null;
  updated_at: string;
}

export interface TrackingEvent {
  id: string;
  organization_id: string;
  unit_id: string | null;
  load_id: string | null;
  event_type: TrackingEventType;
  acknowledged: boolean;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

/** Result of the mode engine */
export interface ModeEngineResult {
  mode: TrackingMode;
  parked_since: string | null;
}

/** Result of a geofence check */
export interface GeofenceCheckResult {
  newStatus: GeofenceStatus;
  events: TrackingEventType[];
}

export interface RiskResult {
  score: RiskScore;
  reasons: string[];
}

export interface ETAResult {
  minutes: number;
  calculated_at: string;
}
