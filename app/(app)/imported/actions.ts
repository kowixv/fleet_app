"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireWriteRole } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { geocodeAndActivateTracking } from "@/lib/tracking/activate";

const EDITABLE = [
  "load_number", "broker_name", "driver_name", "pickup_date", "pickup_location",
  "delivery_date", "delivery_location", "total_miles", "gross_rate",
];

export async function updateImported(id: string, values: Record<string, any>) {
  await requireWriteRole();
  const supabase = await createClient();
  const patch: Record<string, any> = {};
  for (const k of EDITABLE) if (k in values) patch[k] = values[k] === "" ? null : values[k];
  const { error } = await supabase.from("imported_loads").update(patch).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/imported");
  return { ok: true };
}

export async function rejectImported(id: string) {
  await requireWriteRole();
  const supabase = await createClient();
  await supabase.from("imported_loads").update({ status: "rejected" }).eq("id", id);
  revalidatePath("/imported");
  return { ok: true };
}

export async function approveImported(id: string) {
  const profile = await requireWriteRole();
  const supabase = await createClient();

  const { data: imp } = await supabase.from("imported_loads").select("*").eq("id", id).single();
  if (!imp || imp.status !== "pending") {
    revalidatePath("/imported");
    return { error: "Kayıt uygun değil (muhtemelen zaten işlendi)." };
  }

  // Atomic claim before the insert — a double-click sees zero rows and stops
  // (same pattern as the Telegram webhook approve path).
  const { data: claimed } = await supabase
    .from("imported_loads")
    .update({ status: "approved" })
    .eq("id", id)
    .eq("status", "pending")
    .select("id");
  if (!claimed?.length) {
    revalidatePath("/imported");
    return { error: "Kayıt zaten işlendi." };
  }

  let group: any = null;
  if (imp.telegram_group_id) {
    const r = await supabase.from("telegram_groups").select("*").eq("id", imp.telegram_group_id).single();
    group = r.data;
  }

  const { data: load, error } = await supabase
    .from("loads")
    .insert({
      organization_id: profile.organization_id,
      load_number: imp.load_number,
      load_source: "broker",
      company_id: group?.company_id ?? null,
      vehicle_id: group?.vehicle_id ?? null,
      driver_id: group?.driver_id ?? null,
      pickup_date: imp.pickup_date,
      delivery_date: imp.delivery_date,
      pickup_location: imp.pickup_location,
      delivery_location: imp.delivery_location,
      route:
        imp.pickup_location || imp.delivery_location
          ? `${imp.pickup_location ?? "?"} -> ${imp.delivery_location ?? "?"}`
          : null,
      gross_amount: imp.gross_rate ?? 0,
      total_miles: imp.total_miles ?? 0,
      status: "booked",
      source_file_url: imp.file_url,
      notes: imp.raw_text,
    })
    .select("id")
    .single();

  if (error || !load) {
    // Release the claim so the operator can retry.
    await supabase.from("imported_loads").update({ status: "pending" }).eq("id", id);
    revalidatePath("/imported");
    return { error: error?.message ?? "Load kaydedilemedi." };
  }

  await supabase
    .from("imported_loads")
    .update({ created_load_id: load.id })
    .eq("id", id);

  // Geocode pickup/delivery addresses and activate tracking.
  // Awaited so the work isn't killed when a serverless response returns;
  // the function has internal try/catch and never throws.
  const serviceClient = createServiceClient();
  await geocodeAndActivateTracking(serviceClient, load.id, profile.organization_id);

  revalidatePath("/imported");
  revalidatePath("/loads");
  return { ok: true };
}
