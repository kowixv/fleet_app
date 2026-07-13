"use server";

import { createClient } from "@/lib/supabase/server";
import { requireWriteRole } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { todayISO } from "@/lib/tz";

function maintenanceRevalidate() {
  revalidatePath("/maintenance");
  revalidatePath("/vehicles");
  revalidatePath("/");
}

export async function updateMileage(vehicleId: string, mileage: number) {
  await requireWriteRole();
  if (!vehicleId) return { ok: false as const, error: "Araç gerekli." };
  if (!Number.isFinite(mileage) || mileage < 0 || !Number.isInteger(mileage)) {
    return { ok: false as const, error: "Mileage sıfır veya daha büyük tam sayı olmalı." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_vehicle_mileage", {
    p_vehicle_id: vehicleId,
    p_mileage: mileage,
    p_source: "manual",
    p_organization_id: null,
  });
  if (error) return { ok: false as const, error: error.message };
  maintenanceRevalidate();
  return { ok: true as const, mileage };
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
  if (!ruleId) return { ok: false as const, error: "Bakım kuralı gerekli." };
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
