import "server-only";

import { extractText, getDocumentProxy } from "unpdf";
import type { AmazonParserInput, AmazonSchemaInspection } from "../contracts";
import type { FuelCardGroup, FuelReport, FuelTransaction } from "../fuel/fuel-normalization";
import { reconcileFuelReport } from "../fuel/fuel-reconciliation";
import { parseOctaneFuelTextPages } from "./octane-fuel-text";

export async function inspectOctaneFuelPdfSchema(input: AmazonParserInput): Promise<AmazonSchemaInspection> {
  const report = await parseOctaneFuelPdf(input.bytes);
  return {
    signature: report.schemaSignature,
    warnings: report.issues.filter((issue) => issue.severity === "warning").map((issue) => issue.issueCode),
    details: {
      provider: report.provider,
      cardGroupCount: report.cardGroups.length,
      reportedTransactionCount: report.reportedTransactionCount,
    },
  };
}

export async function parseOctaneFuelPdf(bytes: Uint8Array): Promise<FuelReport> {
  const data = bytes instanceof Buffer
    ? new Uint8Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
    : bytes;
  const pdf = await getDocumentProxy(data);
  const result = await extractText(pdf, { mergePages: false });
  const pages = Array.isArray(result.text) ? result.text : [result.text];
  return parseOctaneFuelTextPages(pages);
}

export async function parseOctaneFuelReport(input: AmazonParserInput): Promise<FuelReport> {
  return parseOctaneFuelPdf(input.bytes);
}

export function octaneFuelAdapter() {
  return {
    inspectSchema: inspectOctaneFuelPdfSchema,
    parseReport: parseOctaneFuelReport,
    parseCardGroups: (report: FuelReport) => report.cardGroups,
    parseTransactions: (group: FuelCardGroup) => group.transactions,
    parseProductLines: (transaction: FuelTransaction) => transaction.productLines,
    reconcile: reconcileFuelReport,
  };
}
