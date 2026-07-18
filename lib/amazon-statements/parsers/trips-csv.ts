import type { AmazonParserInput, AmazonSchemaInspection, AmazonStatementParser } from "../contracts";
import type {
  AmazonParsedSourceRow,
  AmazonTripStop,
  AmazonTripsParseResult,
  AmazonTripsRowFields,
  JsonObject,
  ParserIdentity,
} from "../types";
import { parserIssue } from "./parser-errors";
import { inspectColumns } from "./schema-signature";
import {
  displayValue,
  normalizeHeader,
  parseCsv,
  parseDateOnly,
  parseDriverTokens,
  parseMoneyStrict,
  sha256Hex,
  stableJson,
} from "./normalization";

export const TRIPS_CSV_PARSER: ParserIdentity = {
  name: "amazon-trips-csv",
  version: "0.1.0",
};

const REQUIRED_COLUMNS = [
  "Trip ID",
  "Load ID",
  "Driver Name",
  "Tractor Vehicle ID",
];

const OPTIONAL_COLUMNS = [
  "Block/Trip",
  "Trip Stage",
  "Facility Sequence",
  "Load Execution Status",
  "Transit Operator Type",
  "Equipment Type",
  "Trailer ID",
  "Estimate Distance",
  "Estimated Cost",
  "Unit",
  "Rate Type",
  "Currency",
  "Operator ID",
  "Shipper Account",
  "Sub Carrier",
  "CR_ID",
  "Spot Work",
];

export async function parseTripsCsv(input: AmazonParserInput): Promise<AmazonTripsParseResult> {
  const text = Buffer.from(input.bytes).toString("utf8");
  const csv = parseCsv(text);
  const schema = inspectColumns({
    sourceType: "amazon_trips",
    parser: TRIPS_CSV_PARSER,
    observedColumns: csv.headers,
    requiredColumns: REQUIRED_COLUMNS,
    optionalColumns: OPTIONAL_COLUMNS,
    recognizedSchemaVersion: "trips-csv-v1",
  });
  const issues = [
    ...csv.warnings.map((warning) => parserIssue(`csv_${warning}`, warning === "csv_empty" ? "blocking" : "warning", warning)),
    ...schema.warnings.map((warning) => parserIssue(`schema_${warning.split(":")[0]}`, warning.startsWith("missing_column") || warning.startsWith("duplicate_column") ? "blocking" : "info", warning)),
  ];
  const columnMap = buildColumnMap(csv.headers);
  const rows: AmazonParsedSourceRow<AmazonTripsRowFields>[] = [];
  const seenLoadIds = new Set<string>();
  const duplicateLoadIds = new Set<string>();
  let malformedTimestampCount = 0;
  let blankDriverCount = 0;

  csv.rows.forEach((row, index) => {
    const sourceRowNumber = index + 2;
    const rawValues = rowToObject(csv.headers, row);
    const normalized = normalizeTripsRow(columnMap, row);
    malformedTimestampCount += normalized.malformedTimestampCount;
    if (!normalized.values.driverNameRaw) blankDriverCount += 1;
    const warnings = [...normalized.warnings];
    const blockingIssues = [...normalized.blockingIssues];
    if (normalized.values.loadId) {
      if (seenLoadIds.has(normalized.values.loadId)) {
        duplicateLoadIds.add(normalized.values.loadId);
        warnings.push("duplicate_load_id");
      }
      seenLoadIds.add(normalized.values.loadId);
    }
    rows.push({
      sourceFile: {
        originalFilename: input.metadata.originalFilename,
        sha256Hash: input.metadata.sha256Hash,
        sourceType: input.metadata.sourceType,
      },
      sourceSheet: null,
      sourceRowNumber,
      rawValues,
      normalizedValues: normalized.values,
      parser: TRIPS_CSV_PARSER,
      schemaSignature: schema.signature,
      parseStatus: blockingIssues.length ? "failed" : warnings.length ? "warning" : "parsed",
      warnings,
      blockingIssues,
      sourceFingerprint: sha256Hex(stableJson({ fileHash: input.metadata.sha256Hash, sourceRowNumber, rawValues })),
    });
  });

  for (const loadId of duplicateLoadIds) {
    issues.push(parserIssue("trips_duplicate_load_id", "warning", "Duplicate Load ID observed in Trips.csv.", { loadId: sha256Hex(loadId).slice(0, 12) }));
  }

  return {
    rows,
    issues,
    schemaInspection: schema.details as unknown as JsonObject,
    aggregate: {
      rowCount: rows.length,
      duplicateLoadIds: [...duplicateLoadIds].map((value) => sha256Hex(value).slice(0, 12)),
      teamRowCount: rows.filter((row) => row.normalizedValues.requiresTeamAssignmentRule).length,
      blankDriverCount,
      malformedTimestampCount,
    },
  };
}

