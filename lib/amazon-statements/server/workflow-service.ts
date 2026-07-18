import "server-only";

import { createClient } from "@/lib/supabase/server";
import { transitionAmazonBatch } from "./batch-service";
import { downloadAmazonImportFile, listAmazonImportFiles, registerAmazonImportFile } from "./file-service";
import { inspectAmazonImportFile, parseAmazonImportFile } from "./parse-service";
import { persistNormalizedSources } from "./persistence-service";
import type { AmazonUploadRegistrationInput, AmazonWorkflowActor } from "./workflow-types";

export async function createAmazonImportUpload(args: {
  actor: AmazonWorkflowActor;
  upload: AmazonUploadRegistrationInput;
}) {
  return registerAmazonImportFile(args);
}

export async function inspectAmazonImportBatch(args: {
  actor: AmazonWorkflowActor;
  batchId: string;
}) {
  const files = await listAmazonImportFiles(args.actor, args.batchId);
  const supabase = await createClient();
  const inspected: Array<{ fileId: string; parserName: string | null; parserVersion: string | null; schemaSignature: string | null; warnings: string[] }> = [];
  for (const file of files) {
    const bytes = await downloadAmazonImportFile(args.actor, file);
    const result = await inspectAmazonImportFile({ file, bytes });
    const { error } = await supabase
      .from("amazon_import_files")
      .update({
        parser_name: result.parserName,
        parser_version: result.parserVersion,
        schema_signature: result.schemaSignature,
      })
      .eq("organization_id", args.actor.organizationId)
      .eq("id", file.id);
    if (error) throw new Error(error.message);
    inspected.push({ fileId: file.id, ...result });
  }
  return inspected;
}

export async function parseAmazonImportBatch(args: {
  actor: AmazonWorkflowActor;
  batchId: string;
}) {
  await transitionAmazonBatch({
    actor: args.actor,
    batchId: args.batchId,
    to: "parsing",
    operation: "parse_files",
  });
  const files = await listAmazonImportFiles(args.actor, args.batchId);
  const supabase = await createClient();
  const persisted: Array<{ fileId: string; sourceType: string; normalizedKind: string; recordCount: number }> = [];
  let blockingIssues = 0;
  try {
    for (const file of files) {
      const bytes = await downloadAmazonImportFile(args.actor, file);
      const parsed = await parseAmazonImportFile({ file, bytes });
      const result = await persistNormalizedSources({ actor: args.actor, batchId: args.batchId, file, parsed });
      blockingIssues += parsed.generic.issues.filter((issue) => issue.severity === "blocking").length;
      persisted.push({ fileId: file.id, sourceType: file.source_type, ...result });
    }
    await transitionAmazonBatch({
      actor: args.actor,
      batchId: args.batchId,
      to: "parsed",
      operation: "persist_normalized_sources",
      hasBlockingIssues: blockingIssues > 0,
    });
    if (blockingIssues > 0) {
      await transitionAmazonBatch({
        actor: args.actor,
        batchId: args.batchId,
        to: "needs_review",
        operation: "persist_normalized_sources",
        hasBlockingIssues: true,
      });
    }
    return { persisted, blockingIssues };
  } catch (error) {
    await transitionAmazonBatch({
      actor: args.actor,
      batchId: args.batchId,
      to: "failed",
      operation: "parse_files",
    }).catch(() => undefined);
    throw error;
  }
}
