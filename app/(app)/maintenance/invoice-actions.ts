"use server";

import { requireWriteRole } from "@/lib/auth";
import { revalidateMaintenance } from "@/lib/maintenance/cache";
import { parseMaintenanceRpcPayload } from "@/lib/maintenance/validators";
import { createClient } from "@/lib/supabase/server";

export async function finalizeMaintenanceInvoiceReview(invoiceId: string, payload: unknown) {
  await requireWriteRole();
  try {
    const validated = parseMaintenanceRpcPayload(payload, "Invoice inceleme verisi", ["records", "services"]);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("finalize_maintenance_invoice_review", {
      p_invoice_id: invoiceId,
      p_payload: validated,
    });
    if (error) return { ok: false as const, error: error.message };
    revalidateMaintenance({ kind: "invoice", id: invoiceId });
    return { ok: true as const, invoiceId: String(data) };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "Invoice verisi geçersiz." };
  }
}

export async function cancelMaintenanceInvoiceReview(invoiceId: string) {
  const profile = await requireWriteRole();
  const supabase = await createClient();
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("maintenance_invoices")
    .update({
      status: "cancelled",
      pipeline_status: "cancelled",
      cancelled_by: profile.id,
      cancelled_at: now,
      lease_token: null,
      lease_expires_at: null,
      next_attempt_at: null,
    })
    .eq("organization_id", profile.organization_id)
    .eq("id", invoiceId)
    .eq("pipeline_status", "pending_review");
  if (error) return { ok: false as const, error: error.message };
  revalidateMaintenance({ kind: "invoice", id: invoiceId });
  return { ok: true as const };
}

export async function retryMaintenanceInvoiceProcessing(invoiceId: string) {
  const profile = await requireWriteRole();
  if (!invoiceId) return { ok: false as const, error: "Invoice gerekli." };
  const now = new Date().toISOString();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("maintenance_invoices")
    .update({
      pipeline_status: "queued",
      retry_count: 0,
      last_error: null,
      next_attempt_at: now,
      queued_at: now,
      processed_at: null,
      processing_started_at: null,
      lease_token: null,
      lease_expires_at: null,
    })
    .eq("organization_id", profile.organization_id)
    .eq("id", invoiceId)
    .eq("pipeline_status", "failed")
    .is("lease_token", null)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false as const, error: error.message };
  if (!data) return { ok: false as const, error: "Invoice retry için uygun değil." };
  revalidateMaintenance({ kind: "invoice", id: invoiceId });
  return { ok: true as const };
}

export async function undoMaintenanceInvoiceImport(invoiceId: string) {
  await requireWriteRole();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("undo_maintenance_invoice_import", {
    p_invoice_id: invoiceId,
  });
  if (error) return { ok: false as const, error: error.message };
  await supabase
    .from("maintenance_invoices")
    .update({ pipeline_status: "pending_review" })
    .eq("id", invoiceId)
    .eq("status", "pending_review");
  revalidateMaintenance({ kind: "invoice", id: invoiceId });
  return { ok: true as const, result: data };
}

export async function finalizeBulkMaintenanceInvoiceUnit(payload: unknown) {
  await requireWriteRole();
  try {
    const validated = parseMaintenanceRpcPayload(payload, "Toplu invoice verisi", ["records"]);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("finalize_bulk_maintenance_invoice_unit", {
      p_payload: validated,
    });
    if (error) return { ok: false as const, error: error.message };
    revalidateMaintenance({ kind: "invoice" });
    return { ok: true as const, result: data };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "Toplu invoice verisi geçersiz." };
  }
}

export async function undoBulkMaintenanceInvoiceBatch(batchId: string) {
  await requireWriteRole();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("undo_bulk_maintenance_invoice_batch", {
    p_batch_id: batchId,
  });
  if (error) return { ok: false as const, error: error.message };
  revalidateMaintenance({ kind: "invoice" });
  return { ok: true as const, result: data };
}
