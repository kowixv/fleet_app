import type {
  FuelProjectionItem,
  ProjectionPreview,
  RevenueProjectionItem,
} from "./projection-types";

export interface ProjectionUiView {
  revenue: Record<string, number | string>;
  fuel: Record<string, number | string>;
}

export function projectionPreviewToUi(preview: {
  revenue: ProjectionPreview<RevenueProjectionItem>;
  fuel: ProjectionPreview<FuelProjectionItem>;
}): ProjectionUiView {
  return {
    revenue: {
      eligibleCanonicalItemCount: preview.revenue.eligibleCount,
      prospectiveLoadCount: preview.revenue.toCreate.length,
      grossAmount: preview.revenue.totals.toCreate,
      alreadyProjectedAmount: preview.revenue.totals.alreadyProjected,
      unchangedCount: preview.revenue.unchanged.length,
      conflictCount: preview.revenue.conflicts.length + preview.revenue.invalid.length,
      skippedCount: preview.revenue.skipped.length,
      notSettlementReadyCount: [...preview.revenue.toCreate, ...preview.revenue.unchanged]
        .filter((item) => !item.settlementReady).length,
      previewRevision: preview.revenue.previewRevision,
    },
    fuel: {
      eligibleProductLineCount: preview.fuel.eligibleCount,
      prospectiveExpenseCount: preview.fuel.toCreate.length,
      amount: preview.fuel.totals.toCreate,
      placeholderSkips: preview.fuel.skipped.length,
      creditRefundIssues: preview.fuel.invalid.filter((issue) => issue.code === "unsupported_negative_expense").length,
      unchangedCount: preview.fuel.unchanged.length,
      conflictCount: preview.fuel.conflicts.length + preview.fuel.invalid.length,
      notDeductionReadyCount: [...preview.fuel.toCreate, ...preview.fuel.unchanged]
        .filter((item) => !item.settlementDeductionReady).length,
      previewRevision: preview.fuel.previewRevision,
    },
  };
}
