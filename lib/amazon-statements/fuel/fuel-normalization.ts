import { parseDateOnly, parseMoneyStrict, roundMoney, sha256Hex, stableJson } from "../parsers/normalization";
import type { AmazonImportIssueSeverity, JsonObject, ParserIdentity, SchemaSignature } from "../types";

export const OCTANE_FUEL_PDF_PARSER: ParserIdentity = {
  name: "octane-fuel-pdf",
  version: "0.1.0",
};

export type FuelProductTypeNormalized = "ULSD" | "DEF" | "FUEL" | "FEE" | "OTHER";
export type FuelIssueCode =
  | "malformed_fuel_money"
  | "malformed_fuel_date"
  | "orphan_product_line"
  | "duplicate_transaction_fingerprint"
  | "group_transaction_count_mismatch"
  | "report_transaction_count_mismatch"
  | "group_amount_mismatch"
  | "report_amount_mismatch"
  | "report_quantity_mismatch"
  | "report_discount_mismatch"
  | "card_assignment_overlap"
  | "ambiguous_fuel_card_match"
  | "unmatched_fuel_card"
  | "unit_driver_conflict"
  | "placeholder_group"
  | "unsupported_fuel_schema"
  | "unparsed_nonzero_fuel_amount";

export interface FuelSourceLocation {
  sourcePage: number | null;
  sourceGroupNumber: number | null;
  sourceRowNumber: number | null;
  fieldPath?: string | null;
}

export interface FuelImportIssue {
  issueCode: FuelIssueCode;
  severity: AmazonImportIssueSeverity;
  message: string;
  details: JsonObject;
  location: FuelSourceLocation;
}

export interface FuelProductLine {
  sourceLineOrder: number;
  productTypeRaw: string | null;
  productTypeNormalized: FuelProductTypeNormalized;
  quantity: number | null;
  retailUnitPrice: number | null;
  chargedUnitPrice: number | null;
  discountPerUnit: number | null;
  discountAmount: number | null;
  dealType: string | null;
  chargedAmount: number | null;
  sourceSnapshot: JsonObject;
}

export interface FuelTransaction {
  sourceTransactionFingerprint: string;
  transactionAt: string | null;
  invoiceNumber: string | null;
  merchantRaw: string | null;
  cityRaw: string | null;
  stateRaw: string | null;
  odometerRaw: string | null;
  feesAmount: number | null;
  sourcePage: number | null;
  sourceRowNumber: number | null;
  sourceSnapshot: JsonObject;
  productLines: FuelProductLine[];
}

export interface FuelCardGroup {
  sourceGroupNumber: number;
  cardExternalId: string | null;
  cardLastFour: string | null;
  driverLabelRaw: string | null;
  driverLabelNormalized: string | null;
  unitLabelRaw: string | null;
  unitLabelNormalized: string | null;
  reportedTransactionCount: number | null;
  reportedTotalAmount: number | null;
  reportedTotalQuantity: number | null;
  reportedDiscountAmount: number | null;
  isPlaceholderGroup: boolean;
  sourcePageStart: number | null;
  sourcePageEnd: number | null;
  sourceSnapshot: JsonObject;
  transactions: FuelTransaction[];
}

export interface FuelReport {
  provider: "octane";
  carrierIdentifier: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  generatedAt: string | null;
  reportedTransactionCount: number | null;
  reportedTotalAmount: number | null;
  reportedTotalQuantity: number | null;
  reportedDiscountAmount: number | null;
  reportedCardCount: number | null;
  parser: ParserIdentity;
  schemaSignature: SchemaSignature;
  sourceSnapshot: JsonObject;
  cardGroups: FuelCardGroup[];
  issues: FuelImportIssue[];
}

export function normalizeFuelLabel(value: string | null | undefined): string | null {
  const normalized = String(value ?? "").trim().replace(/\s+/g, " ").toUpperCase();
  if (!normalized || normalized === "-" || normalized === "—") return null;
  return normalized;
}

