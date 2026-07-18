import type { AmazonImportIssueSeverity, AmazonParserIssue, JsonObject } from "../types";

export function parserIssue(
  issueCode: string,
  severity: AmazonImportIssueSeverity,
  message: string,
  details: JsonObject = {},
): AmazonParserIssue {
  return { fileId: null, rawRowId: null, issueCode, severity, message, details };
}
