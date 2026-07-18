import {
  AMAZON_EXTERNAL_VEHICLE_IDENTIFIER_TYPES,
  AMAZON_EXTERNAL_VEHICLE_PROVIDERS,
  AMAZON_IMPORT_BATCH_STATUSES,
  AMAZON_IMPORT_FILE_STATUSES,
  AMAZON_IMPORT_ISSUE_SEVERITIES,
  AMAZON_IMPORT_SOURCE_TYPES,
  type AmazonExternalVehicleIdentifier,
  type AmazonImportFileStatus,
  type AmazonImportIssue,
  type AmazonImportRawRow,
  type AmazonImportSourceType,
  type JsonObject,
  type ParserIdentity,
  type SchemaSignature,
} from "./types";

export interface AmazonSourceMetadata {
  sourceType: AmazonImportSourceType;
  originalFilename: string;
  mimeType: string | null;
  sizeBytes: number;
  sha256Hash: string;
}

export interface AmazonParserInput {
  bytes: Uint8Array;
  metadata: AmazonSourceMetadata;
  parser: ParserIdentity;
}

export interface AmazonSchemaInspection {
  signature: SchemaSignature;
  warnings: string[];
  details?: JsonObject;
}

export interface AmazonParseObservation {
  reconciliationType: string;
  expectedAmount?: number | null;
  actualAmount?: number | null;
  expectedCount?: number | null;
  actualCount?: number | null;
  details?: JsonObject;
}

export interface AmazonParseResult {
  rows: Omit<AmazonImportRawRow, "id" | "organizationId" | "batchId" | "fileId" | "createdAt">[];
  issues: Omit<AmazonImportIssue, "id" | "organizationId" | "batchId" | "createdAt" | "status" | "resolvedAt" | "resolvedBy">[];
  reconciliations: AmazonParseObservation[];
}

export interface AmazonStatementParser {
  identity: ParserIdentity;
  supports(metadata: AmazonSourceMetadata): boolean;
  inspectSchema(input: AmazonParserInput): Promise<AmazonSchemaInspection>;
  parse(input: AmazonParserInput): Promise<AmazonParseResult>;
}

export function isAllowedAmazonBatchStatus(value: string): boolean {
  return (AMAZON_IMPORT_BATCH_STATUSES as readonly string[]).includes(value);
}

export function isAllowedAmazonIssueSeverity(value: string): boolean {
  return (AMAZON_IMPORT_ISSUE_SEVERITIES as readonly string[]).includes(value);
}

export function isAllowedAmazonSourceType(value: string): value is AmazonImportSourceType {
  return (AMAZON_IMPORT_SOURCE_TYPES as readonly string[]).includes(value);
}

export function isActiveAmazonImportFileStatus(value: AmazonImportFileStatus): boolean {
  return value === "uploaded" || value === "parsing" || value === "parsed";
}

export function isAllowedAmazonImportFileStatus(value: string): value is AmazonImportFileStatus {
  return (AMAZON_IMPORT_FILE_STATUSES as readonly string[]).includes(value);
}

export function normalizeExternalVehicleIdentifier(value: string): string {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

export function isSupportedExternalVehicleProvider(value: string): boolean {
  return (AMAZON_EXTERNAL_VEHICLE_PROVIDERS as readonly string[]).includes(value);
}

export function isSupportedExternalVehicleIdentifierType(value: string): boolean {
  return (AMAZON_EXTERNAL_VEHICLE_IDENTIFIER_TYPES as readonly string[]).includes(value);
}

export function externalVehicleIdentifierHasNormalizedValue(
  identifier: Pick<AmazonExternalVehicleIdentifier, "externalValue" | "normalizedValue">,
): boolean {
  return normalizeExternalVehicleIdentifier(identifier.externalValue) === identifier.normalizedValue;
}

export function effectiveDateRangesOverlap(
  a: Pick<AmazonExternalVehicleIdentifier, "effectiveFrom" | "effectiveTo">,
  b: Pick<AmazonExternalVehicleIdentifier, "effectiveFrom" | "effectiveTo">,
): boolean {
  const aStart = Date.parse(a.effectiveFrom);
  const bStart = Date.parse(b.effectiveFrom);
  const aEnd = a.effectiveTo ? Date.parse(a.effectiveTo) : Number.POSITIVE_INFINITY;
  const bEnd = b.effectiveTo ? Date.parse(b.effectiveTo) : Number.POSITIVE_INFINITY;
  return aStart < bEnd && bStart < aEnd;
}

export function effectiveDateRangeIsValid(
  value: Pick<AmazonExternalVehicleIdentifier, "effectiveFrom" | "effectiveTo">,
): boolean {
  if (!value.effectiveTo) return true;
  return Date.parse(value.effectiveTo) > Date.parse(value.effectiveFrom);
}

export function potentialExternalVehicleIdentifierConflict(
  a: Pick<AmazonExternalVehicleIdentifier, "organizationId" | "provider" | "identifierType" | "normalizedValue" | "effectiveFrom" | "effectiveTo">,
  b: Pick<AmazonExternalVehicleIdentifier, "organizationId" | "provider" | "identifierType" | "normalizedValue" | "effectiveFrom" | "effectiveTo">,
): boolean {
  return a.organizationId === b.organizationId
    && a.provider === b.provider
    && a.identifierType === b.identifierType
    && a.normalizedValue === b.normalizedValue
    && effectiveDateRangesOverlap(a, b);
}
