import "server-only";

import type { AmazonWorkflowActor, AmazonWorkflowAuditMetadata, AmazonWorkflowStage } from "./workflow-types";

export function amazonAuditMetadata(args: {
  actor: AmazonWorkflowActor;
  stage: AmazonWorkflowStage;
  batchId?: string | null;
  fileId?: string | null;
  candidateId?: string | null;
  details?: Record<string, unknown>;
}): AmazonWorkflowAuditMetadata {
  return {
    stage: args.stage,
    actorId: args.actor.id,
    organizationId: args.actor.organizationId,
    batchId: args.batchId ?? null,
    fileId: args.fileId ?? null,
    candidateId: args.candidateId ?? null,
    at: new Date().toISOString(),
    details: args.details,
  };
}

export function redactedIssueDetails(details: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    redacted[key] = /name|driver|card|route|raw|identifier/i.test(key) ? "[redacted]" : value;
  }
  return redacted;
}
