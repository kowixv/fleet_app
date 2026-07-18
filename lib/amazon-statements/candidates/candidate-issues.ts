import type { AmazonImportIssueSeverity } from "../types";

export type CandidateIssueCode =
  | "missing_configuration"
  | "missing_payee"
  | "missing_vehicle"
  | "invalid_accounting_lane"
  | "duplicate_revenue_source"
  | "duplicate_fuel_source"
  | "source_outside_period"
  | "source_revision_changed"
  | "projection_conflict"
  | "financial_mismatch"
  | "placeholder_fuel_selected"
  | "unresolved_fuel_assignment"
  | "missing_team_split"
  | "invalid_team_split"
  | "stale_preview"
  | "changed_settlement_settings"
  | "pending_projected_load"
  | "non_deductible_projected_expense"
  | "source_already_linked"
  | "converted_candidate"
  | "not_ready";

export interface CandidateIssue {
  issueCode: CandidateIssueCode;
  severity: AmazonImportIssueSeverity;
  message: string;
  sourceType?: "candidate" | "revenue" | "fuel" | "adjustment" | "team" | "conversion";
  sourceId?: string | null;
  details?: Record<string, unknown>;
}

export function candidateIssue(
  issueCode: CandidateIssueCode,
  severity: AmazonImportIssueSeverity,
  message: string,
  details: Record<string, unknown> = {},
  sourceType: CandidateIssue["sourceType"] = "candidate",
  sourceId: string | null = null,
): CandidateIssue {
  return { issueCode, severity, message, details, sourceType, sourceId };
}

export function hasBlockingCandidateIssue(issues: CandidateIssue[]): boolean {
  return issues.some((issue) => issue.severity === "blocking");
}
