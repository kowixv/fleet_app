import "server-only";

import { createClient, createServiceClient } from "@/lib/supabase/server";
import { isAllowedAmazonSourceType } from "../contracts";
import type { AmazonImportSourceType } from "../types";
import { assertWorkflow } from "./workflow-errors";
import {
  amazonFileSha256,
  assertAmazonFileEnvelope,
  assertAmazonFileSecurity,
  assertExpectedAmazonStoragePath,
  buildAmazonImportStoragePath,
  sanitizeAmazonDisplayFilename,
  verifyStoredAmazonObject,
} from "./storage";
import type { AmazonImportFileRecord, AmazonUploadRegistration, AmazonUploadRegistrationInput, AmazonWorkflowActor } from "./workflow-types";
import { loadAmazonBatchForActor } from "./batch-service";

export const AMAZON_IMPORT_BUCKET = "imports";

export function parseAmazonSourceType(value: unknown): AmazonImportSourceType {
  const sourceType = typeof value === "string" ? value : "";
  assertWorkflow(isAllowedAmazonSourceType(sourceType), {
    code: "invalid_source_type",
    message: "Unsupported Amazon import source type.",
    stage: "upload_files",
  });
  return sourceType;
}

export function assertAmazonUploadEnvelope(args: {
  sourceType: AmazonImportSourceType;
  filename: string;
  mimeType: string | null;
  sizeBytes: number;
}): void {
  assertAmazonFileEnvelope(args);
}

export async function registerAmazonImportFile(input: {
  actor: AmazonWorkflowActor;
  upload: AmazonUploadRegistrationInput;
}): Promise<AmazonUploadRegistration> {
  const batch = await loadAmazonBatchForActor(input.actor, input.upload.batchId);
  assertWorkflow(batch.status === "uploaded" || batch.status === "failed", {
    code: "invalid_batch_status",
    message: "Files can only be registered before parsing or through an explicit retry.",
    stage: "upload_files",
    details: { status: batch.status },
  });

  assertAmazonFileSecurity(input.upload);
  const displayFilename = sanitizeAmazonDisplayFilename(input.upload.filename);
  const sha256Hash = amazonFileSha256(input.upload.bytes);
  const supabase = await createClient();
  const { data: duplicate, error: duplicateError } = await supabase
    .from("amazon_import_files")
    .select("id")
    .eq("organization_id", input.actor.organizationId)
    .eq("batch_id", input.upload.batchId)
    .eq("source_type", input.upload.sourceType)
    .eq("sha256_hash", sha256Hash)
    .in("status", ["uploaded", "parsing", "parsed"])
    .maybeSingle();
  if (duplicateError) throw new Error(duplicateError.message);
  if (duplicate) {
    return {
      fileId: String((duplicate as { id: string }).id),
      batchId: input.upload.batchId,
      sourceType: input.upload.sourceType,
      displayFilename,
      sizeBytes: input.upload.bytes.byteLength,
      sha256Hash,
      duplicate: true,
    };
  }

  const storagePath = buildAmazonImportStoragePath({
    organizationId: input.actor.organizationId,
    batchId: input.upload.batchId,
    sourceType: input.upload.sourceType,
    sha256Hash,
  });
  const service = createServiceClient();
  const uploaded = await service.storage
    .from(AMAZON_IMPORT_BUCKET)
    .upload(storagePath, input.upload.bytes, {
      contentType: input.upload.mimeType ?? "application/octet-stream",
      upsert: false,
    });
  if (uploaded.error) throw new Error(uploaded.error.message);
  assertExpectedAmazonStoragePath({
    path: storagePath,
    organizationId: input.actor.organizationId,
    batchId: input.upload.batchId,
    sourceType: input.upload.sourceType,
    sha256Hash,
  });
  const stored = await service.storage.from(AMAZON_IMPORT_BUCKET).download(storagePath);
  if (stored.error || !stored.data) throw new Error(stored.error?.message ?? "Stored object verification failed.");
  verifyStoredAmazonObject({
    sourceType: input.upload.sourceType,
    filename: displayFilename,
    mimeType: input.upload.mimeType,
    bytes: new Uint8Array(await stored.data.arrayBuffer()),
    expectedSha256Hash: sha256Hash,
    expectedSizeBytes: input.upload.bytes.byteLength,
  });

  const { data, error } = await supabase
    .from("amazon_import_files")
    .insert({
      organization_id: input.actor.organizationId,
      batch_id: input.upload.batchId,
      source_type: input.upload.sourceType,
      original_filename: displayFilename,
      storage_path: storagePath,
      mime_type: input.upload.mimeType,
      size_bytes: input.upload.bytes.byteLength,
      sha256_hash: sha256Hash,
      status: "uploaded",
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return {
    fileId: String((data as { id: string }).id),
    batchId: input.upload.batchId,
    sourceType: input.upload.sourceType,
    displayFilename,
    sizeBytes: input.upload.bytes.byteLength,
    sha256Hash,
    duplicate: false,
  };
}

export async function listAmazonImportFiles(actor: AmazonWorkflowActor, batchId: string): Promise<AmazonImportFileRecord[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("amazon_import_files")
    .select("id, organization_id, batch_id, source_type, original_filename, storage_path, mime_type, size_bytes, sha256_hash, parser_name, parser_version, schema_signature, status")
    .eq("organization_id", actor.organizationId)
    .eq("batch_id", batchId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as AmazonImportFileRecord[];
}

export async function downloadAmazonImportFile(actor: AmazonWorkflowActor, file: AmazonImportFileRecord): Promise<Uint8Array> {
  assertWorkflow(file.organization_id === actor.organizationId, {
    code: "wrong_organization",
    message: "Amazon import file does not belong to this organization.",
    stage: "parse_files",
  });
  assertExpectedAmazonStoragePath({
    path: file.storage_path,
    organizationId: actor.organizationId,
    batchId: file.batch_id,
    sourceType: file.source_type,
    sha256Hash: file.sha256_hash,
  });
  const service = createServiceClient();
  const { data, error } = await service.storage.from(AMAZON_IMPORT_BUCKET).download(file.storage_path);
  if (error || !data) throw new Error(error?.message ?? "File download failed.");
  return new Uint8Array(await data.arrayBuffer());
}
