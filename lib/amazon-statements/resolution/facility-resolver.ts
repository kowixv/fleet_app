import { activeOn, normalizeReferenceValue, referenceIssue, referenceRootIssueKey, type EffectiveRange, type ReferenceResolution } from "./resolution-types";

export interface FacilityLocationMapping extends EffectiveRange {
  id: string;
  organizationId: string;
  provider: string;
  facilityCode: string;
  normalizedFacilityCode: string;
  city: string;
  state: string;
  verificationStatus: "unverified" | "manually_verified" | "imported_verified" | "rejected";
}

export interface ResolvedFacility {
  facilityCode: string;
  city: string;
  state: string;
}

export function resolveFacility(args: {
  organizationId: string;
  provider: string;
  facilityCode: string | null;
  serviceDate: string | null;
  mappings: FacilityLocationMapping[];
  requireVerifiedForDisplay: boolean;
}): ReferenceResolution<ResolvedFacility> {
  const normalized = normalizeReferenceValue(args.facilityCode);
  const issueKey = normalized
    ? referenceRootIssueKey("facility", { organizationId: args.organizationId, provider: args.provider, normalizedCode: normalized })
    : undefined;
  if (!normalized) {
    return {
      status: args.requireVerifiedForDisplay ? "unmatched" : "not_required",
      method: "manual",
      confidence: 0,
      value: null,
      sourceMappingId: null,
      issues: args.requireVerifiedForDisplay
        ? [referenceIssue("unresolved_facility", "blocking", "Facility code is required for displayed route resolution.")]
        : [],
    };
  }
  const candidates = args.mappings.filter((mapping) =>
    mapping.organizationId === args.organizationId
    && mapping.provider === args.provider
    && mapping.normalizedFacilityCode === normalized
    && activeOn(mapping, args.serviceDate)
    && mapping.verificationStatus !== "rejected"
  );
  const verified = candidates.filter((mapping) =>
    mapping.verificationStatus === "manually_verified" || mapping.verificationStatus === "imported_verified"
  );
  if (verified.length === 1) {
    return {
      status: "resolved",
      method: "exact_facility_code",
      confidence: 1,
      value: { facilityCode: verified[0].facilityCode, city: verified[0].city, state: verified[0].state },
      sourceMappingId: verified[0].id,
      issues: [],
    };
  }
  if (verified.length > 1) {
    return {
      status: "ambiguous",
      method: "exact_facility_code",
      confidence: 0,
      value: null,
      sourceMappingId: null,
      issues: [referenceIssue("ambiguous_facility", "blocking", "Multiple verified facility mappings are active for the same source code.", { candidateCount: verified.length }, issueKey)],
    };
  }
  return {
    status: candidates.length > 0 ? "proposed" : "unmatched",
    method: "manual",
    confidence: candidates.length > 0 ? 0.4 : 0,
    value: null,
    sourceMappingId: candidates[0]?.id ?? null,
    issues: args.requireVerifiedForDisplay
      ? [referenceIssue("unresolved_facility", "blocking", "Verified facility mapping is required for displayed route resolution.", { hasUnverifiedCandidate: candidates.length > 0 }, issueKey)]
      : [referenceIssue("unresolved_facility", "warning", "Facility mapping is unresolved before final route display.", { hasUnverifiedCandidate: candidates.length > 0 }, issueKey)],
  };
}
