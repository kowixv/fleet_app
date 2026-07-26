import { createReviewDraftData, type ServiceDefault, type VehicleOption } from "@/lib/maintenance-invoice-review";
import { parseMaintenanceInvoice } from "@/lib/maintenance-invoice";
import { maintenanceLog } from "@/lib/maintenance/observability";
import { parseMaintenanceInvoiceJobs } from "@/lib/maintenance/validators";
import { maintenanceVisibleVehicleStatuses } from "@/lib/maintenance-vehicle-status";
import { safeEqual, secretMisconfigured } from "@/lib/secure";
import { createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 300;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secretMisconfigured(secret)) return false;
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  return safeEqual(token, secret);
}

async function processJobs(request: Request) {
  if (!process.env.CRON_SECRET || secretMisconfigured(process.env.CRON_SECRET)) {
    return new Response("server misconfigured", { status: 500 });
  }
  if (!authorized(request)) return new Response("unauthorized", { status: 401 });

  const service = createServiceClient();
  const claim = await service.rpc("claim_maintenance_invoice_jobs", {
    p_limit: 5,
    p_lease_seconds: 240,
  });
  if (claim.error) {
    maintenanceLog("error", "invoice_worker_claim_failed", { error_code: claim.error.code });
    return Response.json({ ok: false, error: claim.error.message }, { status: 500 });
  }

  let jobs;
  try {
    jobs = parseMaintenanceInvoiceJobs(claim.data);
  } catch (error) {
    maintenanceLog("error", "invoice_worker_claim_payload_invalid");
    return Response.json({
      ok: false,
      error: error instanceof Error ? error.message : "Invalid claim payload.",
    }, { status: 500 });
  }

  const results: Array<{ invoiceId: string; status: string }> = [];
  for (const job of jobs) {
    maintenanceLog("info", "invoice_processing_started", {
      organization_id: job.organization_id,
      invoice_id: job.id,
      attempt: job.retry_count,
    });
    try {
      const download = await service.storage
        .from("maintenance-invoices")
        .download(job.storage_path);
      if (download.error) throw new Error(download.error.message);
      const bytes = new Uint8Array(await download.data.arrayBuffer());
      const marked = await service.rpc("mark_maintenance_invoice_job_parsing", {
        p_invoice_id: job.id,
        p_lease_token: job.lease_token,
      });
      if (marked.error || marked.data !== true) throw new Error(marked.error?.message ?? "Invoice lease expired.");

      const [{ parsed, rawText, parser }, vehiclesResult, defaultsResult] = await Promise.all([
        parseMaintenanceInvoice(bytes),
        service
          .from("vehicles")
          .select("id, unit_number, current_mileage")
          .eq("organization_id", job.organization_id)
          .in("status", maintenanceVisibleVehicleStatuses())
          .order("unit_number"),
        service
          .from("maintenance_service_defaults")
          .select("service_key, service_type, default_mode, interval_type, interval_miles, interval_days")
          .eq("organization_id", job.organization_id),
      ]);
      if (vehiclesResult.error) throw new Error(vehiclesResult.error.message);
      if (defaultsResult.error) throw new Error(defaultsResult.error.message);

      const vehicles: VehicleOption[] = vehiclesResult.data ?? [];
      const defaults: ServiceDefault[] = defaultsResult.data ?? [];
      const review = createReviewDraftData({
        organizationId: job.organization_id,
        parsed,
        parser,
        vehicles,
        defaults,
      });
      const complete = await service.rpc("complete_maintenance_invoice_job", {
        p_invoice_id: job.id,
        p_lease_token: job.lease_token,
        p_payload: {
          vehicle_id: review.suggested_vehicle_id,
          invoice_number: parsed.invoice_number,
          invoice_date: parsed.invoice_date,
          shop_name: parsed.shop_name,
          raw_text: rawText,
          parsed_data: { parsed, review },
          parser_confidence: parser.confidence,
          parser_warnings: review.warnings,
        },
      });
      if (complete.error || complete.data !== true) {
        throw new Error(complete.error?.message ?? "Invoice lease expired before completion.");
      }
      maintenanceLog("info", "invoice_processing_completed", {
        organization_id: job.organization_id,
        invoice_id: job.id,
        parser_source: parser.source,
        service_count: parsed.services.length,
      });
      results.push({ invoiceId: job.id, status: "pending_review" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invoice processing failed.";
      const failed = await service.rpc("fail_maintenance_invoice_job", {
        p_invoice_id: job.id,
        p_lease_token: job.lease_token,
        p_error: message,
        p_retryable: true,
      });
      maintenanceLog("error", "invoice_processing_failed", {
        organization_id: job.organization_id,
        invoice_id: job.id,
        attempt: job.retry_count,
        next_status: typeof failed.data === "string" ? failed.data : "unknown",
      });
      results.push({
        invoiceId: job.id,
        status: typeof failed.data === "string" ? failed.data : "failed",
      });
    }
  }

  return Response.json({ ok: true, claimed: jobs.length, results });
}

export async function GET(request: Request) {
  return processJobs(request);
}

export async function POST(request: Request) {
  return processJobs(request);
}
