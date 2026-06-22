import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { isOwnedImportPath } from "@/lib/storage";

export const runtime = "nodejs";

/** Returns a short-lived signed URL redirect for an import file (auth-guarded by middleware). */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const path = searchParams.get("path");
  if (!path) return new Response("missing path", { status: 400 });

  // Require a logged-in user and resolve their organization from the session.
  const profile = await requireProfile();

  // The path must be scoped to the caller's own organization folder. The signing
  // step below uses the service role (bypassing Storage RLS), so this check is the
  // only thing preventing cross-tenant file access.
  if (!isOwnedImportPath(path, profile.organization_id)) {
    return new Response("forbidden", { status: 403 });
  }

  // Defense in depth: confirm an imported_loads row for this path exists in the
  // caller's org (RLS-scoped client), so we never sign orphan/forged paths.
  const supabase = await createClient();
  const { data: owned } = await supabase
    .from("imported_loads")
    .select("id")
    .eq("file_url", path)
    .limit(1)
    .maybeSingle();
  if (!owned) return new Response("not found", { status: 404 });

  // Sign with the service role so we don't depend on Storage RLS policies.
  const service = createServiceClient();
  const { data, error } = await service.storage
    .from("imports")
    .createSignedUrl(path, 3600);
  if (error || !data) return new Response("not found", { status: 404 });
  return Response.redirect(data.signedUrl);
}
