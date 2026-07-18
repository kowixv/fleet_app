import { projectionRevision, sumProjectionMoney } from "./projection-revision";
import { classifyExistingProjection } from "./projection-conflicts";
import type {
  ExistingProjection,
  FuelProjectionItem,
  ProjectionApplyResult,
  ProjectionConflict,
  ProjectionPreview,
  RevenueProjectionItem,
} from "./projection-types";

export function previewRevenueLoadProjections(args: {
  items: RevenueProjectionItem[];
  existing?: ExistingProjection[];
}): ProjectionPreview<RevenueProjectionItem> {
  const existingBySourceId = new Map((args.existing ?? []).map((projection) => [projection.sourceId, projection]));
  const invalid = duplicateFingerprintConflicts(args.items);
  const duplicateIds = new Set(invalid.map((conflict) => conflict.sourceId));
  const eligibleItems = args.items.filter((item) => item.canonicalReady && item.projectionReady && !duplicateIds.has(item.revenueItemId));
  const toCreate: RevenueProjectionItem[] = [];
  const unchanged: RevenueProjectionItem[] = [];
  const conflicts: ProjectionConflict[] = [];
  for (const item of eligibleItems) {
    const result = classifyExistingProjection({
      existing: existingBySourceId.get(item.revenueItemId),
      sourceId: item.revenueItemId,
      sourceRevision: item.sourceRevision,
      sourceFingerprint: item.sourceFingerprint,
      conflictCode: "revenue_projection_revision_conflict",
      alreadyProjectedCode: "revenue_already_projected",
    });
    if (result === "create") toCreate.push(item);
    else if (result === "unchanged") unchanged.push(item);
    else conflicts.push(result);
  }
  return {
    previewRevision: previewRevisionFor(eligibleItems),
    eligibleCount: eligibleItems.length,
    toCreate,
    unchanged,
    conflicts,
    invalid,
    skipped: args.items
      .filter((item) => !item.canonicalReady || !item.projectionReady)
      .map((item) => ({ code: "invalid_projection_status", sourceId: item.revenueItemId })),
    totals: {
      toCreate: sumProjectionMoney(toCreate.map((item) => item.load.gross_amount)),
      alreadyProjected: sumProjectionMoney(unchanged.map((item) => item.load.gross_amount)),
      conflicted: sumProjectionMoney(conflicts.map((conflict) =>
        args.items.find((item) => item.revenueItemId === conflict.sourceId)?.load.gross_amount ?? 0
      )),
    },
  };
}

export function previewFuelExpenseProjections(args: {
  items: FuelProjectionItem[];
  existing?: ExistingProjection[];
  negativeExpensesSupported?: boolean;
}): ProjectionPreview<FuelProjectionItem> {
  const existingBySourceId = new Map((args.existing ?? []).map((projection) => [projection.sourceId, projection]));
  const invalid = [
    ...duplicateFingerprintConflicts(args.items.map((item) => ({
      revenueItemId: item.transactionLineId,
      sourceFingerprint: item.sourceFingerprint,
    }))),
    ...((args.negativeExpensesSupported ?? true)
      ? []
      : args.items
        .filter((item) => item.expense.amount < 0)
        .map((item) => ({ code: "unsupported_negative_expense" as const, sourceId: item.transactionLineId }))),
  ];
  const duplicateIds = new Set(invalid.map((conflict) => conflict.sourceId));
  const eligibleItems = args.items.filter((item) => item.fuelSourceReady && item.expenseProjectionReady && !duplicateIds.has(item.transactionLineId));
  const toCreate: FuelProjectionItem[] = [];
  const unchanged: FuelProjectionItem[] = [];
  const conflicts: ProjectionConflict[] = [];
  for (const item of eligibleItems) {
    const result = classifyExistingProjection({
      existing: existingBySourceId.get(item.transactionLineId),
      sourceId: item.transactionLineId,
      sourceRevision: item.sourceRevision,
      sourceFingerprint: item.sourceFingerprint,
      conflictCode: "fuel_projection_revision_conflict",
      alreadyProjectedCode: "fuel_line_already_projected",
    });
    if (result === "create") toCreate.push(item);
    else if (result === "unchanged") unchanged.push(item);
    else conflicts.push(result);
  }
  return {
    previewRevision: previewRevisionFor(eligibleItems),
    eligibleCount: eligibleItems.length,
    toCreate,
    unchanged,
    conflicts,
    invalid,
    skipped: args.items
      .filter((item) => !item.fuelSourceReady || !item.expenseProjectionReady)
      .map((item) => ({ code: "invalid_projection_status", sourceId: item.transactionLineId })),
    totals: {
      toCreate: sumProjectionMoney(toCreate.map((item) => item.expense.amount)),
      alreadyProjected: sumProjectionMoney(unchanged.map((item) => item.expense.amount)),
      conflicted: sumProjectionMoney(conflicts.map((conflict) =>
        args.items.find((item) => item.transactionLineId === conflict.sourceId)?.expense.amount ?? 0
      )),
    },
  };
}

export function applyProjectionPreview<T extends { sourceRevision: string; sourceFingerprint: string }>(args: {
  preview: ProjectionPreview<T>;
  expectedPreviewRevision: string;
  failMidBatch?: boolean;
}): ProjectionApplyResult {
  if (args.preview.previewRevision !== args.expectedPreviewRevision) {
    return { created: 0, unchanged: 0, skipped: args.preview.skipped.length, conflicts: args.preview.conflicts.length + 1 };
  }
  if (args.failMidBatch || args.preview.conflicts.length > 0 || args.preview.invalid.length > 0) {
    return { created: 0, unchanged: args.preview.unchanged.length, skipped: args.preview.skipped.length, conflicts: args.preview.conflicts.length + args.preview.invalid.length };
  }
  return {
    created: args.preview.toCreate.length,
    unchanged: args.preview.unchanged.length,
    skipped: args.preview.skipped.length,
    conflicts: 0,
  };
}

function previewRevisionFor(items: Array<{ sourceRevision: string; sourceFingerprint: string }>): string {
  return projectionRevision(items.map((item) => ({
    sourceRevision: item.sourceRevision,
    sourceFingerprint: item.sourceFingerprint,
  })).sort((a, b) => a.sourceFingerprint.localeCompare(b.sourceFingerprint)));
}

function duplicateFingerprintConflicts(items: Array<{ revenueItemId: string; sourceFingerprint: string }>): ProjectionConflict[] {
  const idsByFingerprint = new Map<string, string[]>();
  for (const item of items) {
    idsByFingerprint.set(item.sourceFingerprint, [...(idsByFingerprint.get(item.sourceFingerprint) ?? []), item.revenueItemId]);
  }
  return [...idsByFingerprint.entries()]
    .filter(([, ids]) => ids.length > 1)
    .flatMap(([, ids]) => ids.map((sourceId) => ({ code: "duplicate_source_fingerprint" as const, sourceId })));
}