export const tripsCsvParser: AmazonStatementParser = {
  identity: TRIPS_CSV_PARSER,
  supports(metadata) {
    return metadata.sourceType === "amazon_trips"
      && (metadata.originalFilename.toLowerCase().endsWith(".csv")
        || metadata.mimeType === "text/csv"
        || metadata.mimeType === "application/csv");
  },
  async inspectSchema(input): Promise<AmazonSchemaInspection> {
    const csv = parseCsv(Buffer.from(input.bytes).toString("utf8"));
    const inspected = inspectColumns({
      sourceType: "amazon_trips",
      parser: TRIPS_CSV_PARSER,
      observedColumns: csv.headers,
      requiredColumns: REQUIRED_COLUMNS,
      optionalColumns: OPTIONAL_COLUMNS,
      recognizedSchemaVersion: "trips-csv-v1",
    });
    return { ...inspected, details: inspected.details as unknown as JsonObject };
  },
  async parse(input) {
    const parsed = await parseTripsCsv(input);
    return {
      rows: parsed.rows.map((row) => ({
        sourceSheet: null,
        sourcePage: null,
        sourceGroup: "trips_csv",
        sourceRowNumber: row.sourceRowNumber,
        rawData: row.rawValues,
        normalizedData: row.normalizedValues,
        parseStatus: row.parseStatus,
        parseWarning: [...row.warnings, ...row.blockingIssues].join("; ") || null,
      })),
      issues: parsed.issues,
      reconciliations: [{
        reconciliationType: "trips_row_count",
        expectedAmount: null,
        actualAmount: null,
        expectedCount: null,
        actualCount: parsed.aggregate.rowCount,
        details: parsed.aggregate,
      }],
    };
  },
};

function buildColumnMap(headers: string[]): Map<string, number> {
  const map = new Map<string, number>();
  headers.forEach((header, index) => map.set(normalizeHeader(header), index));
  return map;
}

function rowToObject(headers: string[], row: string[]): JsonObject {
  const result: JsonObject = {};
  headers.forEach((header, index) => {
    result[displayValue(header) || `column_${index + 1}`] = row[index] ?? "";
  });
  return result;
}

function normalizeTripsRow(columnMap: Map<string, number>, row: string[]): {
  values: AmazonTripsRowFields;
  warnings: string[];
  blockingIssues: string[];
  malformedTimestampCount: number;
} {
  const warnings: string[] = [];
  const blockingIssues: string[] = [];
  let malformedTimestampCount = 0;
  const text = (name: string) => displayOrNull(row[columnMap.get(name) ?? -1]);
  const driver = parseDriverTokens(text("driver_name"));
  if (!driver.raw) warnings.push("driver_blank");
  if (driver.requiresTeamRule) warnings.push("team_assignment_rule_required");
  const distance = parseOptionalNumber(row[columnMap.get("estimate_distance") ?? -1]);
  if (distance.warning) warnings.push(`estimate_distance:${distance.warning}`);
  const estimatedCost = parseMoneyStrict(row[columnMap.get("estimated_cost") ?? -1]);
  if (estimatedCost.warning) warnings.push(`estimated_cost:${estimatedCost.warning}`);
  const stops = parseStops(columnMap, row);
  malformedTimestampCount = stops.malformedTimestampCount;
  warnings.push(...stops.warnings);
  const values: AmazonTripsRowFields = {
    tripId: text("trip_id"),
    loadId: text("load_id"),
    driverNameRaw: driver.raw || null,
    driverTokens: driver.tokens,
    requiresTeamAssignmentRule: driver.requiresTeamRule,
    tractorVehicleId: text("tractor_vehicle_id"),
    tripStage: text("trip_stage"),
    loadExecutionStatus: text("load_execution_status"),
    estimatedDistance: distance.value,
    equipmentType: text("equipment_type"),
    operatorType: text("transit_operator_type"),
    soloTeamIndicator: text("transit_operator_type"),
    facilitySequence: text("facility_sequence"),
    estimatedCost: estimatedCost.value,
    stops: stops.stops,
  };
  if (!values.tripId && !values.loadId) blockingIssues.push("trips_row_missing_ids");
  return { values, warnings, blockingIssues, malformedTimestampCount };
}

