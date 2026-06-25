import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export interface Profile {
  id: string;
  organization_id: string;
  email: string | null;
  full_name: string | null;
  role: string;
}

/** Roles that are allowed to perform write (create/update/delete) operations. */
const WRITE_ROLES = new Set(["owner", "admin", "manager"]);

/** Get the current profile (org + role), or redirect to /login. */
export async function requireProfile(): Promise<Profile> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, organization_id, email, full_name, role")
    .eq("id", user.id)
    .single();

  if (!profile) redirect("/login");
  return profile as Profile;
}

/**
 * Like requireProfile, but additionally throws if the user's role is not
 * allowed to perform write operations. `viewer` role is read-only.
 */
export async function requireWriteRole(): Promise<Profile> {
  const profile = await requireProfile();
  if (!WRITE_ROLES.has(profile.role)) {
    throw new Error("Bu işlem için yetkiniz yok. (Sadece owner, admin veya manager yazabilir.)");
  }
  return profile;
}
