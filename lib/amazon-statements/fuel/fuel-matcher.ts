import { normalizeFuelLabel, type FuelCardGroup, type FuelImportIssue, type FuelTransaction, fuelIssue } from "./fuel-normalization";

export type FuelMatchMethod =
  | "effective_card_assignment"
  | "exact_card_id"
  | "exact_unit_alias"
  | "exact_driver_label"
  | "manual";

export type FuelMatchStatus =
  | "exact"
  | "inferred"
  | "ambiguous"
  | "unmatched"
  | "manually_approved"
  | "rejected";

export interface FuelCardAssignmentCandidate {
  organizationId: string;
  fuelCardId: string;
  externalCardId: string | null;
  vehicleId: string | null;
  driverId: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  status?: "draft" | "approved" | "archived";
}

export interface FuelKnownCard {
  organizationId: string;
  fuelCardId: string;
  externalCardId: string;
}

export interface FuelUnitAliasCandidate {
  organizationId: string;
  normalizedUnit: string;
  vehicleId: string;
}

export interface FuelDriverLabelCandidate {
  organizationId: string;
  normalizedDriverLabel: string;
  driverId: string;
}

export interface FuelMatchingContext {
  organizationId: string;
  cardAssignments: FuelCardAssignmentCandidate[];
  knownCards: FuelKnownCard[];
  unitAliases: FuelUnitAliasCandidate[];
  driverLabels: FuelDriverLabelCandidate[];
}

export interface FuelMatchCandidate {
  organizationId: string;
  cardGroupNumber: number;
  transactionFingerprint: string | null;
  fuelCardId: string | null;
  vehicleId: string | null;
  driverId: string | null;
  matchMethod: FuelMatchMethod;
  confidenceScore: number;
  status: FuelMatchStatus;
  reasons: string[];
}

export interface FuelMatchingResult {
  candidates: FuelMatchCandidate[];
  issues: FuelImportIssue[];
}

