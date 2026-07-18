import { activeOn, normalizeReferenceValue, referenceIssue, referenceRootIssueKey, type EffectiveRange, type ReferenceResolution } from "./resolution-types";

export interface DriverIdentifierMapping extends EffectiveRange {
  id: string;
  organizationId: string;
  provider: "amazon" | "octane" | "manual";
  identifierType: "driver_display_name" | "driver_external_id" | "fuel_driver_label";
  externalValue: string;
  normalizedValue: string;
  personId: string;
  status: "proposed" | "approved" | "rejected" | "archived";
  confidenceScore: number | null;
}

export interface ResolvedDriver {
  personId: string;
}

export function resolveDriverIdentifier(args: {
  organizationId: string;
  provider: DriverIdentifierMapping["provider"];
  identifierType: DriverIdentifierMapping["identifierType"];
  externalValue: string | null;
  serviceDate: string | null;
  mappings: DriverIdentifierMapping[];
}): ReferenceResolution<ResolvedDriver> {
  const normalized = normalizeReferenceValue(args.externalValue);
  if (!normalized) {
    return unmatched("unresolved_driver_identifier", "Driver identifier is missing.");
  }
  const issueKey = referenceRootIssueKey("driver", {
    organizationId: args.organizationId,
    provider: args.provider,
    normalizedIdentifier: normalized,
  });
  const candidates = args.mappings.filter((mapping) =>
    mapping.organizationId === args.organizationId
    && mapping.provider === args.provider
    && mapping.identifierType === args.identifierType
    && mapping.normalizedValue === normalized
    && activeOn(mapping, args.serviceDate)
    && mapping.status !== "rejected"
    && mapping.status !== "archived"
  );
  const approved = candidates.filter((mapping) => mapping.status === "approved");
  const approvedPeople = new Set(approved.map((mapping) => mapping.personId));
  if (approvedPeople.size === 1) {
    const mapping = approved[0];
    return {
      status: "resolved",
      method: "exact_driver_identifier",
      confidence: mapping.confidenceScore ?? 1,
      value: { personId: mapping.personId },
      sourceMappingId: mapping.id,
      issues: [],
    };
  }
  if (approvedPeople.size > 1) {
    return {
      status: "ambiguous",
      method: "exact_driver_identifier",
      confidence: 0,
      value: null,
      sourceMappingId: null,
      issues: [referenceIssue("ambiguous_driver_identifier", "blocking", "Multiple approved driver mappings are active for one external identifier.", { candidateCount: approvedPeople.size }, issueKey)],
    };
  }
  const proposed = candidates.filter((mapping) => mapping.status === "proposed");
  if (proposed.length > 0) {
    return {
      status: "proposed",
      method: "exact_driver_identifier",
      confidence: proposed[0].confidenceScore ?? 0.5,
      value: { personId: proposed[0].personId },
      sourceMappingId: proposed[0].id,
      issues: [referenceIssue("unresolved_driver_identifier", "warning", "Driver identifier has only a proposed mapping and requires review.", { proposedCandidateCount: proposed.length }, issueKey)],
    };
  }
  return unmatched("unresolved_driver_identifier", "Driver identifier has no approved mapping.", issueKey);
}

export function resolveDriverTokens(args: {
  organizationId: string;
  provider: DriverIdentifierMapping["provider"];
  identifierType: DriverIdentifierMapping["identifierType"];
  tokens: string[];
  serviceDate: string | null;
  mappings: DriverIdentifierMapping[];
}): Array<ReferenceResolution<ResolvedDriver>> {
  return args.tokens.map((token) => resolveDriverIdentifier({ ...args, externalValue: token }));
}

function unmatched(issueCode: string, message: string, issueKey?: string): ReferenceResolution<ResolvedDriver> {
  return {
    status: "unmatched",
    method: "manual",
    confidence: 0,
    value: null,
    sourceMappingId: null,
    issues: [referenceIssue(issueCode, "blocking", message, {}, issueKey)],
  };
}
