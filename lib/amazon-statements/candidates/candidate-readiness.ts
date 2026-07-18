import { usageGroupForSettlementType } from "@/lib/settlement/workflow";
import { candidateIssue, hasBlockingCandidateIssue, type CandidateIssue } from "./candidate-issues";
import type { CandidateCalculationConfig, CandidateReadiness, CandidateStatus } from "./candidate-types";

export function validateCandidateBasics(config: CandidateCalculationConfig): CandidateIssue[] {
  const issues: CandidateIssue[] = [];
  const usageGroup = usageGroupForSettlementType(config.statementType);
  if (!usageGroup) {
    issues.push(candidateIssue("invalid_accounting_lane", "blocking", "Statement type does not map to a supported settlement accounting lane."));
    return issues;
  }
  if (!config.payeeId) {
    issues.push(candidateIssue("missing_payee", "blocking", "A payee must be explicitly approved before candidate readiness.", {}, "candidate"));
  }
  if (!config.vehicleId) {
    issues.push(candidateIssue("missing_vehicle", "blocking", "A vehicle/accounting lane must be explicitly approved before candidate readiness.", {}, "candidate"));
  }
  if (usageGroup !== config.payeeType) {
    issues.push(candidateIssue("invalid_accounting_lane", "blocking", "Payee type must match the settlement usage group.", { usageGroup, payeeType: config.payeeType }));
  }
  if (config.teamRequired) {
    const expected = [...(config.teamExternalPersonIds ?? [])].sort();
    const ruleMembers = [...(config.teamSplitRule?.externalDriverPersonIds ?? [])].sort();
    if (!config.teamSplitRule) {
      issues.push(candidateIssue("missing_team_split", "blocking", "Team candidate requires an approved team split rule.", {}, "team"));
    } else if (expected.length !== ruleMembers.length || expected.some((value, index) => value !== ruleMembers[index])) {
      issues.push(candidateIssue("invalid_team_split", "blocking", "Approved team split members must match the resolved external driver tokens exactly.", { expected, ruleMembers }, "team"));
    } else {
      const total = config.teamSplitRule.members.reduce((sum, member) => sum + member.basisPoints, 0);
      if (total !== 10000) {
        issues.push(candidateIssue("invalid_team_split", "blocking", "Approved team split member basis points must sum to 10000.", { totalBasisPoints: total }, "team"));
      }
    }
  }
  return issues;
}

export function candidateReadiness(args: {
  issues: CandidateIssue[];
  stale?: boolean;
  incomplete?: boolean;
}): CandidateReadiness {
  const status: CandidateStatus = args.stale
    ? "stale"
    : hasBlockingCandidateIssue(args.issues)
      ? "needs_review"
      : args.incomplete
        ? "draft"
        : "ready";
  return { status, ready: status === "ready", issues: args.issues };
}
