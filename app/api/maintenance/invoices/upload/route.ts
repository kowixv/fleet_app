import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requireWriteRole } from "@/lib/auth";
import {
  createReviewDraftData,
  type ServiceDefault,
  type VehicleOption,
} from "@/lib/maintenance-invoice-review";
import { maintenanceInvoiceHash, parseMaintenanceInvoice } from "@/lib/maintenance-invoice";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const profile = await requireWriteRole();
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ ok: false, error: "PDF dosyası gerekli." }, { status: 400 });
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    return Response.json({ ok: false, error: "Sadece PDF kabul edilir." }, { status: 400 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength === 0) return Response.json({ ok: false, error: "PDF boş." }, { status: 400 });
  if (bytes.byteLength > 20 * 1024 * 1024) {
    return Response.json({ ok: false, error: "PDF 20 MB'dan büyük olamaz." }, { status: 400 });
  }

  const hash = maintenanceInvoiceHash(bytes);
  const supabase = await createClient();
  const service = createServiceClient();

  const { data: duplicate, error: duplicateError } = await supabase
    .from("maintenance_invoices")
    .select("id, status, file_name")
    .eq("organization_id", profile.organization_id)
    .eq("file_hash", hash)
    .maybeSingle();
  if (duplicateError) return Response.json({ ok: false, error: duplicateError.message }, { status: 500 });
  if (duplicate) {
    return Response.json({
      ok: false,
      duplicate: true,
      status: "duplicate",
      invoiceId: duplicate.id,
      error: `Bu PDF daha önce yüklendi: ${duplicate.file_name ?? duplicate.id}`,
    }, { status: 409 });
  }

  const storagePath = `${profile.organization_id}/${hash}.pdf`;
  const upload = await service.storage
    .from("maintenance-invoices")
    .upload(storagePath, bytes, { contentType: "application/pdf", upsert: false });
  if (upload.error) return Response.json({ ok: false, error: upload.error.message }, { status: 500 });

  try {
    const [{ parsed, rawText, parser }, vehiclesRes, defaultsRes] = await Promise.all([
      parseMaintenanceInvoice(bytes),
      supabase
        .from("vehicles")
        .select("id, unit_number, current_mileage")
        .eq("status", "active")
        .order("unit_number"),
      supabase
        .from("maintenance_service_defaults")
        .select("service_key, service_type, default_mode, interval_type, interval_miles, interval_days"),
    ]);

    if (vehiclesRes.error) throw new Error(vehiclesRes.error.message);
    if (defaultsRes.error) throw new Error(defaultsRes.error.message);

    const review = createReviewDraftData({
      organizationId: profile.organization_id,
      parsed,
      parser,
      vehicles: (vehiclesRes.data ?? []) as VehicleOption[],
      defaults: (defaultsRes.data ?? []) as ServiceDefault[],
    });

    const insert = await service
      .from("maintenance_invoices")
      .insert({
        organization_id: profile.organization_id,
        vehicle_id: review.suggested_vehicle_id,
        invoice_number: parsed.invoice_number,
        invoice_date: parsed.invoice_date,
        shop_name: parsed.shop_name,
        file_name: file.name,
        storage_path: storagePath,
        file_hash: hash,
        raw_text: rawText,
        parsed_data: { parsed, review },
        parser_confidence: parser.confidence,
        parser_warnings: review.warnings,
        status: "pending_review",
        created_by: profile.id,
      })
      .select("id")
      .single();

    if (insert.error) throw new Error(insert.error.message);
    return Response.json({ ok: true, invoiceId: insert.data.id, status: "pending_review" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await service
      .from("maintenance_invoices")
      .insert({
        organization_id: profile.organization_id,
        file_name: file.name,
        storage_path: storagePath,
        file_hash: hash,
        parsed_data: {},
        parser_warnings: [message],
        status: "failed",
        created_by: profile.id,
      });
    return Response.json({ ok: false, error: message }, { status: 422 });
  }
}
