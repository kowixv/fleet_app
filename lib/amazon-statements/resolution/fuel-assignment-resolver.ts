import type { FuelCardGroup } from "../fuel/fuel-normalization";
import type { FuelReportReconciliation } from "../fuel/fuel-reconciliation";
import { matchFuelCardGroup, type FuelMatchingContext, type FuelMatchCandidate } from "../fuel/fuel-matcher";
import { referenceIssue, referenceRootIssueKey, type ReferenceIssue } from "./resolution-types";

export interface FuelAssignmentReadiness {
  cardStatus: string;
  driverStatus: string;
  vehicleStatus: string;
  financialStatus: string;
  projectionReady: boolean;
  candidate: FuelMatchCandidate | null;
  blockingIssues: ReferenceIssue[];
  warnings: ReferenceIssue[];
}

export function resolveFuelAssignmentReadiness(args: {
  group: FuelCardGroup;
  matchingContext: FuelMatchingContext;
  reconciliation: FuelReportReconciliation;
}): FuelAssignmentReadiness {
  const issueKey = fuelAssignmentIssueKey(args.group, args.matchingContext.organizationId);
  if (args.group.isPlaceholderGroup) {
    return {
      cardStatus: "not_required",
      driverStatus: "not_required",
      vehicleStatus: "not_required",
      financialStatus: args.reconciliation.financialStatus,
      projectionReady: false,
      candidate: null,
      blockingIssues: [],
      warnings: [referenceIssue("placeholder_group", "warning", "Placeholder fuel group requires no financial assignment.")],
    };
  }
  const match = matchFuelCardGroup(args.group, args.matchingContext);
  const blockingIssues = match.issues
    .filter((issue) => issue.severity === "blocking")
    .map((issue) => referenceIssue(normalizeFuelAssignmentIssueCode(issue.issueCode), "blocking", issue.message, issue.details, issueKey));
  const warnings = match.issues
    .filter((issue) => issue.severity === "warning")
    .map((issue) => referenceIssue(normalizeFuelAssignmentIssueCode(issue.issueCode), "warning", issue.message, issue.details, issueKey));
  if (args.reconciliation.financialStatus !== "passed") {
    blockingIssues.push(referenceIssue("fuel_financial_reconciliation_failed", "blocking", "Fuel financial reconciliation must pass before projection."));
  }
  const approved = match.candidates.find((candidate) => candidate.status === "exact" || candidate.status === "manually_approved");
  if (!approved && !blockingIssues.some((issue) => issue.issueCode === "unmatched_fuel_assignment")) {
    blockingIssues.push(referenceIssue("unmatched_fuel_assignment", "blocking", "Fuel group requires an approved internal assignment.", {}, issueKey));
  }
  return {
    cardStatus: approved?.fuelCardId ? "resolved" : "unmatched",
    driverStatus: approved?.driverId ? "resolved" : "unmatched",
    vehicleStatus: approved?.vehicleId ? "resolved" : "unmatched",
    financialStatus: args.reconciliation.financialStatus,
    projectionReady: blockingIssues.length === 0 && Boolean(approved),
    candidate: approved ?? match.candidates[0] ?? null,
    blockingIssues,
    warnings,
  };
}

function normalizeFuelAssignmentIssueCode(issueCode: string): string {
  return issueCode === "unmatched_fuel_card" ? "unmatched_fuel_assignment" : issueCode;
}

function fuelAssignmentIssueKey(group: FuelCardGroup, organizationId: string): string {
  const identity = group.cardExternalId
    ?? group.unitLabelNormalized
    ?? group.driverLabelNormalized
    ?? `source-group-${group.sourceGroupNumber}`;
  return referenceRootIssueKey("fuel_assignment", { organizationId, provider: "octane", groupIdentity: identity });
}
