import type { FuelProjectionItem, ProjectionPreview, RevenueProjectionItem } from "./projection-types";

export interface ProjectionRpcPayload {
  p_organization_id: string;
  p_batch_id: string;
  p_preview_revision: string;
  p_items: Array<Record<string, unknown>>;
}

export function projectionRpcItems<T extends { sourceFingerprint: string }>(
  preview: Pick<ProjectionPreview<T>, "toCreate" | "unchanged">,
): T[] {
  return [...preview.toCreate, ...preview.unchanged]
    .sort((a, b) => a.sourceFingerprint.localeCompare(b.sourceFingerprint));
}

export function revenueProjectionRpcPayload(args: {
  organizationId: string;
  batchId: string;
  previewRevision: string;
  items: RevenueProjectionItem[];
}): ProjectionRpcPayload {
  return {
    p_organization_id: args.organizationId,
    p_batch_id: args.batchId,
    p_preview_revision: args.previewRevision,
    p_items: args.items.map((item) => ({
      revenueItemId: item.revenueItemId,
      sourceRevision: item.sourceRevision,
      sourceFingerprint: item.sourceFingerprint,
      load: item.load,
      projectionSnapshot: item.projectionSnapshot,
    })),
  };
}

export function fuelProjectionRpcPayload(args: {
  organizationId: string;
  batchId: string;
  previewRevision: string;
  items: FuelProjectionItem[];
}): ProjectionRpcPayload {
  return {
    p_organization_id: args.organizationId,
    p_batch_id: args.batchId,
    p_preview_revision: args.previewRevision,
    p_items: args.items.map((item) => ({
      transactionLineId: item.transactionLineId,
      sourceRevision: item.sourceRevision,
      sourceFingerprint: item.sourceFingerprint,
      expense: item.expense,
      projectionSnapshot: item.projectionSnapshot,
    })),
  };
}