export function matchFuelCardGroup(
  group: FuelCardGroup,
  context: FuelMatchingContext,
  transaction: FuelTransaction | null = null,
): FuelMatchingResult {
  const issues: FuelImportIssue[] = [];
  const transactionDate = transaction?.transactionAt?.slice(0, 10) ?? null;
  const activeAssignments = context.cardAssignments.filter((assignment) => {
    if (assignment.organizationId !== context.organizationId || assignment.status === "archived") return false;
    if (group.cardExternalId && assignment.externalCardId && normalizeFuelLabel(assignment.externalCardId) !== normalizeFuelLabel(group.cardExternalId)) return false;
    return !transactionDate || dateInHalfOpenRange(transactionDate, assignment.effectiveFrom, assignment.effectiveTo);
  });

  if (hasOverlappingAssignments(activeAssignments)) {
    issues.push(fuelIssue(
      "card_assignment_overlap",
      "blocking",
      "Overlapping active fuel card assignments require manual review.",
      { sourcePage: group.sourcePageStart, sourceGroupNumber: group.sourceGroupNumber, sourceRowNumber: transaction?.sourceRowNumber ?? null },
      { sourceGroupNumber: group.sourceGroupNumber },
    ));
    return { candidates: [manualCandidate(group, context.organizationId, transaction, "ambiguous", ["overlapping_card_assignments"])], issues };
  }
  if (activeAssignments.length === 1 && activeAssignments[0].status === "approved") {
    const assignment = activeAssignments[0];
    return {
      candidates: [{
        organizationId: context.organizationId,
        cardGroupNumber: group.sourceGroupNumber,
        transactionFingerprint: transaction?.sourceTransactionFingerprint ?? null,
        fuelCardId: assignment.fuelCardId,
        vehicleId: assignment.vehicleId,
        driverId: assignment.driverId,
        matchMethod: "effective_card_assignment",
        confidenceScore: 1,
        status: "exact",
        reasons: ["effective_card_assignment"],
      }],
      issues,
    };
  }
  if (activeAssignments.length > 1) {
    issues.push(fuelIssue(
      "ambiguous_fuel_card_match",
      "blocking",
      "Multiple fuel card assignments matched the same source row.",
      { sourcePage: group.sourcePageStart, sourceGroupNumber: group.sourceGroupNumber, sourceRowNumber: transaction?.sourceRowNumber ?? null },
      { sourceGroupNumber: group.sourceGroupNumber, candidateCount: activeAssignments.length },
    ));
    return { candidates: activeAssignments.map((assignment) => assignmentCandidate(group, context.organizationId, assignment, transaction, "ambiguous", 0.25, ["multiple_card_assignments"])), issues };
  }

  const cardMatches = group.cardExternalId
    ? context.knownCards.filter((card) => card.organizationId === context.organizationId && normalizeFuelLabel(card.externalCardId) === normalizeFuelLabel(group.cardExternalId))
    : [];
  if (cardMatches.length === 1) {
    return { candidates: [knownCardCandidate(group, context.organizationId, cardMatches[0], transaction)], issues };
  }
  if (cardMatches.length > 1) {
    issues.push(fuelIssue(
      "ambiguous_fuel_card_match",
      "blocking",
      "Multiple canonical fuel cards matched the same external card identifier.",
      { sourcePage: group.sourcePageStart, sourceGroupNumber: group.sourceGroupNumber, sourceRowNumber: transaction?.sourceRowNumber ?? null },
      { sourceGroupNumber: group.sourceGroupNumber, candidateCount: cardMatches.length },
    ));
    return { candidates: cardMatches.map((card) => ({ ...knownCardCandidate(group, context.organizationId, card, transaction), status: "ambiguous", confidenceScore: 0.3, reasons: ["ambiguous_card_id"] })), issues };
  }

  const unitMatches = group.unitLabelNormalized
    ? context.unitAliases.filter((unit) => unit.organizationId === context.organizationId && unit.normalizedUnit === group.unitLabelNormalized)
    : [];
  if (unitMatches.length === 1) {
    return {
      candidates: [{
        organizationId: context.organizationId,
        cardGroupNumber: group.sourceGroupNumber,
        transactionFingerprint: transaction?.sourceTransactionFingerprint ?? null,
        fuelCardId: null,
        vehicleId: unitMatches[0].vehicleId,
        driverId: null,
        matchMethod: "exact_unit_alias",
        confidenceScore: 0.75,
        status: "inferred",
        reasons: ["exact_unit_alias"],
      }],
      issues,
    };
  }
  if (unitMatches.length > 1) {
    issues.push(fuelIssue(
      "ambiguous_fuel_card_match",
      "blocking",
      "Multiple vehicles matched the same fuel unit label.",
      { sourcePage: group.sourcePageStart, sourceGroupNumber: group.sourceGroupNumber, sourceRowNumber: transaction?.sourceRowNumber ?? null },
      { sourceGroupNumber: group.sourceGroupNumber, candidateCount: unitMatches.length },
    ));
    return { candidates: unitMatches.map((unit) => ({
      organizationId: context.organizationId,
      cardGroupNumber: group.sourceGroupNumber,
      transactionFingerprint: transaction?.sourceTransactionFingerprint ?? null,
      fuelCardId: null,
      vehicleId: unit.vehicleId,
      driverId: null,
      matchMethod: "exact_unit_alias",
      confidenceScore: 0.2,
      status: "ambiguous",
      reasons: ["ambiguous_unit_alias"],
    })), issues };
  }

  const driverMatches = group.driverLabelNormalized
    ? context.driverLabels.filter((driver) => driver.organizationId === context.organizationId && driver.normalizedDriverLabel === group.driverLabelNormalized)
    : [];
  if (driverMatches.length === 1) {
    return {
      candidates: [{
        organizationId: context.organizationId,
        cardGroupNumber: group.sourceGroupNumber,
        transactionFingerprint: transaction?.sourceTransactionFingerprint ?? null,
        fuelCardId: null,
        vehicleId: null,
        driverId: driverMatches[0].driverId,
        matchMethod: "exact_driver_label",
        confidenceScore: 0.5,
        status: "inferred",
        reasons: ["driver_label_requires_review"],
      }],
      issues: [
        ...issues,
        fuelIssue(
          "unmatched_fuel_card",
          "warning",
          "Driver label matched a candidate but cannot auto-approve a financial fuel assignment.",
          { sourcePage: group.sourcePageStart, sourceGroupNumber: group.sourceGroupNumber, sourceRowNumber: transaction?.sourceRowNumber ?? null },
          { sourceGroupNumber: group.sourceGroupNumber },
        ),
      ],
    };
  }
  if (driverMatches.length > 1) {
    issues.push(fuelIssue(
      "ambiguous_fuel_card_match",
      "blocking",
      "Multiple drivers matched the same fuel driver label.",
      { sourcePage: group.sourcePageStart, sourceGroupNumber: group.sourceGroupNumber, sourceRowNumber: transaction?.sourceRowNumber ?? null },
      { sourceGroupNumber: group.sourceGroupNumber, candidateCount: driverMatches.length },
    ));
    return { candidates: driverMatches.map((driver) => ({
      organizationId: context.organizationId,
      cardGroupNumber: group.sourceGroupNumber,
      transactionFingerprint: transaction?.sourceTransactionFingerprint ?? null,
      fuelCardId: null,
      vehicleId: null,
      driverId: driver.driverId,
      matchMethod: "exact_driver_label",
      confidenceScore: 0.2,
      status: "ambiguous",
      reasons: ["ambiguous_driver_label"],
    })), issues };
  }

  issues.push(fuelIssue(
    "unmatched_fuel_card",
    group.isPlaceholderGroup ? "warning" : "blocking",
    "Fuel source row requires manual card/unit/driver review.",
    { sourcePage: group.sourcePageStart, sourceGroupNumber: group.sourceGroupNumber, sourceRowNumber: transaction?.sourceRowNumber ?? null },
    { sourceGroupNumber: group.sourceGroupNumber, placeholderGroup: group.isPlaceholderGroup },
  ));
  return { candidates: [manualCandidate(group, context.organizationId, transaction, "unmatched", ["manual_review_required"])], issues };
}