export function normalizeFuelProduct(value: string | null | undefined): FuelProductTypeNormalized {
  const normalized = normalizeFuelLabel(value);
  if (!normalized) return "OTHER";
  if (normalized === "ULSD" || normalized === "DSL" || normalized === "DIESEL") return "ULSD";
  if (normalized === "DEF" || normalized === "DEFD") return "DEF";
  if (normalized === "FUEL") return "FUEL";
  if (normalized === "FEE" || normalized === "FEES") return "FEE";
  return "OTHER";
}

export function parseFuelMoney(value: unknown): { value: number | null; warning?: FuelIssueCode } {
  const raw = String(value ?? "").trim();
  if (raw === "" || raw === "-" || raw === "—") return { value: null };
  const parsed = parseMoneyStrict(raw);
  return { value: parsed.value, warning: parsed.warning ? "malformed_fuel_money" : undefined };
}

export function parseFuelNumber(value: unknown): { value: number | null; warning?: FuelIssueCode } {
  const raw = String(value ?? "").trim().replace(/,/g, "");
  if (raw === "" || raw === "-" || raw === "—") return { value: null };
  const parsed = Number(raw.replace(/^\$/, ""));
  if (!Number.isFinite(parsed)) return { value: null, warning: "malformed_fuel_money" };
  return { value: Math.round((parsed + Number.EPSILON) * 1000) / 1000 };
}

export function parseFuelDateTime(date: string, time: string): { value: string | null; warning?: FuelIssueCode } {
  const parsedDate = parseDateOnly(date, { assumeSlashMonthDay: true });
  if (!parsedDate.value) return { value: null, warning: "malformed_fuel_date" };
  if (!/^\d{1,2}:\d{2}$/.test(time)) return { value: `${parsedDate.value}T00:00:00`, warning: "malformed_fuel_date" };
  const [hour, minute] = time.split(":").map(Number);
  if (hour > 23 || minute > 59) return { value: parsedDate.value, warning: "malformed_fuel_date" };
  return { value: `${parsedDate.value}T${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}:00` };
}

export function makeFuelSchemaSignature(details: JsonObject = {}): SchemaSignature {
  return {
    sourceType: "fuel_card",
    parser: OCTANE_FUEL_PDF_PARSER,
    signature: sha256Hex(stableJson({ parser: OCTANE_FUEL_PDF_PARSER.name, ...details })).slice(0, 32),
  };
}

export function fuelTransactionFingerprint(input: {
  provider: string;
  sourceGroupNumber: number;
  transactionAt: string | null;
  invoiceNumber: string | null;
  sourcePage?: number | null;
  sourceRowNumber?: number | null;
  productLines: FuelProductLine[];
}): string {
  return sha256Hex(stableJson({
    provider: input.provider,
    group: input.sourceGroupNumber,
    transactionAt: input.transactionAt,
    invoiceNumber: input.invoiceNumber,
    sourcePage: input.sourcePage,
    sourceRowNumber: input.sourceRowNumber,
    lines: input.productLines.map((line) => ({
      order: line.sourceLineOrder,
      product: line.productTypeNormalized,
      amount: line.chargedAmount,
      quantity: line.quantity,
    })),
  }));
}

export function sumFuelMoney(values: Array<number | null | undefined>): number {
  return roundMoney(values.reduce<number>((sum, value) => sum + (typeof value === "number" && Number.isFinite(value) ? value : 0), 0));
}

export function sumFuelQuantity(values: Array<number | null | undefined>): number {
  return Math.round(values.reduce<number>((sum, value) => sum + (typeof value === "number" && Number.isFinite(value) ? value : 0), 0) * 1000) / 1000;
}

export function fuelIssue(
  issueCode: FuelIssueCode,
  severity: AmazonImportIssueSeverity,
  message: string,
  location: FuelSourceLocation,
  details: JsonObject = {},
): FuelImportIssue {
  return { issueCode, severity, message, location, details };
}
