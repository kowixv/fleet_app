import readExcelFile from "read-excel-file/node";
import type { Sheet } from "read-excel-file/node";
import type {
  AmazonParserInput,
  AmazonSchemaInspection,
  AmazonStatementParser,
} from "../contracts";
import type {
  AmazonParsedSourceRow,
  AmazonPaymentDetailFields,
  AmazonPaymentParseResult,
  AmazonPaymentRowClassification,
  AmazonPaymentSummaryFields,
  JsonObject,
  ParserIdentity,
  SchemaSignature,
} from "../types";
import { parserIssue } from "./parser-errors";
import { inspectColumns } from "./schema-signature";
import {
  displayValue,
  normalizeHeader,
  parseDateOnly,
  parseMoneyStrict,
  roundMoney,
  sha256Hex,
  stableJson,
} from "./normalization";

export const PAYMENT_XLSX_PARSER: ParserIdentity = {
  name: "amazon-payment-xlsx",
  version: "0.1.0",
};

const REQUIRED_DETAIL_COLUMNS = [
  "Invoice Number",
  "Trip ID",
  "Load ID",
  "Start Date",
  "End Date",
  "Item Type",
  "Base Rate",
  "Fuel Surcharge",
  "Tolls",
  "Detention",
  "TONU",
  "Others",
  "Gross Pay",
];

const OPTIONAL_DETAIL_COLUMNS = [
  "Block ID",
  "Route",
  "Operator Type",
  "Equipment",
  "Distance (Mi)",
  "Program Type",
  "Comments",
];

type SheetRows = unknown[][];
type PaymentWorkbook = Array<{ sheet: string; data: SheetRows }>;
type PaymentXlsxLimitKey = keyof PaymentXlsxLimits;

export interface PaymentXlsxLimits {
  maxStoredFileBytes: number;
  maxWorkbookSheetCount: number;
  maxRowsPerSheet: number;
  maxColumnsPerRow: number;
  maxTotalCells: number;
  maxCellStringLength: number;
  maxTotalParsedStringBytes: number;
  maxParserMs: number;
}

export const PAYMENT_XLSX_LIMITS: PaymentXlsxLimits = {
  maxStoredFileBytes: 10 * 1024 * 1024,
  maxWorkbookSheetCount: 12,
  maxRowsPerSheet: 10_000,
  maxColumnsPerRow: 80,
  maxTotalCells: 250_000,
  maxCellStringLength: 8_192,
  maxTotalParsedStringBytes: 2 * 1024 * 1024,
  maxParserMs: 15_000,
};

const DANGEROUS_OBJECT_KEYS = new Set(["__proto__", "prototype", "constructor"]);

