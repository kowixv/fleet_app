import type { AmazonRevenueItem } from "../revenue/revenue-builder";
import type { FuelCardGroup } from "../fuel/fuel-normalization";
import type { FuelReportReconciliation } from "../fuel/fuel-reconciliation";
import type { FuelMatchingContext } from "../fuel/fuel-matcher";
import { referenceIssue, type FuelReadinessLevel, type ReferenceIssue, type RevenueReadinessLevel } from "./resolution-types";
import { resolveFacility, type FacilityLocationMapping } from "./facility-resolver";
import { resolveFuelAssignmentReadiness, type FuelAssignmentReadiness } from "./fuel-assignment-resolver";

export interface RevenueReferenceReadiness {
  facilityStatus: string;
  driverStatus: string;
  vehicleStatus: string;
  teamSplitStatus: string;
  canonicalReady: boolean;
  projectionReady: boolean;
  settlementReady: boolean;
  statementDisplayReady: boolean;
  blockedBy: Record<RevenueReadinessLevel, string[]>;
  blockingIssues: ReferenceIssue[];
  warnings: ReferenceIssue[];
}

export interface FuelReferenceReadiness extends FuelAssignmentReadiness {
  fuelSourceReady: boolean;
  expenseProjectionReady: boolean;
  settlementDeductionReady: boolean;
  blockedBy: Record<FuelReadinessLevel, string[]>;
}

export function revenueReferenceReadiness(args: {
  organizationId: string;
  provider: string;
  item: AmazonRevenueItem;
  facilityMappings: FacilityLocationMapping[];
  requireFacilityForDisplay: boolean;
  driverResolved: boolean;
  vehicleResolved: boolean;
  teamSplitResolved: boolean;
  financialStatus: "passed" | "warning" | "failed";
  projectionRequiresDriver?: boolean;
  projectionRequiresVehicle?: boolean;
  settlementRequiresDriver?: boolean;
  settlementRequiresVehicle?: boolean;
  statementDisplayRequiresFacility?: boolean;
}): RevenueReferenceReadiness {
  const blockingIssues: ReferenceIssue[] = [];
  const warnings: ReferenceIssue[] = [];
  let projectionBlocked = false;
  let settlementBlocked = false;
  let statementDisplayBlocked = false;
  const blockedBy: Record<RevenueReadinessLevel, string[]> = {
    canonical: [],
    projection: [],
    settlement: [],
    statement_display: [],
  };
  const settlementRequiresDriver = args.settlementRequiresDriver ?? true;
  const settlementRequiresVehicle = args.settlementRequiresVehicle ?? true;
  const statementDisplayRequiresFacility = args.statementDisplayRequiresFacility ?? args.requireFacilityForDisplay;
  const facilities = [args.item.originFacilityCode, args.item.destinationFacilityCode].filter(Boolean);
  const facilityResults = facilities.map((facilityCode) => resolveFacility({
    organizationId: args.organizationId,
    provider: args.provider,
    facilityCode,
    serviceDate: args.item.startDate,
    mappings: args.facilityMappings,
    requireVerifiedForDisplay: statementDisplayRequiresFacility,
  }));
  for (const result of facilityResults) {
    const facilityBlockers = result.issues.filter((issue) => issue.severity === "blocking");
    blockingIssues.push(...facilityBlockers);
    warnings.push(...result.issues.filter((issue) => issue.severity === "warning"));
    for (const issue of facilityBlockers) {
      statementDisplayBlocked = true;
      addBlockedBy(blockedBy.statement_display, issue.issueKey);
    }
  }
  if (args.financialStatus !== "passed") {
    const issue = referenceIssue("revenue_financial_reconciliation_failed", "blocking", "Revenue financial reconciliation must pass before projection.");
    blockingIssues.push(issue);
    projectionBlocked = true;
    settlementBlocked = true;
    statementDisplayBlocked = true;
    for (const level of ["canonical", "projection", "settlement", "statement_display"] as const) addBlockedBy(blockedBy[level], issue.issueKey);
  }
  if (!args.driverResolved) {
    const issue = referenceIssue("unresolved_driver_identifier", "blocking", "Revenue item requires approved driver mapping.");
    blockingIssues.push(issue);
    if (args.projectionRequiresDriver) {
      projectionBlocked = true;
      addBlockedBy(blockedBy.projection, issue.issueKey);
    }
    if (settlementRequiresDriver) {
      settlementBlocked = true;
      addBlockedBy(blockedBy.settlement, issue.issueKey);
    }
  }
  if (!args.vehicleResolved) {
    const issue = referenceIssue("unresolved_vehicle_identifier", "blocking", "Revenue item requires approved vehicle mapping.");
    blockingIssues.push(issue);
    if (args.projectionRequiresVehicle) {
      projectionBlocked = true;
      addBlockedBy(blockedBy.projection, issue.issueKey);
    }
    if (settlementRequiresVehicle) {
      settlementBlocked = true;
      addBlockedBy(blockedBy.settlement, issue.issueKey);
    }
  }
  if (args.item.driverAssignmentStatus === "needs_team_split" && !args.teamSplitResolved) {
    const issue = referenceIssue("missing_team_split", "blocking", "Revenue item requires an approved team split rule.");
    blockingIssues.push(issue);
    settlementBlocked = true;
    addBlockedBy(blockedBy.settlement, issue.issueKey);
  }
  const canonicalReady = args.financialStatus === "passed";
  return {
    facilityStatus: facilityResults.length === 0 ? "not_required" : facilityResults.every((result) => result.status === "resolved") ? "resolved" : "unmatched",
    driverStatus: args.driverResolved ? "resolved" : "unmatched",
    vehicleStatus: args.vehicleResolved ? "resolved" : "unmatched",
    teamSplitStatus: args.item.driverAssignmentStatus === "needs_team_split"
      ? args.teamSplitResolved ? "resolved" : "unmatched"
      : "not_required",
    canonicalReady,
    projectionReady: canonicalReady && !projectionBlocked,
    settlementReady: canonicalReady && !settlementBlocked,
    statementDisplayReady: canonicalReady && !statementDisplayBlocked,
    blockedBy,
    blockingIssues,
    warnings,
  };
}

