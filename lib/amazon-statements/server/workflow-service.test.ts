import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const actionSource = readFileSync("app/(app)/settlements/amazon-imports/actions.ts", "utf8");
const settlementActionSource = readFileSync("app/(app)/settlements/actions.ts", "utf8");
const sharedCreatorSource = readFileSync("lib/settlement/create-from-selection.ts", "utf8");
const conversionSource = readFileSync("lib/amazon-statements/server/conversion-service.ts", "utf8");
const pdfServiceSource = readFileSync("lib/amazon-statements/server/pdf-service.ts", "utf8");
const parseServiceSource = readFileSync("lib/amazon-statements/server/parse-service.ts", "utf8");
const persistenceServiceSource = readFileSync("lib/amazon-statements/server/persistence-service.ts", "utf8");
const referenceServiceSource = readFileSync("lib/amazon-statements/server/reference-service.ts", "utf8");
const batchServiceSource = readFileSync("lib/amazon-statements/server/batch-service.ts", "utf8");
const storageSource = readFileSync("lib/amazon-statements/server/storage.ts", "utf8");
const fileServiceSource = readFileSync("lib/amazon-statements/server/file-service.ts", "utf8");
const hardeningMigration = readFileSync("supabase/migrations/20260716070000_amazon_server_workflow_hardening.sql", "utf8");
const vitestConfigSource = readFileSync("vitest.config.ts", "utf8");

describe("amazon server workflow transitions", () => {
  it("allows only approved batch status transitions", () => {
    expect(batchServiceSource).toContain('{ from: "uploaded", to: "parsing", operation: "parse_files" }');
    expect(batchServiceSource).toContain('{ from: "parsing", to: "parsed", operation: "persist_normalized_sources" }');
    expect(batchServiceSource).toContain('{ from: "failed", to: "uploaded", operation: "retry_failed" }');
    expect(batchServiceSource).toContain('if (args.from === "archived") return false;');
    expect(batchServiceSource).toContain('args.to === "ready"');
  });

  it("requires financial reconciliation and no blockers before ready", () => {
    expect(batchServiceSource).toContain("transition_amazon_import_batch_atomic");
    expect(hardeningMigration).toContain("p_financial_reconciled");
    expect(hardeningMigration).toContain("p_has_blocking_issues");
    expect(hardeningMigration).toContain("for update");
    expect(hardeningMigration).toContain("Stale Amazon import batch status");
  });
});

describe("amazon upload security helpers", () => {
  it("accepts valid source signatures and computes deterministic hashes", () => {
    expect(storageSource).toContain("createHash(\"sha256\")");
    expect(storageSource).toContain("bytes[0] === 0x50 && bytes[1] === 0x4b");
    expect(storageSource).toContain('header === "%PDF-"');
    expect(storageSource).toContain("!firstBytes.includes(0)");
  });

  it("rejects invalid extension, MIME, size and signature", () => {
    expect(storageSource).toContain("assertAmazonFileEnvelope");
    expect(storageSource).toContain("sizeBytes");
    expect(storageSource).toContain("invalid_file_extension");
    expect(storageSource).toContain("invalid_mime_type");
    expect(storageSource).toContain("file_too_large");
    expect(storageSource).toContain("invalid_file_signature");
  });

  it("sanitizes filenames and scopes storage paths to organization folders", () => {
    expect(storageSource).toContain("sanitizeAmazonDisplayFilename");
    expect(storageSource).toContain("buildAmazonImportStoragePath");
    expect(storageSource).toContain("assertExpectedAmazonStoragePath");
    expect(storageSource).toContain("verifyStoredAmazonObject");
    expect(fileServiceSource).toContain("assertExpectedAmazonStoragePath({");
    expect(fileServiceSource).toContain("path: file.storage_path");
    expect(fileServiceSource).toContain(".download(storagePath)");
  });

  it("validates upload envelopes before buffering browser files", () => {
    const envelopeIndex = actionSource.indexOf("assertAmazonUploadEnvelope({");
    const bufferIndex = actionSource.indexOf("await file.arrayBuffer()");
    expect(envelopeIndex).toBeGreaterThan(-1);
    expect(bufferIndex).toBeGreaterThan(-1);
    expect(envelopeIndex).toBeLessThan(bufferIndex);
  });

  it("scopes duplicate upload idempotency to the current batch", () => {
    expect(fileServiceSource).toMatch(/\.eq\("organization_id", input\.actor\.organizationId\)[\s\S]*\.eq\("batch_id", input\.upload\.batchId\)[\s\S]*\.eq\("source_type", input\.upload\.sourceType\)[\s\S]*\.eq\("sha256_hash", sha256Hash\)/);
  });
});

