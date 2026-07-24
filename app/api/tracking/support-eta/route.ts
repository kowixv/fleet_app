import { createClient } from "@/lib/supabase/server";
import { calculateSupportRoute, type SupportRouteResult } from "@/lib/tracking/support-route";

export const runtime = "nodejs";

const CACHE_TTL_MS = 15 * 60 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const supportRouteCache = new Map<string, SupportRouteResult>();

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("organization_id")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile) return new Response("Forbidden", { status: 403 });

  let body: { unit_id?: string; location_id?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.unit_id || !UUID_RE.test(body.unit_id)) {
    return Response.json({ error: "Valid unit_id is required." }, { status: 400 });
  }
  if (!body.location_id || !UUID_RE.test(body.location_id)) {
    return Response.json({ error: "Valid location_id is required." }, { status: 400 });
  }

  const [unitRes, locationRes] = await Promise.all([
    supabase
      .from("unit_locations")
      .select("latitude, longitude")
      .eq("organization_id", profile.organization_id)
      .eq("unit_id", body.unit_id)
      .maybeSingle(),
    supabase
      .from("fleet_locations")
      .select("latitude, longitude")
      .eq("organization_id", profile.organization_id)
      .eq("id", body.location_id)
      .eq("active", true)
      .maybeSingle(),
  ]);

  if (unitRes.error) return Response.json({ error: unitRes.error.message }, { status: 400 });
  if (locationRes.error) return Response.json({ error: locationRes.error.message }, { status: 400 });
  if (!unitRes.data) return Response.json({ error: "No unit location available." }, { status: 422 });
  if (!locationRes.data) return Response.json({ error: "Location not found." }, { status: 404 });

  const cacheKey = [
    profile.organization_id,
    body.unit_id,
    body.location_id,
    unitRes.data.latitude.toFixed(4),
    unitRes.data.longitude.toFixed(4),
  ].join(":");
  const cached = supportRouteCache.get(cacheKey);
  if (cached && Date.now() - new Date(cached.calculated_at).getTime() < CACHE_TTL_MS) {
    return Response.json(cached);
  }

  const route = await calculateSupportRoute(
    unitRes.data.latitude,
    unitRes.data.longitude,
    locationRes.data.latitude,
    locationRes.data.longitude,
  );

  if (!route) {
    return Response.json(
      { error: "Driving ETA is unavailable. Approx. distance is still shown." },
      { status: 503 },
    );
  }

  supportRouteCache.set(cacheKey, route);
  return Response.json(route);
}
