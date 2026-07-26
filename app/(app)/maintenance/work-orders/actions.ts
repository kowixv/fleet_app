"use server";

import { requireWriteRole } from "@/lib/auth";
import {
  assertWorkOrderTransition,
  canTransitionWorkOrderPart,
  canTransitionWorkOrderTask,
  isWorkOrderPartStatus,
  isWorkOrderStatus,
  isWorkOrderTaskStatus,
  parseWorkOrderCreateForm,
  parseWorkOrderDetailsForm,
  parseWorkOrderPartForm,
  parseWorkOrderTaskForm,
} from "@/lib/maintenance-work-orders";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { maintenanceLog } from "@/lib/maintenance/observability";

function refresh(id?: string) {
  revalidatePath("/maintenance");
  revalidatePath("/maintenance/work-orders");
  revalidatePath("/maintenance/calendar");
  revalidatePath("/maintenance/reminders");
  revalidatePath("/maintenance/inspections");
  if (id) revalidatePath(`/maintenance/work-orders/${id}`);
}

function id(value: FormDataEntryValue | null, label: string): string {
  const result = String(value ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(result)) throw new Error(`${label} geçersiz.`);
  return result;
}

export async function createMaintenanceWorkOrder(formData: FormData): Promise<void> {
  const profile = await requireWriteRole();
  const payload = parseWorkOrderCreateForm(formData);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_maintenance_work_order", { p_payload: payload });
  if (error) throw new Error(error.message);
  maintenanceLog("info", "work_order_created", {
    organization_id: profile.organization_id,
    work_order_id: data,
    source_type: payload.source_type,
  });
  refresh(data as string);
  redirect(`/maintenance/work-orders/${data as string}`);
}

export async function createMaintenanceWorkOrderInline(formData: FormData) {
  await requireWriteRole();
  const payload = parseWorkOrderCreateForm(formData);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_maintenance_work_order", { p_payload: payload });
  if (error) return { ok: false as const, error: error.message };
  maintenanceLog("info", "work_order_created", {
    work_order_id: data,
    source_type: payload.source_type,
  });
  refresh(data as string);
  return { ok: true as const, workOrderId: data as string };
}

export async function updateMaintenanceWorkOrder(workOrderId: string, formData: FormData): Promise<void> {
  const profile = await requireWriteRole();
  const workOrder = id(workOrderId, "Work order");
  const payload = parseWorkOrderDetailsForm(formData);
  const { estimated_cost: _estimate, approved_cost_limit: _approved, ...safePayload } = payload;
  const supabase = await createClient();
  const { error } = await supabase
    .from("maintenance_work_orders")
    .update(safePayload)
    .eq("organization_id", profile.organization_id)
    .eq("id", workOrder);
  if (error) throw new Error(error.message);
  refresh(workOrder);
}

export async function transitionMaintenanceWorkOrder(workOrderId: string, formData: FormData): Promise<void> {
  const profile = await requireWriteRole();
  const workOrder = id(workOrderId, "Work order");
  const toStatus = String(formData.get("to_status") ?? "");
  if (!isWorkOrderStatus(toStatus)) throw new Error("Hedef status geçersiz.");
  const supabase = await createClient();
  const { data: row, error: readError } = await supabase
    .from("maintenance_work_orders")
    .select("status")
    .eq("organization_id", profile.organization_id)
    .eq("id", workOrder)
    .single();
  if (readError) throw new Error(readError.message);
  assertWorkOrderTransition(row.status, toStatus);
  const { error } = await supabase.rpc("transition_maintenance_work_order", {
    p_work_order_id: workOrder,
    p_to_status: toStatus,
    p_notes: String(formData.get("notes") ?? "").trim() || null,
  });
  if (error) throw new Error(error.message);
  maintenanceLog("info", "work_order_transitioned", {
    organization_id: profile.organization_id,
    work_order_id: workOrder,
    from_status: row.status,
    to_status: toStatus,
  });
  refresh(workOrder);
}

export async function submitWorkOrderEstimate(workOrderId: string, formData: FormData): Promise<void> {
  await requireWriteRole();
  const workOrder = id(workOrderId, "Work order");
  const amount = Number(String(formData.get("estimated_cost") ?? "").replace(/,/g, ""));
  if (!Number.isFinite(amount) || amount < 0) throw new Error("Geçerli bir tahmini tutar gerekli.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_maintenance_work_order_estimate", {
    p_work_order_id: workOrder,
    p_estimated_cost: Math.round(amount * 100) / 100,
    p_notes: String(formData.get("notes") ?? "").trim() || null,
  });
  if (error) throw new Error(error.message);
  refresh(workOrder);
}