describe("amazon server source contracts", () => {
  it("keeps parser access behind server-only workflow modules", () => {
    expect(parseServiceSource.startsWith('import "server-only";')).toBe(true);
    expect(parseServiceSource).toContain("../parsers/payment-xlsx");
    expect(parseServiceSource).toContain("../parsers/trips-csv");
    expect(parseServiceSource).toContain("../parsers/octane-fuel-pdf");
    expect(readFileSync("lib/amazon-statements/server/workflow-service.ts", "utf8")).toContain('import "server-only";');
  });

  it("keeps server actions thin and free of parser/storage dependencies", () => {
    expect(actionSource).toContain('"use server"');
    expect(actionSource).not.toMatch(/xlsx|unpdf|createServiceClient|create_settlement_with_links_atomic/);
    expect(actionSource).toContain("parseAmazonImportBatchService");
  });

  it("routes existing settlement action and Amazon conversion through one shared creator", () => {
    expect(sharedCreatorSource.match(/create_settlement_with_links_atomic/g) ?? []).toHaveLength(2);
    expect(settlementActionSource).toContain("createSettlementWithLinksAtomic");
    expect(conversionSource).toContain("convert_amazon_candidate_atomic");
    expect(conversionSource).not.toContain("create_settlement_with_links_atomic");
  });

  it("keeps PDF generation snapshot-only", () => {
    expect(pdfServiceSource).toContain("AmazonStatementViewModel");
    expect(pdfServiceSource).toContain("assertValidStatementViewModel");
    expect(pdfServiceSource).not.toMatch(/PAYMENT|Trips|fuel\.pdf|parse|storage|from\(/);
  });

  it("preserves raw-row lineage and ordered trip driver tokens during persistence", () => {
    expect(persistenceServiceSource).toContain("raw_row_id");
    expect(persistenceServiceSource).toContain("rawRowIdsByLineage");
    expect(persistenceServiceSource).toContain("amazon_trip_driver_tokens");
    expect(persistenceServiceSource).toContain("token_order: index + 1");
    expect(persistenceServiceSource).toContain("requires_split_rule");
  });

  it("deduplicates issues with hashed deterministic keys instead of raw details", () => {
    expect(persistenceServiceSource).toContain("issueDetailsHash");
    expect(persistenceServiceSource).toContain("issueKey");
    expect(persistenceServiceSource).not.toContain("JSON.stringify(issue.details),");
  });

  it("persists each parsed source file through one transactional database RPC", () => {
    expect(persistenceServiceSource).toContain("persist_amazon_source_atomic");
    expect(hardeningMigration).toContain("create or replace function public.persist_amazon_source_atomic");
    expect(hardeningMigration).toContain("for update");
    expect(hardeningMigration).toContain("status = 'parsed'");
    expect(hardeningMigration).toContain("Parser version or schema signature changed");
  });

  it("defines an exactly-once atomic candidate conversion RPC", () => {
    expect(hardeningMigration).toContain("create or replace function public.convert_amazon_candidate_atomic");
    expect(hardeningMigration).toContain("for update");
    expect(hardeningMigration).toContain("public.create_settlement_with_links_atomic");
    expect(hardeningMigration).toContain("converted_settlement_id = v_settlement_id");
    expect(hardeningMigration).toContain("already_converted");
    expect(hardeningMigration).toContain("amazon_statement_candidates_conversion_idempotency_key");
  });

  it("does not globally neutralize server-only in Vitest", () => {
    expect(vitestConfigSource).not.toContain("server-only");
  });

  it("exposes explicit safe reference review operations without auto-creating people or vehicles", () => {
    expect(referenceServiceSource).toContain("approveExternalDriverMapping");
    expect(referenceServiceSource).toContain("approveVehicleAliasMapping");
    expect(referenceServiceSource).toContain("archiveVehicleAliasMapping");
    expect(referenceServiceSource).toContain("verifyFacilityMapping");
    expect(referenceServiceSource).toContain("approveFuelCardAssignment");
    expect(referenceServiceSource).toContain("approveTeamSplitRule");
    expect(referenceServiceSource).toContain("rejectReferenceMapping");
    expect(referenceServiceSource).toContain("assertNoApprovedOverlap");
    expect(referenceServiceSource).not.toMatch(/\.from\(\"people\"\)\.insert|\.from\(\"vehicles\"\)\.insert/);
    expect(referenceServiceSource).not.toMatch(/splitBasisPoints:\s*5000/);
  });
});
