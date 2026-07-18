export const AMAZON_IMPORT_BATCH_STATUSES = [
  "uploaded",
  "parsing",
  "parsed",
  "needs_review",
  "reconciled",
  "ready",
  "failed",
  "archived",
] as const;

export const AMAZON_IMPORT_SOURCE_TYPES = [
  "amazon_payment",
  "amazon_trips",
  "fuel_card",
  "statement_reference",
] as const;

export const AMAZON_IMPORT_FILE_STATUSES = [
  "uploaded",
  "parsing",
  "parsed",
  "failed",
  "archived",
] as const;

export const AMAZON_RAW_ROW_PARSE_STATUSES = [
  "pending",
  "parsed",
  "warning",
  "failed",
  "skipped",
] as const;

export const AMAZON_IMPORT_ISSUE_SEVERITIES = [
  "info",
  "warning",
  "blocking",
] as const;

export const AMAZON_IMPORT_ISSUE_STATUSES = [
  "open",
  "resolved",
  "dismissed",
] as const;

export const AMAZON_RECONCILIATION_STATUSES = [
  "pending",
  "passed",
  "warning",
  "failed",
] as const;

export const AMAZON_EXTERNAL_VEHICLE_PROVIDERS = [
  "amazon",
  "octane",
  "manual",
] as const;

export const AMAZON_EXTERNAL_VEHICLE_IDENTIFIER_TYPES = [
  "tractor_vehicle_id",
  "amazon_unit",
  "fuel_unit",
  "fuel_card",
] as const;

export type AmazonImportBatchStatus = typeof AMAZON_IMPORT_BATCH_STATUSES[number];
export type AmazonImportSourceType = typeof AMAZON_IMPORT_SOURCE_TYPES[number];
export type AmazonImportFileStatus = typeof AMAZON_IMPORT_FILE_STATUSES[number];
export type AmazonRawRowParseStatus = typeof AMAZON_RAW_ROW_PARSE_STATUSES[number];
export type AmazonImportIssueSeverity = typeof AMAZON_IMPORT_ISSUE_SEVERITIES[number];
export type AmazonImportIssueStatus = typeof AMAZON_IMPORT_ISSUE_STATUSES[number];
export type AmazonReconciliationStatus = typeof AMAZON_RECONCILIATION_STATUSES[number];
export type AmazonExternalVehicleProvider = typeof AMAZON_EXTERNAL_VEHICLE_PROVIDERS[number];
export type AmazonExternalVehicleIdentifierType = typeof AMAZON_EXTERNAL_VEHICLE_IDENTIFIER_TYPES[number];

export type JsonObject = Record<string, unknown>;

export interface ParserIdentity {
  name: string;
  version: string;
  bundleVersion?: string;
}

export interface SchemaSignature {
  sourceType: AmazonImportSourceType;
  signature: string;
  parser: ParserIdentity;
}

export interface SourceLineageReference {
  fileId?: string;
  sourceSheet?: string | null;
  sourcePage?: number | null;
  sourceGroup?: string | null;
  sourceRowNumber?: number | null;
  fieldPath?: string | null;
}

export interface AmazonImportBatch {
  id: string;
  organizationId: string;
  periodStart: string | null;
  periodEnd: string | null;
  status: AmazonImportBatchStatus;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  parserBundleVersion: string | null;
  notes: string | null;
}

export interface AmazonImportFile {
  id: string;
  organizationId: string;
  batchId: string;
  sourceType: AmazonImportSourceType;
  originalFilename: string;
  storagePath: string;
  mimeType: string | null;
  sizeBytes: number;
  sha256Hash: string;
  parserName: string | null;
  parserVersion: string | null;
  schemaSignature: string | null;
  status: AmazonImportFileStatus;
  createdAt: string;
}

export interface AmazonImportRawRow {
  id: string;
  organizationId: string;
  batchId: string;
  fileId: string;
  sourceSheet: string | null;
  sourcePage: number | null;
  sourceGroup: string | null;
  sourceRowNumber: number | null;
  rawData: JsonObject;
  normalizedData: JsonObject;
  parseStatus: AmazonRawRowParseStatus;
  parseWarning: string | null;
  createdAt: string;
}

export interface AmazonImportIssue {
  id: string;
  organizationId: string;
  batchId: string;
  fileId: string | null;
  rawRowId: string | null;
  issueCode: string;
  severity: AmazonImportIssueSeverity;
  message: string;
  details: JsonObject;
  status: AmazonImportIssueStatus;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
}

export interface AmazonParserIssue {
  fileId: string | null;
  rawRowId: string | null;
  issueCode: string;
  severity: AmazonImportIssueSeverity;
  message: string;
  details: JsonObject;
}