export async function parsePaymentXlsx(input: AmazonParserInput, options: { limits?: Partial<PaymentXlsxLimits> } = {}): Promise<AmazonPaymentParseResult> {
  const loaded = await loadPaymentWorkbook(input, options.limits);
  if (!loaded.ok) return paymentFailure(loaded.issueCode, loaded.message, loaded.details);
  const workbook = loaded.workbook;
  const summarySheetName = findSheet(workbook, "payment_summary") ?? workbook.SheetNames.find((name) => normalizeHeader(name).includes("summary"));
  const detailsSheetName = findSheet(workbook, "payment_details") ?? workbook.SheetNames.find((name) => normalizeHeader(name).includes("detail"));
  const issues = [];

  if (!summarySheetName) issues.push(parserIssue("payment_summary_missing", "blocking", "Payment Summary sheet was not found."));
  if (!detailsSheetName) issues.push(parserIssue("payment_details_missing", "blocking", "Payment Details sheet was not found."));

  const summaryRows = summarySheetName ? sheetRows(workbook, summarySheetName) : [];
  const detailRows = detailsSheetName ? sheetRows(workbook, detailsSheetName) : [];
  const summary = extractSummary(summaryRows);
  const header = findHeaderRow(detailRows);
  if (!header) {
    issues.push(parserIssue("payment_details_header_missing", "blocking", "Payment Details header row was not found."));
    return {
      summary,
      detailRows: [],
      issues,
      reconciliation: emptyReconciliation(summary.invoiceTotal),
      schemaInspection: { compatibilityStatus: "blocking", missingColumns: REQUIRED_DETAIL_COLUMNS.map(normalizeHeader) },
    };
  }

  const schema = inspectColumns({
    sourceType: "amazon_payment",
    parser: PAYMENT_XLSX_PARSER,
    observedColumns: header.headers,
    requiredColumns: REQUIRED_DETAIL_COLUMNS,
    optionalColumns: OPTIONAL_DETAIL_COLUMNS,
    recognizedSchemaVersion: "payment-details-v1",
  });
  for (const warning of schema.warnings) {
    const severity = warning.startsWith("missing_column") || warning.startsWith("duplicate_column") ? "blocking" : "info";
    issues.push(parserIssue(`schema_${warning.split(":")[0]}`, severity, warning, { sheet: detailsSheetName, warning }));
  }

  const columnMap = buildColumnMap(header.headers);
  const parsedRows: AmazonParsedSourceRow<AmazonPaymentDetailFields>[] = [];
  const seenLoadIds = new Set<string>();
  const duplicateLoadIds = new Set<string>();

  for (let rowIndex = header.index + 1; rowIndex < detailRows.length; rowIndex += 1) {
    const row = detailRows[rowIndex];
    const rawValues = rowToObject(header.headers, row);
    const normalized = normalizePaymentDetailRow(columnMap, row);
    const warnings = [...normalized.warnings];
    const blockingIssues = [...normalized.blockingIssues];
    if (normalized.values.loadId) {
      if (seenLoadIds.has(normalized.values.loadId)) {
        duplicateLoadIds.add(normalized.values.loadId);
        warnings.push("duplicate_load_id");
      }
      seenLoadIds.add(normalized.values.loadId);
    }
    const parseStatus = blockingIssues.length ? "failed" : warnings.length ? "warning" : normalized.values.rowClassification === "non_financial" ? "skipped" : "parsed";
    const sourceRowNumber = rowIndex + 1;
    parsedRows.push({
      sourceFile: {
        originalFilename: input.metadata.originalFilename,
        sha256Hash: input.metadata.sha256Hash,
        sourceType: input.metadata.sourceType,
      },
      sourceSheet: detailsSheetName ?? null,
      sourceRowNumber,
      rawValues,
      normalizedValues: normalized.values,
      parser: PAYMENT_XLSX_PARSER,
      schemaSignature: schema.signature,
      parseStatus,
      warnings,
      blockingIssues,
      sourceFingerprint: fingerprint(input.metadata.sha256Hash, detailsSheetName ?? "", sourceRowNumber, rawValues),
    });
  }

  for (const loadId of duplicateLoadIds) {
    issues.push(parserIssue("payment_duplicate_load_id", "warning", "Duplicate Load ID observed in Payment Details.", { loadId: redact(loadId) }));
  }

  const reconciliation = reconcilePayment(summary.invoiceTotal, parsedRows);
  if (reconciliation.reconciliationStatus !== "passed") {
    issues.push(parserIssue("payment_reconciliation_mismatch", "warning", "Payment Details gross total does not match Payment Summary invoice total.", {
      differenceAmount: reconciliation.differenceAmount,
    }));
  }

  return {
    summary,
    detailRows: parsedRows,
    issues,
    reconciliation,
    schemaInspection: schema.details as unknown as JsonObject,
  };
}

