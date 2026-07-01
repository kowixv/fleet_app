/**
 * GET /api/tracking/active-load
 * Returns the active load details for the authenticated tablet's unit.
 * The tablet uses this to get pickup/delivery coordinates.
 * Auth: tablet token
 */

import { authenticateTablet } from "@/lib/tracking/tablet-auth";
import { createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await authenticateTablet(req);
  if (!auth.ok) {
    return new Response(auth.error, { status: auth.status });
  }

  const supabase = createServiceClient();

  const { data: load } = await supabase
    .from("loads")
    .select(`
      id, load_number, status,
      pickup_date, delivery_date,
      pickup_location, delivery_location,
      pickup_lat, pickup_lng,
      delivery_lat, delivery_lng,
      load_tracking (
        tracking_status,
        geofence_status
      )
    `)
    .eq("organization_id", auth.orgId)
    .eq("vehicle_id", auth.unitId)
    .in("status", ["booked", "delivered"])
    .order("pickup_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  return Response.json({ load: load ?? null });
}
