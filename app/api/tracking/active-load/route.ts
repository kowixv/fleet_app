/**
 * GET /api/tracking/active-load
 * Returns the active load details for the authenticated tablet's unit.
 * The tablet uses this to get pickup/delivery coordinates.
 * Auth: tablet token
 */

import { authenticateTablet } from "@/lib/tracking/tablet-auth";
import { resolveActiveLoad } from "@/lib/tracking/resolve-active-load";
import { createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await authenticateTablet(req);
  if (!auth.ok) {
    return new Response(auth.error, { status: auth.status });
  }

  const supabase = createServiceClient();

  const { load, error } = await resolveActiveLoad(
    supabase,
    auth.orgId,
    auth.unitId,
    `
      id, load_number, status,
      pickup_date, delivery_date,
      pickup_location, delivery_location,
      pickup_lat, pickup_lng,
      delivery_lat, delivery_lng,
      load_tracking (
        tracking_status,
        geofence_status
      )
    `,
  );

  if (error) {
    console.error("tracking/active-load: query failed", error);
    return Response.json({ error: "Query failed" }, { status: 500 });
  }

  if (!load) return Response.json({ load: null });

  // PostgREST returns load_tracking as an array (its unique key is the
  // composite (organization_id, load_id), so the embed counts as to-many).
  // Clients expect a single object or null — normalize here.
  const lt = load.load_tracking;
  return Response.json({
    load: { ...load, load_tracking: Array.isArray(lt) ? (lt[0] ?? null) : lt },
  });
}