export async function decideWorkOrderApproval(workOrderId: string, formData: FormData): Promise<void> {
  await requireWriteRole();
  const workOrder = id(workOrderId, "Work order");
  const decision = String(formData.get("decision") ?? "");
  if (!["approved", "rejected"].includes(decision)) throw new Error("Onay kararı geçersiz.");
  const rawAmount = String(formData.get("approved_amount") ?? "").trim();
  const amount = rawAmount ? Number(rawAmount.replace(/,/g, "")) : null;
  if (amount != null && (!Number.isFinite(amount) || amount < 0)) throw new Error("Onay tutarı geçersiz.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("decide_maintenance_work_order_approval", {
    p_work_order_id: workOrder,
    p_decision: decision,
    p_approved_amount: amount,
    p_notes: String(formData.get("notes") ?? "").trim() || null,
    p_rejection_reason: String(formData.get("rejection_reason") ?? "").trim() || null,
  });
  if (error) throw new Error(error.message);
  refresh(workOrder);
}

export async function addWorkOrderTask(workOrderId: string, formData: FormData): Promise<void> {
  const profile = await requireWriteRole();
  const workOrder = id(workOrderId, "Work order");
  const payload = parseWorkOrderTaskForm(formData);
  const supabase = await createClient();
  const { error } = await supabase.from("maintenance_work_order_tasks").insert({
    ...payload,
    organization_id: profile.organization_id,
    work_order_id: workOrder,
    created_by: profile.id,
  });
  if (error) throw new Error(error.message);
  refresh(workOrder);
}

export async function transitionWorkOrderTask(workOrderId: string, taskId: string, formData: FormData): Promise<void> {
  const profile = await requireWriteRole();
  const workOrder = id(workOrderId, "Work order");
  const task = id(taskId, "Task");
  const toStatus = String(formData.get("status") ?? "");
  if (!isWorkOrderTaskStatus(toStatus)) throw new Error("Task status geçersiz.");
  const supabase = await createClient();
  const { data: row, error: readError } = await supabase.from("maintenance_work_order_tasks")
    .select("status").eq("organization_id", profile.organization_id).eq("work_order_id", workOrder).eq("id", task).single();
  if (readError) throw new Error(readError.message);
  if (!isWorkOrderTaskStatus(row.status) || !canTransitionWorkOrderTask(row.status, toStatus)) {
    throw new Error("Task status geçişine izin verilmiyor.");
  }
  const { error } = await supabase.from("maintenance_work_order_tasks")
    .update({ status: toStatus }).eq("organization_id", profile.organization_id).eq("work_order_id", workOrder).eq("id", task);
  if (error) throw new Error(error.message);
  refresh(workOrder);
}

export async function addWorkOrderPart(workOrderId: string, formData: FormData): Promise<void> {
  const profile = await requireWriteRole();
  const workOrder = id(workOrderId, "Work order");
  const payload = parseWorkOrderPartForm(formData);
  const supabase = await createClient();
  const { error } = await supabase.from("maintenance_work_order_parts").insert({
    ...payload,
    organization_id: profile.organization_id,
    work_order_id: workOrder,
    created_by: profile.id,
  });
  if (error) throw new Error(error.message);
  refresh(workOrder);
}

export async function transitionWorkOrderPart(workOrderId: string, partId: string, formData: FormData): Promise<void> {
  const profile = await requireWriteRole();
  const workOrder = id(workOrderId, "Work order");
  const part = id(partId, "Parça");
  const toStatus = String(formData.get("status") ?? "");
  if (!isWorkOrderPartStatus(toStatus)) throw new Error("Parça status geçersiz.");
  const supabase = await createClient();
  const { data: row, error: readError } = await supabase.from("maintenance_work_order_parts")
    .select("status").eq("organization_id", profile.organization_id).eq("work_order_id", workOrder).eq("id", part).single();
  if (readError) throw new Error(readError.message);
  if (!isWorkOrderPartStatus(row.status) || !canTransitionWorkOrderPart(row.status, toStatus)) {
    throw new Error("Parça status geçişine izin verilmiyor.");
  }
  const patch = { status: toStatus, core_returned: formData.get("core_returned") === "on" };
  const { error } = await supabase.from("maintenance_work_order_parts")
    .update(patch).eq("organization_id", profile.organization_id).eq("work_order_id", workOrder).eq("id", part);
  if (error) throw new Error(error.message);
  refresh(workOrder);
}
