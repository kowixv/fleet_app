"use server";

import { requireProfile, requireWriteRole } from "@/lib/auth";
import { parseInspectionDraftPayload, parseInspectionDraftResults } from "@/lib/inspection-draft";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

function revalidateInspectionPaths() {
  revalidatePath("/maintenance");
  revalidatePath("/maintenance/inspections");
  revalidatePath("/maintenance/units");
  revalidatePath("/vehicles");
  revalidatePath("/");
}

export async function startVehicleInspection(input: {
  vehicleId: string;
  templateId: string;
  maintenanceRuleId?: string | null;
  maintenanceRecordId?: string | null;
}) {
  await requireWriteRole();
  if (!input.vehicleId || !input.templateId) {
    return { ok: false as const, error: "Vehicle and checklist template are required." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("start_vehicle_inspection", {
    p_vehicle_id: input.vehicleId,
    p_template_id: input.templateId,
    p_maintenance_rule_id: input.maintenanceRuleId ?? null,
    p_maintenance_record_id: input.maintenanceRecordId ?? null,
  });
  if (error) return { ok: false as const, error: error.message };
  revalidateInspectionPaths();
  return { ok: true as const, inspectionId: data as string };
}

export async function saveVehicleInspectionDraft(inspectionId: string, payload: unknown) {
  await requireWriteRole();
  if (!inspectionId) return { ok: false as const, error: "Inspection taslağı gerekli." };
  let parsedPayload;
  try {
    parsedPayload = parseInspectionDraftPayload(payload);
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "Inspection taslağı geçersiz." };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_vehicle_inspection_draft", {
    p_inspection_id: inspectionId,
    p_payload: parsedPayload,
  });
  if (error) return { ok: false as const, error: error.message };
  const { data: inspection, error: readError } = await supabase
    .from("vehicle_inspections")
    .select("updated_at")
    .eq("id", inspectionId)
    .maybeSingle();
  if (readError) return { ok: false as const, error: readError.message };
  revalidateInspectionPaths();
  return { ok: true as const, updatedAt: inspection?.updated_at as string | null };
}

export async function loadVehicleInspectionDraft(inspectionId: string) {
  await requireWriteRole();
  if (!inspectionId) return { ok: false as const, error: "Inspection taslagi gerekli." };
  const supabase = await createClient();
  const [inspectionRes, resultsRes] = await Promise.all([
    supabase
      .from("vehicle_inspections")
      .select("id, vehicle_id, template_id, inspection_type, inspection_date, inspector, shop, notes, maintenance_rule_id, mark_rule_serviced, updated_at")
      .eq("id", inspectionId)
      .eq("status", "draft")
      .maybeSingle(),
    supabase
      .from("vehicle_inspection_results")
      .select("template_item_id, value_text, value_number, value_bool, passed, notes, photo_storage_path")
      .eq("inspection_id", inspectionId),
  ]);
  const error = inspectionRes.error ?? resultsRes.error;
  if (error) return { ok: false as const, error: error.message };
  if (!inspectionRes.data) return { ok: false as const, error: "Taslak bulunamadi." };
  let results;
  try {
    results = parseInspectionDraftResults(resultsRes.data ?? []);
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "Inspection sonuçları geçersiz." };
  }
  return {
    ok: true as const,
    draft: inspectionRes.data,
    results,
  };
}

export async function completeVehicleInspection(inspectionId: string, payload: unknown) {
  await requireWriteRole();
  if (!inspectionId) return { ok: false as const, error: "Inspection taslağı gerekli." };
  let parsedPayload;
  try {
    parsedPayload = parseInspectionDraftPayload(payload);
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "Inspection sonucu geçersiz." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("complete_vehicle_inspection", {
    p_inspection_id: inspectionId,
    p_payload: parsedPayload,
  });
  if (error) return { ok: false as const, error: error.message };
  revalidateInspectionPaths();
  return { ok: true as const, inspectionId: data as string };
}

export async function cloneInspectionTemplate(templateId: string, name: string) {
  await requireWriteRole();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("clone_inspection_template", {
    p_template_id: templateId,
    p_name: name,
  });
  if (error) return { ok: false as const, error: error.message };
  revalidatePath("/maintenance");
  revalidatePath("/maintenance/settings");
  revalidatePath("/maintenance/inspections");
  return { ok: true as const, templateId: data as string };
}

export async function createInspectionWorkOrderDraft(findingId: string, notes: string) {
  await requireWriteRole();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_inspection_work_order_draft", {
    p_finding_id: findingId,
    p_notes: notes,
  });
  if (error) return { ok: false as const, error: error.message };
  revalidateInspectionPaths();
  return { ok: true as const, findingId: data as string };
}

export async function signedInspectionFileUrl(resultId: string) {
  const profile = await requireProfile();
  if (!resultId) return { ok: false as const, error: "Inspection attachment is required." };
  const supabase = await createClient();
  const { data: result, error: rowError } = await supabase
    .from("vehicle_inspection_results")
    .select("photo_storage_path")
    .eq("id", resultId)
    .eq("organization_id", profile.organization_id)
    .maybeSingle();
  if (rowError) return { ok: false as const, error: rowError.message };
  if (!result?.photo_storage_path) return { ok: false as const, error: "Inspection file not found." };
  const service = createServiceClient();
  const { data, error } = await service.storage
    .from("inspection-files")
    .createSignedUrl(result.photo_storage_path, 60 * 10);
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const, url: data.signedUrl };
}

export async function clearVehicleDispatchHold(formData: FormData) {
  await requireWriteRole();
  const holdId = String(formData.get("hold_id") ?? "").trim();
  const notes = String(formData.get("clearance_notes") ?? "").trim();
  if (!holdId) return { ok: false as const, error: "Dispatch hold gerekli." };
  if (notes.length < 3) return { ok: false as const, error: "Temizleme notu en az 3 karakter olmalı." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("clear_vehicle_dispatch_hold", {
    p_hold_id: holdId,
    p_clearance_notes: notes,
  });
  if (error) return { ok: false as const, error: error.message };
  revalidateInspectionPaths();
  return { ok: true as const, holdId: data as string };
}
