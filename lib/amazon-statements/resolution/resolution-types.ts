import { sha256Hex, stableJson } from "../parsers/normalization";

export type ReferenceIssueSeverity = "warning" | "blocking";
export type ReferenceStatus = "resolved" | "proposed" | "ambiguous" | "unmatched" | "not_required" | "invalid";
export type ReferenceRootIssueCategory = "driver" | "vehicle" | "facility" | "fuel_assignment" | "team_split" | "financial";
export type RevenueReadinessLevel = "canonical" | "projection" | "settlement" | "statement_display";
export type FuelReadinessLevel = "fuel_source" | "expense_projection" | "settlement_deduction";

export interface ReferenceIssue {
  issueKey?: string;
  issueCode: string;
  severity: ReferenceIssueSeverity;
  message: string;
  details: Record<string, unknown>;
  source?: {
    sourcePage?: number | null;
    sourceRowNumber?: number | null;
    sourceGroupNumber?: number | null;
    fieldPath?: string | null;
  };
}

export interface ReferenceResolution<T = Record<string, unknown>> {
  status: ReferenceStatus;
  method: string;
  confidence: number;
  value: T | null;
  sourceMappingId: string | null;
  issues: ReferenceIssue[];
}

export interface ReferenceRootIssue {
  issueKey: string;
  category: ReferenceRootIssueCategory;
  issueCode: string;
  severity: ReferenceIssueSeverity;
  message: string;
  details: Record<string, unknown>;
}

export interface ReferenceDependency<Level extends string = string> {
  dependencyKey: string;
  itemType: "revenue_item" | "fuel_group";
  itemId: string;
  blockedLevels: Level[];
  rootIssueKeys: string[];
  sourceReferences: Array<{
    sourceFingerprint?: string | null;
    sourceGroupNumber?: number | null;
    sourceRowNumber?: number | null;
  }>;
}

export interface EffectiveRange {
  effectiveFrom: string;
  effectiveTo: string | null;
}

export function normalizeReferenceValue(value: string | null | undefined): string | null {
  const normalized = String(value ?? "").trim().replace(/\s+/g, " ").toUpperCase();
  return normalized || null;
}

export function activeOn(range: EffectiveRange, date: string | null | undefined): boolean {
  if (!date) return true;
  return date >= range.effectiveFrom && (!range.effectiveTo || date < range.effectiveTo);
}

export function rangesOverlap(a: EffectiveRange, b: EffectiveRange): boolean {
  return a.effectiveFrom < (b.effectiveTo ?? "9999-12-31") && b.effectiveFrom < (a.effectiveTo ?? "9999-12-31");
}

export function referenceIssue(
  issueCode: string,
  severity: ReferenceIssueSeverity,
  message: string,
  details: Record<string, unknown> = {},
  issueKey?: string,
): ReferenceIssue {
  return { issueCode, severity, message, details, issueKey };
}

export function hashedReferencePart(value: string | null | undefined): string {
  return sha256Hex(stableJson(normalizeReferenceValue(value) ?? "")).slice(0, 24);
}

export function referenceRootIssueKey(
  category: "driver",
  args: { organizationId: string; provider: string; normalizedIdentifier: string | null | undefined },
): string;
export function referenceRootIssueKey(
  category: "vehicle",
  args: { organizationId: string; provider: string; identifierType: string; normalizedValue: string | null | undefined },
): string;
export function referenceRootIssueKey(
  category: "facility",
  args: { organizationId: string; provider: string; normalizedCode: string | null | undefined },
): string;
export function referenceRootIssueKey(
  category: "fuel_assignment",
  args: { organizationId: string; provider: string; groupIdentity: string | null | undefined },
): string;
export function referenceRootIssueKey(
  category: "team_split",
  args: { organizationId: string; teamKey: string },
): string;
export function referenceRootIssueKey(
  category: ReferenceRootIssueCategory,
  args: Record<string, string | null | undefined>,
): string {
  if (category === "driver") {
    return `driver:${args.organizationId}:${args.provider}:${hashedReferencePart(args.normalizedIdentifier)}`;
  }
  if (category === "vehicle") {
    return `vehicle:${args.organizationId}:${args.provider}:${args.identifierType}:${hashedReferencePart(args.normalizedValue)}`;
  }
  if (category === "facility") {
    return `facility:${args.organizationId}:${args.provider}:${hashedReferencePart(args.normalizedCode)}`;
  }
  if (category === "fuel_assignment") {
    return `fuel-assignment:${args.organizationId}:${args.provider}:${hashedReferencePart(args.groupIdentity)}`;
  }
  if (category === "team_split") {
    return `team-split:${args.organizationId}:${args.teamKey}`;
  }
  return `financial:${args.organizationId}:${hashedReferencePart(args.issueKey)}`;
}

export function deterministicTeamKey(tokens: string[]): string {
  const normalized = tokens.map(normalizeReferenceValue).filter((token): token is string => Boolean(token)).sort();
  return `team_${sha256Hex(stableJson(normalized)).slice(0, 24)}`;
}
