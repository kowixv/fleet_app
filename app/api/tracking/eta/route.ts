/**
 * POST /api/tracking/eta
 * On-demand ETA calculation for a specific load.
 * Cached per load for 15 minutes — expensive Google Routes API call.
 * Auth: session
 */

import { createClient, createServiceClient } from "@/lib/supabase/server";
import { calculateETA } from "@/lib/tracking/eta";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("organization_id, role")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile || !["owner", "admin", "manager"].includes(profile.role)) {
    return new Response("Forbidden", { status: 403 });
  }

  let body: { load_id: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.load_id) {
    return Response.json({ error: "load_id required" }, { status: 400 });
  }

  const serviceClient = createServiceClient();

  // Fetch load for coordinates
  const { data: load } = await serviceClient
    .from("loads")
    .select("id, delivery_lat, delivery_lng, vehicle_id")
    .eq("id", body.load_id)
    .eq("organization_id", profile.organization_id)
    .maybeSingle();

  if (!load) {
    return Response.json({ error: "Load not found" }, { status: 404 });
  }

  if (!load.delivery_lat || !load.delivery_lng) {
    return Response.json({ error: "Delivery coordinates not geocoded yet" }, { status: 422 });
  }

  if (!load.vehicle_id) {
    return Response.json({ error: "No vehicle assigned to load" }, { status: 422 });
  }

  // Get current unit location
  const { data: unitLoc } = await serviceClient
    .from("unit_locations")
    .select("latitude, longitude")
    .eq("unit_id", load.vehicle_id)
    .maybeSingle();

  if (!unitLoc) {
    return Response.json({ error: "No location available for this unit" }, { status: 422 });
  }

  // Get cached ETA from load_tracking
  const { data: lt } = await serviceClient
    .from("load_tracking")
    .select("id, eta_minutes, eta_calculated_at")
    .eq("load_id", body.load_id)
    .maybeSingle();

  const eta = await calculateETA(
    unitLoc.latitude, unitLoc.longitude,
    load.delivery_lat, load.delivery_lng,
    lt?.eta_calculated_at ?? null,
    lt?.eta_minutes ?? null,
  );

  if (!eta) {
    return Response.json({ error: "ETA calculation failed" }, { status: 500 });
  }

  // Persist new ETA to load_tracking
  if (lt) {
    await serviceClient
      .from("load_tracking")
      .update({
        eta_minutes: eta.minutes,
        eta_calculated_at: eta.calculated_at,
      })
      .eq("id", lt.id);
  }

  return Response.json({
    load_id: body.load_id,
    eta_minutes: eta.minutes,
    calculated_at: eta.calculated_at,
  });
}
