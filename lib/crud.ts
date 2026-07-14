"use server";

import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requireWriteRole } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { clean, isAllowedTable } from "@/lib/crud-allowlist";
import { geocodeAndActivateTracking } from "@/lib/tracking/activate";
import { mileageRpcErrorMessage, validateOptionalInitialMileage } from "@/lib/vehicle-mileage";

type LoadRow = { id: string; status: string | null; vehicle_id: string | null };

/**
 * Booked loads with a vehicle get geocoding + a load_tracking row, so the
 * tracking pipeline also covers manually entered loads (imported loads get
 * this at approval). Idempotent; errors are logged inside geocodeAndActivate-
 * Tracking and never break the CRUD flow.
 */
async function activateLoadTracking(load: LoadRow | null, orgId: string) {
  if (!load || load.status !== "booked" || !load.vehicle_id) return;
  await geocodeAndActivateTracking(createServiceClient(), load.id, orgId);
}

/**
 * Generic CRUD server actions. Security: the table must be in the allowlist,
 * only allowlisted columns are written, and organization_id always comes from
 * the session — never from the client. The allowlist itself lives in
 * `lib/crud-allowlist.ts` (testable, non-"use server").
 * Write operations require at least `manager` role; `viewer` is rejected.
 */

export async function createRow(
  table: string,
  values: Record<string, unknown>,
  revalidate?: string,
) {
  const profile = await requireWriteRole();
  const supabase = await createClient();
  const initialMileage =
    table === "vehicles" ? validateOptionalInitialMileage(values.current_mileage) : null;
  if (initialMileage && !initialMileage.ok) return { error: initialMileage.error };

  const row: Record<string, unknown> = { ...clean(table, values), organization_id: profile.organization_id };
  if (table === "vehicles") {
    row.vehicle_type ??= "truck";
    row.ownership_type ??= "company_owned";
    row.status ??= "active";
  }
  if (table === "loads") {
    const { data, error } = await supabase
      .from(table)
      .insert(row)
      .select("id, status, vehicle_id")
      .single();
    if (error) return { error: error.message };
    await activateLoadTracking(data, profile.organization_id);
  } else if (table === "vehicles") {
    const { data, error } = await supabase.from(table).insert(row).select("id").single();
    if (error) return { error: error.message };

    if (initialMileage?.ok) {
      const { error: mileageError } = await supabase.rpc("set_vehicle_mileage", {
        p_vehicle_id: data.id,
        p_mileage: initialMileage.mileage,
        p_source: "initial",
        p_organization_id: null,
      });
      if (mileageError) return { error: mileageRpcErrorMessage(mileageError.message) };
    }
  } else {
    const { error } = await supabase.from(table).insert(row);
    if (error) return { error: error.message };
  }
  if (revalidate) revalidatePath(revalidate);
  return { ok: true };
}

export async function updateRow(
  table: string,
  id: string,
  values: Record<string, unknown>,
  revalidate?: string,
) {
  const profile = await requireWriteRole();
  const supabase = await createClient();
  if (table === "loads") {
    const { data, error } = await supabase
      .from(table)
      .update(clean(table, values))
      .eq("id", id)
      .select("id, status, vehicle_id")
      .maybeSingle();
    if (error) return { error: error.message };
    await activateLoadTracking(data, profile.organization_id);
  } else {
    const { error } = await supabase.from(table).update(clean(table, values)).eq("id", id);
    if (error) return { error: error.message };
  }
  if (revalidate) revalidatePath(revalidate);
  return { ok: true };
}

export async function deleteRow(table: string, id: string, revalidate?: string) {
  if (!isAllowedTable(table)) throw new Error(`Table not allowed: ${table}`);
  await requireWriteRole();
  const supabase = await createClient();
  const { error } = await supabase.from(table).delete().eq("id", id);
  if (error) return { error: error.message };
  if (revalidate) revalidatePath(revalidate);
  return { ok: true };
}
