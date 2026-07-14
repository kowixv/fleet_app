"use server";

import { requireProfile, requireWriteRole } from "@/lib/auth";
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

const VEHICLE_RELATION_CHECKS = [
  { table: "loads", column: "vehicle_id", label: "loads" },
  { table: "expenses", column: "vehicle_id", label: "expenses" },
  { table: "settlements", column: "vehicle_id", label: "settlements" },
  { table: "telegram_groups", column: "vehicle_id", label: "telegram groups" },
  { table: "maintenance_rules", column: "vehicle_id", label: "maintenance rules" },
  { table: "maintenance_records", column: "vehicle_id", label: "maintenance history" },
  { table: "vehicle_mileage_logs", column: "vehicle_id", label: "mileage history" },
  { table: "maintenance_invoices", column: "vehicle_id", label: "maintenance invoices" },
  { table: "vehicle_maintenance_profiles", column: "vehicle_id", label: "maintenance profile" },
  { table: "vehicle_inspections", column: "vehicle_id", label: "inspections" },
  { table: "inspection_findings", column: "vehicle_id", label: "inspection findings" },
  { table: "vehicle_mileage_period_snapshots", column: "vehicle_id", label: "mileage snapshots" },
  { table: "unit_locations", column: "unit_id", label: "tracking location" },
  { table: "tracking_events", column: "unit_id", label: "tracking events" },
  { table: "tablet_tokens", column: "unit_id", label: "tablet tokens" },
] as const;

function friendlyVehicleRemovalError(message: string) {
  if (/foreign key|violates|constraint|23503/i.test(message)) {
    return "Bu unit geçmiş kayıtları bulunduğu için kalıcı olarak silinemez. Unit pasife alındı ve geçmiş kayıtları korundu.";
  }
  return message || "İşlem tamamlanamadı.";
}

async function getVehicleForOrg(vehicleId: string, organizationId: string) {
  const supabase = await createClient();
  return supabase
    .from("vehicles")
    .select("id, unit_number, status")
    .eq("id", vehicleId)
    .eq("organization_id", organizationId)
    .maybeSingle();
}

async function vehicleHasRelatedHistory(vehicleId: string, organizationId: string) {
  const supabase = await createClient();
  const found: string[] = [];
  for (const check of VEHICLE_RELATION_CHECKS) {
    const { count, error } = await supabase
      .from(check.table)
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq(check.column, vehicleId);
    if (error) {
      if (/does not exist|schema cache/i.test(error.message)) continue;
      throw new Error(error.message);
    }
    if ((count ?? 0) > 0) found.push(check.label);
  }
  return found;
}

async function shutdownVehicleTracking(vehicleId: string, organizationId: string) {
  const supabase = await createClient();
  await supabase
    .from("unit_locations")
    .update({ tracking_mode: "offline" })
    .eq("organization_id", organizationId)
    .eq("unit_id", vehicleId);
  await supabase
    .from("tablet_tokens")
    .update({ is_active: false })
    .eq("organization_id", organizationId)
    .eq("unit_id", vehicleId)
    .eq("is_active", true);

  const { data: activeLoads } = await supabase
    .from("loads")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("vehicle_id", vehicleId)
    .in("status", ["pending", "booked"]);
  const loadIds = (activeLoads ?? []).map((load: any) => load.id);
  if (loadIds.length > 0) {
    await supabase
      .from("load_tracking")
      .update({ tracking_status: "cancelled" })
      .eq("organization_id", organizationId)
      .in("load_id", loadIds)
      .eq("tracking_status", "active");
  }
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

export async function deactivateVehicle(vehicleId: string) {
  const profile = await requireWriteRole();
  const id = text(vehicleId);
  if (!id) return { ok: false as const, error: "Unit gerekli." };

  const supabase = await createClient();
  const vehicleRes = await getVehicleForOrg(id, profile.organization_id);
  if (vehicleRes.error) return { ok: false as const, error: friendlyVehicleRemovalError(vehicleRes.error.message) };
  if (!vehicleRes.data) return { ok: false as const, error: "Unit bulunamadı." };

  const { error } = await supabase
    .from("vehicles")
    .update({ status: "inactive" })
    .eq("id", id)
    .eq("organization_id", profile.organization_id);
  if (error) return { ok: false as const, error: friendlyVehicleRemovalError(error.message) };

  await shutdownVehicleTracking(id, profile.organization_id);
  revalidateVehicleMaintenance();
  return {
    ok: true as const,
    unitNumber: vehicleRes.data.unit_number as string,
    message: `Unit ${vehicleRes.data.unit_number} pasife alındı. Geçmiş kayıtları korundu.`,
  };
}

export async function reactivateVehicle(vehicleId: string) {
  const profile = await requireWriteRole();
  const id = text(vehicleId);
  if (!id) return { ok: false as const, error: "Unit gerekli." };

  const supabase = await createClient();
  const vehicleRes = await getVehicleForOrg(id, profile.organization_id);
  if (vehicleRes.error) return { ok: false as const, error: friendlyVehicleRemovalError(vehicleRes.error.message) };
  if (!vehicleRes.data) return { ok: false as const, error: "Unit bulunamadı." };

  const { error } = await supabase
    .from("vehicles")
    .update({ status: "active" })
    .eq("id", id)
    .eq("organization_id", profile.organization_id);
  if (error) return { ok: false as const, error: friendlyVehicleRemovalError(error.message) };
  revalidateVehicleMaintenance();
  return {
    ok: true as const,
    unitNumber: vehicleRes.data.unit_number as string,
    message: `Unit ${vehicleRes.data.unit_number} tekrar aktif edildi.`,
  };
}

export async function permanentlyDeleteUnusedVehicle(vehicleId: string, confirmationUnitNumber: string) {
  const profile = await requireProfile();
  if (!["owner", "admin"].includes(profile.role)) {
    return { ok: false as const, error: "Kalıcı silme için owner veya admin yetkisi gerekli." };
  }
  const id = text(vehicleId);
  if (!id) return { ok: false as const, error: "Unit gerekli." };

  const supabase = await createClient();
  const vehicleRes = await getVehicleForOrg(id, profile.organization_id);
  if (vehicleRes.error) return { ok: false as const, error: friendlyVehicleRemovalError(vehicleRes.error.message) };
  if (!vehicleRes.data) return { ok: false as const, error: "Unit bulunamadı." };

  const unitNumber = String(vehicleRes.data.unit_number ?? "");
  if (text(confirmationUnitNumber) !== unitNumber) {
    return { ok: false as const, error: `Kalıcı silme için Unit ${unitNumber} numarasını aynen yazın.` };
  }

  let related: string[] = [];
  try {
    related = await vehicleHasRelatedHistory(id, profile.organization_id);
  } catch (error) {
    return { ok: false as const, error: friendlyVehicleRemovalError(error instanceof Error ? error.message : String(error)) };
  }

  if (related.length > 0) {
    await deactivateVehicle(id);
    return {
      ok: false as const,
      deactivated: true,
      related,
      error: "Bu unit geçmiş kayıtları bulunduğu için kalıcı olarak silinemez. Unit pasife alındı ve geçmiş kayıtları korundu.",
    };
  }

  const { error } = await supabase
    .from("vehicles")
    .delete()
    .eq("id", id)
    .eq("organization_id", profile.organization_id);
  if (error) return { ok: false as const, error: friendlyVehicleRemovalError(error.message) };
  revalidateVehicleMaintenance();
  return { ok: true as const, message: `Unit ${unitNumber} kalıcı olarak silindi.` };
}
