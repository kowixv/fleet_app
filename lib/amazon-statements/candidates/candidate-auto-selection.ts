export type CandidateAutoSelectionStatus = "exact" | "ambiguous" | "unmatched";

export interface CandidateAutoSelectionHint {
  suggestedPersonIds: string[];
  suggestedVehicleIds: string[];
  autoSelectionStatus: CandidateAutoSelectionStatus;
  autoSelectionReasons: string[];
}

export interface CandidateAutoSelectableSource extends CandidateAutoSelectionHint {
  sourceId: string;
}

export interface CandidateAutoSelectionVehicle {
  id: string;
  ownerId: string | null;
}

export type CandidateStatementType = "company_driver" | "box_truck_driver" | "owner_operator" | "managed_investor";

export interface CandidateAutoSelectionResult {
  selectedSourceIds: string[];
  exactMatchCount: number;
  reviewRequiredCount: number;
}

export function autoSelectCandidateSources(args: {
  statementType: CandidateStatementType;
  payeeId: string;
  vehicleId: string | null;
  vehicles: CandidateAutoSelectionVehicle[];
  sources: CandidateAutoSelectableSource[];
}): CandidateAutoSelectionResult {
  const payeeId = args.payeeId.trim();
  const vehicleId = args.vehicleId?.trim() || null;
  if (!payeeId) {
    return {
      selectedSourceIds: [],
      exactMatchCount: 0,
      reviewRequiredCount: args.sources.length,
    };
  }

  const selectedVehicle = vehicleId
    ? args.vehicles.find((vehicle) => vehicle.id === vehicleId) ?? null
    : null;
  const ownershipLane = args.statementType === "owner_operator" || args.statementType === "managed_investor";
  const selectedSourceIds: string[] = [];
  let reviewRequiredCount = 0;

  for (const source of args.sources) {
    if (source.autoSelectionStatus !== "exact") {
      reviewRequiredCount += 1;
      continue;
    }

    const personMatch = source.suggestedPersonIds.includes(payeeId);
    const vehicleMatch = Boolean(vehicleId && source.suggestedVehicleIds.includes(vehicleId));
    const payeeOwnsSelectedVehicle = Boolean(
      ownershipLane
      && selectedVehicle
      && selectedVehicle.ownerId === payeeId,
    );

    let compatible = false;
    if (ownershipLane) {
      compatible = personMatch || (payeeOwnsSelectedVehicle && vehicleMatch);
    } else {
      compatible = personMatch;
    }

    if (compatible && vehicleId && source.suggestedVehicleIds.length > 0 && !vehicleMatch) {
      compatible = false;
    }

    if (compatible) selectedSourceIds.push(source.sourceId);
    else reviewRequiredCount += 1;
  }

  return {
    selectedSourceIds,
    exactMatchCount: selectedSourceIds.length,
    reviewRequiredCount,
  };
}

export function uniqueOwnedVehicleId(args: {
  statementType: CandidateStatementType;
  payeeId: string;
  vehicles: CandidateAutoSelectionVehicle[];
}): string | null {
  if (args.statementType !== "owner_operator" && args.statementType !== "managed_investor") return null;
  const owned = args.vehicles.filter((vehicle) => vehicle.ownerId === args.payeeId);
  return owned.length === 1 ? owned[0].id : null;
}
