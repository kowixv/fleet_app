import type {
  AmazonParsedSourceRow,
  AmazonParserIssue,
  AmazonPaymentDetailFields,
  AmazonPaymentParseResult,
  AmazonTripsParseResult,
  AmazonTripsRowFields,
  JsonObject,
} from "../types";
import type { AmazonRevenueItem } from "../revenue/revenue-builder";

export type AmazonIssueLifecycleStage =
  | "schema_inspection"
  | "payment_parser"
  | "trips_parser"
  | "matching"
  | "revenue"
  | "route_resolution";

export type AmazonIssueCategory =
  | "parser"
  | "schema"
  | "matching"
  | "route"
  | "revenue";

export interface AmazonBatchIssue extends AmazonParserIssue {
  category: AmazonIssueCategory;
  lifecycleStage: AmazonIssueLifecycleStage;
  sourceRowReference: {
    sourceType: "amazon_payment" | "amazon_trips" | "derived";
    sourceSheet: string | null;
    sourceRowNumber: number | null;
    sourceFingerprint: string | null;
  };
  resolutionStatus: "open" | "resolved";
  resolutionReason: string | null;
}

export interface AmazonIssueCategoryCounts {
  parserWarnings: number;
  schemaWarnings: number;
  matchingWarnings: number;
  routeResolutionWarnings: number;
  revenueWarnings: number;
  blockingIssues: number;
  totalPersistedWarningIssues: number;
}

export function collectParserBatchIssues(args: {
  payment: AmazonPaymentParseResult;
  trips: AmazonTripsParseResult;
}): AmazonBatchIssue[] {
  return [
    ...args.payment.detailRows.flatMap((row) => rowWarningsToIssues("payment_parser", "parser", "amazon_payment", row)),
    ...args.trips.rows.flatMap((row) => rowWarningsToIssues("trips_parser", "parser", "amazon_trips", row)),
    ...args.payment.issues.map((issue) => parserIssueToBatchIssue(issue, "schema_inspection", issue.issueCode.startsWith("schema_") ? "schema" : "parser")),
    ...args.trips.issues.map((issue) => parserIssueToBatchIssue(issue, "schema_inspection", issue.issueCode.startsWith("schema_") ? "schema" : "parser")),
  ];
}

export function matchingOrRevenueIssueToBatchIssue(issue: AmazonParserIssue, lifecycleStage: "matching" | "revenue"): AmazonBatchIssue {
  return {
    ...issue,
    category: lifecycleStage,
    lifecycleStage,
    sourceRowReference: sourceReferenceFromDetails(issue.details),
    resolutionStatus: "open",
    resolutionReason: null,
  };
}

export function createRouteResolutionIssues(args: {
  items: AmazonRevenueItem[];
  routeResolutionRequested: boolean;
}): AmazonBatchIssue[] {
  if (!args.routeResolutionRequested) return [];
  return args.items
    .filter((item) => item.routeResolutionStatus === "unresolved")
    .map((item) => ({
      fileId: null,
      rawRowId: null,
      issueCode: "unresolved_facility",
      severity: "warning",
      message: "Displayed route requires verified facility location mapping.",
      details: {
        groupingKeyHash: hashString(item.groupingKey),
        sourceRevision: item.sourceRevision,
      },
      category: "route",
      lifecycleStage: "route_resolution",
      sourceRowReference: {
        sourceType: "derived",
        sourceSheet: null,
        sourceRowNumber: null,
        sourceFingerprint: item.sourceRevision,
      },
      resolutionStatus: "open",
      resolutionReason: null,
    }));
}

export function summarizeIssueCategories(issues: AmazonBatchIssue[]): AmazonIssueCategoryCounts {
  const openIssues = issues.filter((issue) => issue.resolutionStatus === "open");
  return {
    parserWarnings: count(openIssues, "parser", "warning"),
    schemaWarnings: count(openIssues, "schema", "warning"),
    matchingWarnings: count(openIssues, "matching", "warning"),
    routeResolutionWarnings: count(openIssues, "route", "warning"),
    revenueWarnings: count(openIssues, "revenue", "warning"),
    blockingIssues: openIssues.filter((issue) => issue.severity === "blocking").length,
    totalPersistedWarningIssues: openIssues.filter((issue) => issue.severity === "warning").length,
  };
}

export function markIssueResolved(issue: AmazonBatchIssue, resolutionReason: string): AmazonBatchIssue {
  return { ...issue, resolutionStatus: "resolved", resolutionReason };
}

export function issueCodeCounts(issues: AmazonBatchIssue[]): Record<string, number> {
  return issues.reduce<Record<string, number>>((counts, issue) => {
    counts[issue.issueCode] = (counts[issue.issueCode] ?? 0) + 1;
    return counts;
  }, {});
}

function rowWarningsToIssues<T extends AmazonPaymentDetailFields | AmazonTripsRowFields>(
  lifecycleStage: "payment_parser" | "trips_parser",
  category: AmazonIssueCategory,
  sourceType: "amazon_payment" | "amazon_trips",
  row: AmazonParsedSourceRow<T>,
): AmazonBatchIssue[] {
  return row.warnings.map((warning) => ({
    fileId: null,
    rawRowId: null,
    issueCode: warningToIssueCode(sourceType, warning),
    severity: "warning",
    message: "Parser warning preserved from source row.",
    details: {
      warning,
      sourceType,
      sourceSheet: row.sourceSheet,
      sourceRowNumber: row.sourceRowNumber,
      sourceFingerprint: row.sourceFingerprint,
    },
    category,
    lifecycleStage,
    sourceRowReference: {
      sourceType,
      sourceSheet: row.sourceSheet,
      sourceRowNumber: row.sourceRowNumber,
      sourceFingerprint: row.sourceFingerprint,
    },
    resolutionStatus: "open",
    resolutionReason: null,
  }));
}

function parserIssueToBatchIssue(
  issue: AmazonParserIssue,
  lifecycleStage: AmazonIssueLifecycleStage,
  category: AmazonIssueCategory,
): AmazonBatchIssue {
  return {
    ...issue,
    category,
    lifecycleStage,
    sourceRowReference: sourceReferenceFromDetails(issue.details),
    resolutionStatus: "open",
    resolutionReason: null,
  };
}

function warningToIssueCode(sourceType: "amazon_payment" | "amazon_trips", warning: string): string {
  const prefix = sourceType === "amazon_payment" ? "payment" : "trips";
  return `${prefix}_${warning.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").toLowerCase()}`;
}

function sourceReferenceFromDetails(details: JsonObject): AmazonBatchIssue["sourceRowReference"] {
  return {
    sourceType: typeof details.sourceType === "string" && (details.sourceType === "amazon_payment" || details.sourceType === "amazon_trips")
      ? details.sourceType
      : "derived",
    sourceSheet: typeof details.sourceSheet === "string" ? details.sourceSheet : null,
    sourceRowNumber: typeof details.sourceRowNumber === "number" ? details.sourceRowNumber : null,
    sourceFingerprint: typeof details.sourceFingerprint === "string" ? details.sourceFingerprint : null,
  };
}

function count(issues: AmazonBatchIssue[], category: AmazonIssueCategory, severity: "warning" | "blocking"): number {
  return issues.filter((issue) => issue.category === category && issue.severity === severity).length;
}

function hashString(value: string): string {
  let hash = 0;
  for (const char of value) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  return Math.abs(hash).toString(16);
}
