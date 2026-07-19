import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { AmazonImportSourceType } from "../types";
import { assertWorkflow } from "./workflow-errors";

const MAX_FILE_BYTES: Record<AmazonImportSourceType, number> = {
  amazon_payment: 10 * 1024 * 1024,
  amazon_trips: 10 * 1024 * 1024,
  fuel_card: 25 * 1024 * 1024,
  statement_reference: 25 * 1024 * 1024,
};

const SOURCE_FORMATS: Record<AmazonImportSourceType, { extension: string; mimes: readonly string[] }> = {
  amazon_payment: {
    extension: ".xlsx",
    mimes: [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/octet-stream",
    ],
  },
  amazon_trips: {
    extension: ".csv",
    mimes: ["text/csv", "application/csv", "application/vnd.ms-excel", "text/plain", "application/octet-stream"],
  },
  fuel_card: {
    extension: ".pdf",
    mimes: ["application/pdf", "application/octet-stream"],
  },
  statement_reference: {
    extension: ".pdf",
    mimes: ["application/pdf", "application/octet-stream"],
  },
};

export function amazonFileSha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function sanitizeAmazonDisplayFilename(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? "upload";
  const cleaned = base.replace(/[^\w.\- ()]/g, "_").replace(/\s+/g, " ").trim();
  return cleaned.slice(0, 160) || "upload";
}

export function amazonStorageExtension(sourceType: AmazonImportSourceType): string {
  return SOURCE_FORMATS[sourceType].extension;
}

export function buildAmazonImportStoragePath(args: {
  organizationId: string;
  batchId: string;
  sourceType: AmazonImportSourceType;
  sha256Hash: string;
}): string {
  const extension = amazonStorageExtension(args.sourceType);
  return [
    args.organizationId,
    "amazon-statements",
    args.batchId,
    args.sourceType,
    `${args.sha256Hash}-${randomUUID()}${extension}`,
  ].join("/");
}

export function assertOwnedAmazonStoragePath(path: string, organizationId: string): void {
  assertWorkflow(
    path.startsWith(`${organizationId}/amazon-statements/`) && !path.includes("..") && !path.includes("\\"),
    { code: "unsafe_storage_path", message: "Storage path is not scoped to the caller organization.", stage: "upload_files" },
  );
}

export function assertExpectedAmazonStoragePath(args: {
  path: string;
  organizationId: string;
  batchId: string;
  sourceType: AmazonImportSourceType;
  sha256Hash: string;
}): void {
  assertOwnedAmazonStoragePath(args.path, args.organizationId);
  const expectedPrefix = `${args.organizationId}/amazon-statements/${args.batchId}/${args.sourceType}/${args.sha256Hash}-`;
  assertWorkflow(args.path.startsWith(expectedPrefix), {
    code: "storage_path_mismatch",
    message: "Stored object path does not match the issued upload reservation.",
    stage: "upload_files",
  });
  assertWorkflow(args.path.endsWith(amazonStorageExtension(args.sourceType)), {
    code: "storage_path_mismatch",
    message: "Stored object extension does not match the source type.",
    stage: "upload_files",
  });
}

export function verifyStoredAmazonObject(args: {
  sourceType: AmazonImportSourceType;
  filename: string;
  mimeType: string | null;
  bytes: Uint8Array;
  expectedSha256Hash: string;
  expectedSizeBytes: number;
}): { sha256Hash: string; sizeBytes: number } {
  const sha256Hash = amazonFileSha256(args.bytes);
  const sizeBytes = args.bytes.byteLength;
  assertWorkflow(sha256Hash === args.expectedSha256Hash, {
    code: "stored_hash_mismatch",
    message: "Stored object hash does not match the upload reservation.",
    stage: "upload_files",
  });
  assertWorkflow(sizeBytes === args.expectedSizeBytes, {
    code: "stored_size_mismatch",
    message: "Stored object size does not match the upload reservation.",
    stage: "upload_files",
  });
  assertAmazonFileSecurity({
    sourceType: args.sourceType,
    filename: args.filename,
    mimeType: args.mimeType,
    bytes: args.bytes,
  });
  return { sha256Hash, sizeBytes };
}

export function assertAmazonFileSecurity(args: {
  sourceType: AmazonImportSourceType;
  filename: string;
  mimeType: string | null;
  bytes: Uint8Array;
}): void {
  assertAmazonFileEnvelope({
    sourceType: args.sourceType,
    filename: args.filename,
    mimeType: args.mimeType,
    sizeBytes: args.bytes.byteLength,
  });
  assertMagicBytes(args.sourceType, args.bytes);
}

export function assertAmazonFileEnvelope(args: {
  sourceType: AmazonImportSourceType;
  filename: string;
  mimeType: string | null;
  sizeBytes: number;
}): void {
  const format = SOURCE_FORMATS[args.sourceType];
  const displayFilename = sanitizeAmazonDisplayFilename(args.filename).toLowerCase();
  assertWorkflow(displayFilename.endsWith(format.extension), {
    code: "invalid_file_extension",
    message: `${args.sourceType} requires ${format.extension} files.`,
    stage: "upload_files",
  });
  if (args.mimeType) {
    assertWorkflow(format.mimes.includes(args.mimeType), {
      code: "invalid_mime_type",
      message: `${args.sourceType} file MIME type is not accepted.`,
      stage: "upload_files",
      details: { mimeType: args.mimeType },
    });
  }
  assertWorkflow(args.sizeBytes > 0, {
    code: "empty_file",
    message: "Uploaded file is empty.",
    stage: "upload_files",
  });
  assertWorkflow(args.sizeBytes <= MAX_FILE_BYTES[args.sourceType], {
    code: "file_too_large",
    message: "Uploaded file exceeds the allowed size.",
    stage: "upload_files",
    details: { maxBytes: MAX_FILE_BYTES[args.sourceType] },
  });
}

function assertMagicBytes(sourceType: AmazonImportSourceType, bytes: Uint8Array): void {
  if (sourceType === "amazon_payment") {
    assertWorkflow(bytes[0] === 0x50 && bytes[1] === 0x4b, {
      code: "invalid_file_signature",
      message: "XLSX file signature is invalid.",
      stage: "upload_files",
    });
  }
  if (sourceType === "fuel_card" || sourceType === "statement_reference") {
    const header = Buffer.from(bytes.slice(0, 5)).toString("ascii");
    assertWorkflow(header === "%PDF-", {
      code: "invalid_file_signature",
      message: "PDF file signature is invalid.",
      stage: "upload_files",
    });
  }
  if (sourceType === "amazon_trips") {
    const firstBytes = bytes.slice(0, Math.min(bytes.byteLength, 512));
    assertWorkflow(!firstBytes.includes(0), {
      code: "invalid_file_signature",
      message: "CSV file appears to contain binary data.",
      stage: "upload_files",
    });
  }
}
