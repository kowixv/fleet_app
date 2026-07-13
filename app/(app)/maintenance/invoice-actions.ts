"use server";

import { revalidatePath } from "next/cache";
import { requireWriteRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

function revalidateMaintenanceInvoicePaths(id?: string) {
  revalidatePath("/maintenance");
  if (id) revalidatePath(`/maintenance/invoices/${id}`);
  revalidatePath("/");
}

export async function finalizeMaintenanceInvoiceReview(invoiceId: string, payload: unknown) {
  await requireWriteRole();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("finalize_maintenance_invoice_review", {
    p_invoice_id: invoiceId,
    p_payload: payload,
  });
  if (error) return { ok: false as const, error: error.message };
  revalidateMaintenanceInvoicePaths(invoiceId);
  return { ok: true as const, invoiceId: data as string };
}

export async function cancelMaintenanceInvoiceReview(invoiceId: string) {
  const profile = await requireWriteRole();
  const supabase = await createClient();
  const { error } = await supabase
    .from("maintenance_invoices")
    .update({
      status: "cancelled",
      cancelled_by: profile.id,
      cancelled_at: new Date().toISOString(),
    })
    .eq("id", invoiceId)
    .eq("status", "pending_review");
  if (error) return { ok: false as const, error: error.message };
  revalidateMaintenanceInvoicePaths(invoiceId);
  return { ok: true as const };
}

export async function undoMaintenanceInvoiceImport(invoiceId: string) {
  await requireWriteRole();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("undo_maintenance_invoice_import", {
    p_invoice_id: invoiceId,
  });
  if (error) return { ok: false as const, error: error.message };
  revalidateMaintenanceInvoicePaths(invoiceId);
  return { ok: true as const, result: data };
}
