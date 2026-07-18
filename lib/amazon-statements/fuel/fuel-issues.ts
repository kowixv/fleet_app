import type { AmazonParserIssue } from "../types";
import type { FuelImportIssue } from "./fuel-normalization";

export function fuelIssuesToAmazonImportIssues(issues: FuelImportIssue[]): AmazonParserIssue[] {
  return issues.map((issue) => ({
    fileId: null,
    rawRowId: null,
    issueCode: issue.issueCode,
    severity: issue.severity,
    message: issue.message,
    details: {
      ...issue.details,
      sourcePage: issue.location.sourcePage,
      sourceGroupNumber: issue.location.sourceGroupNumber,
      sourceRowNumber: issue.location.sourceRowNumber,
      fieldPath: issue.location.fieldPath ?? null,
      lifecycleStage: "fuel_parser",
    },
  }));
}

export function fuelIssueCodeCounts(issues: FuelImportIssue[]): Record<string, number> {
  return issues.reduce<Record<string, number>>((counts, issue) => {
    counts[issue.issueCode] = (counts[issue.issueCode] ?? 0) + 1;
    return counts;
  }, {});
}
