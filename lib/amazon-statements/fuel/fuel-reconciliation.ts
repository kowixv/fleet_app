import { roundMoney } from "../parsers/normalization";
import {
  fuelIssue,
  sumFuelMoney,
  sumFuelQuantity,
  type FuelCardGroup,
  type FuelImportIssue,
  type FuelReport,
  type FuelTransaction,
} from "./fuel-normalization";

export type FuelReconciliationStatus = "passed" | "warning" | "failed";

export interface FuelTransactionReconciliation {
  fingerprint: string;
  productLineCount: number;
  quantityTotal: number;
  chargedAmountTotal: number;
  discountTotal: number;
  reportedVersusCalculatedAmount: number | null;
  status: FuelReconciliationStatus;
}

export interface FuelCardGroupReconciliation {
  sourceGroupNumber: number;
  parsedTransactionCount: number;
  reportedTransactionCount: number | null;
  parsedProductLineCount: number;
  reportedTotalAmount: number | null;
  calculatedChargedAmount: number;
  difference: number | null;
  quantityTotal: number;
  discountTotal: number;
  status: FuelReconciliationStatus;
}

export interface FuelReportReconciliation {
  reportedTransactionCount: number | null;
  parsedRealTransactionCount: number;
  parsedProductLineCount: number;
  reportedTotalAmount: number | null;
  calculatedChargedAmount: number;
  unresolvedFinancialAmount: number;
  reportedQuantity: number | null;
  calculatedQuantity: number;
  reportedDiscount: number | null;
  calculatedDiscount: number;
  placeholderGroupCount: number;
  groupMismatchCount: number;
  blockingIssueCount: number;
  warningIssueCount: number;
  status: FuelReconciliationStatus;
  financialStatus: FuelReconciliationStatus;
  transactionCountStatus: FuelReconciliationStatus;
  quantityStatus: FuelReconciliationStatus;
  discountStatus: FuelReconciliationStatus;
  transactionResults: FuelTransactionReconciliation[];
  groupResults: FuelCardGroupReconciliation[];
  issues: FuelImportIssue[];
}

export function reconcileFuelReport(report: FuelReport): FuelReportReconciliation {
  const issues = [...report.issues];
  const transactionResults = report.cardGroups.flatMap((group) => group.transactions.map(reconcileFuelTransaction));
  const groupResults = report.cardGroups.map((group) => reconcileFuelCardGroup(group, issues));
  const financialGroups = report.cardGroups.filter((group) => !group.isPlaceholderGroup);
  const financialTransactions = financialGroups.flatMap((group) => group.transactions);
  const allLines = financialTransactions.flatMap((transaction) => transaction.productLines);
  const parsedRealTransactionCount = financialTransactions.length;
  const parsedProductLineCount = allLines.length;
  const calculatedChargedAmount = sumFuelMoney(allLines.map((line) => line.chargedAmount));
  const calculatedQuantity = sumFuelQuantity(allLines.map((line) => line.quantity));
  const calculatedDiscount = sumFuelMoney(allLines.map((line) => line.discountAmount));
  const amountDifference = difference(report.reportedTotalAmount, calculatedChargedAmount);
  const quantityDifference = difference3(report.reportedTotalQuantity, calculatedQuantity);
  const discountDifference = difference(report.reportedDiscountAmount, calculatedDiscount);
  const transactionCountDifference = report.reportedTransactionCount === null
    ? null
    : report.reportedTransactionCount - parsedRealTransactionCount;

  if (amountDifference !== null && Math.abs(amountDifference) > 0.01) {
    issues.push(fuelIssue(
      "report_amount_mismatch",
      "blocking",
      "Reported fuel total does not match parsed product-line charged amounts.",
      { sourcePage: null, sourceGroupNumber: null, sourceRowNumber: null },
      { reportedTotalAmount: report.reportedTotalAmount, calculatedChargedAmount, difference: amountDifference },
    ));
  }
  if (quantityDifference !== null && Math.abs(quantityDifference) > 0.001) {
    issues.push(fuelIssue(
      "report_quantity_mismatch",
      "warning",
      "Reported fuel quantity does not match parsed product-line quantities.",
      { sourcePage: null, sourceGroupNumber: null, sourceRowNumber: null },
      { reportedQuantity: report.reportedTotalQuantity, calculatedQuantity, difference: quantityDifference },
    ));
  }
  if (discountDifference !== null && Math.abs(discountDifference) > 0.01) {
    issues.push(fuelIssue(
      "report_discount_mismatch",
      "warning",
      "Reported fuel discount does not match parsed product-line discounts.",
      { sourcePage: null, sourceGroupNumber: null, sourceRowNumber: null },
      { reportedDiscount: report.reportedDiscountAmount, calculatedDiscount, difference: discountDifference },
    ));
  }
  if (transactionCountDifference !== null && transactionCountDifference !== 0) {
    issues.push(fuelIssue(
      "report_transaction_count_mismatch",
      "warning",
      "Reported fuel transaction count does not match visibly parsed financial transactions.",
      { sourcePage: null, sourceGroupNumber: null, sourceRowNumber: null },
      {
        reportedTransactionCount: report.reportedTransactionCount,
        parsedRealTransactionCount,
        difference: transactionCountDifference,
        financialTotalsReconciled: amountDifference === null || Math.abs(amountDifference) <= 0.01,
      },
    ));
  }

  const fingerprints = new Map<string, number>();
  for (const transaction of financialTransactions) {
    fingerprints.set(transaction.sourceTransactionFingerprint, (fingerprints.get(transaction.sourceTransactionFingerprint) ?? 0) + 1);
  }
  for (const [fingerprint, count] of fingerprints) {
    if (count > 1) {
      issues.push(fuelIssue(
        "duplicate_transaction_fingerprint",
        "blocking",
        "Duplicate fuel transaction fingerprint detected.",
        { sourcePage: null, sourceGroupNumber: null, sourceRowNumber: null },
        { fingerprint, count },
      ));
    }
  }

  const blockingIssueCount = issues.filter((issue) => issue.severity === "blocking").length;
  const warningIssueCount = issues.filter((issue) => issue.severity === "warning").length;
  const groupMismatchCount = issues.filter((issue) =>
    issue.issueCode === "group_transaction_count_mismatch" || issue.issueCode === "group_amount_mismatch"
  ).length;
  const financialStatus: FuelReconciliationStatus = amountDifference !== null && Math.abs(amountDifference) > 0.01 ? "failed" : "passed";
  const transactionCountStatus: FuelReconciliationStatus = transactionCountDifference !== null && transactionCountDifference !== 0 ? "warning" : "passed";
  const quantityStatus: FuelReconciliationStatus = quantityDifference !== null && Math.abs(quantityDifference) > 0.001 ? "warning" : "passed";
  const discountStatus: FuelReconciliationStatus = discountDifference !== null && Math.abs(discountDifference) > 0.01 ? "warning" : "passed";

  return {
    reportedTransactionCount: report.reportedTransactionCount,
    parsedRealTransactionCount,
    parsedProductLineCount,
    reportedTotalAmount: report.reportedTotalAmount,
    calculatedChargedAmount,
    unresolvedFinancialAmount: amountDifference === null ? 0 : Math.max(0, roundMoney(amountDifference)),
    reportedQuantity: report.reportedTotalQuantity,
    calculatedQuantity,
    reportedDiscount: report.reportedDiscountAmount,
    calculatedDiscount,
    placeholderGroupCount: report.cardGroups.filter((group) => group.isPlaceholderGroup).length,
    groupMismatchCount,
    blockingIssueCount,
    warningIssueCount,
    status: blockingIssueCount > 0 ? "failed" : warningIssueCount > 0 ? "warning" : "passed",
    financialStatus,
    transactionCountStatus,
    quantityStatus,
    discountStatus,
    transactionResults,
    groupResults,
    issues,
  };
}

