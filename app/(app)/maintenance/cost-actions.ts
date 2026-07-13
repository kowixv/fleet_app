"use server";

import { revalidatePath } from "next/cache";
import { requireWriteRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function refreshMaintenanceMileageSnapshots(formData: FormData) {
  await requireWriteRole();
  const start = String(formData.get("cost_start") ?? "");
  const end = String(formData.get("cost_end") ?? "");
  const vehicleRaw = String(formData.get("cost_vehicle") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    throw new Error("Valid start and end dates are required.");
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("refresh_vehicle_mileage_period_snapshots", {
    p_start: start,
    p_end: end,
    p_vehicle_id: vehicleRaw && vehicleRaw !== "all" ? vehicleRaw : null,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/maintenance");
  revalidatePath("/maintenance/costs");
  revalidatePath("/maintenance/settings");
}
