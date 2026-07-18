import type { FuelCardGroup, FuelProductLine, FuelTransaction } from "../fuel/fuel-normalization";
import { roundMoney } from "../parsers/normalization";
import { projectionRevision, projectionSourceFingerprint } from "./projection-revision";
import type { FuelProjectionItem, ProjectedExpensePayload, ResolvedProjectionReference } from "./projection-types";

export function mapFuelLineToExpenseProjection(args: {
  group: FuelCardGroup;
  transaction: FuelTransaction;
  productLine: FuelProductLine;
  transactionLineId?: string | null;
  batchId?: string | null;
  references?: Pick<ResolvedProjectionReference, "vehicleId" | "driverId">;
  fuelSourceReady?: boolean;
  expenseProjectionReady?: boolean;
  settlementDeductionReady?: boolean;
}): FuelProjectionItem {
  const group = args.group;
  const transaction = args.transaction;
  const line = args.productLine;
  const transactionLineId = args.transactionLineId ?? projectionSourceFingerprint([
    "fuel-transaction-line",
    transaction.sourceTransactionFingerprint,
    line.sourceLineOrder,
    line.productTypeNormalized,
    line.chargedAmount,
  ]);
  const expense: ProjectedExpensePayload = {
    date: transaction.transactionAt?.slice(0, 10) ?? null,
    vehicle_id: args.references?.vehicleId ?? null,
    driver_id: args.references?.driverId ?? null,
    owner_id: null,
    category: expenseCategoryForFuelProduct(line.productTypeNormalized),
    amount: roundMoney(line.chargedAmount ?? 0),
    deduct_from_settlement: false,
    deduct_from_driver: false,
    deduct_from_owner: false,
    deduct_from_investor: false,
    notes: "Amazon fuel projection",
  };
  const sourceFingerprint = projectionSourceFingerprint([
    "amazon-fuel-expense",
    transaction.sourceTransactionFingerprint,
    line.sourceLineOrder,
  ]);
  const projectionSnapshot = {
    sourceGroupNumber: group.sourceGroupNumber,
    sourceTransactionFingerprint: transaction.sourceTransactionFingerprint,
    sourceLineOrder: line.sourceLineOrder,
    productTypeNormalized: line.productTypeNormalized,
    quantity: line.quantity,
    chargedAmount: line.chargedAmount,
    discountAmount: line.discountAmount,
    discountPreservedAsMetadata: true,
  };
  return {
    transactionLineId,
    batchId: args.batchId ?? null,
    sourceRevision: projectionRevision({ source: "fuel-expense", sourceFingerprint, expense, projectionSnapshot }),
    sourceFingerprint,
    group,
    transaction,
    productLine: line,
    expense,
    projectionSnapshot,
    fuelSourceReady: args.fuelSourceReady ?? !group.isPlaceholderGroup,
    expenseProjectionReady: args.expenseProjectionReady ?? !group.isPlaceholderGroup,
    settlementDeductionReady: args.settlementDeductionReady ?? false,
  };
}

export function expenseCategoryForFuelProduct(productType: string): ProjectedExpensePayload["category"] {
  if (productType === "DEF") return "def";
  if (productType === "FEE") return "fees";
  if (productType === "OTHER") return "other";
  return "fuel";
}

export function fuelProjectionLinesFromGroups(groups: FuelCardGroup[]): Array<{
  group: FuelCardGroup;
  transaction: FuelTransaction;
  productLine: FuelProductLine;
}> {
  return groups.flatMap((group) =>
    group.isPlaceholderGroup
      ? []
      : group.transactions.flatMap((transaction) =>
        transaction.productLines
          .filter((line) => typeof line.chargedAmount === "number" && Number.isFinite(line.chargedAmount))
          .map((productLine) => ({ group, transaction, productLine }))
      )
  );
}
