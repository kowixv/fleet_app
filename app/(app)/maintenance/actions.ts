"use server";

import { requireWriteRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { todayISO } from "@/lib/tz";
import { mileageRpcErrorMessage, validateMileageInput } from "@/lib/vehicle-mileage";
import { revalidatePath } from "next/cache";

function maintenanceRevalidate() {
  revalidatePath("/maintenance");
  revalidatePath("/maintenance/units");
  revalidatePath("/maintenance/costs");
  revalidatePath("/vehicles");
  revalidatePath("/");
}

export async function updateMileage(vehicleId: string, mileage: number | string) {
  await requireWriteRole();
  if (!vehicleId) return { ok: false as const, error: "Arac gerekli." };

  const parsed = validateMileageInput(mileage);
  if (!parsed.ok) return { ok: false as const, error: parsed.error };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_vehicle_mileage", {
    p_vehicle_id: vehicleId,
    p_mileage: parsed.mileage,
    p_source: "manual",
    p_organization_id: null,
  });
  if (error) return { ok: false as const, error: mileageRpcErrorMessage(error.message) };
  maintenanceRevalidate();
  return { ok: true as const, mileage: parsed.mileage };
}

export interface ServiceDetails {
  cost?: number;
  shopName?: string;
  partName?: string;
  notes?: string;
}

/** Atomic and idempotent: DB re-reads the authoritative vehicle mileage. */
export async function markServiced(ruleId: string, details: ServiceDetails = {}) {
  await requireWriteRole();
  const cost = Number(details.cost ?? 0);
  if (!ruleId) return { ok: false as const, error: "Bakim kurali gerekli." };
  if (!Number.isFinite(cost) || cost < 0) {
    return { ok: false as const, error: "Maliyet negatif olamaz." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("mark_maintenance_serviced", {
    p_rule_id: ruleId,
    p_performed_date: todayISO(),
    p_cost: cost,
    p_shop_name: details.shopName?.trim() || null,
    p_part_name: details.partName?.trim() || null,
    p_notes: details.notes?.trim() || null,
  });
  if (error) return { ok: false as const, error: error.message };
  maintenanceRevalidate();
  return { ok: true as const, recordId: data as string };
}
