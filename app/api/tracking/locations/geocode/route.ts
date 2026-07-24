import { createClient } from "@/lib/supabase/server";
import { isWriteRole } from "@/lib/auth-roles";
import { geocodeAddress } from "@/lib/tracking/geocode";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile || !isWriteRole(profile.role)) {
    return new Response("Forbidden", { status: 403 });
  }

  let body: { address?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const address = typeof body.address === "string" ? body.address.trim() : "";
  if (address.length < 3 || address.length > 500) {
    return Response.json({ error: "Address is required." }, { status: 400 });
  }

  const point = await geocodeAddress(address);
  if (!point) {
    return Response.json({ error: "No geocode result found." }, { status: 404 });
  }

  return Response.json(point);
}
