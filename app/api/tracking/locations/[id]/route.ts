import { createClient } from "@/lib/supabase/server";
import { isWriteRole } from "@/lib/auth-roles";
import { validateFleetLocationInput } from "@/lib/tracking/location-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const LOCATION_SELECT = `
  id, organization_id, name, location_type, address_line, city, state, postal_code,
  latitude, longitude, phone, email, website, business_hours, is_24_hour,
  mobile_service, heavy_duty_capable, preferred_vendor, services,
  internal_rating, notes, active
`;

async function requireWriter() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { supabase, response: new Response("Unauthorized", { status: 401 }) };

  const { data: profile } = await supabase
    .from("profiles")
    .select("organization_id, role")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile || !isWriteRole(profile.role)) {
    return { supabase, response: new Response("Forbidden", { status: 403 }) };
  }
  return { supabase, profile };
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return Response.json({ error: "Invalid location id" }, { status: 400 });

  const actor = await requireWriter();
  if ("response" in actor) return actor.response;

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
    .update(validation.data)
    .eq("id", id)
    .eq("organization_id", actor.profile.organization_id)
    .select(LOCATION_SELECT)
    .maybeSingle();

  if (error) return Response.json({ error: error.message }, { status: 400 });
  if (!data) return Response.json({ error: "Location not found" }, { status: 404 });
  return Response.json({ location: data });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return Response.json({ error: "Invalid location id" }, { status: 400 });

  const actor = await requireWriter();
  if ("response" in actor) return actor.response;

  const { data, error } = await actor.supabase
    .from("fleet_locations")
    .update({ active: false })
    .eq("id", id)
    .eq("organization_id", actor.profile.organization_id)
    .select("id")
    .maybeSingle();

  if (error) return Response.json({ error: error.message }, { status: 400 });
  if (!data) return Response.json({ error: "Location not found" }, { status: 404 });
  return Response.json({ ok: true });
}
