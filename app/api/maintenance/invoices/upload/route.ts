import { requireWriteRole } from "@/lib/auth";
import { maintenanceInvoiceHash } from "@/lib/maintenance-invoice";
import {
  hasPdfMagicBytes,
  maintenanceInvoiceMaxBytes,
  validateMaintenanceInvoiceFileMeta,
} from "@/lib/maintenance-invoice-upload";
import { maintenanceLog } from "@/lib/maintenance/observability";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
const MAX_MAINTENANCE_INVOICE_BYTES = maintenanceInvoiceMaxBytes(process.env.MAINTENANCE_INVOICE_MAX_BYTES);

export async function POST(request: Request) {
  const profile = await requireWriteRole();
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ ok: false, error: "PDF dosyası gerekli." }, { status: 400 });
  }
  const fileError = validateMaintenanceInvoiceFileMeta(file, MAX_MAINTENANCE_INVOICE_BYTES);
  if (fileError) return Response.json({ ok: false, error: fileError }, { status: 400 });

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!hasPdfMagicBytes(bytes)) {
    return Response.json({ ok: false, error: "PDF imzası geçersiz." }, { status: 400 });
  }

  const hash = maintenanceInvoiceHash(bytes);
  const supabase = await createClient();
  const service = createServiceClient();
  const duplicateResult = await supabase
    .from("maintenance_invoices")
    .select("id, pipeline_status, file_name")
    .eq("organization_id", profile.organization_id)
    .eq("file_hash", hash)
    .maybeSingle();
  if (duplicateResult.error) {
    return Response.json({ ok: false, error: duplicateResult.error.message }, { status: 500 });
  }
  if (duplicateResult.data) {
    return Response.json({
      ok: false,
      duplicate: true,
      status: duplicateResult.data.pipeline_status,
      invoiceId: duplicateResult.data.id,
      error: `Bu PDF daha önce yüklendi: ${duplicateResult.data.file_name ?? duplicateResult.data.id}`,
    }, { status: 409 });
  }

  const storagePath = `${profile.organization_id}/${hash}.pdf`;
  const upload = await service.storage
    .from("maintenance-invoices")
    .upload(storagePath, bytes, { contentType: "application/pdf", upsert: false });
  if (upload.error) {
    const concurrent = await supabase
      .from("maintenance_invoices")
      .select("id, pipeline_status")
      .eq("organization_id", profile.organization_id)
      .eq("file_hash", hash)
      .maybeSingle();
    if (concurrent.data) {
      return Response.json({
        ok: false,
        duplicate: true,
        status: concurrent.data.pipeline_status,
        invoiceId: concurrent.data.id,
        error: "Bu PDF daha önce yüklendi.",
      }, { status: 409 });
    }
    return Response.json({ ok: false, error: upload.error.message }, { status: 500 });
  }

  const insert = await supabase
    .from("maintenance_invoices")
    .insert({
      organization_id: profile.organization_id,
      file_name: file.name.slice(0, 255),
      storage_path: storagePath,
      file_hash: hash,
      parsed_data: {},
      parser_warnings: [],
      status: "failed",
      pipeline_status: "queued",
      queued_at: new Date().toISOString(),
      next_attempt_at: new Date().toISOString(),
      created_by: profile.id,
    })
    .select("id, pipeline_status")
    .single();

  if (insert.error) {
    await service.storage.from("maintenance-invoices").remove([storagePath]);
    const concurrent = await supabase
      .from("maintenance_invoices")
      .select("id, pipeline_status")
      .eq("organization_id", profile.organization_id)
      .eq("file_hash", hash)
      .maybeSingle();
    if (concurrent.data) {
      return Response.json({
        ok: false,
        duplicate: true,
        status: concurrent.data.pipeline_status,
        invoiceId: concurrent.data.id,
        error: "Bu PDF daha önce yüklendi.",
      }, { status: 409 });
    }
    maintenanceLog("error", "invoice_upload_enqueue_failed", {
      organization_id: profile.organization_id,
      error_code: insert.error.code,
    });
    return Response.json({ ok: false, error: insert.error.message }, { status: 500 });
  }

  maintenanceLog("info", "invoice_uploaded_and_queued", {
    organization_id: profile.organization_id,
    invoice_id: insert.data.id,
    size_bytes: bytes.byteLength,
  });
  return Response.json({
    ok: true,
    invoiceId: insert.data.id,
    status: insert.data.pipeline_status,
  }, { status: 202 });
}