export function matchFuelReport(reportGroups: FuelCardGroup[], context: FuelMatchingContext): FuelMatchingResult {
  return reportGroups.reduce<FuelMatchingResult>((result, group) => {
    const groupMatch = matchFuelCardGroup(group, context);
    result.candidates.push(...groupMatch.candidates);
    result.issues.push(...groupMatch.issues);
    return result;
  }, { candidates: [], issues: [] });
}

export function dateInHalfOpenRange(date: string, effectiveFrom: string, effectiveTo: string | null): boolean {
  return date >= effectiveFrom && (!effectiveTo || date < effectiveTo);
}

export function hasOverlappingAssignments(assignments: FuelCardAssignmentCandidate[]): boolean {
  const approved = assignments.filter((assignment) => assignment.status === undefined || assignment.status === "approved");
  for (let i = 0; i < approved.length; i += 1) {
    for (let j = i + 1; j < approved.length; j += 1) {
      if (approved[i].fuelCardId === approved[j].fuelCardId
        && approved[i].organizationId === approved[j].organizationId
        && approved[i].effectiveFrom < (approved[j].effectiveTo ?? "9999-12-31")
        && approved[j].effectiveFrom < (approved[i].effectiveTo ?? "9999-12-31")) {
        return true;
      }
    }
  }
  return false;
}

function assignmentCandidate(
  group: FuelCardGroup,
  organizationId: string,
  assignment: FuelCardAssignmentCandidate,
  transaction: FuelTransaction | null,
  status: FuelMatchStatus,
  confidenceScore: number,
  reasons: string[],
): FuelMatchCandidate {
  return {
    organizationId,
    cardGroupNumber: group.sourceGroupNumber,
    transactionFingerprint: transaction?.sourceTransactionFingerprint ?? null,
    fuelCardId: assignment.fuelCardId,
    vehicleId: assignment.vehicleId,
    driverId: assignment.driverId,
    matchMethod: "effective_card_assignment",
    confidenceScore,
    status,
    reasons,
  };
}

function knownCardCandidate(
  group: FuelCardGroup,
  organizationId: string,
  card: FuelKnownCard,
  transaction: FuelTransaction | null,
): FuelMatchCandidate {
  return {
    organizationId,
    cardGroupNumber: group.sourceGroupNumber,
    transactionFingerprint: transaction?.sourceTransactionFingerprint ?? null,
    fuelCardId: card.fuelCardId,
    vehicleId: null,
    driverId: null,
    matchMethod: "exact_card_id",
    confidenceScore: 0.85,
    status: "inferred",
    reasons: ["exact_card_id_requires_assignment_review"],
  };
}

function manualCandidate(
  group: FuelCardGroup,
  organizationId: string,
  transaction: FuelTransaction | null,
  status: FuelMatchStatus,
  reasons: string[],
): FuelMatchCandidate {
  return {
    organizationId,
    cardGroupNumber: group.sourceGroupNumber,
    transactionFingerprint: transaction?.sourceTransactionFingerprint ?? null,
    fuelCardId: null,
    vehicleId: null,
    driverId: null,
    matchMethod: "manual",
    confidenceScore: 0,
    status,
    reasons,
  };
}
