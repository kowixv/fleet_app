import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { extractText, getDocumentProxy } from "unpdf";
import { parsePaymentXlsx } from "../lib/amazon-statements/parsers/payment-xlsx";
import { parseTripsCsv } from "../lib/amazon-statements/parsers/trips-csv";
import { parseOctaneFuelTextPages } from "../lib/amazon-statements/parsers/octane-fuel-text";
import { sha256Hex } from "../lib/amazon-statements/parsers/normalization";
import type { AmazonParserInput, AmazonSourceMetadata } from "../lib/amazon-statements/contracts";
import { matchPaymentTrips } from "../lib/amazon-statements/matching/payment-trip-matcher";
import { buildAmazonRevenueItems } from "../lib/amazon-statements/revenue/revenue-builder";
import { reconcileAmazonRevenue } from "../lib/amazon-statements/revenue/revenue-reconciliation";
import { collectParserBatchIssues, issueCodeCounts } from "../lib/amazon-statements/issues/warning-lineage";
import { reconcileFuelReport } from "../lib/amazon-statements/fuel/fuel-reconciliation";
import { matchFuelReport } from "../lib/amazon-statements/fuel/fuel-matcher";
import { fuelReferenceReadiness, revenueReferenceReadiness } from "../lib/amazon-statements/resolution/reference-readiness";
import { collectReferenceIssueModel, collectReferenceIssues, countReferenceIssues } from "../lib/amazon-statements/resolution/resolution-issues";
import type { AmazonRevenueItem } from "../lib/amazon-statements/revenue/revenue-builder";
import type { AmazonSourceMatch } from "../lib/amazon-statements/matching/payment-trip-matcher";
import {
  deterministicTeamKey,
  normalizeReferenceValue,
  referenceRootIssueKey,
  type ReferenceDependency,
  type ReferenceRootIssue,
} from "../lib/amazon-statements/resolution/resolution-types";
import { mapRevenueItemToLoadProjection } from "../lib/amazon-statements/projection/revenue-load-mapper";
import { fuelProjectionLinesFromGroups, mapFuelLineToExpenseProjection } from "../lib/amazon-statements/projection/fuel-expense-mapper";
import { previewFuelExpenseProjections, previewRevenueLoadProjections } from "../lib/amazon-statements/projection/projection-preview";

const root = process.cwd();
const paymentPath = join(root, "fixtures", "amazon-statements", "sample-week", "PAYMENT.xlsx");
const tripsPath = join(root, "fixtures", "amazon-statements", "sample-week", "Trips.csv");
const fuelPath = join(root, "fixtures", "amazon-statements", "sample-week", "fuel.pdf");

