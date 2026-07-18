import type { ReferenceDependency, ReferenceIssue, ReferenceIssueSeverity, ReferenceRootIssue, ReferenceRootIssueCategory } from "./resolution-types";

export interface ReferenceIssueCounts {
  blocking: number;
  warning: number;
  byCode: Record<string, number>;
}

export interface ReferenceRootIssueCounts {
  uniqueBlocking: number;
  uniqueWarning: number;
  byCategory: Record<ReferenceRootIssueCategory, number>;
  dependencyCount: number;
}

export interface ReferenceIssueCollection {
  rootIssues: ReferenceRootIssue[];
  dependencies: ReferenceDependency[];
  counts: ReferenceRootIssueCounts;
}

export function collectReferenceIssues(results: Array<{ blockingIssues?: ReferenceIssue[]; warnings?: ReferenceIssue[]; issues?: ReferenceIssue[] }>): ReferenceIssue[] {
  return results.flatMap((result) => [
    ...(result.blockingIssues ?? []),
    ...(result.warnings ?? []),
    ...(result.issues ?? []),
  ]);
}

export function countReferenceIssues(issues: ReferenceIssue[]): ReferenceIssueCounts {
  return {
    blocking: countBySeverity(issues, "blocking"),
    warning: countBySeverity(issues, "warning"),
    byCode: issues.reduce<Record<string, number>>((counts, issue) => {
      counts[issue.issueCode] = (counts[issue.issueCode] ?? 0) + 1;
      return counts;
    }, {}),
  };
}

export function rootIssueFromReferenceIssue(
  issue: ReferenceIssue,
  category: ReferenceRootIssueCategory,
): ReferenceRootIssue | null {
  if (!issue.issueKey) return null;
  return {
    issueKey: issue.issueKey,
    category,
    issueCode: issue.issueCode,
    severity: issue.severity,
    message: issue.message,
    details: issue.details,
  };
}

export function dedupeRootIssues(rootIssues: ReferenceRootIssue[]): ReferenceRootIssue[] {
  const byKey = new Map<string, ReferenceRootIssue>();
  for (const issue of rootIssues) {
    const current = byKey.get(issue.issueKey);
    if (!current || severityRank(issue.severity) > severityRank(current.severity)) {
      byKey.set(issue.issueKey, issue);
    }
  }
  return [...byKey.values()].sort((a, b) => a.issueKey.localeCompare(b.issueKey));
}

export function collectReferenceIssueModel(args: {
  rootIssues: ReferenceRootIssue[];
  dependencies: ReferenceDependency[];
}): ReferenceIssueCollection {
  const rootIssues = dedupeRootIssues(args.rootIssues);
  const dependencyKeys = new Set<string>();
  const dependencies = args.dependencies.filter((dependency) => {
    if (dependencyKeys.has(dependency.dependencyKey)) return false;
    dependencyKeys.add(dependency.dependencyKey);
    return true;
  });
  return {
    rootIssues,
    dependencies,
    counts: {
      uniqueBlocking: rootIssues.filter((issue) => issue.severity === "blocking").length,
      uniqueWarning: rootIssues.filter((issue) => issue.severity === "warning").length,
      byCategory: rootIssues.reduce<Record<ReferenceRootIssueCategory, number>>((counts, issue) => {
        counts[issue.category] = (counts[issue.category] ?? 0) + 1;
        return counts;
      }, {
        driver: 0,
        vehicle: 0,
        facility: 0,
        fuel_assignment: 0,
        team_split: 0,
        financial: 0,
      }),
      dependencyCount: dependencies.reduce((sum, dependency) => sum + dependency.rootIssueKeys.length, 0),
    },
  };
}

function countBySeverity(issues: ReferenceIssue[], severity: ReferenceIssueSeverity): number {
  return issues.filter((issue) => issue.severity === severity).length;
}

function severityRank(severity: ReferenceIssueSeverity): number {
  return severity === "blocking" ? 2 : 1;
}