export const paymentXlsxParser: AmazonStatementParser = {
  identity: PAYMENT_XLSX_PARSER,
  supports(metadata) {
    return metadata.sourceType === "amazon_payment"
      && (metadata.originalFilename.toLowerCase().endsWith(".xlsx")
        || metadata.mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  },
  async inspectSchema(input): Promise<AmazonSchemaInspection> {
    const loaded = await loadPaymentWorkbook(input);
    if (!loaded.ok) {
      return {
        signature: { sourceType: "amazon_payment", signature: sha256Hex(loaded.issueCode), parser: PAYMENT_XLSX_PARSER },
        warnings: [loaded.issueCode],
        details: { compatibilityStatus: "blocking", issueCode: loaded.issueCode },
      };
    }
    const workbook = loaded.workbook;
    const detailsSheetName = findSheet(workbook, "payment_details") ?? workbook.SheetNames.find((name) => normalizeHeader(name).includes("detail"));
    if (!detailsSheetName) {
      return {
        signature: { sourceType: "amazon_payment", signature: sha256Hex("missing-payment-details"), parser: PAYMENT_XLSX_PARSER },
        warnings: ["payment_details_missing"],
        details: { compatibilityStatus: "blocking" },
      };
    }
    const header = findHeaderRow(sheetRows(workbook, detailsSheetName));
    if (!header) {
      return {
        signature: { sourceType: "amazon_payment", signature: sha256Hex("missing-payment-details-header"), parser: PAYMENT_XLSX_PARSER },
        warnings: ["payment_details_header_missing"],
        details: { compatibilityStatus: "blocking" },
      };
    }
    const inspected = inspectColumns({
      sourceType: "amazon_payment",
      parser: PAYMENT_XLSX_PARSER,
      observedColumns: header.headers,
      requiredColumns: REQUIRED_DETAIL_COLUMNS,
      optionalColumns: OPTIONAL_DETAIL_COLUMNS,
      recognizedSchemaVersion: "payment-details-v1",
    });
    return { ...inspected, details: inspected.details as unknown as JsonObject };
  },
  async parse(input) {
    const parsed = await parsePaymentXlsx(input);
    return {
      rows: parsed.detailRows.map((row) => ({
        sourceSheet: row.sourceSheet,
        sourcePage: null,
        sourceGroup: "payment_details",
        sourceRowNumber: row.sourceRowNumber,
        rawData: row.rawValues,
        normalizedData: row.normalizedValues,
        parseStatus: row.parseStatus,
        parseWarning: [...row.warnings, ...row.blockingIssues].join("; ") || null,
      })),
      issues: parsed.issues,
      reconciliations: [{
        reconciliationType: "payment_invoice_total",
        expectedAmount: parsed.reconciliation.summaryInvoiceTotal,
        actualAmount: parsed.reconciliation.totalParsedGrossPay,
        expectedCount: null,
        actualCount: parsed.reconciliation.validFinancialRowCount,
        details: parsed.reconciliation as unknown as JsonObject,
      }],
    };
  },
};

function findSheet(workbook: { SheetNames: string[] }, normalizedName: string): string | undefined {
  return workbook.SheetNames.find((name) => normalizeHeader(name) === normalizedName);
}

function sheetRows(workbook: { Sheets: Map<string, SheetRows> }, sheetName: string): SheetRows {
  return workbook.Sheets.get(sheetName) ?? [];
}

function extractSummary(rows: SheetRows): AmazonPaymentSummaryFields {
  const lookup = new Map<string, unknown>();
  for (const row of rows) {
    for (let i = 0; i < row.length; i += 1) {
      const key = normalizeHeader(row[i]);
      if (!key || i + 1 >= row.length) continue;
      const value = row.slice(i + 1).find((cell) => displayValue(cell) !== "");
      lookup.set(key, value ?? null);
    }
  }
  const period = displayValue(lookup.get("work_period") ?? lookup.get("period"));
  const workPeriod = parseWorkPeriod(period);
  const invoiceDate = parseDateOnly(lookup.get("invoice_date")).value;
  const paymentDate = parseDateOnly(lookup.get("payment_date")).value;
  return {
    invoiceNumber: displayOrNull(lookup.get("invoice_number") ?? lookup.get("invoice_id") ?? lookup.get("invoice")),
    invoiceDate,
    invoiceTotal: parseMoneyStrict(lookup.get("invoice_total") ?? lookup.get("total")).value,
    workPeriodStart: workPeriod.start ?? parseDateOnly(lookup.get("work_period_start")).value,
    workPeriodEnd: workPeriod.end ?? parseDateOnly(lookup.get("work_period_end")).value,
    paymentDate,
    paymentStatus: displayOrNull(lookup.get("payment_status") ?? lookup.get("status")),
    carrierIdentifier: displayOrNull(lookup.get("scac") ?? lookup.get("carrier_identifier") ?? lookup.get("carrier")),
  };
}

function parseWorkPeriod(value: string): { start: string | null; end: string | null } {
  if (!value) return { start: null, end: null };
  const parts = value.split(/\s+-\s+/);
  if (parts.length !== 2) return { start: null, end: null };
  const end = parseDateOnly(parts[1]).value;
  let start = parseDateOnly(parts[0]).value;
  if (!start && end) {
    const year = end.slice(0, 4);
    start = parseDateOnly(`${parts[0]}, ${year}`).value;
  }
  return { start, end };
}

function findHeaderRow(rows: SheetRows): { index: number; headers: string[] } | null {
  let best: { index: number; headers: string[]; score: number } | null = null;
  const required = new Set(REQUIRED_DETAIL_COLUMNS.map(normalizeHeader));
  rows.forEach((row, index) => {
    const headers = row.map(displayValue);
    const normalized = new Set(headers.map(normalizeHeader));
    const score = [...required].filter((column) => normalized.has(column)).length;
    if (score >= 4 && (!best || score > best.score)) best = { index, headers, score };
  });
  if (best === null) return null;
  const selected = best as { index: number; headers: string[]; score: number };
  return { index: selected.index, headers: selected.headers };
}

function buildColumnMap(headers: string[]): Map<string, number> {
  const map = new Map<string, number>();
  headers.forEach((header, index) => map.set(normalizeHeader(header), index));
  return map;
}

function rowToObject(headers: string[], row: unknown[]): JsonObject {
  const result = Object.create(null) as JsonObject;
  const seen = new Set<string>();
  headers.forEach((header, index) => {
    const key = safeRawHeaderKey(header, index, seen);
    result[key] = row[index] ?? null;
  });
  return result;
}

async function loadPaymentWorkbook(input: AmazonParserInput, overrides: Partial<PaymentXlsxLimits> = {}): Promise<
  | { ok: true; workbook: { SheetNames: string[]; Sheets: Map<string, SheetRows> } }
  | { ok: false; issueCode: string; message: string; details: JsonObject }
> {
  const limits = effectiveLimits(overrides);
  const sizeBytes = input.bytes.byteLength;
  if (sizeBytes > limits.maxStoredFileBytes) {
    return limitFailure("payment_xlsx_file_too_large", "Payment workbook exceeds the stored file size limit.", "maxStoredFileBytes", sizeBytes, limits.maxStoredFileBytes);
  }
  if (limits.maxParserMs <= 0) {
    return {
      ok: false,
      issueCode: "payment_xlsx_parser_timeout",
      message: "Payment workbook parsing timed out.",
      details: { limitName: "maxParserMs", limit: limits.maxParserMs },
    };
  }
  let sheets: PaymentWorkbook;
  try {
    sheets = normalizeWorkbookSheets(await withTimeout(readExcelFile(Buffer.from(input.bytes)), limits.maxParserMs));
  } catch (error) {
    const timedOut = error instanceof Error && error.message === "payment_xlsx_parser_timeout";
    return {
      ok: false,
      issueCode: timedOut ? "payment_xlsx_parser_timeout" : "payment_xlsx_unreadable",
      message: timedOut ? "Payment workbook parsing timed out." : "Payment workbook could not be read safely.",
      details: timedOut ? { limitName: "maxParserMs", limit: limits.maxParserMs } : {},
    };
  }
  const violation = workbookLimitViolation(sheets, limits);
  if (violation) return violation;
  return {
    ok: true,
    workbook: {
      SheetNames: sheets.map((sheet) => sheet.sheet),
      Sheets: new Map(sheets.map((sheet) => [sheet.sheet, sheet.data])),
    },
  };
}

function effectiveLimits(overrides: Partial<PaymentXlsxLimits>): PaymentXlsxLimits {
  return { ...PAYMENT_XLSX_LIMITS, ...overrides };
}

function normalizeWorkbookSheets(sheets: Sheet[]): PaymentWorkbook {
  return sheets.map((sheet) => ({
    sheet: sheet.sheet,
    data: sheet.data.map((row) => row.map((cell) => cell ?? null)) as SheetRows,
  }));
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("payment_xlsx_parser_timeout")), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function workbookLimitViolation(
  sheets: PaymentWorkbook,
  limits: ReturnType<typeof effectiveLimits>,
): { ok: false; issueCode: string; message: string; details: JsonObject } | null {
  if (sheets.length > limits.maxWorkbookSheetCount) {
    return limitFailure("payment_xlsx_sheet_limit_exceeded", "Payment workbook has too many worksheets.", "maxWorkbookSheetCount", sheets.length, limits.maxWorkbookSheetCount);
  }
  let totalCells = 0;
  let totalStringBytes = 0;
  for (const sheet of sheets) {
    if (sheet.data.length > limits.maxRowsPerSheet) {
      return limitFailure("payment_xlsx_row_limit_exceeded", "Payment workbook has too many rows in a worksheet.", "maxRowsPerSheet", sheet.data.length, limits.maxRowsPerSheet);
    }
    for (let rowIndex = 0; rowIndex < sheet.data.length; rowIndex += 1) {
      const row = sheet.data[rowIndex];
      if (row.length > limits.maxColumnsPerRow) {
        return limitFailure("payment_xlsx_column_limit_exceeded", "Payment workbook row has too many columns.", "maxColumnsPerRow", row.length, limits.maxColumnsPerRow, { rowNumber: rowIndex + 1 });
      }
      totalCells += row.length;
      if (totalCells > limits.maxTotalCells) {
        return limitFailure("payment_xlsx_cell_limit_exceeded", "Payment workbook has too many cells.", "maxTotalCells", totalCells, limits.maxTotalCells);
      }
      for (const cell of row) {
        if (typeof cell !== "string") continue;
        if (cell.length > limits.maxCellStringLength) {
          return limitFailure("payment_xlsx_cell_string_limit_exceeded", "Payment workbook contains an oversized cell value.", "maxCellStringLength", cell.length, limits.maxCellStringLength, { rowNumber: rowIndex + 1 });
        }
        totalStringBytes += Buffer.byteLength(cell, "utf8");
        if (totalStringBytes > limits.maxTotalParsedStringBytes) {
          return limitFailure("payment_xlsx_string_total_limit_exceeded", "Payment workbook contains too much text.", "maxTotalParsedStringBytes", totalStringBytes, limits.maxTotalParsedStringBytes);
        }
      }
    }
  }
  return null;
}

function limitFailure(issueCode: string, message: string, limitName: PaymentXlsxLimitKey, observed: number, limit: number, extra: JsonObject = {}) {
  return {
    ok: false as const,
    issueCode,
    message,
    details: { ...extra, limitName, observed, limit },
  };
}

function paymentFailure(issueCode: string, message: string, details: JsonObject): AmazonPaymentParseResult {
  return {
    summary: emptyPaymentSummary(),
    detailRows: [],
    issues: [parserIssue(issueCode, "blocking", message, details)],
    reconciliation: emptyReconciliation(null),
    schemaInspection: { compatibilityStatus: "blocking", issueCode },
  };
}

function emptyPaymentSummary(): AmazonPaymentSummaryFields {
  return {
    invoiceNumber: null,
    invoiceDate: null,
    invoiceTotal: null,
    workPeriodStart: null,
    workPeriodEnd: null,
    paymentDate: null,
    paymentStatus: null,
    carrierIdentifier: null,
  };
}

function safeRawHeaderKey(header: unknown, index: number, seen: Set<string>): string {
  const requested = displayValue(header) || `column_${index + 1}`;
  const lower = requested.trim().toLowerCase();
  let key = DANGEROUS_OBJECT_KEYS.has(lower) ? `column_${index + 1}` : requested;
  if (seen.has(key)) key = `${key}_${index + 1}`;
  seen.add(key);
  return key;
}

function normalizePaymentDetailRow(columnMap: Map<string, number>, row: unknown[]): {
  values: AmazonPaymentDetailFields;
  warnings: string[];
  blockingIssues: string[];
} {
  const warnings: string[] = [];
  const blockingIssues: string[] = [];
  const text = (name: string) => displayOrNull(row[columnMap.get(name) ?? -1]);
  const money = (name: string) => {
    const parsed = parseMoneyStrict(row[columnMap.get(name) ?? -1]);
    if (parsed.warning) warnings.push(`${name}:${parsed.warning}`);
    return parsed.value;
  };
  const date = (name: string) => {
    const parsed = parseDateOnly(row[columnMap.get(name) ?? -1]);
    if (parsed.warning) warnings.push(`${name}:${parsed.warning}`);
    return parsed.value;
  };
  const distance = parseOptionalNumber(row[columnMap.get("distance_mi") ?? -1]);
  if (distance.warning) warnings.push(`distance_mi:${distance.warning}`);
  const values: AmazonPaymentDetailFields = {
    invoiceNumber: text("invoice_number"),
    blockId: text("block_id"),
    tripId: text("trip_id"),
    loadId: text("load_id"),
    startDate: date("start_date"),
    endDate: date("end_date"),
    route: text("route"),
    operatorType: text("operator_type"),
    equipment: text("equipment"),
    distanceMiles: distance.value,
    itemType: text("item_type"),
    programType: text("program_type"),
    baseRate: money("base_rate"),
    fuelSurcharge: money("fuel_surcharge"),
    tolls: money("tolls"),
    detention: money("detention"),
    tonu: money("tonu"),
    others: money("others"),
    grossPay: money("gross_pay"),
    comments: text("comments"),
    rowClassification: "invalid",
  };
  values.rowClassification = classifyPaymentRow(values);
  if (values.rowClassification === "invalid") blockingIssues.push("payment_row_invalid");
  return { values, warnings, blockingIssues };
}

function classifyPaymentRow(row: AmazonPaymentDetailFields): AmazonPaymentRowClassification {
  const hasAnyText = Boolean(row.invoiceNumber || row.tripId || row.loadId || row.itemType || row.comments);
  const hasAnyMoney = [row.baseRate, row.fuelSurcharge, row.tolls, row.detention, row.tonu, row.others, row.grossPay].some((value) => value !== null);
  if (!hasAnyText && !hasAnyMoney) return "non_financial";
  if (!row.invoiceNumber && normalizeHeader(row.itemType).includes("total")) return "non_financial";
  if (!row.invoiceNumber && !row.tripId && !row.loadId) return "non_financial";
  const hasTrip = Boolean(row.tripId);
  const hasLoad = Boolean(row.loadId);
  const itemType = normalizeHeader(row.itemType);
  if (hasTrip && !hasLoad && itemType.includes("tour")) return "trip_parent";
  if (hasLoad && hasTrip && row.tripId !== row.loadId && !itemType.includes("single")) return "load_child";
  if (hasLoad) return "standalone_load";
  if (!hasTrip && !hasLoad && !hasAnyMoney) return "non_financial";
  return "invalid";
}

function reconcilePayment(summaryTotal: number | null, rows: AmazonParsedSourceRow<AmazonPaymentDetailFields>[]) {
  const validRows = rows.filter((row) => ["trip_parent", "load_child", "standalone_load"].includes(row.normalizedValues.rowClassification));
  const totalParsedGrossPay = roundMoney(validRows.reduce((sum, row) => sum + (row.normalizedValues.grossPay ?? 0), 0));
  const differenceAmount = summaryTotal === null ? null : roundMoney(totalParsedGrossPay - summaryTotal);
  return {
    summaryInvoiceTotal: summaryTotal,
    totalParsedGrossPay,
    validFinancialRowCount: validRows.length,
    tripParentCount: validRows.filter((row) => row.normalizedValues.rowClassification === "trip_parent").length,
    loadChildCount: validRows.filter((row) => row.normalizedValues.rowClassification === "load_child").length,
    standaloneLoadCount: validRows.filter((row) => row.normalizedValues.rowClassification === "standalone_load").length,
    invalidFinancialRowCount: rows.filter((row) => row.normalizedValues.rowClassification === "invalid").length,
    differenceAmount,
    reconciliationStatus: differenceAmount === null ? "warning" : Math.abs(differenceAmount) <= 0.01 ? "passed" : "warning",
  } as const;
}

function emptyReconciliation(summaryInvoiceTotal: number | null) {
  return {
    summaryInvoiceTotal,
    totalParsedGrossPay: 0,
    validFinancialRowCount: 0,
    tripParentCount: 0,
    loadChildCount: 0,
    standaloneLoadCount: 0,
    invalidFinancialRowCount: 0,
    differenceAmount: summaryInvoiceTotal === null ? null : -summaryInvoiceTotal,
    reconciliationStatus: "failed" as const,
  };
}

function parseOptionalNumber(value: unknown): { value: number | null; warning?: string } {
  if (value === null || value === undefined || value === "") return { value: null };
  if (typeof value === "number" && Number.isFinite(value)) return { value };
  const raw = displayValue(value).replace(/,/g, "");
  if (/^-?\d+(?:\.\d+)?$/.test(raw)) return { value: Number(raw) };
  return { value: null, warning: "number_malformed" };
}

function displayOrNull(value: unknown): string | null {
  const text = displayValue(value);
  return text ? text : null;
}

function fingerprint(fileHash: string, sheet: string, rowNumber: number, rawValues: JsonObject): string {
  return sha256Hex(stableJson({ fileHash, sheet, rowNumber, rawValues }));
}

function redact(value: string): string {
  return sha256Hex(value).slice(0, 12);
}
