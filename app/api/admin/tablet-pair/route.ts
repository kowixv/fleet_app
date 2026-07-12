/**
 * Admin API — tablet token management
 * POST: Create a new tablet token for a unit
 * GET: List all tablet tokens for the org
 * DELETE: Revoke a tablet token (default), or permanently delete it
 *         (body.hard === true — only allowed once it's already revoked)
 */

import { randomBytes } from "node:crypto";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { hashTabletToken } from "@/lib/tracking/tablet-auth";

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

  // Generate here and store only the hash; the raw token is returned exactly
  // once in this response and can never be read back from the DB.
  const rawToken = randomBytes(32).toString("hex");

  const { data: token, error } = await serviceClient
    .from("tablet_tokens")
    .insert({
      organization_id: profile.organization_id,
      unit_id: body.unit_id,
      token_hash: hashTabletToken(rawToken),
      device_label: body.device_label ?? `Tablet – Unit ${vehicle.unit_number}`,
      device_id: body.device_id ?? null,
      created_by: user.id,
    })
    .select("id, unit_id, device_label, is_active, created_at")
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ token: { ...token, token: rawToken } });
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

  let body: { token_id: string; hard?: boolean };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const serviceClient = createServiceClient();

  if (body.hard) {
    // Permanent delete — only for tokens already revoked, so a token can't
    // be removed (and its tablet silently cut off with no trace) without
    // going through the revoke step first.
    const { error, count } = await serviceClient
      .from("tablet_tokens")
      .delete({ count: "exact" })
      .eq("id", body.token_id)
      .eq("organization_id", profile.organization_id)
      .eq("is_active", false);

    if (error) return Response.json({ error: error.message }, { status: 500 });
    if (!count) {
      return Response.json(
        { error: "Token not found, or still active — revoke it first" },
        { status: 409 },
      );
    }
    return Response.json({ ok: true });
  }

  const { error } = await serviceClient
    .from("tablet_tokens")
    .update({ is_active: false })
    .eq("id", body.token_id)
    .eq("organization_id", profile.organization_id);

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
