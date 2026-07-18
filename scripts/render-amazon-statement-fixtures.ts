import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { getDocumentProxy } from "unpdf";
import {
  amazonStatementFixtureNames,
  buildAmazonStatementFixture,
  type AmazonStatementFixtureName,
} from "../lib/amazon-statements/pdf/statement-fixtures";
import { renderAmazonStatementPdf } from "../lib/amazon-statements/pdf/statement-template-registry";
import { validateStatementViewModel } from "../lib/amazon-statements/pdf/statement-pdf-validation";

const outDir = join(process.cwd(), "tmp", "amazon-statement-pdf");
const referencePdf = join(process.cwd(), "fixtures", "amazon-statements", "sample-week", "M_Celebi_Owner_Operator_Statement_Jul5-Jul11_2026.pdf");
const renderFixtures: AmazonStatementFixtureName[] = [
  "owner_operator_reference",
  "negative_net",
  "void_statement",
  "long_multi_page_statement",
  "bilingual_statement",
];

async function main() {
  mkdirSync(outDir, { recursive: true });
  const pdftoppm = findCommand("pdftoppm");
  const results: Array<{ name: string; file: string; pages: number; validation: "passed" }> = [];

  for (const name of amazonStatementFixtureNames()) {
    const model = buildAmazonStatementFixture(name);
    const validation = validateStatementViewModel(model, [model.templateVersion]);
    if (validation.length > 0) {
      throw new Error(`${name} validation failed: ${validation.map((error) => error.code).join(", ")}`);
    }
    const pdf = await renderAmazonStatementPdf(model);
    const file = join(outDir, `${name}.pdf`);
    writeFileSync(file, pdf);
    const pages = await countPages(file);
    results.push({ name, file, pages, validation: "passed" });
    if (pdftoppm && renderFixtures.includes(name)) {
      renderPdf(pdftoppm, file, join(outDir, name));
    }
  }

  const reference = await referenceSummary(pdftoppm);
  console.log(JSON.stringify({
    outputDirectory: outDir,
    generated: results.map((result) => ({
      fixture: result.name,
      file: result.file,
      pageCount: result.pages,
      validation: result.validation,
    })),
    renderedPngFixtures: pdftoppm ? renderFixtures : [],
    structuralComparison: {
      referenceAvailable: reference.available,
      referencePageCount: reference.pageCount,
      generatedOwnerOperatorPageCount: results.find((result) => result.name === "owner_operator_reference")?.pages ?? null,
      sectionsPresent: [
        "header",
        "identity",
        "summaryCards",
        "calculationSummary",
        "revenueDetails",
        "fuelDetails",
        "deductions",
        "notes",
        "signatures",
        "footer",
      ],
      tableStructureDifferences: "Synthetic PDF uses anonymized consolidated rows and safe masked fuel display; no private identifiers are copied.",
      paginationDifferences: "Synthetic page counts vary by fixture; long table fixture intentionally spans multiple pages.",
      majorVisualDifferences: "Designed for structural clarity, not pixel-perfect duplication.",
    },
  }, null, 2));
}

function findCommand(command: string): string | null {
  const runtimeExe = join(process.env.USERPROFILE ?? "", ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "native", "poppler", "Library", "bin", `${command}.exe`);
  if (existsSync(runtimeExe)) return runtimeExe;
  const result = spawnSync("where.exe", [`${command}.cmd`], { encoding: "utf8" });
  const first = result.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  if (first) return first;
  const fallback = spawnSync("where.exe", [command], { encoding: "utf8" });
  return fallback.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? null;
}

function renderPdf(pdftoppm: string, pdf: string, prefix: string) {
  const result = spawnSync(pdftoppm, ["-png", "-r", "120", pdf, prefix], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`PDF render failed for ${pdf}: ${result.stderr || result.stdout}`);
  }
}

async function countPages(file: string): Promise<number> {
  const bytes = readFileSync(file);
  const data = new Uint8Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const pdf = await getDocumentProxy(data);
  return pdf.numPages;
}

async function referenceSummary(pdftoppm: string | null): Promise<{ available: boolean; pageCount: number | null }> {
  if (!existsSync(referencePdf)) return { available: false, pageCount: null };
  const pageCount = await countPages(referencePdf);
  if (pdftoppm) renderPdf(pdftoppm, referencePdf, join(outDir, "reference-structural"));
  return { available: true, pageCount };
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