function parseStops(columnMap: Map<string, number>, row: string[]): { stops: AmazonTripStop[]; warnings: string[]; malformedTimestampCount: number } {
  const sequences = new Set<number>();
  for (const key of columnMap.keys()) {
    const match = key.match(/^stop_(\d+)_/);
    if (match) sequences.add(Number(match[1]));
  }
  const warnings: string[] = [];
  let malformedTimestampCount = 0;
  const stops: AmazonTripStop[] = [...sequences].sort((a, b) => a - b).map((sequence) => {
    const prefix = `stop_${sequence}_`;
    const stop: AmazonTripStop = {
      sequence,
      facilityCode: readFirst(columnMap, row, [`stop_${sequence}`, `${prefix}facility`, `${prefix}facility_code`]),
      stopType: readFirst(columnMap, row, [`${prefix}type`, `${prefix}stop_type`]),
      plannedArrival: readDateTime(columnMap, row, prefix, "planned_arrival"),
      plannedDeparture: readDateTime(columnMap, row, prefix, "planned_departure"),
      actualArrival: readDateTime(columnMap, row, prefix, "actual_arrival"),
      actualDeparture: readDateTime(columnMap, row, prefix, "actual_departure"),
    };
    for (const [field, value] of Object.entries(stop)) {
      if (field !== "sequence" && value === "__MALFORMED__") {
        malformedTimestampCount += 1;
        warnings.push(`stop_${sequence}_${field}:timestamp_malformed`);
        (stop as Record<string, unknown>)[field] = null;
      }
    }
    return stop;
  }).filter((stop) => Boolean(stop.facilityCode || stop.stopType || stop.plannedArrival || stop.plannedDeparture || stop.actualArrival || stop.actualDeparture));
  return { stops, warnings, malformedTimestampCount };
}

function readDateTime(columnMap: Map<string, number>, row: string[], prefix: string, key: string): string | null {
  const direct = readFirst(columnMap, row, [`${prefix}${key}`, `${prefix}${key}_timestamp`]);
  if (direct) return normalizeTimestamp(direct);
  const date = readFirst(columnMap, row, [`${prefix}${key}_date`, `${prefix}${key}_date_local`]);
  const time = readFirst(columnMap, row, [`${prefix}${key}_time`, `${prefix}${key}_time_local`]);
  if (!date && !time) return null;
  const parsedDate = parseDateOnly(date, { assumeSlashMonthDay: true });
  if (!parsedDate.value || (time && !/^\d{1,2}:\d{2}(?::\d{2})?$/.test(time))) return "__MALFORMED__";
  return `${parsedDate.value}T${time ? time.padStart(5, "0") : "00:00"}`;
}

function normalizeTimestamp(value: string): string | null {
  const dateOnly = parseDateOnly(value);
  if (dateOnly.value && !/[T ]\d{1,2}:\d{2}/.test(value)) return dateOnly.value;
  const match = value.match(/^(\d{4}-\d{1,2}-\d{1,2})[T ](\d{1,2}:\d{2}(?::\d{2})?)(?:Z|[+-]\d{2}:?\d{2})?$/);
  if (!match) return "__MALFORMED__";
  const parsedDate = parseDateOnly(match[1]);
  if (!parsedDate.value) return "__MALFORMED__";
  return `${parsedDate.value}T${match[2].padStart(5, "0")}`;
}

function readFirst(columnMap: Map<string, number>, row: string[], names: string[]): string | null {
  for (const name of names) {
    const index = columnMap.get(name);
    if (index !== undefined) {
      const value = displayOrNull(row[index]);
      if (value) return value;
    }
  }
  return null;
}

function parseOptionalNumber(value: unknown): { value: number | null; warning?: string } {
  if (value === null || value === undefined || value === "") return { value: null };
  const raw = displayValue(value).replace(/,/g, "");
  if (/^-?\d+(?:\.\d+)?$/.test(raw)) return { value: Number(raw) };
  return { value: null, warning: "number_malformed" };
}

function displayOrNull(value: unknown): string | null {
  const text = displayValue(value);
  return text ? text : null;
}
