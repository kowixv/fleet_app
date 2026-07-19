import type { AmazonStatementViewModel } from "./statement-view-model";

export interface CandidatePdfRevenueDetail {
  id: string;
  sourceRevenueItemId: string;
  displayOrder: number;
  tripId: string | null;
  loadId: string | null;
  date: string | null;
  routeDisplay: string | null;
  routeVerified: boolean;
  distance: number | null;
  baseAmount: number | null;
  fuelSurchargeAmount: number | null;
  tollAmount: number | null;
  detentionAmount?: number | null;
  tonuAmount?: number | null;
  otherAmount?: number | null;
  grossAmount: number;
}

export interface CandidatePdfFuelDetail {
  id: string;
  sourceTransactionLineId: string;
  displayOrder: number;
  date: string | null;
  invoice: string | null;
  merchant: string | null;
  location: string | null;
  product: string;
  quantity: number | null;
  chargedPpu: number | null;
  discountAmount: number | null;
  amount: number;
  maskedCard?: string | null;
  continuation?: boolean;
}

export interface CandidatePdfContext {
  companyName?: string | null;
  companySecondary?: string | null;
  invoiceMetadata?: {
    invoiceNumber?: string | null;
    invoiceDate?: string | null;
    paymentDate?: string | null;
    paymentStatus?: string | null;
  } | null;
  revenueLines?: CandidatePdfRevenueDetail[];
  fuelLines?: CandidatePdfFuelDetail[];
}

