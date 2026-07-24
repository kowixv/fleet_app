import { createClient } from "@/lib/supabase/server";
import { isWriteRole } from "@/lib/auth-roles";
import { validateFleetLocationInput } from "@/lib/tracking/location-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireActor() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { supabase, response: new Response("Unauthorized", { status: 401 }) };

  const { data: profile } = await supabase
    .from("profiles")
    .select("organization_id, role")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile) return { supabase, response: new Response("Forbidden", { status: 403 }) };
  return { supabase, profile, isWriter: isWriteRole(profile.role) };
}

const LOCATION_SELECT = `
  id, organization_id, name, location_type, address_line, city, state, postal_code,
  latitude, longitude, phone, email, website, business_hours, is_24_hour,
  mobile_service, heavy_duty_capable, preferred_vendor, services,
  internal_rating, notes, active
`;

export async function GET(req: Request) {
  const actor = await requireActor();
  if ("response" in actor) return actor.response;

  const includeInactive =
    actor.isWriter && new URL(req.url).searchParams.get("include_inactive") === "1";

  let query = actor.supabase
    .from("fleet_locations")
    .select(LOCATION_SELECT)
    .eq("organization_id", actor.profile.organization_id)
    .order("preferred_vendor", { ascending: false })
    .order("name", { ascending: true });

  if (!includeInactive) query = query.eq("active", true);

  const { data, error } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({
    locations: (data ?? []).map((location) => ({
      ...location,
      notes: actor.isWriter ? location.notes : null,
    })),
  });
}

export async function POST(req: Request) {
  const actor = await requireActor();
  if ("response" in actor) return actor.response;
  if (!actor.isWriter) return new Response("Forbidden", { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const validation = validateFleetLocationInput(body);
  if (!validation.ok || !validation.data) {
    return Response.json({ error: validation.errors.join(" ") }, { status: 400 });
  }

  const { data, error } = await actor.supabase
    .from("fleet_locations")
    .insert({
      ...validation.data,
      organization_id: actor.profile.organization_id,
      active: true,
    })
    .select(LOCATION_SELECT)
    .single();

  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ location: data }, { status: 201 });
}