export interface AmazonImportReconciliationResult {
  id?: string;
  organizationId?: string;
  batchId?: string;
  reconciliationType: string;
  expectedAmount: number | null;
  actualAmount: number | null;
  differenceAmount: number | null;
  expectedCount: number | null;
  actualCount: number | null;
  status: AmazonReconciliationStatus;
  details: JsonObject;
  createdAt?: string;
}

export interface AmazonImportReviewDecision {
  id: string;
  organizationId: string;
  batchId: string;
  issueId: string | null;
  decisionType: string;
  previousValue: JsonObject | null;
  selectedValue: JsonObject | null;
  reason: string | null;
  decidedBy: string | null;
  decidedAt: string;
}

export interface AmazonExternalVehicleIdentifier {
  id: string;
  organizationId: string;
  vehicleId: string;
  provider: AmazonExternalVehicleProvider;
  identifierType: AmazonExternalVehicleIdentifierType;
  externalValue: string;
  normalizedValue: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  createdAt: string;
  updatedAt: string;
}

export type AmazonPaymentRowClassification =
  | "trip_parent"
  | "load_child"
  | "standalone_load"
  | "non_financial"
  | "invalid";

export interface AmazonParsedSourceRow<T extends JsonObject = JsonObject> {
  sourceFile: {
    originalFilename: string;
    sha256Hash: string;
    sourceType: AmazonImportSourceType;
  };
  sourceSheet: string | null;
  sourceRowNumber: number | null;
  rawValues: JsonObject;
  normalizedValues: T;
  parser: ParserIdentity;
  schemaSignature: SchemaSignature;
  parseStatus: AmazonRawRowParseStatus;
  warnings: string[];
  blockingIssues: string[];
  sourceFingerprint: string;
}

export interface AmazonPaymentSummaryFields extends JsonObject {
  invoiceNumber: string | null;
  invoiceDate: string | null;
  invoiceTotal: number | null;
  workPeriodStart: string | null;
  workPeriodEnd: string | null;
  paymentDate: string | null;
  paymentStatus: string | null;
  carrierIdentifier: string | null;
}

export interface AmazonPaymentDetailFields extends JsonObject {
  invoiceNumber: string | null;
  blockId: string | null;
  tripId: string | null;
  loadId: string | null;
  startDate: string | null;
  endDate: string | null;
  route: string | null;
  operatorType: string | null;
  equipment: string | null;
  distanceMiles: number | null;
  itemType: string | null;
  programType: string | null;
  baseRate: number | null;
  fuelSurcharge: number | null;
  tolls: number | null;
  detention: number | null;
  tonu: number | null;
  others: number | null;
  grossPay: number | null;
  comments: string | null;
  rowClassification: AmazonPaymentRowClassification;
}

export interface AmazonPaymentReconciliation {
  summaryInvoiceTotal: number | null;
  totalParsedGrossPay: number;
  validFinancialRowCount: number;
  tripParentCount: number;
  loadChildCount: number;
  standaloneLoadCount: number;
  invalidFinancialRowCount: number;
  differenceAmount: number | null;
  reconciliationStatus: AmazonReconciliationStatus;
}

export interface AmazonPaymentParseResult {
  summary: AmazonPaymentSummaryFields;
  detailRows: AmazonParsedSourceRow<AmazonPaymentDetailFields>[];
  issues: AmazonParserIssue[];
  reconciliation: AmazonPaymentReconciliation;
  schemaInspection: JsonObject;
}

export interface AmazonTripStop extends JsonObject {
  sequence: number;
  facilityCode: string | null;
  stopType: string | null;
  plannedArrival: string | null;
  plannedDeparture: string | null;
  actualArrival: string | null;
  actualDeparture: string | null;
}

export interface AmazonTripsRowFields extends JsonObject {
  tripId: string | null;
  loadId: string | null;
  driverNameRaw: string | null;
  driverTokens: string[];
  requiresTeamAssignmentRule: boolean;
  tractorVehicleId: string | null;
  tripStage: string | null;
  loadExecutionStatus: string | null;
  estimatedDistance: number | null;
  equipmentType: string | null;
  operatorType: string | null;
  soloTeamIndicator: string | null;
  facilitySequence: string | null;
  estimatedCost: number | null;
  stops: AmazonTripStop[];
}

export interface AmazonTripsParseResult {
  rows: AmazonParsedSourceRow<AmazonTripsRowFields>[];
  issues: AmazonParserIssue[];
  schemaInspection: JsonObject;
  aggregate: {
    rowCount: number;
    duplicateLoadIds: string[];
    teamRowCount: number;
    blankDriverCount: number;
    malformedTimestampCount: number;
  };
}
