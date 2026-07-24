/**
 * GET /api/tracking/dashboard
 * Returns all active unit locations, load tracking states, and recent alerts.
 * Auth: session (viewer/admin/manager/owner)
 */

import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("organization_id, role")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile || !["owner", "admin", "manager", "viewer"].includes(profile.role)) {
    return new Response("Forbidden", { status: 403 });
  }
  const orgId = profile.organization_id;

  // Run all queries in parallel
  const [unitsRes, activeLoadsRes, eventsRes, locationsRes] = await Promise.all([
    // Unit locations with vehicle info.
    // NOTE: no `people` embed here — `vehicles` has two FKs to `people`
    // (owner_id + assigned_driver_id), which makes a nested people embed
    // ambiguous in PostgREST. Driver name is sourced from loads.people below.
    supabase
      .from("unit_locations")
      .select(`
        id, unit_id, latitude, longitude, speed, heading, accuracy,
        tracking_mode, last_update_at, tablet_device_id,
        vehicles (id, unit_number, vehicle_type)
      `)
      .eq("organization_id", orgId),

    // Active load tracking with load + vehicle info.
    // Explicit FK hints disambiguate: loads→people and loads→vehicles both
    // have a second composite (organization_id, …) same-org FK, and PostgREST
    // rejects the embed as ambiguous (PGRST201) without the hint.
    supabase
      .from("load_tracking")
      .select(`
        id, load_id, tracking_status, geofence_status,
        risk_score, risk_reasons, appointment_status,
        eta_minutes, eta_calculated_at, parked_since, updated_at,
        loads (
          id, load_number, status,
          pickup_date, delivery_date,
          pickup_location, delivery_location,
          pickup_lat, pickup_lng,
          delivery_lat, delivery_lng,
          vehicle_id,
          vehicles!loads_vehicle_id_fkey (unit_number),
          people!loads_driver_same_org_fk (full_name)
        )
      `)
      .eq("organization_id", orgId)
      .eq("tracking_status", "active")
      .order("updated_at", { ascending: false }),

    // Recent unacknowledged events + last 50 total
    supabase
      .from("tracking_events")
      .select(`
        id, unit_id, load_id, event_type,
        acknowledged, acknowledged_by, acknowledged_at,
        metadata, created_at,
        vehicles (unit_number),
        loads (load_number)
      `)
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false })
      .limit(100),

    // Saved support locations for map markers and nearby support lookup.
    // Internal notes are intentionally omitted from dashboard payloads.
    supabase
      .from("fleet_locations")
      .select(`
        id, name, location_type, address_line, city, state, postal_code,
        latitude, longitude, phone, business_hours, is_24_hour,
        mobile_service, heavy_duty_capable, preferred_vendor,
        services, internal_rating
      `)
      .eq("organization_id", orgId)
      .eq("active", true)
      .order("preferred_vendor", { ascending: false })
      .order("name", { ascending: true }),
  ]);

  // Surface query errors instead of silently returning empty arrays —
  // a broken embed/schema change should be visible in logs, not hidden.
  if (unitsRes.error) console.error("tracking/dashboard: units query failed", unitsRes.error);
  if (activeLoadsRes.error) console.error("tracking/dashboard: activeLoads query failed", activeLoadsRes.error);
  if (eventsRes.error) console.error("tracking/dashboard: events query failed", eventsRes.error);
  if (locationsRes.error) console.error("tracking/dashboard: locations query failed", locationsRes.error);

  return Response.json({
    units: unitsRes.data ?? [],
    activeLoads: activeLoadsRes.data ?? [],
    events: eventsRes.data ?? [],
    locations: locationsRes.data ?? [],
  });
}
