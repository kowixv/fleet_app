"use server";

import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { revalidatePath } from "next/cache";

export async function updateMileage(vehicleId: string, mileage: number) {
  const profile = await requireProfile();
  const supabase = await createClient();
  await supabase.from("vehicles").update({ current_mileage: mileage }).eq("id", vehicleId);
  await supabase.from("vehicle_mileage_logs").insert({
    organization_id: profile.organization_id,
    vehicle_id: vehicleId,
    mileage,
    source: "manual",
  });
  revalidatePath("/maintenance");
  revalidatePath("/");
  return { ok: true };
}

/** Mark a rule serviced now: snapshot mileage/date as the new baseline. */
export async function markServiced(ruleId: string, mileage: number) {
  const profile = await requireProfile();
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);
  await supabase
    .from("maintenance_rules")
    .update({ last_done_mileage: mileage, last_done_date: today })
    .eq("id", ruleId);
  const { data: rule } = await supabase
    .from("maintenance_rules")
    .select("vehicle_id, service_type")
    .eq("id", ruleId)
    .single();
  if (rule) {
    await supabase.from("maintenance_records").insert({
      organization_id: profile.organization_id,
      vehicle_id: rule.vehicle_id,
      rule_id: ruleId,
      service_type: rule.service_type,
      performed_date: today,
      mileage,
    });
  }
  revalidatePath("/maintenance");
  return { ok: true };
}
