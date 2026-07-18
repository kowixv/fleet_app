import type { AmazonParserIssue } from "../types";
import type { AmazonMatchingResult } from "../matching/payment-trip-matcher";
import { matchingIssue } from "../matching/matching-issues";
import { roundMoney } from "../parsers/normalization";
import type { AmazonRevenueBuildResult } from "./revenue-builder";
import type { AmazonBatchIssue, AmazonIssueCategoryCounts } from "../issues/warning-lineage";
import {
  createRouteResolutionIssues,
  matchingOrRevenueIssueToBatchIssue,
  summarizeIssueCategories,
} from "../issues/warning-lineage";

export interface AmazonRevenueReconciliationResult {
  summaryInvoiceTotal: number | null;
  validPaymentRowGrossTotal: number;
  canonicalRevenueTotal: number;
  assignedRevenueTotal: number;
  unassignedRevenueTotal: number;
  exactLoadMatches: number;
  exactTripMatches: number;
  inferredMatches: number;
  ambiguousMatches: number;
  unmatchedFinancialRows: number;
  parentRowCount: number;
  childRowCount: number;
  standaloneRowCount: number;
  canonicalRevenueItemCount: number;
  duplicateSourceContributionCount: number;
  blockingIssueCount: number;
  warningIssueCount: number;
  issueCategoryCounts: AmazonIssueCategoryCounts;
  finalStatus: "passed" | "warning" | "failed";
  issues: AmazonParserIssue[];
  batchIssues: AmazonBatchIssue[];
}

export function reconcileAmazonRevenue(args: {
  summaryInvoiceTotal: number | null;
  validPaymentRowGrossTotal: number;
  parentRowCount: number;
  childRowCount: number;
  standaloneRowCount: number;
  matching: AmazonMatchingResult;
  revenue: AmazonRevenueBuildResult;
  parserIssues?: AmazonBatchIssue[];
  routeResolutionRequested?: boolean;
}): AmazonRevenueReconciliationResult {
  const canonicalRevenueTotal = roundMoney(args.revenue.items.reduce((total, item) => total + item.grossAmount, 0));
  const unassignedRevenueTotal = roundMoney(args.revenue.unassignedRows.reduce((total, row) => total + (row.normalizedValues.grossPay ?? 0), 0));
  const assignedRevenueTotal = canonicalRevenueTotal;
  const issues: AmazonParserIssue[] = [...args.matching.issues, ...args.revenue.issues];
  if (args.summaryInvoiceTotal !== null && Math.abs(args.summaryInvoiceTotal - args.validPaymentRowGrossTotal) > 0.01) {
    issues.push(matchingIssue("financial_reconciliation_failed", "blocking", "Payment summary total does not match valid payment-row gross total.", {
      summaryInvoiceTotal: args.summaryInvoiceTotal,
      validPaymentRowGrossTotal: args.validPaymentRowGrossTotal,
    }));
  }
  if (Math.abs(args.validPaymentRowGrossTotal - roundMoney(canonicalRevenueTotal + unassignedRevenueTotal)) > 0.01) {
    issues.push(matchingIssue("financial_reconciliation_failed", "blocking", "Valid payment-row gross total does not equal canonical plus unassigned revenue.", {
      validPaymentRowGrossTotal: args.validPaymentRowGrossTotal,
      canonicalRevenueTotal,
      unassignedRevenueTotal,
    }));
  }
  const matchingBatchIssues = args.matching.issues.map((issue) => matchingOrRevenueIssueToBatchIssue(issue, "matching"));
  const revenueBatchIssues = args.revenue.issues.map((issue) => matchingOrRevenueIssueToBatchIssue(issue, "revenue"));
  const reconciliationBatchIssues = issues
    .filter((issue) => issue.issueCode === "financial_reconciliation_failed")
    .map((issue) => matchingOrRevenueIssueToBatchIssue(issue, "revenue"));
  const routeBatchIssues = createRouteResolutionIssues({
    items: args.revenue.items,
    routeResolutionRequested: args.routeResolutionRequested ?? false,
  });
  const batchIssues = [
    ...(args.parserIssues ?? []),
    ...matchingBatchIssues,
    ...revenueBatchIssues,
    ...reconciliationBatchIssues,
    ...routeBatchIssues,
  ];
  const issueCategoryCounts = summarizeIssueCategories(batchIssues);
  const blockingIssueCount = issueCategoryCounts.blockingIssues;
  const warningIssueCount = issueCategoryCounts.totalPersistedWarningIssues;
  return {
    summaryInvoiceTotal: args.summaryInvoiceTotal,
    validPaymentRowGrossTotal: args.validPaymentRowGrossTotal,
    canonicalRevenueTotal,
    assignedRevenueTotal,
    unassignedRevenueTotal,
    exactLoadMatches: args.matching.counts.exactLoadMatches,
    exactTripMatches: args.matching.counts.exactTripMatches,
    inferredMatches: args.matching.counts.inferredMatches,
    ambiguousMatches: args.matching.counts.ambiguousMatches,
    unmatchedFinancialRows: args.matching.counts.unmatchedFinancialRows,
    parentRowCount: args.parentRowCount,
    childRowCount: args.childRowCount,
    standaloneRowCount: args.standaloneRowCount,
    canonicalRevenueItemCount: args.revenue.items.length,
    duplicateSourceContributionCount: args.revenue.duplicateSourceContributionCount,
    blockingIssueCount,
    warningIssueCount,
    issueCategoryCounts,
    finalStatus: blockingIssueCount > 0 ? "failed" : warningIssueCount > 0 ? "warning" : "passed",
    issues,
    batchIssues,
  };
}
