import { NextResponse } from "next/server";
import { requireAmazonImportActor } from "@/lib/amazon-statements/server/auth";
import { createClient } from "@/lib/supabase/server";
import { renderAmazonStatementPdf } from "@/lib/amazon-statements/pdf/statement-template-registry";
import type { AmazonStatementViewModel } from "@/lib/amazon-statements/pdf/statement-view-model";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ candidateId: string }> }) {
  const actor = await requireAmazonImportActor();
  const { candidateId } = await params;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("amazon_statement_candidates")
    .select("id, organization_id, statement_type, status, period_start, period_end, payee_id, people!amazon_statement_candidates_payee_same_org_fk(full_name), vehicle_id, vehicles!amazon_statement_candidates_vehicle_same_org_fk(unit_number), template_version, calculation_rule_version, source_revision, preview_revision, configuration_snapshot, calculation_snapshot, gross_amount, percentage_deductions_amount, fixed_deductions_amount, fuel_deductions_amount, other_deductions_amount, total_deductions_amount, net_amount, converted_settlement_id")
    .eq("organization_id", actor.organizationId)
    .eq("id", candidateId)
    .single();
  if (error) return NextResponse.json({ error: "Statement candidate is not available." }, { status: 404 });
  const model = candidatePdfModel(data as Record<string, unknown>);
  const pdf = await renderAmazonStatementPdf(model);
  const filename = safeFilename(`amazon-statement-${String(data.id).slice(0, 8)}-${model.candidateStatus}.pdf`);
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

function candidatePdfModel(row: Record<string, unknown>): AmazonStatementViewModel {
  const snapshot = safeObject(row.calculation_snapshot);
  const configurationSnapshot = safeObject(row.configuration_snapshot);
  const engineInputs = safeObject(snapshot.engineInputs);
  const loads = Array.isArray(engineInputs.loads) ? engineInputs.loads as Array<Record<string, unknown>> : [];
  const expenses = Array.isArray(engineInputs.expenses) ? engineInputs.expenses as Array<Record<string, unknown>> : [];
  const lineItems = Array.isArray(snapshot.lineItems) ? snapshot.lineItems as Array<Record<string, unknown>> : [];
  const status = String(row.status);
  const candidateStatus: AmazonStatementViewModel["candidateStatus"] =
    status === "ready" ? "ready" : status === "converted" ? "converted" : "draft";
  return {
    candidateId: String(row.id),
    documentId: `amazon-statement-${String(row.id).slice(0, 8)}`,
    statementType: row.statement_type as AmazonStatementViewModel["statementType"],
    candidateStatus,
    settlementStatus: row.converted_settlement_id ? "finalized" : null,
    ruleVersion: String(row.calculation_rule_version ?? "amazon-candidate-rules-v1"),
    templateVersion: String(row.template_version ?? "amazon-statement-v1"),
    language: languageMode(configurationSnapshot.language_mode ?? snapshot.languageMode),
    company: { name: "Fleet settlement", secondary: "Amazon Relay statement" },
    payee: { name: safeRelatedName(row.people) },
    vehicleDisplay: safeRelatedUnit(row.vehicles),
    periodStart: String(row.period_start),
    periodEnd: String(row.period_end),
    summary: {
      grossRevenue: numberValue(row.gross_amount),
      percentageDeductions: numberValue(row.percentage_deductions_amount),
      fixedDeductions: numberValue(row.fixed_deductions_amount),
      fuelDeductions: numberValue(row.fuel_deductions_amount),
      otherDeductions: numberValue(row.other_deductions_amount),
      totalDeductions: numberValue(row.total_deductions_amount),
      netAmount: numberValue(row.net_amount),
    },
    revenueLines: loads.map((load, index) => ({
      id: `load-${index + 1}`,
      sourceRevenueItemId: `revenue-${index + 1}`,
      displayOrder: index + 1,
      tripId: null,
      loadId: safeString(load.loadNumber ?? load.load_number),
      date: safeString(load.deliveryDate ?? load.delivery_date),
      routeDisplay: safeString(load.route) ?? "Pending Review",
      routeStatus: safeString(load.route) ? "verified" : "pending_review",
      distance: nullableNumber(load.totalMiles ?? load.total_miles),
      fuelSurchargeAmount: nullableNumber(load.fuelSurcharge ?? load.fuel_surcharge),
      grossAmount: numberValue(load.grossAmount ?? load.gross_amount),
    })),
    fuelLines: expenses
      .filter((expense) => String(expense.category ?? "").toLowerCase().includes("fuel") || String(expense.category ?? "") === "def")
      .map((expense, index) => ({
        id: `fuel-${index + 1}`,
        sourceTransactionLineId: `fuel-line-${index + 1}`,
        displayOrder: index + 1,
        date: safeString(expense.date),
        product: String(expense.category ?? "fuel").toUpperCase(),
        amount: numberValue(expense.amount),
      })),
    deductionLines: lineItems
      .filter((line) => numberValue(line.amount) !== 0)
      .map((line, index) => ({
        id: `deduction-${index + 1}`,
        displayOrder: index + 1,
        type: String(line.key ?? "line_item"),
        label: String(line.labelEn ?? line.label_en ?? line.key ?? "Deduction"),
        calculationBasis: "engine_line",
        amount: numberValue(line.amount),
        source: "saved_calculation_snapshot",
      })),
    teamAllocations: [],
    calculationNotes: ["Generated from saved Amazon statement candidate snapshot."],
    reconciliationIndicators: ["Source files are not reparsed during PDF generation."],
    companySignature: { signedStatus: "pending" },
    payeeSignature: { signedStatus: "pending" },
    generatedAt: new Date().toISOString(),
    footer: {
      templateVersion: String(row.template_version ?? "amazon-statement-v1"),
      sourceRevision: String(row.source_revision ?? ""),
      previewRevision: String(row.preview_revision ?? ""),
    },
  };
}

function safeObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function safeRelatedName(value: unknown): string {
  if (!value || typeof value !== "object") return "Pending Review";
  const name = (value as { full_name?: unknown }).full_name;
  return typeof name === "string" && name.trim() ? name : "Pending Review";
}

function safeRelatedUnit(value: unknown): string {
  if (!value || typeof value !== "object") return "Pending Review";
  const unit = (value as { unit_number?: unknown }).unit_number;
  return typeof unit === "string" && unit.trim() ? unit : "Pending Review";
}

function safeString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
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

function languageMode(value: unknown): AmazonStatementViewModel["language"] {
  return value === "en" || value === "tr" || value === "en_tr" ? value : "en_tr";
}

function safeFilename(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-");
}
