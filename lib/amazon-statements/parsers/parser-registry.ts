import type { AmazonParserInput, AmazonSourceMetadata, AmazonStatementParser } from "../contracts";
import { paymentXlsxParser } from "./payment-xlsx";
import { tripsCsvParser } from "./trips-csv";

export type ParserRegistryResult =
  | { status: "supported"; parser: AmazonStatementParser; confidence: number; reasons: string[] }
  | { status: "unsupported"; confidence: number; reasons: string[] }
  | { status: "ambiguous"; confidence: number; candidates: AmazonStatementParser[]; reasons: string[] };

export const amazonStatementParsers: AmazonStatementParser[] = [
  paymentXlsxParser,
  tripsCsvParser,
];

export async function selectAmazonStatementParser(
  metadata: AmazonSourceMetadata,
  bytes?: Uint8Array,
  parsers: AmazonStatementParser[] = amazonStatementParsers,
): Promise<ParserRegistryResult> {
  const extensionCandidates = parsers.filter((parser) => parser.supports(metadata));
  if (!bytes) {
    if (extensionCandidates.length === 1) return { status: "supported", parser: extensionCandidates[0], confidence: 0.7, reasons: ["declared_source_type_and_extension"] };
    if (extensionCandidates.length > 1) return { status: "ambiguous", confidence: 0.5, candidates: extensionCandidates, reasons: ["multiple_extension_candidates"] };
    return { status: "unsupported", confidence: 0, reasons: ["no_declared_source_type_extension_match"] };
  }

  const inspections: Array<{ parser: AmazonStatementParser; status: string; warnings: string[] }> = [];
  for (const parser of extensionCandidates) {
    try {
      const inspected = await parser.inspectSchema({ bytes, metadata, parser: parser.identity } satisfies AmazonParserInput);
      inspections.push({
        parser,
        status: String(inspected.details?.compatibilityStatus ?? "unknown"),
        warnings: inspected.warnings,
      });
    } catch {
      inspections.push({ parser, status: "blocking", warnings: ["schema_inspection_failed"] });
    }
  }
  const compatible = inspections.filter((entry) => entry.status === "compatible" || entry.status === "warning");
  if (compatible.length === 1) {
    return {
      status: "supported",
      parser: compatible[0].parser,
      confidence: compatible[0].status === "compatible" ? 0.95 : 0.85,
      reasons: ["declared_source_type_extension_and_schema", ...compatible[0].warnings],
    };
  }
  if (compatible.length > 1) {
    return { status: "ambiguous", confidence: 0.6, candidates: compatible.map((entry) => entry.parser), reasons: ["multiple_schema_candidates"] };
  }
  return { status: "unsupported", confidence: 0.1, reasons: inspections.flatMap((entry) => entry.warnings).concat("no_compatible_schema") };
}
