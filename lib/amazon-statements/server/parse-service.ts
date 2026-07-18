import "server-only";

import { selectAmazonStatementParser } from "../parsers/parser-registry";
import { parsePaymentXlsx } from "../parsers/payment-xlsx";
import { parseTripsCsv } from "../parsers/trips-csv";
import { inspectOctaneFuelPdfSchema, parseOctaneFuelPdf } from "../parsers/octane-fuel-pdf";
import { reconcileFuelReport } from "../fuel/fuel-reconciliation";
import type { AmazonSourceMetadata, AmazonParseResult } from "../contracts";
import type { AmazonPaymentParseResult, AmazonTripsParseResult } from "../types";
import type { FuelReport } from "../fuel/fuel-normalization";
import type { AmazonImportFileRecord } from "./workflow-types";
import { assertWorkflow } from "./workflow-errors";

export type AmazonParsedFileResult =
  | {
      sourceType: "amazon_payment";
      generic: AmazonParseResult;
      payment: AmazonPaymentParseResult;
    }
  | {
      sourceType: "amazon_trips";
      generic: AmazonParseResult;
      trips: AmazonTripsParseResult;
    }
  | {
      sourceType: "fuel_card";
      generic: AmazonParseResult;
      fuel: FuelReport;
      fuelReconciliation: ReturnType<typeof reconcileFuelReport>;
    }
  | {
      sourceType: "statement_reference";
      generic: AmazonParseResult;
    };

export function amazonSourceMetadata(file: AmazonImportFileRecord): AmazonSourceMetadata {
  return {
    sourceType: file.source_type,
    originalFilename: file.original_filename,
    mimeType: file.mime_type,
    sizeBytes: file.size_bytes,
    sha256Hash: file.sha256_hash,
  };
}

export async function parseAmazonImportFile(args: {
  file: AmazonImportFileRecord;
  bytes: Uint8Array;
}): Promise<AmazonParsedFileResult> {
  const metadata = amazonSourceMetadata(args.file);
  if (metadata.sourceType === "statement_reference") {
    return {
      sourceType: "statement_reference",
      generic: { rows: [], issues: [], reconciliations: [] },
    };
  }
  if (metadata.sourceType === "fuel_card") {
    const fuel = await parseOctaneFuelPdf(args.bytes);
    const fuelReconciliation = reconcileFuelReport(fuel);
    return {
      sourceType: "fuel_card",
      fuel,
      fuelReconciliation,
      generic: {
        rows: [],
        issues: fuelReconciliation.issues.map((issue) => ({
          fileId: args.file.id,
          rawRowId: null,
          issueCode: issue.issueCode,
          severity: issue.severity,
          message: issue.message,
          details: { ...issue.details, location: issue.location },
        })),
        reconciliations: [
          {
            reconciliationType: "fuel_report",
            expectedAmount: fuel.reportedTotalAmount,
            actualAmount: fuelReconciliation.calculatedChargedAmount,
            expectedCount: fuel.reportedTransactionCount,
            actualCount: fuelReconciliation.parsedRealTransactionCount,
            details: fuelReconciliation as unknown as Record<string, unknown>,
          },
        ],
      },
    };
  }

  const registry = await selectAmazonStatementParser(metadata, args.bytes);
  assertWorkflow(registry.status === "supported", {
    code: registry.status === "ambiguous" ? "ambiguous_parser" : "unsupported_parser",
    message: "No single approved parser matched this Amazon source file.",
    stage: "inspect_files",
    details: { reasons: registry.reasons },
  });
  const parser = registry.parser;
  const generic = await parser.parse({ bytes: args.bytes, metadata, parser: parser.identity });

  if (metadata.sourceType === "amazon_payment") {
    return {
      sourceType: "amazon_payment",
      generic,
      payment: await parsePaymentXlsx({ bytes: args.bytes, metadata, parser: parser.identity }),
    };
  }
  return {
    sourceType: "amazon_trips",
    generic,
    trips: await parseTripsCsv({ bytes: args.bytes, metadata, parser: parser.identity }),
  };
}

export async function inspectAmazonImportFile(args: {
  file: AmazonImportFileRecord;
  bytes: Uint8Array;
}): Promise<{ parserName: string | null; parserVersion: string | null; schemaSignature: string | null; warnings: string[] }> {
  const metadata = amazonSourceMetadata(args.file);
  if (metadata.sourceType === "statement_reference") {
    return { parserName: null, parserVersion: null, schemaSignature: null, warnings: [] };
  }
  if (metadata.sourceType === "fuel_card") {
    const inspected = await inspectOctaneFuelPdfSchema({ bytes: args.bytes, metadata, parser: { name: "octane-fuel-pdf", version: "0.1.0" } });
    return {
      parserName: inspected.signature.parser.name,
      parserVersion: inspected.signature.parser.version,
      schemaSignature: inspected.signature.signature,
      warnings: inspected.warnings,
    };
  }
  const registry = await selectAmazonStatementParser(metadata, args.bytes);
  assertWorkflow(registry.status === "supported", {
    code: registry.status === "ambiguous" ? "ambiguous_parser" : "unsupported_parser",
    message: "No single approved parser matched this Amazon source file.",
    stage: "inspect_files",
    details: { reasons: registry.reasons },
  });
  const inspected = await registry.parser.inspectSchema({ bytes: args.bytes, metadata, parser: registry.parser.identity });
  return {
    parserName: inspected.signature.parser.name,
    parserVersion: inspected.signature.parser.version,
    schemaSignature: inspected.signature.signature,
    warnings: inspected.warnings,
  };
}
