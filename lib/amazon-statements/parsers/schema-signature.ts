import type { AmazonImportSourceType, ParserIdentity, SchemaSignature } from "../types";
import { normalizeHeader, sha256Hex, stableJson } from "./normalization";

export type CompatibilityStatus = "compatible" | "warning" | "blocking";

export interface SchemaInspectionDetails {
  normalizedColumns: string[];
  missingColumns: string[];
  extraColumns: string[];
  duplicateColumns: string[];
  compatibilityStatus: CompatibilityStatus;
  recognizedSchemaVersion: string | null;
}

export function inspectColumns(args: {
  sourceType: AmazonImportSourceType;
  parser: ParserIdentity;
  observedColumns: string[];
  requiredColumns: string[];
  optionalColumns?: string[];
  recognizedSchemaVersion?: string;
}): { signature: SchemaSignature; details: SchemaInspectionDetails; warnings: string[] } {
  const normalizedColumns = args.observedColumns.map(normalizeHeader);
  const required = args.requiredColumns.map(normalizeHeader);
  const optional = (args.optionalColumns ?? []).map(normalizeHeader);
  const counts = new Map<string, number>();
  for (const column of normalizedColumns) counts.set(column, (counts.get(column) ?? 0) + 1);
  const duplicateColumns = [...counts].filter(([, count]) => count > 1).map(([column]) => column);
  const observedSet = new Set(normalizedColumns);
  const knownSet = new Set([...required, ...optional]);
  const missingColumns = required.filter((column) => !observedSet.has(column));
  const extraColumns = normalizedColumns.filter((column) => column && !knownSet.has(column));
  const compatibilityStatus: CompatibilityStatus = missingColumns.length || duplicateColumns.length ? "blocking" : extraColumns.length ? "warning" : "compatible";
  const signature = sha256Hex(stableJson({
    sourceType: args.sourceType,
    columns: normalizedColumns,
    required,
    optional,
  }));
  return {
    signature: { sourceType: args.sourceType, signature, parser: args.parser },
    warnings: [
      ...missingColumns.map((column) => `missing_column:${column}`),
      ...extraColumns.map((column) => `extra_column:${column}`),
      ...duplicateColumns.map((column) => `duplicate_column:${column}`),
    ],
    details: {
      normalizedColumns,
      missingColumns,
      extraColumns,
      duplicateColumns,
      compatibilityStatus,
      recognizedSchemaVersion: compatibilityStatus === "compatible" || compatibilityStatus === "warning"
        ? args.recognizedSchemaVersion ?? "synthetic-v1"
        : null,
    },
  };
}
