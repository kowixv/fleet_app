"use server";

import { createClient } from "@/lib/supabase/server";
import { requireWriteRole } from "@/lib/auth";
import { revalidatePath } from "next/cache";

export async function updateSettings(formData: FormData): Promise<void> {
  const profile = await requireWriteRole();
  const supabase = await createClient();
  const num = (k: string) => {
    const v = formData.get(k);
    return v === null || v === "" ? null : Number(v);
  };

  const patch = {
    organization_id: profile.organization_id,
    default_commission: num("default_commission"),
    pm_due_soon_miles: num("pm_due_soon_miles"),
    repair_warning_amount: num("repair_warning_amount"),
    fuel_warning_pct: num("fuel_warning_pct") != null ? Number(num("fuel_warning_pct")) / 100 : null,
    updated_at: new Date().toISOString(),
  };

  await supabase.from("settings").upsert(patch, { onConflict: "organization_id" });
  revalidatePath("/settings");
}
