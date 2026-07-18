import type { AmazonParserIssue } from "../types";

export function matchingIssue(issueCode: string, severity: "warning" | "blocking", message: string, details: Record<string, unknown> = {}): AmazonParserIssue {
  return { fileId: null, rawRowId: null, issueCode, severity, message, details };
}
