import { NextResponse } from "next/server";
import { requireAmazonImportActor } from "@/lib/amazon-statements/server/auth";
import { createClient } from "@/lib/supabase/server";
import { renderAmazonStatementPdf } from "@/lib/amazon-statements/pdf/statement-template-registry";
import {
  candidatePdfModel,
  type CandidatePdfContext,
  type CandidatePdfFuelDetail,
  type CandidatePdfRevenueDetail,
} from "@/lib/amazon-statements/pdf/candidate-pdf-model";
import { resolveStatementCompanyIdentity } from "@/lib/amazon-statements/pdf/statement-company-identity";
import { resolveStatementRoute } from "@/lib/amazon-statements/pdf/statement-route-display";

export const dynamic = "force-dynamic";

type DbRow = Record<string, unknown>;

export async function GET(_request: Request, { params }: { params: Promise<{ candidateId: string }> }) {
  const actor = await requireAmazonImportActor();
  const { candidateId } = await params;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("amazon_statement_candidates")
    .select("id, organization_id, batch_id, statement_type, status, period_start, period_end, payee_id, people!amazon_statement_candidates_payee_same_org_fk(full_name), vehicle_id, vehicles!amazon_statement_candidates_vehicle_same_org_fk(unit_number), template_version, calculation_rule_version, source_revision, preview_revision, configuration_snapshot, calculation_snapshot, gross_amount, percentage_deductions_amount, fixed_deductions_amount, fuel_deductions_amount, other_deductions_amount, total_deductions_amount, net_amount, converted_settlement_id")
    .eq("organization_id", actor.organizationId)
    .eq("id", candidateId)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Statement candidate is not available." }, { status: 404 });
  }

  let detailedContext: CandidatePdfContext | null = null;
  try {
    detailedContext = await loadCandidatePdfContext({
      supabase,
      organizationId: actor.organizationId,
      batchId: String(data.batch_id),
      candidateId,
    });
  } catch (contextError) {
    console.warn("Amazon statement PDF detail hydration failed; using saved calculation snapshot", {
      candidateId,
      organizationId: actor.organizationId,
      error: contextError instanceof Error ? contextError.message : String(contextError),
    });
  }

  try {
    const model = candidatePdfModel(data as DbRow, detailedContext ?? {});
    const pdf = await renderAmazonStatementPdf(model);
    return statementPdfResponse(pdf, data as DbRow, model.candidateStatus, detailedContext ? "canonical-details" : "snapshot-fallback");
  } catch (primaryRenderError) {
    if (detailedContext) {
      try {
        const fallbackModel = candidatePdfModel(data as DbRow, {});
        const fallbackPdf = await renderAmazonStatementPdf(fallbackModel);
        console.warn("Amazon statement PDF rendered from saved calculation snapshot after detailed render failure", {
          candidateId,
          organizationId: actor.organizationId,
          error: primaryRenderError instanceof Error ? primaryRenderError.message : String(primaryRenderError),
        });
        return statementPdfResponse(fallbackPdf, data as DbRow, fallbackModel.candidateStatus, "snapshot-fallback");
      } catch (fallbackRenderError) {
        console.error("Amazon statement PDF preview failed in detailed and fallback modes", {
          candidateId,
          organizationId: actor.organizationId,
          detailedError: primaryRenderError instanceof Error ? primaryRenderError.message : String(primaryRenderError),
          fallbackError: fallbackRenderError instanceof Error ? fallbackRenderError.message : String(fallbackRenderError),
        });
      }
    } else {
      console.error("Amazon statement PDF snapshot fallback failed", {
        candidateId,
        organizationId: actor.organizationId,
        error: primaryRenderError instanceof Error ? primaryRenderError.message : String(primaryRenderError),
      });
    }

    return NextResponse.json(
      {
        error: "Statement PDF could not be generated from the saved candidate snapshot.",
        code: "statement_pdf_render_failed",
      },
      { status: 422 },
    );
  }
}

function statementPdfResponse(
  pdf: Uint8Array | Buffer,
  candidate: DbRow,
  candidateStatus: string,
  detailMode: "canonical-details" | "snapshot-fallback",
) {
  const filename = safeFilename(`amazon-statement-${String(candidate.id).slice(0, 8)}-${candidateStatus}.pdf`);
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "private, no-store",
      "X-Statement-Detail-Mode": detailMode,
    },
  });
}