export function reconcileFuelTransaction(transaction: FuelTransaction): FuelTransactionReconciliation {
  const chargedAmountTotal = sumFuelMoney(transaction.productLines.map((line) => line.chargedAmount));
  return {
    fingerprint: transaction.sourceTransactionFingerprint,
    productLineCount: transaction.productLines.length,
    quantityTotal: sumFuelQuantity(transaction.productLines.map((line) => line.quantity)),
    chargedAmountTotal,
    discountTotal: sumFuelMoney(transaction.productLines.map((line) => line.discountAmount)),
    reportedVersusCalculatedAmount: null,
    status: transaction.productLines.some((line) => line.chargedAmount === null) ? "failed" : "passed",
  };
}

export function reconcileFuelCardGroup(group: FuelCardGroup, issues: FuelImportIssue[] = []): FuelCardGroupReconciliation {
  const lines = group.transactions.flatMap((transaction) => transaction.productLines);
  const calculatedChargedAmount = sumFuelMoney(lines.map((line) => line.chargedAmount));
  const amountDifference = difference(group.reportedTotalAmount, calculatedChargedAmount);
  const transactionCountMismatch = group.reportedTransactionCount !== null
    && group.reportedTransactionCount !== group.transactions.length
    && !group.isPlaceholderGroup;
  const amountMismatch = amountDifference !== null && Math.abs(amountDifference) > 0.01 && !group.isPlaceholderGroup;

  if (group.isPlaceholderGroup) {
    issues.push(fuelIssue(
      "placeholder_group",
      "warning",
      "Zero-value placeholder fuel card group was preserved and excluded from deduction totals.",
      { sourcePage: group.sourcePageStart, sourceGroupNumber: group.sourceGroupNumber, sourceRowNumber: null },
      { sourceGroupNumber: group.sourceGroupNumber },
    ));
  }
  if (transactionCountMismatch) {
    issues.push(fuelIssue(
      "group_transaction_count_mismatch",
      "warning",
      "Fuel card group transaction count does not match parsed transactions.",
      { sourcePage: group.sourcePageStart, sourceGroupNumber: group.sourceGroupNumber, sourceRowNumber: null },
      { reportedTransactionCount: group.reportedTransactionCount, parsedTransactionCount: group.transactions.length },
    ));
  }
  if (amountMismatch) {
    issues.push(fuelIssue(
      "group_amount_mismatch",
      "warning",
      "Fuel card group total does not match parsed product-line charged amounts.",
      { sourcePage: group.sourcePageStart, sourceGroupNumber: group.sourceGroupNumber, sourceRowNumber: null },
      { reportedTotalAmount: group.reportedTotalAmount, calculatedChargedAmount, difference: amountDifference },
    ));
  }

  return {
    sourceGroupNumber: group.sourceGroupNumber,
    parsedTransactionCount: group.transactions.length,
    reportedTransactionCount: group.reportedTransactionCount,
    parsedProductLineCount: lines.length,
    reportedTotalAmount: group.reportedTotalAmount,
    calculatedChargedAmount,
    difference: amountDifference,
    quantityTotal: sumFuelQuantity(lines.map((line) => line.quantity)),
    discountTotal: sumFuelMoney(lines.map((line) => line.discountAmount)),
    status: amountMismatch ? "failed" : transactionCountMismatch || group.isPlaceholderGroup ? "warning" : "passed",
  };
}

function difference(expected: number | null, actual: number): number | null {
  return expected === null ? null : roundMoney(expected - actual);
}

function difference3(expected: number | null, actual: number): number | null {
  return expected === null ? null : Math.round((expected - actual) * 1000) / 1000;
}
