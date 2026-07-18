import { activeOn, normalizeReferenceValue, referenceIssue, referenceRootIssueKey, type EffectiveRange, type ReferenceResolution } from "./resolution-types";

export interface VehicleIdentifierMapping extends EffectiveRange {
  id: string;
  organizationId: string;
  vehicleId: string;
  provider: "amazon" | "octane" | "manual";
  identifierType: "tractor_vehicle_id" | "amazon_unit" | "fuel_unit" | "fuel_card";
  externalValue: string;
  normalizedValue: string;
}

export interface ApprovedFuelCardAssignment extends EffectiveRange {
  id: string;
  organizationId: string;
  fuelCardId: string;
  vehicleId: string | null;
  driverId: string | null;
  status: "draft" | "approved" | "archived";
}

export interface ResolvedVehicle {
  vehicleId: string;
}

export function resolveVehicleIdentifier(args: {
  organizationId: string;
  serviceDate: string | null;
  mappings: VehicleIdentifierMapping[];
  amazonTractorId?: string | null;
  amazonUnit?: string | null;
  fuelUnit?: string | null;
  approvedFuelCardAssignment?: ApprovedFuelCardAssignment | null;
}): ReferenceResolution<ResolvedVehicle> {
  const priority: Array<{ provider: VehicleIdentifierMapping["provider"]; type: VehicleIdentifierMapping["identifierType"]; value: string | null | undefined; method: string }> = [
    { provider: "amazon", type: "tractor_vehicle_id", value: args.amazonTractorId, method: "exact_amazon_tractor_vehicle_id" },
    { provider: "amazon", type: "amazon_unit", value: args.amazonUnit, method: "exact_amazon_unit" },
    { provider: "octane", type: "fuel_unit", value: args.fuelUnit, method: "exact_fuel_unit_alias" },
  ];

  for (const entry of priority) {
    const resolved = resolveByAlias(args.organizationId, args.serviceDate, args.mappings, entry.provider, entry.type, entry.value, entry.method);
    if (resolved.status !== "unmatched") return resolved;
  }

  const assignment = args.approvedFuelCardAssignment;
  if (assignment?.status === "approved" && assignment.vehicleId && assignment.organizationId === args.organizationId && activeOn(assignment, args.serviceDate)) {
    return {
      status: "resolved",
      method: "approved_fuel_card_assignment",
      confidence: 1,
      value: { vehicleId: assignment.vehicleId },
      sourceMappingId: assignment.id,
      issues: [],
    };
  }
  const unresolvedIdentity = firstVehicleIdentity(args);
  return {
    status: "unmatched",
    method: "manual",
    confidence: 0,
    value: null,
    sourceMappingId: null,
    issues: [referenceIssue(
      "unresolved_vehicle_identifier",
      "blocking",
      "Vehicle reference has no approved exact mapping.",
      {},
      unresolvedIdentity
        ? referenceRootIssueKey("vehicle", {
          organizationId: args.organizationId,
          provider: unresolvedIdentity.provider,
          identifierType: unresolvedIdentity.type,
          normalizedValue: unresolvedIdentity.value,
        })
        : undefined,
    )],
  };
}

function firstVehicleIdentity(args: {
  amazonTractorId?: string | null;
  amazonUnit?: string | null;
  fuelUnit?: string | null;
}): { provider: VehicleIdentifierMapping["provider"]; type: VehicleIdentifierMapping["identifierType"]; value: string } | null {
  const identities: Array<{ provider: VehicleIdentifierMapping["provider"]; type: VehicleIdentifierMapping["identifierType"]; value: string | null }> = [
    { provider: "amazon", type: "tractor_vehicle_id", value: normalizeReferenceValue(args.amazonTractorId) },
    { provider: "amazon", type: "amazon_unit", value: normalizeReferenceValue(args.amazonUnit) },
    { provider: "octane", type: "fuel_unit", value: normalizeReferenceValue(args.fuelUnit) },
  ];
  return identities.find((identity): identity is { provider: VehicleIdentifierMapping["provider"]; type: VehicleIdentifierMapping["identifierType"]; value: string } => Boolean(identity.value)) ?? null;
}

function resolveByAlias(
  organizationId: string,
  serviceDate: string | null,
  mappings: VehicleIdentifierMapping[],
  provider: VehicleIdentifierMapping["provider"],
  identifierType: VehicleIdentifierMapping["identifierType"],
  externalValue: string | null | undefined,
  method: string,
): ReferenceResolution<ResolvedVehicle> {
  const normalized = normalizeReferenceValue(externalValue);
  if (!normalized) {
    return { status: "unmatched", method, confidence: 0, value: null, sourceMappingId: null, issues: [] };
  }
  const matches = mappings.filter((mapping) =>
    mapping.organizationId === organizationId
    && mapping.provider === provider
    && mapping.identifierType === identifierType
    && mapping.normalizedValue === normalized
    && activeOn(mapping, serviceDate)
  );
  const vehicles = new Set(matches.map((mapping) => mapping.vehicleId));
  if (vehicles.size === 1) {
    return {
      status: "resolved",
      method,
      confidence: 1,
      value: { vehicleId: matches[0].vehicleId },
      sourceMappingId: matches[0].id,
      issues: [],
    };
  }
  if (vehicles.size > 1) {
    return {
      status: "ambiguous",
      method,
      confidence: 0,
      value: null,
      sourceMappingId: null,
      issues: [referenceIssue(
        "conflicting_vehicle_identifiers",
        "blocking",
        "Multiple active vehicle mappings match the same exact identifier.",
        { candidateCount: vehicles.size },
        referenceRootIssueKey("vehicle", { organizationId, provider, identifierType, normalizedValue: normalized }),
      )],
    };
  }
  return { status: "unmatched", method, confidence: 0, value: null, sourceMappingId: null, issues: [] };
}
