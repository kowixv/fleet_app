import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { amazonImportDetailFixtures, amazonImportListFixtures } from "./ui-fixtures";

const root = process.cwd();
const page = read("app/(app)/settlements/amazon-imports/page.tsx");
const newPage = read("app/(app)/settlements/amazon-imports/new/page.tsx");
const detailPage = read("app/(app)/settlements/amazon-imports/[id]/page.tsx");
const actions = read("app/(app)/settlements/amazon-imports/actions.ts");
const createForm = read("app/(app)/settlements/amazon-imports/components/create-batch-form.tsx");
const upload = read("app/(app)/settlements/amazon-imports/components/source-file-upload.tsx");
const fileCard = read("app/(app)/settlements/amazon-imports/components/uploaded-files-card.tsx");
const reconciliation = read("app/(app)/settlements/amazon-imports/components/reconciliation-summary.tsx");
const issues = read("app/(app)/settlements/amazon-imports/components/issue-summary.tsx");
const references = read("app/(app)/settlements/amazon-imports/components/reference-readiness-summary.tsx");
const projection = read("app/(app)/settlements/amazon-imports/components/projection-summary.tsx");
const candidates = read("app/(app)/settlements/amazon-imports/components/candidate-summary.tsx");
const candidateEditor = read("app/(app)/settlements/amazon-imports/components/candidate-editor-workspace.tsx");
const candidateNewPage = read("app/(app)/settlements/amazon-imports/[id]/candidates/new/page.tsx");
const candidateEditPage = read("app/(app)/settlements/amazon-imports/[id]/candidates/[candidateId]/page.tsx");
const batchOperations = read("app/(app)/settlements/amazon-imports/components/batch-operations.tsx");
const history = read("app/(app)/settlements/amazon-imports/components/history-timeline.tsx");
const pdfRoute = read("app/api/settlements/amazon-imports/candidates/[candidateId]/statement/route.ts");
const candidatePdfModelSource = read("lib/amazon-statements/pdf/candidate-pdf-model.ts");
const pdfResponseSource = read("lib/amazon-statements/pdf/statement-pdf-response.ts");
const finalWorkflowService = read("lib/amazon-statements/server/final-workflow-service.ts");
const conversionService = read("lib/amazon-statements/server/conversion-service.ts");
const candidateService = read("lib/amazon-statements/server/candidate-service.ts");
const finalSyntheticScript = read("scripts/simulate-amazon-final-workflow.ts");
const rolloutChecklist = read("docs/amazon-statements/rollout-checklist.md");
const readService = read("lib/amazon-statements/server/ui-read-service.ts");
const sidebar = read("components/Sidebar.tsx");

