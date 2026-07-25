"use server";

import { requireWriteRole } from "@/lib/auth";
import {
  canTransitionWarrantyClaim,
  isWarrantyClaimStatus,
  parseMaintenanceBudgetForm,
  parseWarrantyClaimForm,
} from "@/lib/maintenance-decision-support";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

function recordId(value: FormDataEntryValue | string | null, label: string): string {
  const normalized = String(value ?? "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)) {
    throw new Error(`${label} geçersiz.`);
  }
  return normalized;
}

function refreshDecisionSupport() {
  revalidatePath("/maintenance/budgets");
  revalidatePath("/maintenance/warranties");
  revalidatePath("/maintenance/analytics");
  revalidatePath("/maintenance/settings");
  revalidatePath("/maintenance/work-orders");
}

export async function saveMaintenanceBudget(formData: FormData): Promise<void> {
  const profile = await requireWriteRole();
  const payload = parseMaintenanceBudgetForm(formData);
  const existingId = String(formData.get("id") ?? "").trim();
  const supabase = await createClient();
  const query = existingId
    ? supabase.from("maintenance_budgets").update(payload)
      .eq("organization_id", profile.organization_id)
      .eq("id", recordId(existingId, "Bütçe"))
    : supabase.from("maintenance_budgets").insert({
      ...payload,
      organization_id: profile.organization_id,
    });
  const { error } = await query;
  if (error) throw new Error(error.code === "23505" ? "Bu kapsam ve dönem için bütçe zaten mevcut." : error.message);
  refreshDecisionSupport();
}

export async function createMaintenanceWarrantyClaim(formData: FormData): Promise<void> {
  const profile = await requireWriteRole();
  const payload = parseWarrantyClaimForm(formData);
  const supabase = await createClient();
  const { error } = await supabase.from("maintenance_warranty_claims").insert({
    ...payload,
    organization_id: profile.organization_id,
  });
  if (error) throw new Error(error.message);
  refreshDecisionSupport();
}

export async function updateMaintenanceWarrantyClaim(claimId: string, formData: FormData): Promise<void> {
  const profile = await requireWriteRole();
  const id = recordId(claimId, "Warranty claim");
  const payload = parseWarrantyClaimForm(formData);
  const supabase = await createClient();
  const { error } = await supabase.from("maintenance_warranty_claims")
    .update(payload)
    .eq("organization_id", profile.organization_id)
    .eq("id", id);
  if (error) throw new Error(error.message);
  refreshDecisionSupport();
}

export async function transitionMaintenanceWarrantyClaim(claimId: string, formData: FormData): Promise<void> {
  const profile = await requireWriteRole();
  const id = recordId(claimId, "Warranty claim");
  const nextStatus = String(formData.get("to_status") ?? "");
  if (!isWarrantyClaimStatus(nextStatus)) throw new Error("Warranty status geçersiz.");
  const supabase = await createClient();
  const { data: current, error: readError } = await supabase.from("maintenance_warranty_claims")
    .select("status")
    .eq("organization_id", profile.organization_id)
    .eq("id", id)
    .single();
  if (readError) throw new Error(readError.message);
  if (!isWarrantyClaimStatus(current.status) || !canTransitionWarrantyClaim(current.status, nextStatus)) {
    throw new Error("Warranty status geçişine izin verilmiyor.");
  }
  const { error } = await supabase.rpc("transition_maintenance_warranty_claim", {
    p_claim_id: id,
    p_to_status: nextStatus,
    p_notes: String(formData.get("notes") ?? "").trim() || null,
  });
  if (error) throw new Error(error.message);
  refreshDecisionSupport();
}
