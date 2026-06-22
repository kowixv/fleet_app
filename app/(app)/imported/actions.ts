"use server";

import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { revalidatePath } from "next/cache";

const EDITABLE = [
  "load_number", "broker_name", "driver_name", "pickup_date", "pickup_location",
  "delivery_date", "delivery_location", "total_miles", "gross_rate",
];

export async function updateImported(id: string, values: Record<string, any>) {
  await requireProfile();
  const supabase = await createClient();
  const patch: Record<string, any> = {};
  for (const k of EDITABLE) if (k in values) patch[k] = values[k] === "" ? null : values[k];
  const { error } = await supabase.from("imported_loads").update(patch).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/imported");
  return { ok: true };
}

export async function rejectImported(id: string) {
  await requireProfile();
  const supabase = await createClient();
  await supabase.from("imported_loads").update({ status: "rejected" }).eq("id", id);
  revalidatePath("/imported");
  return { ok: true };
}

export async function approveImported(id: string) {
  const profile = await requireProfile();
  const supabase = await createClient();

  const { data: imp } = await supabase.from("imported_loads").select("*").eq("id", id).single();
  if (!imp || imp.status !== "pending") return { error: "Kayıt uygun değil." };

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

  if (error) return { error: error.message };

  await supabase
    .from("imported_loads")
    .update({ status: "approved", created_load_id: load?.id ?? null })
    .eq("id", id);
  revalidatePath("/imported");
  revalidatePath("/loads");
  return { ok: true };
}