describe("amazon import UI slice", () => {
  it("creates the required routes and navigation entry", () => {
    expect(page).toContain("Amazon Imports");
    expect(newPage).toContain("Create Amazon import batch");
    expect(detailPage).toContain("getAmazonImportBatchDetailForUi");
    expect(candidateNewPage).toContain("getAmazonCandidateEditorForUi");
    expect(candidateEditPage).toContain("getAmazonCandidateEditorForUi");
    expect(read("app/(app)/settlements/amazon-imports/[id]/loading.tsx")).toContain("animate-pulse");
    expect(read("app/(app)/settlements/amazon-imports/[id]/error.tsx")).toContain("stack traces are intentionally hidden");
    expect(sidebar).toContain("/settlements/amazon-imports");
  });

  it("supports list empty state, organization-scoped view model, and safe filters", () => {
    expect(amazonImportListFixtures[0].sourceFileCompleteness).toBe("0/4");
    expect(page).toContain("status");
    expect(page).toContain("period");
    expect(page).toContain("Needs review");
    expect(page).toContain("Ready");
    expect(readService).toContain("requireAmazonImportActor()");
    expect(readService).toContain(".limit(50)");
    expect(readService).not.toContain("createServiceClient");
  });

  it("validates create batch input and omits organization or financial fields", () => {
    expect(createForm).toContain("Period start must not be after period end");
    expect(createForm).toContain("createAmazonImportBatchAction");
    expect(createForm).toContain("Viewer users can inspect");
    expect(createForm).not.toContain("organization_id");
    expect(createForm).not.toMatch(/gross|net|total/i);
    expect(actions).toContain("requireAmazonImportActor({ writer: true })");
  });

  it("renders exactly four upload source slots with client-only UX validation", () => {
    const slotBlock = upload.match(/const SLOTS:[\s\S]*?\];/)?.[0] ?? "";
    expect(slotBlock.match(/sourceType:/g) ?? []).toHaveLength(4);
    expect(upload).toContain("amazon_payment");
    expect(upload).toContain("amazon_trips");
    expect(upload).toContain("fuel_card");
    expect(upload).toContain("statement_reference");
    expect(upload).toContain("must be a");
    expect(upload).toContain("exceeds the");
    expect(upload).toContain("Uploading and verifying stored bytes");
  });

  it("does not expose storage paths, signed URLs, hashes, or raw source values in UI components", () => {
    for (const source of clientAndPageSources()) {
      expect(source).not.toMatch(/storage_path|sha256_hash|signedUrl|signed_url|raw_data|raw PDF|raw spreadsheet/i);
    }
    expect(fileCard).toContain("sanitizedFilename");
    expect(fileCard).toContain("verifiedSizeBytes");
  });

  it("makes parse available only through gated action props", () => {
    expect(upload).toContain("canParse");
    expect(upload).toContain("disabled={!canParse || pendingParse}");
    expect(upload).toContain("parseAmazonImportBatchAction");
    expect(detailPage).toContain("canParse={batch.canParse}");
  });

  it("renders workflow stages without collapsing later blockers into earlier failures", () => {
    const fixture = amazonImportDetailFixtures.warning;
    expect(fixture.workflow.map((step) => step.label)).toEqual([
      "Files",
      "Parsing",
      "Reconciliation",
      "Matching",
      "References",
      "Projection",
      "Candidates",
      "Statements",
    ]);
    expect(fixture.workflow[0].state).toBe("completed");
    expect(fixture.workflow[4].state).toBe("blocked");
  });

  it("keeps fuel financial and transaction-count statuses separate", () => {
    expect(reconciliation).toContain("financialStatus");
    expect(reconciliation).toContain("transactionCountStatus");
    expect(amazonImportDetailFixtures.warning.reconciliation.fuel.financialStatus).toBe("passed");
    expect(amazonImportDetailFixtures.warning.reconciliation.fuel.transactionCountStatus).toBe("warning");
  });

  it("distinguishes unique root issue count from dependency count", () => {
    expect(issues).toContain("Unique root issues");
    expect(issues).toContain("Affected dependencies");
    expect(amazonImportDetailFixtures.warning.issues[0].uniqueRootCount).toBeLessThan(
      amazonImportDetailFixtures.warning.issues[0].affectedDependencyCount,
    );
  });

  it("renders reference readiness, projection, and candidates as complete workflow controls", () => {
    expect(references).toContain("Read-only aggregate readiness");
    expect(projection).toContain("applyAmazonProjectionAction");
    expect(projection).toContain("Projection creates pending operational rows only");
    expect(candidates).toContain("/candidates/new");
    expect(candidates).toContain("/candidates/${candidate.id}");
    expect(candidateEditor).toContain("createAmazonCandidateAction");
    expect(candidates).toContain("approveAmazonCandidateAction");
    expect(candidates).toContain("convertAmazonCandidateAction");
    expect(candidates).toContain("Download Final Statement");
  });

  it("provides a reviewed candidate editor for all statement types and source subsets", () => {
    for (const statementType of ["company_driver", "box_truck_driver", "owner_operator", "managed_investor"]) {
      expect(candidateEditor).toContain(statementType);
      expect(finalWorkflowService).toContain(statementType);
    }
    expect(candidateEditor).toContain("Select statement type");
    expect(candidateEditor).toContain("selectedRevenueItemIds");
    expect(candidateEditor).toContain("selectedFuelLineIds");
    expect(candidateEditor).toContain("Select all visible (manual)");
    expect(candidateEditor).toContain("no_fuel");
    expect(candidateEditor).toContain("Automatic source selection");
    expect(candidateEditor).toContain("previewAmazonCandidateAction");
    expect(candidateEditor).toContain("createAmazonCandidateAction");
    expect(finalWorkflowService).toContain("previewReviewedAmazonCandidate");
    expect(finalWorkflowService).toContain("saveReviewedAmazonCandidate");
    expect(finalWorkflowService).toContain(".in(\"revenue_item_id\", selectedRevenueItemIds)");
    expect(finalWorkflowService).toContain(".in(\"transaction_line_id\", selectedFuelLineIds)");
    expect(finalWorkflowService).not.toContain("createDefaultAmazonCandidate");
  });

  it("keeps browser input to selections and policy fields, not financial totals", () => {
    const payloadBlock = candidateEditor.match(/return \{[\s\S]*?fixedAdjustments:[\s\S]*?\n    \};/)?.[0] ?? "";
    expect(candidateEditor).toContain("companyFeeBasisPoints: adjustmentRate");
    expect(candidateEditor).toContain("driverPayBasisPoints: adjustmentRate");
    expect(candidateEditor).toContain("fixedAdjustments");
    expect(payloadBlock).not.toMatch(/grossAmount|netAmount|totalDeductionsAmount|organizationId/);
    expect(finalWorkflowService).toContain("assertPayeeAndLane");
    expect(finalWorkflowService).toContain("missing_revenue_selection");
    expect(finalWorkflowService).toContain("invalid_revenue_selection");
    expect(finalWorkflowService).toContain("invalid_fuel_selection");
  });

  it("adds final workflow tabs, breadcrumbs, history, and controlled batch operations", () => {
    expect(detailPage).toContain("overview");
    expect(detailPage).toContain("projection");
    expect(detailPage).toContain("statements");
    expect(detailPage).toContain("Current batch");
    expect(batchOperations).toContain("retryAmazonImportBatchAction");
    expect(batchOperations).toContain("archiveAmazonImportBatchAction");
    expect(batchOperations).not.toContain("status=");
    expect(history).toContain("raw snapshots, storage paths, hashes");
  });

  it("keeps writer mutations server-authorized and does not accept browser financial authority", () => {
    expect(actions).toContain("applyAmazonProjectionAction");
    expect(actions).toContain("createAmazonCandidateAction");
    expect(actions).toContain("convertAmazonCandidateAction");
    expect(actions.match(/requireAmazonImportActor\(\{ writer: true \}\)/g)?.length ?? 0).toBeGreaterThanOrEqual(8);
    expect(candidates).not.toMatch(/grossAmount|netAmount|organizationId/);
    expect(finalWorkflowService).toContain("companyFeeBasisPoints");
    expect(finalWorkflowService).not.toMatch(/from\(\"settlements\"\)\.insert|insert into public\.settlements/i);
  });

  it("persists candidate source links and converts only through the atomic Amazon RPC", () => {
    expect(candidateService).toContain("amazon_statement_candidate_revenue");
    expect(candidateService).toContain("amazon_statement_candidate_fuel_lines");
    expect(candidateService).toContain("amazon_statement_candidate_adjustments");
    expect(candidateService).toContain("candidate_readiness_blocked");
    expect(conversionService).toContain("convertSavedAmazonCandidate");
    expect(conversionService).toContain('rpc("convert_amazon_candidate_atomic"');
    expect(conversionService).not.toMatch(/from\(\"settlements\"\)\.insert|settlement_load_links.*insert|settlement_expense_links.*insert/i);
  });

  it("generates statement PDFs from authenticated saved snapshots only", () => {
    expect(pdfRoute).toContain("requireAmazonImportActor");
    expect(pdfRoute).toContain("calculation_snapshot");
    expect(pdfRoute).toContain("configuration_snapshot");
    expect(candidatePdfModelSource).toContain("languageMode");
    expect(pdfRoute).toContain("renderAmazonStatementPdf");
    expect(pdfResponseSource).toContain("safeFilename");
    expect(pdfRoute).not.toMatch(/parsePaymentXlsx|parseTripsCsv|storage_path|signedUrl|sha256_hash/);
  });

  it("includes rollout artifacts and synthetic final workflow verification", () => {
    expect(read("scripts/amazon-statements-preflight.sql")).toContain("Read-only");
    expect(read("scripts/amazon-statements-post-migration-verify.sql")).toContain("convert_amazon_candidate_atomic");
    expect(rolloutChecklist).toContain("run post-migration verification");
    expect(finalSyntheticScript).toContain("gross");
    expect(finalSyntheticScript).toContain("9291.84");
    expect(finalSyntheticScript).toContain("databaseWrites: 0");
    expect(finalSyntheticScript).toContain("convert_amazon_candidate_atomic");
  });

  it("covers archived and ready display fixture scenarios without private data", () => {
    expect(amazonImportListFixtures.some((row) => row.status === "needs_review")).toBe(true);
    expect(amazonImportDetailFixtures.empty.archived).toBe(false);
    expect(JSON.stringify(amazonImportDetailFixtures)).not.toMatch(/card_last|cardExternal|driver name|invoice number|storage_path|sha256/i);
  });

  it("uses mobile-safe containers and does not import parser/server modules into Client Components", () => {
    expect(fileCard).toContain("overflow-x-auto");
    expect(upload).toContain("md:grid-cols-2");
    expect(page).toContain("md:grid-cols-5");
    for (const source of clientComponentSources()) {
      const imports = source.split("\n").filter((line) => line.startsWith("import ")).join("\n");
      expect(imports).not.toMatch(/from ["']xlsx["']|from ["']read-excel-file|from ["']unpdf["']|from ["']canvas["']|from ["']@napi-rs\/canvas["']|from ["']node:crypto["']|from ["']node:fs["']|amazon-statements\/parsers\/payment-xlsx|amazon-statements\/parsers\/parser-registry|amazon-statements\/server|createClient|createServiceClient/);
    }
  });
});

function read(path: string) {
  return readFileSync(join(root, path), "utf8");
}

function clientAndPageSources() {
  return [
    page,
    newPage,
    detailPage,
    createForm,
      upload,
      fileCard,
      reconciliation,
      issues,
      references,
      projection,
      candidates,
      batchOperations,
      history,
    ];
}

function clientComponentSources() {
  return componentFiles(join(root, "app/(app)/settlements/amazon-imports/components"))
    .map((file) => readFileSync(file, "utf8"))
    .filter((source) => source.startsWith('"use client";'));
}

function componentFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? componentFiles(path) : path.endsWith(".tsx") ? [path] : [];
  });
}
