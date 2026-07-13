"use server";

import { requireWriteRole } from "@/lib/auth";
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
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_vehicle_inspection_draft", {
    p_inspection_id: inspectionId,
    p_payload: payload,
  });
  if (error) return { ok: false as const, error: error.message };
  revalidateInspectionPaths();
  return { ok: true as const };
}

export async function completeVehicleInspection(inspectionId: string, payload: unknown) {
  await requireWriteRole();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("complete_vehicle_inspection", {
    p_inspection_id: inspectionId,
    p_payload: payload,
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

export async function signedInspectionFileUrl(storagePath: string) {
  await requireWriteRole();
  if (!storagePath) return { ok: false as const, error: "Storage path is required." };
  const service = createServiceClient();
  const { data, error } = await service.storage
    .from("inspection-files")
    .createSignedUrl(storagePath, 60 * 10);
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const, url: data.signedUrl };
}
