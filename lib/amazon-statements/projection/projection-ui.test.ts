import { describe, expect, it } from "vitest";
import type {
  FuelProjectionItem,
  ProjectionPreview,
  RevenueProjectionItem,
} from "./projection-types";
import { projectionPreviewToUi } from "./projection-ui";

describe("projectionPreviewToUi", () => {
  it("uses server dry-run counts, totals, and revisions instead of persisted rows", () => {
    const revenueItem = { settlementReady: false } as RevenueProjectionItem;
    const fuelItem = { settlementDeductionReady: false } as FuelProjectionItem;
    const revenue: ProjectionPreview<RevenueProjectionItem> = {
      previewRevision: "revenue-revision",
      eligibleCount: 20,
      toCreate: [revenueItem],
      unchanged: [],
      conflicts: [],
      invalid: [],
      skipped: [],
      totals: { toCreate: 30665.09, alreadyProjected: 0, conflicted: 0 },
    };
    const fuel: ProjectionPreview<FuelProjectionItem> = {
      previewRevision: "fuel-revision",
      eligibleCount: 33,
      toCreate: [fuelItem],
      unchanged: [],
      conflicts: [],
      invalid: [],
      skipped: [],
      totals: { toCreate: 7461.17, alreadyProjected: 0, conflicted: 0 },
    };

    const view = projectionPreviewToUi({ revenue, fuel });

    expect(view.revenue).toMatchObject({
      eligibleCanonicalItemCount: 20,
      prospectiveLoadCount: 1,
      grossAmount: 30665.09,
      previewRevision: "revenue-revision",
    });
    expect(view.fuel).toMatchObject({
      eligibleProductLineCount: 33,
      prospectiveExpenseCount: 1,
      amount: 7461.17,
      previewRevision: "fuel-revision",
    });
  });
});
