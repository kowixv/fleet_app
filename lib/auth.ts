import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export interface Profile {
  id: string;
  organization_id: string;
  email: string | null;
  full_name: string | null;
  role: string;
}

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
