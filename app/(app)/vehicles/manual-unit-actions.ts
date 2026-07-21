"use server";

import { requireWriteRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  isGeneratedUnitNumberCollision,
  isVehicleFormType,
  isVehicleStatus,
  normalizeUpperText,
  optionalNonNegativeNumber,
  optionalPercentFraction,
  optionalText,
} from "@/lib/vehicle-form";
import { revalidatePath } from "next/cache";

function revalidateVehicleMaintenance() {
  revalidatePath("/vehicles");
  revalidatePath("/maintenance");
  revalidatePath("/maintenance/units");
  revalidatePath("/maintenance/settings");
  revalidatePath("/");
}

function intOrNull(value: unknown, label: string): number | null {
  const parsed = optionalNonNegativeNumber(value, label);
  if (parsed === null) return null;
  if (!Number.isInteger(parsed)) throw new Error(`${label} must be a whole number.`);
  return parsed;
}

function vehicleId(value: unknown): string | null {
  const cleaned = optionalText(value);
  return cleaned && /^[0-9a-f-]{36}$/i.test(cleaned) ? cleaned : null;
}

function manualUnitNumber(value: unknown): string {
  const cleaned = normalizeUpperText(value);
  if (!cleaned) throw new Error("Unit numarası gerekli.");
  if (cleaned.length > 50) throw new Error("Unit numarası 50 karakterden uzun olamaz.");
  return cleaned;
}

function buildVehicleFormPayload(input: Record<string, unknown>) {
  const type = optionalText(input.vehicle_type);
  if (!isVehicleFormType(type)) throw new Error("Geçerli bir araç tipi seçin.");
  const status = optionalText(input.status);
  if (!isVehicleStatus(status)) throw new Error("Geçerli bir durum seçin.");

  return {
    vehicle: {
      unit_number: manualUnitNumber(input.unit_number),
      vehicle_type: type,
      owner_id: vehicleId(input.owner_id),
      assigned_driver_id: vehicleId(input.assigned_driver_id),
      default_driver_pay_pct: optionalPercentFraction(input.default_driver_pay_pct),
      vin: normalizeUpperText(input.vin),
      year: intOrNull(input.year, "Yıl"),
      make: optionalText(input.make),
      model: optionalText(input.model),
      plate: normalizeUpperText(input.plate),
      truck_color: optionalText(input.truck_color),
      current_mileage: optionalNonNegativeNumber(input.current_mileage, "Mileage"),
      status,
      notes: optionalText(input.notes),
    },
    profile: {
      engine_model: optionalText(input.engine_model),
      engine_hours: optionalNonNegativeNumber(input.engine_hours, "Engine Hour"),
    },
  };
}

async function assertDriverInOrg(driverId: string | null, organizationId: string) {
  if (!driverId) return;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("people")
    .select("id")
    .eq("id", driverId)
    .eq("organization_id", organizationId)
    .in("type", ["company_driver", "external_carrier_driver"])
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Seçilen şoför bu organizasyona ait değil.");
}

async function assertOwnerInOrg(ownerId: string | null, organizationId: string) {
  if (!ownerId) return;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("people")
    .select("id")
    .eq("id", ownerId)
    .eq("organization_id", organizationId)
    .in("type", ["owner_operator", "investor"])
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Seçilen owner bu organizasyona ait değil.");
}

function friendlyUnitNumberError(error: { code?: string | null; message?: string | null; details?: string | null; hint?: string | null; constraint?: string | null }) {
  if (isGeneratedUnitNumberCollision(error)) {
    return "Bu unit numarası zaten kullanılıyor. Başka bir unit numarası girin.";
  }
  return error.message || "Araç kaydedilemedi.";
}

export async function saveVehicleWithManualUnitFromForm(input: Record<string, unknown>) {
  const profile = await requireWriteRole();
  const id = vehicleId(input.id);
  let payload: ReturnType<typeof buildVehicleFormPayload>;

  try {
    payload = buildVehicleFormPayload(input);
    await Promise.all([
      assertDriverInOrg(payload.vehicle.assigned_driver_id, profile.organization_id),
      assertOwnerInOrg(payload.vehicle.owner_id, profile.organization_id),
    ]);
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
  }

  const supabase = await createClient();
  let vehicleRecordId = id;
  let existingProfile = false;

  if (vehicleRecordId) {
    const existing = await supabase
      .from("vehicles")
      .select("id")
      .eq("id", vehicleRecordId)
      .eq("organization_id", profile.organization_id)
      .maybeSingle();
    if (existing.error) return { ok: false as const, error: existing.error.message };
    if (!existing.data) return { ok: false as const, error: "Unit bulunamadı." };

    const { error } = await supabase
      .from("vehicles")
      .update(payload.vehicle)
      .eq("id", vehicleRecordId)
      .eq("organization_id", profile.organization_id);
    if (error) return { ok: false as const, error: friendlyUnitNumberError(error) };

    const profileRes = await supabase
      .from("vehicle_maintenance_profiles")
      .select("id")
      .eq("organization_id", profile.organization_id)
      .eq("vehicle_id", vehicleRecordId)
      .maybeSingle();
    if (profileRes.error) return { ok: false as const, error: profileRes.error.message };
    existingProfile = Boolean(profileRes.data);
  } else {
    const { data, error } = await supabase
      .from("vehicles")
      .insert({
        ...payload.vehicle,
        organization_id: profile.organization_id,
      })
      .select("id")
      .single();
    if (error) return { ok: false as const, error: friendlyUnitNumberError(error) };
    vehicleRecordId = String(data.id);
  }

  const hasEngineInput = payload.profile.engine_model !== null || payload.profile.engine_hours !== null;
  if (vehicleRecordId && (existingProfile || hasEngineInput)) {
    const { error } = await supabase
      .from("vehicle_maintenance_profiles")
      .upsert(
        {
          organization_id: profile.organization_id,
          vehicle_id: vehicleRecordId,
          engine_model: payload.profile.engine_model,
          engine_hours: payload.profile.engine_hours,
          updated_by: profile.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "organization_id,vehicle_id" },
      );
    if (error) return { ok: false as const, error: error.message };
  }

  revalidateVehicleMaintenance();
  return { ok: true as const, vehicleId: vehicleRecordId, unitNumber: payload.vehicle.unit_number };
}