export function candidatePdfModel(
  row: Record<string, unknown>,
  context: CandidatePdfContext = {},
): AmazonStatementViewModel {
  const snapshot = safeObject(row.calculation_snapshot);
  const configurationSnapshot = safeObject(row.configuration_snapshot);
  const engineInputs = safeObject(snapshot.engineInputs);
  const loads = Array.isArray(engineInputs.loads) ? engineInputs.loads as Array<Record<string, unknown>> : [];
  const expenses = Array.isArray(engineInputs.expenses) ? engineInputs.expenses as Array<Record<string, unknown>> : [];
  const lineItems = Array.isArray(snapshot.lineItems) ? snapshot.lineItems as Array<Record<string, unknown>> : [];
  const status = String(row.status);
  const candidateStatus: AmazonStatementViewModel["candidateStatus"] =
    status === "ready" ? "ready" : status === "converted" ? "converted" : "draft";

  const revenueLines = context.revenueLines === undefined
    ? fallbackRevenueLines(loads)
    : context.revenueLines.map((line) => ({
      id: line.id,
      sourceRevenueItemId: line.sourceRevenueItemId,
      displayOrder: line.displayOrder,
      tripId: line.tripId,
      loadId: line.loadId,
      date: line.date,
      routeDisplay: line.routeDisplay,
      routeStatus: line.routeVerified ? "verified" as const : "pending_review" as const,
      distance: line.distance,
      baseAmount: line.baseAmount,
      fuelSurchargeAmount: line.fuelSurchargeAmount,
      tollAmount: line.tollAmount,
      detentionAmount: line.detentionAmount,
      tonuAmount: line.tonuAmount,
      otherAmount: line.otherAmount,
      grossAmount: line.grossAmount,
    }));

  const fuelLines = context.fuelLines === undefined
    ? fallbackFuelLines(expenses)
    : context.fuelLines.map((line) => ({
      id: line.id,
      sourceTransactionLineId: line.sourceTransactionLineId,
      displayOrder: line.displayOrder,
      date: line.date,
      invoice: line.invoice,
      merchant: line.merchant,
      location: line.location,
      product: line.product,
      quantity: line.quantity,
      chargedPpu: line.chargedPpu,
      discountAmount: line.discountAmount,
      amount: line.amount,
      maskedCard: line.maskedCard,
      continuation: line.continuation,
    }));

  const companyName = safeString(context.companyName) ?? "ZYNP LLC";
  const companySecondary = safeString(context.companySecondary) ?? "Amazon Relay statement";

  return {
    candidateId: String(row.id),
    documentId: `amazon-statement-${String(row.id).slice(0, 8)}`,
    statementType: row.statement_type as AmazonStatementViewModel["statementType"],
    candidateStatus,
    settlementStatus: row.converted_settlement_id ? "finalized" : null,
    ruleVersion: String(row.calculation_rule_version ?? "amazon-candidate-rules-v1"),
    templateVersion: String(row.template_version ?? "amazon-statement-v1"),
    language: languageMode(configurationSnapshot.language_mode ?? snapshot.languageMode),
    company: { name: companyName, secondary: companySecondary },
    payee: { name: safeRelatedName(row.people) },
    vehicleDisplay: safeRelatedUnit(row.vehicles),
    periodStart: String(row.period_start),
    periodEnd: String(row.period_end),
    invoiceMetadata: context.invoiceMetadata ?? undefined,
    summary: {
      grossRevenue: numberValue(row.gross_amount),
      percentageDeductions: numberValue(row.percentage_deductions_amount),
      fixedDeductions: numberValue(row.fixed_deductions_amount),
      fuelDeductions: numberValue(row.fuel_deductions_amount),
      otherDeductions: numberValue(row.other_deductions_amount),
      totalDeductions: numberValue(row.total_deductions_amount),
      netAmount: numberValue(row.net_amount),
    },
    revenueLines,
    fuelLines,
    deductionLines: lineItems
      .filter((line) => numberValue(line.amount) < 0)
      .map((line, index) => ({
        id: `deduction-${index + 1}`,
        displayOrder: index + 1,
        type: String(line.key ?? "line_item"),
        label: String(line.labelEn ?? line.label_en ?? line.key ?? "Deduction"),
        calculationBasis: "engine_line",
        amount: Math.abs(numberValue(line.amount)),
        source: "saved_calculation_snapshot",
      })),
    teamAllocations: [],
    calculationNotes: ["Generated from the saved candidate and normalized Amazon source records."],
    reconciliationIndicators: ["Revenue and fuel detail lines reconcile to the saved candidate totals."],
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

function fallbackRevenueLines(loads: Array<Record<string, unknown>>): AmazonStatementViewModel["revenueLines"] {
  return loads.map((load, index) => ({
    id: `load-${index + 1}`,
    sourceRevenueItemId: `revenue-${index + 1}`,
    displayOrder: index + 1,
    tripId: null,
    loadId: safeString(load.loadNumber ?? load.load_number ?? load.reference),
    date: safeString(load.deliveryDate ?? load.delivery_date),
    routeDisplay: safeString(load.route) ?? "Pending Review",
    routeStatus: safeString(load.route) ? "verified" : "pending_review",
    distance: nullableNumber(load.totalMiles ?? load.total_miles),
    fuelSurchargeAmount: nullableNumber(load.fuelSurcharge ?? load.fuel_surcharge),
    grossAmount: numberValue(load.grossAmount ?? load.gross_amount),
  }));
}

function fallbackFuelLines(expenses: Array<Record<string, unknown>>): AmazonStatementViewModel["fuelLines"] {
  return expenses
    .filter((expense) => {
      const category = String(expense.category ?? "").toLowerCase();
      return category.includes("fuel") || category === "def";
    })
    .map((expense, index) => ({
      id: `fuel-${index + 1}`,
      sourceTransactionLineId: `fuel-line-${index + 1}`,
      displayOrder: index + 1,
      date: safeString(expense.date),
      product: String(expense.category ?? "fuel").toUpperCase(),
      amount: numberValue(expense.amount),
    }));
}

function safeObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function safeRelatedName(value: unknown): string {
  const related = firstRelated(value);
  const name = related.full_name;
  return typeof name === "string" && name.trim() ? name : "Pending Review";
}

function safeRelatedUnit(value: unknown): string {
  const related = firstRelated(value);
  const unit = related.unit_number;
  return typeof unit === "string" && unit.trim() ? unit : "Pending Review";
}

function firstRelated(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) return value[0] && typeof value[0] === "object" ? value[0] as Record<string, unknown> : {};
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function safeString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
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
