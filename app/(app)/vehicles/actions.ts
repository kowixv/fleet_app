"use server";

import { requireWriteRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error("Numeric values must be zero or greater.");
  return parsed;
}

function text(value: unknown): string | null {
  const cleaned = typeof value === "string" ? value.trim() : "";
  return cleaned || null;
}

function revalidateVehicleMaintenance() {
  revalidatePath("/vehicles");
  revalidatePath("/maintenance");
  revalidatePath("/maintenance/units");
  revalidatePath("/maintenance/settings");
  revalidatePath("/");
}

export async function upsertVehicleMaintenanceProfile(input: Record<string, unknown>) {
  const profile = await requireWriteRole();
  const vehicleId = text(input.vehicle_id);
  if (!vehicleId) return { ok: false as const, error: "Vehicle is required." };

  let patch: Record<string, unknown>;
  try {
    patch = {
      organization_id: profile.organization_id,
      vehicle_id: vehicleId,
      vin: text(input.vin),
      model_year: num(input.model_year),
      make: text(input.make),
      model: text(input.model),
      engine_model: text(input.engine_model),
      engine_esn: text(input.engine_esn),
      transmission_model: text(input.transmission_model),
      transmission_serial: text(input.transmission_serial),
      front_axle_model: text(input.front_axle_model),
      rear_axle_model: text(input.rear_axle_model),
      dpf_serial: text(input.dpf_serial),
      turbo_part_number: text(input.turbo_part_number),
      engine_hours: num(input.engine_hours),
      idle_hours: num(input.idle_hours),
      idle_percentage: num(input.idle_percentage),
      rolling_30_day_mpg: num(input.rolling_30_day_mpg),
      duty_cycle: text(input.duty_cycle) ?? "normal_otr",
      coolant_specification: text(input.coolant_specification),
      axle_oil_specification: text(input.axle_oil_specification),
      last_dot_annual_inspection_date: text(input.last_dot_annual_inspection_date),
      notes: text(input.notes),
      updated_by: profile.id,
      updated_at: new Date().toISOString(),
    };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("vehicle_maintenance_profiles")
    .upsert(patch, { onConflict: "organization_id,vehicle_id" });
  if (error) return { ok: false as const, error: error.message };
  revalidateVehicleMaintenance();
  return { ok: true as const };
}

export async function applyMaintenanceTemplateToVehicle(
  vehicleId: string,
  templateId: string,
  items: Array<Record<string, unknown>>,
) {
  await requireWriteRole();
  if (!vehicleId || !templateId) return { ok: false as const, error: "Vehicle and template are required." };
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false as const, error: "Select at least one template item." };
  }

  const payload = items.map((item) => ({
    enabled: item.enabled === true,
    template_item_id: text(item.template_item_id),
    service_type: text(item.service_type),
    service_category: text(item.service_category),
    description: text(item.description),
    checklist_reference: text(item.checklist_reference),
    interval_miles: num(item.interval_miles),
    interval_days: num(item.interval_days),
    interval_engine_hours: num(item.interval_engine_hours),
    last_done_mileage: num(item.last_done_mileage),
    last_done_date: text(item.last_done_date),
    last_done_engine_hours: num(item.last_done_engine_hours),
  }));

  const selected = payload.filter((item) => item.enabled);
  if (selected.length === 0) return { ok: false as const, error: "No enabled template items selected." };
  if (selected.some((item) => !item.service_type)) {
    return { ok: false as const, error: "Every selected item needs a service name." };
  }
  if (selected.some((item) => !item.interval_miles && !item.interval_days && !item.interval_engine_hours)) {
    return { ok: false as const, error: "Every selected item needs at least one interval." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("apply_maintenance_template", {
    p_vehicle_id: vehicleId,
    p_template_id: templateId,
    p_items: payload,
  });
  if (error) return { ok: false as const, error: error.message };
  revalidateVehicleMaintenance();
  return { ok: true as const, result: data };
}