export function fuelReferenceReadiness(args: {
  group: FuelCardGroup;
  matchingContext: FuelMatchingContext;
  reconciliation: FuelReportReconciliation;
}): FuelReferenceReadiness {
  const readiness = resolveFuelAssignmentReadiness(args);
  const financialBlockers = readiness.blockingIssues.filter((issue) => issue.issueCode === "fuel_financial_reconciliation_failed" || issue.issueCode === "duplicate_transaction_fingerprint");
  const assignmentBlockers = readiness.blockingIssues.filter((issue) => issue.issueCode !== "fuel_financial_reconciliation_failed" && issue.issueCode !== "duplicate_transaction_fingerprint");
  const blockedBy: Record<FuelReadinessLevel, string[]> = {
    fuel_source: financialBlockers.map((issue) => issue.issueKey).filter((value): value is string => Boolean(value)),
    expense_projection: financialBlockers.map((issue) => issue.issueKey).filter((value): value is string => Boolean(value)),
    settlement_deduction: args.group.isPlaceholderGroup
      ? []
      : [...financialBlockers, ...assignmentBlockers].map((issue) => issue.issueKey).filter((value): value is string => Boolean(value)),
  };
  const fuelSourceReady = readiness.financialStatus === "passed" && !args.group.isPlaceholderGroup && financialBlockers.length === 0;
  return {
    ...readiness,
    fuelSourceReady,
    expenseProjectionReady: fuelSourceReady && blockedBy.expense_projection.length === 0,
    settlementDeductionReady: fuelSourceReady && blockedBy.settlement_deduction.length === 0,
    blockedBy,
  };
}

function addBlockedBy(values: string[], issueKey: string | undefined): void {
  if (issueKey && !values.includes(issueKey)) values.push(issueKey);
}
