import "server-only";

import type { AmazonImportBatchStatus, AmazonImportSourceType } from "../types";

export const AMAZON_WORKFLOW_STAGES = [
  "create_batch",
  "upload_files",
  "inspect_files",
  "parse_files",
  "persist_normalized_sources",
  "reconcile_payment",
  "match_payment_to_trips",
  "reconcile_fuel",
  "resolve_references",
  "preview_projection",
  "apply_projection",
  "compile_candidates",
  "approve_candidate",
  "convert_candidate",
  "generate_statement_pdf",
] as const;

export type AmazonWorkflowStage = typeof AMAZON_WORKFLOW_STAGES[number];
export type AmazonWorkflowActorRole = "viewer" | "writer";

export type AmazonWorkflowResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: AmazonWorkflowErrorShape };

export interface AmazonWorkflowErrorShape {
  code: string;
  message: string;
  stage?: AmazonWorkflowStage;
  retryable?: boolean;
  details?: Record<string, unknown>;
}

export interface AmazonWorkflowActor {
  id: string;
  organizationId: string;
  role: string;
  access: AmazonWorkflowActorRole;
}

export interface AmazonBatchRecord {
  id: string;
  organization_id: string;
  status: AmazonImportBatchStatus;
  parser_bundle_version: string | null;
  period_start?: string | null;
  period_end?: string | null;
}

export interface AmazonImportFileRecord {
  id: string;
  organization_id: string;
  batch_id: string;
  source_type: AmazonImportSourceType;
  original_filename: string;
  storage_path: string;
  mime_type: string | null;
  size_bytes: number;
  sha256_hash: string;
  parser_name: string | null;
  parser_version: string | null;
  schema_signature: string | null;
  status: "uploaded" | "parsing" | "parsed" | "failed" | "archived";
}

export interface AmazonUploadRegistrationInput {
  batchId: string;
  sourceType: AmazonImportSourceType;
  filename: string;
  mimeType: string | null;
  bytes: Uint8Array;
}

export interface AmazonUploadRegistration {
  fileId: string;
  batchId: string;
  sourceType: AmazonImportSourceType;
  displayFilename: string;
  sizeBytes: number;
  sha256Hash: string;
  duplicate: boolean;
}

export interface AmazonWorkflowAuditMetadata {
  stage: AmazonWorkflowStage;
  actorId: string;
  organizationId: string;
  batchId?: string | null;
  fileId?: string | null;
  candidateId?: string | null;
  at: string;
  details?: Record<string, unknown>;
}

export interface AmazonTransitionRule {
  from: AmazonImportBatchStatus;
  to: AmazonImportBatchStatus;
  operation: AmazonWorkflowStage | "retry_failed" | "archive_batch";
}
