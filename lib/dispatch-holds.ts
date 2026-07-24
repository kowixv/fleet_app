import type { SupabaseClient } from "@supabase/supabase-js";

export const DISPATCH_HOLD_ASSIGNMENT_ERROR =
  "Bu unit için açık SEVKE ÇIKMASIN kaydı var. Hold temizlenmeden yeni yük atanamaz.";

export async function vehicleHasOpenDispatchHold(
  supabase: SupabaseClient,
  organizationId: string,
  vehicleId: string | null | undefined,
): Promise<{ blocked: boolean; error?: string }> {
  if (!vehicleId) return { blocked: false };
  const { data, error } = await supabase
    .from("vehicle_dispatch_holds")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("vehicle_id", vehicleId)
    .eq("status", "open")
    .limit(1)
    .maybeSingle();
  if (error) return { blocked: false, error: error.message };
  return { blocked: Boolean(data) };
}

export async function assertVehicleDispatchable(
  supabase: SupabaseClient,
  organizationId: string,
  vehicleId: string | null | undefined,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const hold = await vehicleHasOpenDispatchHold(supabase, organizationId, vehicleId);
  if (hold.error) return { ok: false, error: hold.error };
  if (hold.blocked) return { ok: false, error: DISPATCH_HOLD_ASSIGNMENT_ERROR };
  return { ok: true };
}