async function loadCandidatePdfContext(args: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  organizationId: string;
  batchId: string;
  candidateId: string;
}): Promise<CandidatePdfContext> {
  const { supabase, organizationId, batchId, candidateId } = args;
  const [organizationResult, invoiceResult, candidateRevenueResult, candidateFuelResult] = await Promise.all([
    supabase
      .from("organizations")
      .select("name")
      .eq("id", organizationId)
      .maybeSingle(),
    supabase
      .from("amazon_payment_invoices")
      .select("invoice_number, invoice_date, payment_date, payment_status, carrier_identifier, created_at")
      .eq("organization_id", organizationId)
      .eq("batch_id", batchId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("amazon_statement_candidate_revenue")
      .select("id, revenue_item_id, allocated_gross_amount, display_order")
      .eq("organization_id", organizationId)
      .eq("candidate_id", candidateId)
      .order("display_order"),
    supabase
      .from("amazon_statement_candidate_fuel_lines")
      .select("id, transaction_line_id, allocated_amount, display_order")
      .eq("organization_id", organizationId)
      .eq("candidate_id", candidateId)
      .order("display_order"),
  ]);

  for (const result of [invoiceResult, candidateRevenueResult, candidateFuelResult]) {
    if (result.error) throw new Error(result.error.message);
  }

  const candidateRevenueRows = (candidateRevenueResult.data ?? []) as DbRow[];
  const candidateFuelRows = (candidateFuelResult.data ?? []) as DbRow[];
  const revenueItemIds = candidateRevenueRows.map((row) => String(row.revenue_item_id));
  const transactionLineIds = candidateFuelRows.map((row) => String(row.transaction_line_id));

  const revenueItemsResult = revenueItemIds.length > 0
    ? await supabase
      .from("amazon_revenue_items")
      .select("id, grouping_type, trip_id, primary_load_id, start_date, end_date, origin_facility_code, destination_facility_code, distance, base_amount, fuel_surcharge_amount, toll_amount, detention_amount, tonu_amount, other_amount, gross_amount")
      .eq("organization_id", organizationId)
      .eq("batch_id", batchId)
      .in("id", revenueItemIds)
    : { data: [], error: null };

  const fuelLinesResult = transactionLineIds.length > 0
    ? await supabase
      .from("fuel_import_transaction_lines")
      .select("id, transaction_id, product_type_raw, product_type_normalized, quantity, charged_unit_price, discount_amount, charged_amount, fuel_import_transactions!inner(transaction_at, invoice_number, merchant_raw, city_raw, state_raw, fuel_import_card_groups!inner(card_last_four))")
      .eq("organization_id", organizationId)
      .in("id", transactionLineIds)
    : { data: [], error: null };

  if (revenueItemsResult.error) throw new Error(revenueItemsResult.error.message);
  if (fuelLinesResult.error) throw new Error(fuelLinesResult.error.message);

  const revenueItems = (revenueItemsResult.data ?? []) as DbRow[];
  const facilityCodes = uniqueStrings(revenueItems.flatMap((row) => [
    stringOrNull(row.origin_facility_code),
    stringOrNull(row.destination_facility_code),
  ]));
  const facilityResult = facilityCodes.length > 0
    ? await supabase
      .from("amazon_facility_locations")
      .select("normalized_facility_code, city, state, effective_from, effective_to, verification_status")
      .eq("organization_id", organizationId)
      .eq("provider", "amazon")
      .in("normalized_facility_code", facilityCodes)
      .in("verification_status", ["manually_verified", "imported_verified"])
      .order("effective_from", { ascending: false })
    : { data: [], error: null };
  if (facilityResult.error) throw new Error(facilityResult.error.message);

  const revenueLines = buildRevenueDetails(
    candidateRevenueRows,
    revenueItems,
    (facilityResult.data ?? []) as DbRow[],
  );
  const fuelLines = buildFuelDetails(
    candidateFuelRows,
    (fuelLinesResult.data ?? []) as DbRow[],
  );
  const invoice = invoiceResult.data as DbRow | null;
  const carrierIdentifier = stringOrNull(invoice?.carrier_identifier);
  const identity = resolveStatementCompanyIdentity(
    stringOrNull((organizationResult.data as DbRow | null)?.name),
    carrierIdentifier,
  );

  return {
    companyName: identity.name,
    companySecondary: identity.secondary,
    invoiceMetadata: invoice ? {
      invoiceNumber: stringOrNull(invoice.invoice_number),
      invoiceDate: stringOrNull(invoice.invoice_date),
      paymentDate: stringOrNull(invoice.payment_date),
      paymentStatus: stringOrNull(invoice.payment_status),
    } : null,
    revenueLines,
    fuelLines,
  };
}

function buildRevenueDetails(
  candidateRows: DbRow[],
  revenueItems: DbRow[],
  facilityRows: DbRow[],
): CandidatePdfRevenueDetail[] {
  const itemById = new Map(revenueItems.map((item) => [String(item.id), item]));
  return candidateRows.map((candidateRow, index) => {
    const revenueItemId = String(candidateRow.revenue_item_id);
    const item = itemById.get(revenueItemId);
    if (!item) throw new Error(`Missing canonical revenue item ${revenueItemId}.`);
    const fullGross = numberValue(item.gross_amount);
    const allocatedGross = numberValue(candidateRow.allocated_gross_amount);
    const ratio = fullGross === 0 ? 1 : allocatedGross / fullGross;
    const startDate = stringOrNull(item.start_date);
    const endDate = stringOrNull(item.end_date);
    const serviceDate = endDate ?? startDate;
    const originCode = stringOrNull(item.origin_facility_code);
    const destinationCode = stringOrNull(item.destination_facility_code);
    const route = resolveStatementRoute({
      originCode,
      destinationCode,
      verifiedOrigin: resolveFacility(originCode, serviceDate, facilityRows),
      verifiedDestination: resolveFacility(destinationCode, serviceDate, facilityRows),
    });
    return {
      id: String(candidateRow.id ?? `candidate-revenue-${index + 1}`),
      sourceRevenueItemId: revenueItemId,
      displayOrder: integerValue(candidateRow.display_order, index + 1),
      tripId: stringOrNull(item.trip_id),
      loadId: stringOrNull(item.primary_load_id),
      date: serviceDate,
      startDate,
      endDate,
      status: "Completed",
      routeDisplay: route.display,
      routeVerified: route.displayReady,
      distance: nullableNumber(item.distance),
      baseAmount: scaledMoney(item.base_amount, ratio),
      fuelSurchargeAmount: scaledMoney(item.fuel_surcharge_amount, ratio),
      tollAmount: scaledMoney(item.toll_amount, ratio),
      detentionAmount: scaledMoney(item.detention_amount, ratio),
      tonuAmount: scaledMoney(item.tonu_amount, ratio),
      otherAmount: scaledMoney(item.other_amount, ratio),
      grossAmount: roundMoney(allocatedGross),
    };
  });
}

function buildFuelDetails(candidateRows: DbRow[], sourceLines: DbRow[]): CandidatePdfFuelDetail[] {
  const lineById = new Map(sourceLines.map((line) => [String(line.id), line]));
  let previousTransactionId: string | null = null;
  return candidateRows.map((candidateRow, index) => {
    const transactionLineId = String(candidateRow.transaction_line_id);
    const line = lineById.get(transactionLineId);
    if (!line) throw new Error(`Missing normalized fuel line ${transactionLineId}.`);
    const transaction = firstRelated(line.fuel_import_transactions);
    const cardGroup = firstRelated(transaction.fuel_import_card_groups);
    const transactionId = stringOrNull(line.transaction_id);
    const continuation = Boolean(transactionId && transactionId === previousTransactionId);
    previousTransactionId = transactionId;
    return {
      id: String(candidateRow.id ?? `candidate-fuel-${index + 1}`),
      sourceTransactionLineId: transactionLineId,
      displayOrder: integerValue(candidateRow.display_order, index + 1),
      date: stringOrNull(transaction.transaction_at),
      invoice: stringOrNull(transaction.invoice_number),
      merchant: stringOrNull(transaction.merchant_raw),
      location: cityState(transaction.city_raw, transaction.state_raw),
      product: stringOrNull(line.product_type_normalized) ?? stringOrNull(line.product_type_raw) ?? "FUEL",
      quantity: nullableNumber(line.quantity),
      chargedPpu: nullableNumber(line.charged_unit_price),
      discountAmount: nullableNumber(line.discount_amount),
      amount: roundMoney(numberValue(candidateRow.allocated_amount)),
      maskedCard: maskCard(stringOrNull(cardGroup.card_last_four)),
      continuation,
    };
  });
}

function resolveFacility(code: string | null, serviceDate: string | null, rows: DbRow[]): string | null {
  if (!code) return null;
  const normalized = code.trim().toUpperCase();
  const row = rows.find((candidate) => {
    if (String(candidate.normalized_facility_code ?? "").trim().toUpperCase() !== normalized) return false;
    if (!serviceDate) return true;
    const from = stringOrNull(candidate.effective_from);
    const to = stringOrNull(candidate.effective_to);
    return (!from || serviceDate >= from) && (!to || serviceDate < to);
  });
  return row ? cityState(row.city, row.state) : null;
}

function cityState(city: unknown, state: unknown): string | null {
  const cityValue = stringOrNull(city);
  const stateValue = stringOrNull(state);
  if (cityValue && stateValue) return `${cityValue}, ${stateValue}`;
  return cityValue ?? stateValue;
}

function maskCard(lastFour: string | null): string | null {
  return lastFour ? `****${lastFour}` : null;
}

function firstRelated(value: unknown): DbRow {
  if (Array.isArray(value)) return value[0] && typeof value[0] === "object" ? value[0] as DbRow : {};
  return value && typeof value === "object" ? value as DbRow : {};
}

function uniqueStrings(values: Array<string | null>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function scaledMoney(value: unknown, ratio: number): number {
  return roundMoney(numberValue(value) * ratio);
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function integerValue(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function safeFilename(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-");
}
