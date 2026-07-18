import type { ExistingProjection, ProjectionConflict, ProjectionStatus } from "./projection-types";

export function projectionIsActive(status: ProjectionStatus): boolean {
  return status === "projected";
}

export function targetIsSettlementLocked(target: { linkedSettlementStatus?: string | null; activeSettlementLink?: boolean | null }): boolean {
  return Boolean(target.activeSettlementLink && (target.linkedSettlementStatus === "finalized" || target.linkedSettlementStatus === "paid"));
}

export function classifyExistingProjection(args: {
  existing: ExistingProjection | undefined;
  sourceId: string;
  sourceRevision: string;
  sourceFingerprint: string;
  conflictCode: ProjectionConflict["code"];
  alreadyProjectedCode: ProjectionConflict["code"];
}): "create" | "unchanged" | ProjectionConflict {
  const existing = args.existing;
  if (!existing) return "create";
  if (existing.projectionStatus !== "projected") {
    return { code: "invalid_projection_status", sourceId: args.sourceId, targetId: existing.targetId };
  }
  if (existing.targetSettlementLocked) {
    return { code: "projected_target_settlement_locked", sourceId: args.sourceId, targetId: existing.targetId };
  }
  if (existing.sourceRevision === args.sourceRevision && existing.sourceFingerprint === args.sourceFingerprint) {
    return "unchanged";
  }
  if (existing.sourceFingerprint === args.sourceFingerprint) {
    return { code: args.conflictCode, sourceId: args.sourceId, targetId: existing.targetId };
  }
  return { code: args.alreadyProjectedCode, sourceId: args.sourceId, targetId: existing.targetId };
}