async function main() {
  const paymentBytes = readPrivateFile(paymentPath);
  const tripsBytes = readPrivateFile(tripsPath);
  const fuelBytes = readPrivateFile(fuelPath);
  const payment = await parsePaymentXlsx(makeInput(paymentBytes, {
    sourceType: "amazon_payment",
    originalFilename: "PAYMENT.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  }));
  const trips = await parseTripsCsv(makeInput(tripsBytes, {
    sourceType: "amazon_trips",
    originalFilename: "Trips.csv",
    mimeType: "text/csv",
  }));
  const fuel = await parsePrivateFuelPdf(fuelBytes);
  const fuelReconciliation = reconcileFuelReport(fuel);
  const fuelMatching = matchFuelReport(fuel.cardGroups, {
    organizationId: "private-validator-org",
    cardAssignments: [],
    knownCards: [],
    unitAliases: [],
    driverLabels: [],
  });
  const parserBatchIssues = collectParserBatchIssues({ payment, trips });
  const matching = matchPaymentTrips(payment.detailRows, trips.rows);
  const revenue = buildAmazonRevenueItems({
    invoiceId: payment.summary.invoiceNumber ? sha256Hex(payment.summary.invoiceNumber).slice(0, 16) : "private-invoice",
    paymentRows: payment.detailRows,
    matches: matching.matches,
  });
  const reconciliation = reconcileAmazonRevenue({
    summaryInvoiceTotal: payment.reconciliation.summaryInvoiceTotal,
    validPaymentRowGrossTotal: payment.reconciliation.totalParsedGrossPay,
    parentRowCount: payment.reconciliation.tripParentCount,
    childRowCount: payment.reconciliation.loadChildCount,
    standaloneRowCount: payment.reconciliation.standaloneLoadCount,
    matching,
    revenue,
    parserIssues: parserBatchIssues,
    routeResolutionRequested: false,
  });
  const paymentParserIssues = parserBatchIssues.filter((issue) => issue.lifecycleStage === "payment_parser");
  const tripsParserIssues = parserBatchIssues.filter((issue) => issue.lifecycleStage === "trips_parser");
  const emptyFuelMatchingContext = {
    organizationId: "private-validator-org",
    cardAssignments: [],
    knownCards: [],
    unitAliases: [],
    driverLabels: [],
  };
  const revenueReferenceResults = revenue.items.map((item) => revenueReferenceReadiness({
    organizationId: "private-validator-org",
    provider: "amazon",
    item,
    facilityMappings: [],
    requireFacilityForDisplay: revenueItemRequiresFacilityMapping(item),
    driverResolved: !revenueItemRequiresDriverMapping(item, matching.matches),
    vehicleResolved: !revenueItemRequiresVehicleMapping(item, matching.matches),
    teamSplitResolved: false,
    financialStatus: item.reconciliationStatus,
  }));
  const fuelReferenceResults = fuel.cardGroups.map((group) => fuelReferenceReadiness({
    group,
    reconciliation: fuelReconciliation,
    matchingContext: emptyFuelMatchingContext,
  }));
  const referenceIssues = collectReferenceIssues([...revenueReferenceResults, ...fuelReferenceResults]);
  const referenceIssueCounts = countReferenceIssues(referenceIssues);
  const rootReferenceModel = buildRootReferenceModel({
    organizationId: "private-validator-org",
    revenueItems: revenue.items,
    matches: matching.matches,
    fuelGroups: fuel.cardGroups,
  });
  const revenueProjectionItems = revenue.items.map((item) => mapRevenueItemToLoadProjection({
    item,
    batchId: "private-validator-batch",
    canonicalReady: item.reconciliationStatus === "passed",
    projectionReady: item.reconciliationStatus === "passed",
    settlementReady: false,
  }));
  const revenueProjectionPreview = previewRevenueLoadProjections({ items: revenueProjectionItems });
  const fuelProjectionSourceLines = fuelProjectionLinesFromGroups(fuel.cardGroups);
  const fuelProjectionItems = fuelProjectionSourceLines.map(({ group, transaction, productLine }) => mapFuelLineToExpenseProjection({
    group,
    transaction,
    productLine,
    batchId: "private-validator-batch",
    fuelSourceReady: !group.isPlaceholderGroup && fuelReconciliation.financialStatus === "passed",
    expenseProjectionReady: !group.isPlaceholderGroup && fuelReconciliation.financialStatus === "passed",
    settlementDeductionReady: false,
  }));
  const fuelProjectionPreview = previewFuelExpenseProjections({ items: fuelProjectionItems });
  const zeroFuelLineSkipCount = fuelProjectionItems.filter((item) => item.expense.amount === 0).length;
  const legacyReferenceBlockingBreakdown = {
    facilityItemBlockers: referenceIssues.filter((issue) => issue.issueCode === "unresolved_facility" && issue.severity === "blocking").length,
    driverItemBlockers: referenceIssues.filter((issue) => issue.issueCode === "unresolved_driver_identifier" && issue.severity === "blocking").length,
    vehicleItemBlockers: referenceIssues.filter((issue) => issue.issueCode === "unresolved_vehicle_identifier" && issue.severity === "blocking").length,
    teamSplitBlockers: referenceIssues.filter((issue) => issue.issueCode === "missing_team_split" && issue.severity === "blocking").length,
    fuelAssignmentBlockers: referenceIssues.filter((issue) => issue.issueCode === "unmatched_fuel_assignment" && issue.severity === "blocking").length,
    total: referenceIssueCounts.blocking,
  };

  const paymentClassCounts = payment.detailRows.reduce<Record<string, number>>((counts, row) => {
    counts[row.normalizedValues.rowClassification] = (counts[row.normalizedValues.rowClassification] ?? 0) + 1;
    return counts;
  }, {});

  const paymentOutput = {
    payment: {
      schemaSignature: payment.detailRows[0]?.schemaSignature.signature ?? null,
      summaryDetected: {
        hasInvoiceNumber: Boolean(payment.summary.invoiceNumber),
        invoiceDate: payment.summary.invoiceDate,
        invoiceTotal: payment.summary.invoiceTotal,
        workPeriodStart: payment.summary.workPeriodStart,
        workPeriodEnd: payment.summary.workPeriodEnd,
        paymentDate: payment.summary.paymentDate,
        paymentStatus: payment.summary.paymentStatus,
        hasCarrierIdentifier: Boolean(payment.summary.carrierIdentifier),
      },
      rowCount: payment.detailRows.length,
      classCounts: paymentClassCounts,
      reconciliation: payment.reconciliation,
      issueCount: payment.issues.length,
      warningRowCount: payment.detailRows.filter((row) => row.warnings.length > 0).length,
      blockingRowCount: payment.detailRows.filter((row) => row.blockingIssues.length > 0).length,
      warningIssueCodeCounts: issueCodeCounts(paymentParserIssues),
    },
    trips: {
      schemaSignature: trips.rows[0]?.schemaSignature.signature ?? null,
      rowCount: trips.aggregate.rowCount,
      teamRowCount: trips.aggregate.teamRowCount,
      blankDriverCount: trips.aggregate.blankDriverCount,
      malformedTimestampCount: trips.aggregate.malformedTimestampCount,
      duplicateLoadIdCount: trips.aggregate.duplicateLoadIds.length,
      issueCount: trips.issues.length,
      warningRowCount: trips.rows.filter((row) => row.warnings.length > 0).length,
      blockingRowCount: trips.rows.filter((row) => row.blockingIssues.length > 0).length,
      warningIssueCodeCounts: issueCodeCounts(tripsParserIssues),
    },
    matching: {
      exactLoadMatches: reconciliation.exactLoadMatches,
      exactTripMatches: reconciliation.exactTripMatches,
      inferredMatches: reconciliation.inferredMatches,
      ambiguousMatches: reconciliation.ambiguousMatches,
      unmatchedFinancialRows: reconciliation.unmatchedFinancialRows,
      teamRuleIssueCount: reconciliation.issues.filter((issue) => issue.issueCode === "missing_team_split").length,
      warningIssueCount: reconciliation.issueCategoryCounts.matchingWarnings,
    },
    revenue: {
      canonicalRevenueItemCount: reconciliation.canonicalRevenueItemCount,
      summaryInvoiceTotal: reconciliation.summaryInvoiceTotal,
      validPaymentRowGrossTotal: reconciliation.validPaymentRowGrossTotal,
      canonicalRevenueTotal: reconciliation.canonicalRevenueTotal,
      assignedRevenueTotal: reconciliation.assignedRevenueTotal,
      unassignedRevenueTotal: reconciliation.unassignedRevenueTotal,
      duplicateSourceContributionCount: reconciliation.duplicateSourceContributionCount,
      blockingIssueCount: reconciliation.blockingIssueCount,
      warningIssueCount: reconciliation.warningIssueCount,
      issueCategoryCounts: reconciliation.issueCategoryCounts,
      routeWarningsCurrentlyApplicable: reconciliation.issueCategoryCounts.routeResolutionWarnings,
      finalStatus: reconciliation.finalStatus,
    },
    referenceResolution: {
      legacyReferenceBlockingBreakdown,
      distinctExternalDriverTokenCount: countDistinctExternalDriverTokens(trips.rows),
      multiDriverRevenueItemCount: revenue.items.filter((item) => item.driverAssignmentStatus === "needs_team_split").length,
      revenueItemsRequiringDriverMapping: revenue.items.filter((item) => revenueItemRequiresDriverMapping(item, matching.matches)).length,
      revenueItemsRequiringVehicleMapping: revenue.items.filter((item) => revenueItemRequiresVehicleMapping(item, matching.matches)).length,
      distinctFacilityCodeCount: countDistinctFacilityCodes(revenue.items),
      revenueItemsRequiringFacilityMapping: revenue.items.filter(revenueItemRequiresFacilityMapping).length,
      fuelFinancialGroupsRequiringAssignment: fuel.cardGroups.filter((group) => !group.isPlaceholderGroup).length,
      placeholderFuelGroupsNotRequiringAssignment: fuel.cardGroups.filter((group) => group.isPlaceholderGroup).length,
      teamSplitBlockingCount: referenceIssues.filter((issue) => issue.issueCode === "missing_team_split" && issue.severity === "blocking").length,
      totalReferenceBlockingCount: referenceIssueCounts.blocking,
      totalReferenceWarningCount: referenceIssueCounts.warning,
      issueCodeCounts: referenceIssueCounts.byCode,
      rootReferences: {
        uniqueUnresolvedDriverIdentifiers: rootReferenceModel.counts.byCategory.driver,
        uniqueUnresolvedVehicleIdentifiers: rootReferenceModel.counts.byCategory.vehicle,
        uniqueUnresolvedFacilityMappings: rootReferenceModel.counts.byCategory.facility,
        uniqueUnresolvedFuelAssignments: rootReferenceModel.counts.byCategory.fuel_assignment,
        uniqueMissingTeamRules: rootReferenceModel.counts.byCategory.team_split,
        totalUniqueRootBlockers: rootReferenceModel.counts.uniqueBlocking,
      },
      dependencies: {
        revenueItemsBlockedForProjection: countRevenueDependencies(rootReferenceModel.dependencies, "projection"),
        revenueItemsBlockedForSettlement: countRevenueDependencies(rootReferenceModel.dependencies, "settlement"),
        revenueItemsBlockedOnlyForStatementDisplay: countRevenueOnlyStatementDisplayDependencies(rootReferenceModel.dependencies),
        fuelGroupsBlockedForExpenseProjection: countFuelDependencies(rootReferenceModel.dependencies, "expense_projection"),
        fuelGroupsBlockedForSettlementDeduction: countFuelDependencies(rootReferenceModel.dependencies, "settlement_deduction"),
        totalRootToItemDependencyCount: rootReferenceModel.counts.dependencyCount,
      },
      readiness: {
        canonicalReadyRevenueItems: revenue.items.filter((item) => revenueCanonicalReady(item)).length,
        projectionReadyRevenueItems: revenue.items.filter((item) => revenueCanonicalReady(item)).length,
        settlementReadyRevenueItems: revenue.items.filter((item) => revenueCanonicalReady(item) && revenueSettlementRootKeys(item, matching.matches, "private-validator-org").length === 0).length,
        statementDisplayReadyRevenueItems: revenue.items.filter((item) => revenueCanonicalReady(item) && facilityRootKeysForRevenueItem(item, "private-validator-org").length === 0).length,
        sourceReadyFuelGroups: fuel.cardGroups.filter((group) => fuelGroupSourceReady(group, fuelReconciliation)).length,
        expenseProjectionReadyFuelGroups: fuel.cardGroups.filter((group) => fuelGroupSourceReady(group, fuelReconciliation)).length,
        settlementDeductionReadyFuelGroups: fuel.cardGroups.filter((group) => fuelGroupSourceReady(group, fuelReconciliation) && fuelAssignmentRootKeysForGroup(group, "private-validator-org").length === 0).length,
      },
    },
    projectionDryRun: {
      databaseWrites: 0,
      revenue: {
        canonicalRevenueItems: revenue.items.length,
        prospectiveLoadProjections: revenueProjectionPreview.toCreate.length,
        skippedRevenueItems: revenueProjectionPreview.skipped.length,
        revenueConflicts: revenueProjectionPreview.conflicts.length + revenueProjectionPreview.invalid.length,
        prospectiveGrossTotal: revenueProjectionPreview.totals.toCreate,
        projectedLoadsNotYetSettlementReady: revenueProjectionItems.filter((item) => item.projectionReady && !item.settlementReady).length,
      },
      fuel: {
        parsedProductLines: fuelReconciliation.parsedProductLineCount,
        prospectiveExpenseProjections: fuelProjectionPreview.toCreate.length,
        placeholderGroupSkips: fuel.cardGroups.filter((group) => group.isPlaceholderGroup).length,
        zeroLineSkips: zeroFuelLineSkipCount,
        fuelConflicts: fuelProjectionPreview.conflicts.length + fuelProjectionPreview.invalid.length,
        prospectiveExpenseTotal: fuelProjectionPreview.totals.toCreate,
        projectedExpensesNotYetDeductionReady: fuelProjectionItems.filter((item) => item.expenseProjectionReady && !item.settlementDeductionReady).length,
      },
      expectedPrivateFacts: summarizeExpectedProjectionFacts(revenueProjectionPreview.totals.toCreate, fuelProjectionPreview.totals.toCreate, revenueProjectionPreview.toCreate.length, fuelProjectionPreview.toCreate.length),
    },
    candidateDryRun: {
      databaseWrites: 0,
      possibleCandidateGroups: revenue.items.length,
      candidatesBlockedByReferences: revenue.items.filter((item) => revenueSettlementRootKeys(item, matching.matches, "private-validator-org").length > 0).length,
      candidatesBlockedByTeamSplit: revenue.items.filter((item) => teamRootKeysForRevenueItem(item, matching.matches, "private-validator-org").length > 0).length,
      candidatesArithmeticallyValid: revenue.items.filter(revenueCanonicalReady).length,
      candidatesReady: revenue.items.filter((item) => revenueCanonicalReady(item) && revenueSettlementRootKeys(item, matching.matches, "private-validator-org").length === 0).length,
      grossTotalAvailableForCandidates: reconciliation.canonicalRevenueTotal,
      fuelTotalAvailableForCandidates: fuelReconciliation.calculatedChargedAmount,
    },
    fuel: {
      reportedTransactionCount: fuel.reportedTransactionCount,
      parsedRealTransactionCount: fuelReconciliation.parsedRealTransactionCount,
      parsedProductLineCount: fuelReconciliation.parsedProductLineCount,
      cardGroupCount: fuel.cardGroups.length,
      reportedCardGroupTransactionCount: fuel.cardGroups.reduce((sum, group) => sum + (group.reportedTransactionCount ?? 0), 0),
      placeholderGroupCount: fuelReconciliation.placeholderGroupCount,
      totalChargedAmount: fuelReconciliation.calculatedChargedAmount,
      totalQuantity: fuelReconciliation.calculatedQuantity,
      totalDiscount: fuelReconciliation.calculatedDiscount,
      financialStatus: fuelReconciliation.financialStatus,
      transactionCountStatus: fuelReconciliation.transactionCountStatus,
      quantityStatus: fuelReconciliation.quantityStatus,
      discountStatus: fuelReconciliation.discountStatus,
      reportReconciliationDifference: fuelReconciliation.reportedTotalAmount === null
        ? null
        : Number((fuelReconciliation.reportedTotalAmount - fuelReconciliation.calculatedChargedAmount).toFixed(2)),
      groupMismatchCount: fuelReconciliation.groupMismatchCount,
      blockingIssueCount: fuelReconciliation.blockingIssueCount + fuelMatching.issues.filter((issue) => issue.severity === "blocking").length,
      warningIssueCount: fuelReconciliation.warningIssueCount + fuelMatching.issues.filter((issue) => issue.severity === "warning").length,
      groupsWithMultipleProductLinesUnderOneTransaction: fuel.cardGroups.filter((group) =>
        group.transactions.some((transaction) => transaction.productLines.length > 1),
      ).length,
      singleProductTransactionCount: fuel.cardGroups.flatMap((group) => group.transactions).filter((transaction) => transaction.productLines.length === 1).length,
      multiProductTransactionCount: fuel.cardGroups.flatMap((group) => group.transactions).filter((transaction) => transaction.productLines.length > 1).length,
      productLinesInMultiProductTransactions: fuel.cardGroups
        .flatMap((group) => group.transactions)
        .filter((transaction) => transaction.productLines.length > 1)
        .reduce((sum, transaction) => sum + transaction.productLines.length, 0),
      unitLabelsAppearingAcrossMultipleCards: countUnitLabelsAppearingAcrossMultipleCards(fuel.cardGroups),
      expectedPrivateFacts: summarizeExpectedFuelFacts(fuel, fuelReconciliation),
    },
  };

  console.log(JSON.stringify(paymentOutput, null, 2));
}

function summarizeExpectedProjectionFacts(
  prospectiveLoadGrossTotal: number,
  prospectiveExpenseTotal: number,
  prospectiveLoadCount: number,
  prospectiveExpenseCount: number,
) {
  const deviations: string[] = [];
  if (prospectiveLoadCount !== 20) deviations.push("prospective_load_projection_count_not_20");
  if (prospectiveLoadGrossTotal !== 30665.09) deviations.push("prospective_load_gross_total_not_expected");
  if (prospectiveExpenseCount !== 33) deviations.push("prospective_expense_projection_count_not_33");
  if (prospectiveExpenseTotal !== 7461.17) deviations.push("prospective_expense_total_not_expected");
  return {
    allExpectedAggregatesDetected: deviations.length === 0,
    deviationCodes: deviations,
  };
}

function buildRootReferenceModel(args: {
  organizationId: string;
  revenueItems: AmazonRevenueItem[];
  matches: AmazonSourceMatch[];
  fuelGroups: Awaited<ReturnType<typeof parsePrivateFuelPdf>>["cardGroups"];
}) {
  const rootIssues: ReferenceRootIssue[] = [];
  const dependencies: ReferenceDependency[] = [];

  for (const item of args.revenueItems) {
    const settlementRootIssueKeys = revenueSettlementRootKeys(item, args.matches, args.organizationId);
    const statementRootIssueKeys = facilityRootKeysForRevenueItem(item, args.organizationId);
    for (const issue of revenueRootIssuesForItem(item, args.matches, args.organizationId)) rootIssues.push(issue);
    const rootIssueKeys = [...new Set([...settlementRootIssueKeys, ...statementRootIssueKeys])];
    if (rootIssueKeys.length > 0) {
      dependencies.push({
        dependencyKey: `revenue-item:${item.id}`,
        itemType: "revenue_item",
        itemId: item.id,
        blockedLevels: [
          ...(settlementRootIssueKeys.length > 0 ? ["settlement"] : []),
          ...(statementRootIssueKeys.length > 0 ? ["statement_display"] : []),
        ],
        rootIssueKeys,
        sourceReferences: item.sources.map((source) => ({
          sourceFingerprint: source.paymentRow.sourceFingerprint,
          sourceRowNumber: source.paymentRow.sourceRowNumber,
        })),
      });
    }
  }

  for (const group of args.fuelGroups) {
    const rootIssueKeys = fuelAssignmentRootKeysForGroup(group, args.organizationId);
    if (rootIssueKeys.length === 0) continue;
    rootIssues.push({
      issueKey: rootIssueKeys[0],
      category: "fuel_assignment",
      issueCode: "unmatched_fuel_assignment",
      severity: "blocking",
      message: "Fuel financial group requires an approved internal assignment.",
      details: { provider: "octane" },
    });
    dependencies.push({
      dependencyKey: `fuel-group:${group.sourceGroupNumber}`,
      itemType: "fuel_group",
      itemId: `fuel-group:${group.sourceGroupNumber}`,
      blockedLevels: ["settlement_deduction"],
      rootIssueKeys,
      sourceReferences: [{ sourceGroupNumber: group.sourceGroupNumber }],
    });
  }

  return collectReferenceIssueModel({ rootIssues, dependencies });
}

function revenueRootIssuesForItem(item: AmazonRevenueItem, matches: AmazonSourceMatch[], organizationId: string): ReferenceRootIssue[] {
  const issues: ReferenceRootIssue[] = [];
  for (const issueKey of driverRootKeysForRevenueItem(item, matches, organizationId)) {
    issues.push({ issueKey, category: "driver", issueCode: "unresolved_driver_identifier", severity: "blocking", message: "External driver identifier requires approved person mapping.", details: { provider: "amazon" } });
  }
  for (const issueKey of vehicleRootKeysForRevenueItem(item, matches, organizationId)) {
    issues.push({ issueKey, category: "vehicle", issueCode: "unresolved_vehicle_identifier", severity: "blocking", message: "External vehicle identifier requires approved vehicle mapping.", details: { provider: "amazon", identifierType: "tractor_vehicle_id" } });
  }
  for (const issueKey of facilityRootKeysForRevenueItem(item, organizationId)) {
    issues.push({ issueKey, category: "facility", issueCode: "unresolved_facility", severity: "blocking", message: "Facility code requires verified city/state mapping for statement display.", details: { provider: "amazon" } });
  }
  for (const issueKey of teamRootKeysForRevenueItem(item, matches, organizationId)) {
    issues.push({ issueKey, category: "team_split", issueCode: "missing_team_split", severity: "blocking", message: "Team identity requires approved split rule.", details: { provider: "amazon" } });
  }
  return issues;
}

function revenueSettlementRootKeys(item: AmazonRevenueItem, matches: AmazonSourceMatch[], organizationId: string): string[] {
  return [...new Set([
    ...driverRootKeysForRevenueItem(item, matches, organizationId),
    ...vehicleRootKeysForRevenueItem(item, matches, organizationId),
    ...teamRootKeysForRevenueItem(item, matches, organizationId),
  ])];
}

function driverRootKeysForRevenueItem(item: AmazonRevenueItem, matches: AmazonSourceMatch[], organizationId: string): string[] {
  return [...new Set(revenueItemMatches(item, matches)
    .flatMap((match) => match.relatedTripRows)
    .flatMap((row) => row.normalizedValues.driverTokens)
    .map(normalizeReferenceValue)
    .filter((value): value is string => Boolean(value))
    .map((normalizedIdentifier) => referenceRootIssueKey("driver", { organizationId, provider: "amazon", normalizedIdentifier })))];
}

function vehicleRootKeysForRevenueItem(item: AmazonRevenueItem, matches: AmazonSourceMatch[], organizationId: string): string[] {
  return [...new Set(revenueItemMatches(item, matches)
    .flatMap((match) => match.relatedTripRows)
    .map((row) => normalizeReferenceValue(row.normalizedValues.tractorVehicleId))
    .filter((value): value is string => Boolean(value))
    .map((normalizedValue) => referenceRootIssueKey("vehicle", { organizationId, provider: "amazon", identifierType: "tractor_vehicle_id", normalizedValue })))];
}

function facilityRootKeysForRevenueItem(item: AmazonRevenueItem, organizationId: string): string[] {
  return [...new Set([item.originFacilityCode, item.destinationFacilityCode]
    .map(normalizeReferenceValue)
    .filter((value): value is string => Boolean(value))
    .map((normalizedCode) => referenceRootIssueKey("facility", { organizationId, provider: "amazon", normalizedCode })))];
}

function teamRootKeysForRevenueItem(item: AmazonRevenueItem, matches: AmazonSourceMatch[], organizationId: string): string[] {
  if (item.driverAssignmentStatus !== "needs_team_split") return [];
  const tokens = revenueItemMatches(item, matches)
    .flatMap((match) => match.relatedTripRows)
    .flatMap((row) => row.normalizedValues.driverTokens)
    .map(normalizeReferenceValue)
    .filter((value): value is string => Boolean(value));
  if (tokens.length < 2) return [];
  return [referenceRootIssueKey("team_split", { organizationId, teamKey: deterministicTeamKey(tokens) })];
}

function fuelAssignmentRootKeysForGroup(
  group: Awaited<ReturnType<typeof parsePrivateFuelPdf>>["cardGroups"][number],
  organizationId: string,
): string[] {
  if (group.isPlaceholderGroup) return [];
  const identity = group.cardExternalId ?? group.unitLabelNormalized ?? group.driverLabelNormalized ?? `source-group-${group.sourceGroupNumber}`;
  return [referenceRootIssueKey("fuel_assignment", { organizationId, provider: "octane", groupIdentity: identity })];
}

function revenueCanonicalReady(item: AmazonRevenueItem): boolean {
  return item.reconciliationStatus === "passed";
}

function fuelGroupSourceReady(
  group: Awaited<ReturnType<typeof parsePrivateFuelPdf>>["cardGroups"][number],
  reconciliation: ReturnType<typeof reconcileFuelReport>,
): boolean {
  return !group.isPlaceholderGroup && reconciliation.financialStatus === "passed";
}

function countRevenueDependencies(dependencies: ReferenceDependency[], level: "projection" | "settlement" | "statement_display"): number {
  return dependencies.filter((dependency) => dependency.itemType === "revenue_item" && dependency.blockedLevels.includes(level)).length;
}

function countRevenueOnlyStatementDisplayDependencies(dependencies: ReferenceDependency[]): number {
  return dependencies.filter((dependency) =>
    dependency.itemType === "revenue_item"
    && dependency.blockedLevels.length === 1
    && dependency.blockedLevels[0] === "statement_display"
  ).length;
}

function countFuelDependencies(dependencies: ReferenceDependency[], level: "expense_projection" | "settlement_deduction"): number {
  return dependencies.filter((dependency) => dependency.itemType === "fuel_group" && dependency.blockedLevels.includes(level)).length;
}

function countDistinctExternalDriverTokens(rows: Awaited<ReturnType<typeof parseTripsCsv>>["rows"]): number {
  return new Set(rows.flatMap((row) => row.normalizedValues.driverTokens)).size;
}

function countDistinctFacilityCodes(items: AmazonRevenueItem[]): number {
  const codes = items.flatMap((item) => [item.originFacilityCode, item.destinationFacilityCode]).filter((value): value is string => Boolean(value));
  return new Set(codes).size;
}

function revenueItemMatches(item: AmazonRevenueItem, matches: AmazonSourceMatch[]): AmazonSourceMatch[] {
  const sourceFingerprints = new Set(item.sources.map((source) => source.paymentRow.sourceFingerprint));
  return matches.filter((match) => sourceFingerprints.has(match.paymentRow.sourceFingerprint));
}

function revenueItemRequiresDriverMapping(item: AmazonRevenueItem, matches: AmazonSourceMatch[]): boolean {
  return revenueItemMatches(item, matches).some((match) =>
    match.relatedTripRows.some((row) => row.normalizedValues.driverTokens.length > 0)
  );
}

function revenueItemRequiresVehicleMapping(item: AmazonRevenueItem, matches: AmazonSourceMatch[]): boolean {
  return revenueItemMatches(item, matches).some((match) =>
    match.relatedTripRows.some((row) => Boolean(row.normalizedValues.tractorVehicleId))
  );
}

function revenueItemRequiresFacilityMapping(item: AmazonRevenueItem): boolean {
  return item.routeResolutionStatus !== "not_applicable" && Boolean(item.originFacilityCode || item.destinationFacilityCode);
}

function countUnitLabelsAppearingAcrossMultipleCards(groups: Array<{ unitLabelNormalized: string | null; cardExternalId: string | null }>): number {
  const cardsByUnit = new Map<string, Set<string>>();
  for (const group of groups) {
    if (!group.unitLabelNormalized || !group.cardExternalId) continue;
    if (!cardsByUnit.has(group.unitLabelNormalized)) cardsByUnit.set(group.unitLabelNormalized, new Set());
    cardsByUnit.get(group.unitLabelNormalized)?.add(group.cardExternalId);
  }
  return Array.from(cardsByUnit.values()).filter((cards) => cards.size > 1).length;
}

async function parsePrivateFuelPdf(bytes: Uint8Array) {
  const data = bytes instanceof Buffer
    ? new Uint8Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
    : bytes;
  const pdf = await getDocumentProxy(data);
  const result = await extractText(pdf, { mergePages: false });
  const pages = Array.isArray(result.text) ? result.text : [result.text];
  return parseOctaneFuelTextPages(pages);
}

function summarizeExpectedFuelFacts(
  fuel: Awaited<ReturnType<typeof parsePrivateFuelPdf>>,
  reconciliation: ReturnType<typeof reconcileFuelReport>,
) {
  const deviations: string[] = [];
  if (fuel.reportedTransactionCount !== 30) deviations.push("reported_transaction_count_not_30");
  if (fuel.reportedTotalAmount !== 7461.17) deviations.push("reported_total_not_expected");
  if (fuel.reportedTotalQuantity !== 1777.6) deviations.push("reported_quantity_not_expected");
  if (fuel.reportedDiscountAmount !== 678.69) deviations.push("reported_discount_not_expected");
  if (fuel.cardGroups.length !== 6) deviations.push("card_group_count_not_6");
  if (reconciliation.placeholderGroupCount !== 1) deviations.push("placeholder_group_count_not_1");
  if (!fuel.cardGroups.some((group) => group.transactions.some((transaction) => transaction.productLines.length > 1))) {
    deviations.push("no_multi_product_invoice_detected");
  }
  if (!fuel.cardGroups.some((group) => group.reportedTotalAmount === 2028.22)) {
    deviations.push("target_group_total_not_detected");
  }
  return {
    allExpectedAggregatesDetected: deviations.length === 0,
    deviationCodes: deviations,
  };
}

function readPrivateFile(path: string): Uint8Array {
  try {
    statSync(path);
    return readFileSync(path);
  } catch {
    throw new Error(`Private sample file is unavailable: ${path}`);
  }
}

function makeInput(
  bytes: Uint8Array,
  metadata: Pick<AmazonSourceMetadata, "sourceType" | "originalFilename" | "mimeType">,
): AmazonParserInput {
  return {
    bytes,
    metadata: {
      ...metadata,
      sizeBytes: bytes.byteLength,
      sha256Hash: sha256Hex(bytes),
    },
    parser: { name: "private-sample-validator", version: "0.1.0" },
  };
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
