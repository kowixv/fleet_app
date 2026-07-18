import { activeOn, deterministicTeamKey, referenceIssue, referenceRootIssueKey, type EffectiveRange, type ReferenceIssue, type ReferenceResolution } from "./resolution-types";
import type { ResolvedDriver } from "./driver-resolver";

export interface TeamSplitRule extends EffectiveRange {
  id: string;
  organizationId: string;
  provider: "amazon" | "manual";
  teamKey: string;
  status: "proposed" | "approved" | "rejected" | "archived";
}

export interface TeamSplitRuleMember {
  id: string;
  organizationId: string;
  teamSplitRuleId: string;
  personId: string;
  memberOrder: number;
  splitBasisPoints: number;
}

export interface TeamAllocation {
  personId: string;
  memberOrder: number;
  splitBasisPoints: number;
}

export function teamKeyFromDriverTokens(tokens: string[]): string {
  return deterministicTeamKey(tokens);
}

export function resolveTeamSplit(args: {
  organizationId: string;
  provider: "amazon" | "manual";
  driverTokens: string[];
  driverResolutions: Array<ReferenceResolution<ResolvedDriver>>;
  serviceDate: string | null;
  rules: TeamSplitRule[];
  members: TeamSplitRuleMember[];
}): ReferenceResolution<{ teamKey: string; allocations: TeamAllocation[] }> {
  const issues: ReferenceIssue[] = [];
  const resolvedPeople = args.driverResolutions.map((resolution) => resolution.value?.personId).filter((value): value is string => Boolean(value));
  const teamKey = teamKeyFromDriverTokens(args.driverTokens);
  const issueKey = referenceRootIssueKey("team_split", { organizationId: args.organizationId, teamKey });
  if (resolvedPeople.length !== args.driverTokens.length) {
    issues.push(referenceIssue("missing_team_split", "blocking", "Every team driver token must resolve before team split can be applied.", { teamKey }, issueKey));
  }
  const activeRules = args.rules.filter((rule) =>
    rule.organizationId === args.organizationId
    && rule.provider === args.provider
    && rule.teamKey === teamKey
    && rule.status === "approved"
    && activeOn(rule, args.serviceDate)
  );
  if (activeRules.length === 0) {
    issues.push(referenceIssue("missing_team_split", "blocking", "Approved team split rule is missing.", { teamKey }, issueKey));
  }
  if (activeRules.length > 1) {
    issues.push(referenceIssue("missing_team_split", "blocking", "Multiple approved team split rules are active for one team key.", { teamKey, activeRuleCount: activeRules.length }, issueKey));
  }
  const rule = activeRules[0];
  const allocations = rule
    ? args.members
      .filter((member) => member.organizationId === args.organizationId && member.teamSplitRuleId === rule.id)
      .sort((a, b) => a.memberOrder - b.memberOrder)
      .map((member) => ({ personId: member.personId, memberOrder: member.memberOrder, splitBasisPoints: member.splitBasisPoints }))
    : [];
  const total = allocations.reduce((sum, allocation) => sum + allocation.splitBasisPoints, 0);
  if (rule && total !== 10000) {
    issues.push(referenceIssue("invalid_team_split_total", "blocking", "Approved team split members must sum to 10000 basis points.", { totalBasisPoints: total }));
  }
  if (new Set(allocations.map((allocation) => allocation.personId)).size !== allocations.length) {
    issues.push(referenceIssue("team_member_mismatch", "blocking", "Duplicate people are not allowed in one team split rule."));
  }
  if (rule && !sameSet(resolvedPeople, allocations.map((allocation) => allocation.personId))) {
    issues.push(referenceIssue("team_member_mismatch", "blocking", "Team split members do not match resolved driver tokens."));
  }
  return {
    status: issues.some((issue) => issue.severity === "blocking") ? "invalid" : "resolved",
    method: "approved_team_split_rule",
    confidence: issues.length ? 0 : 1,
    value: issues.length ? null : { teamKey, allocations },
    sourceMappingId: rule?.id ?? null,
    issues,
  };
}

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value) => b.includes(value));
}
