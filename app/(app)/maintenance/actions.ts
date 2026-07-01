"use server";

import { createClient } from "@/lib/supabase/server";
import { requireWriteRole } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { localISODate } from "@/lib/format";

export async function updateMileage(vehicleId: string, mileage: number) {
  const profile = await requireWriteRole();
  const supabase = await createClient();
  const { error: updErr } = await supabase
    .from("vehicles")
    .update({ current_mileage: mileage })
    .eq("id", vehicleId);
  if (updErr) return { ok: false as const, error: updErr.message };
  const { error: logErr } = await supabase.from("vehicle_mileage_logs").insert({
    organization_id: profile.organization_id,
    vehicle_id: vehicleId,
    mileage,
    source: "manual",
  });
  if (logErr) return { ok: false as const, error: logErr.message };
  revalidatePath("/maintenance");
  revalidatePath("/");
  return { ok: true as const };
}

/** Mark a rule serviced now: snapshot mileage/date as the new baseline. */
export async function markServiced(ruleId: string, mileage: number) {
  const profile = await requireWriteRole();
  const supabase = await createClient();
  const today = localISODate();
  const { error: updErr } = await supabase
    .from("maintenance_rules")
    .update({ last_done_mileage: mileage, last_done_date: today })
    .eq("id", ruleId);
  if (updErr) return { ok: false as const, error: updErr.message };
  const { data: rule, error: ruleErr } = await supabase
    .from("maintenance_rules")
    .select("vehicle_id, service_type")
    .eq("id", ruleId)
    .single();
  if (ruleErr) return { ok: false as const, error: ruleErr.message };
  if (rule) {
    const { error: recErr } = await supabase.from("maintenance_records").insert({
      organization_id: profile.organization_id,
      vehicle_id: rule.vehicle_id,
      rule_id: ruleId,
      service_type: rule.service_type,
      performed_date: today,
      mileage,
    });
    if (recErr) return { ok: false as const, error: recErr.message };
  }
  revalidatePath("/maintenance");
  return { ok: true as const };
}
