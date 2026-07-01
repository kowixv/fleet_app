/**
 * POST /api/tracking/acknowledge
 * Marks a tracking event as acknowledged.
 * Auth: session (admin/manager/owner)
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

  let body: { event_id: string } | { event_ids: string[] };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const ids: string[] = "event_ids" in body
    ? body.event_ids
    : [body.event_id];

  if (!ids.length) {
    return Response.json({ error: "No event IDs provided" }, { status: 400 });
  }

  const serviceClient = createServiceClient();
  const { error } = await serviceClient
    .from("tracking_events")
    .update({
      acknowledged: true,
      acknowledged_by: user.id,
      acknowledged_at: new Date().toISOString(),
    })
    .in("id", ids)
    .eq("organization_id", profile.organization_id);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ ok: true, acknowledged: ids.length });
}
