/**
 * Admin API — tablet token management
 * POST: Create a new tablet token for a unit
 * GET: List all tablet tokens for the org
 * DELETE: Revoke a tablet token
 */

import { createClient, createServiceClient } from "@/lib/supabase/server";

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

  let body: { unit_id: string; device_label?: string; device_id?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.unit_id) {
    return Response.json({ error: "unit_id required" }, { status: 400 });
  }

  // Verify unit belongs to this org
  const serviceClient = createServiceClient();
  const { data: vehicle } = await serviceClient
    .from("vehicles")
    .select("id, unit_number")
    .eq("id", body.unit_id)
    .eq("organization_id", profile.organization_id)
    .maybeSingle();

  if (!vehicle) {
    return Response.json({ error: "Unit not found" }, { status: 404 });
  }

  const { data: token, error } = await serviceClient
    .from("tablet_tokens")
    .insert({
      organization_id: profile.organization_id,
      unit_id: body.unit_id,
      device_label: body.device_label ?? `Tablet – Unit ${vehicle.unit_number}`,
      device_id: body.device_id ?? null,
      created_by: user.id,
    })
    .select("id, token, unit_id, device_label, is_active, created_at")
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ token });
}

export async function GET() {
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

  const serviceClient = createServiceClient();
  const { data: tokens } = await serviceClient
    .from("tablet_tokens")
    .select(`
      id, unit_id, device_label, device_id, is_active,
      last_seen_at, created_at,
      vehicles (unit_number, vehicle_type)
    `)
    .eq("organization_id", profile.organization_id)
    .order("created_at", { ascending: false });

  return Response.json({ tokens: tokens ?? [] });
}

export async function DELETE(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("organization_id, role")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile || !["owner", "admin"].includes(profile.role)) {
    return new Response("Forbidden", { status: 403 });
  }

  let body: { token_id: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const serviceClient = createServiceClient();
  const { error } = await serviceClient
    .from("tablet_tokens")
    .update({ is_active: false })
    .eq("id", body.token_id)
    .eq("organization_id", profile.organization_id);

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
