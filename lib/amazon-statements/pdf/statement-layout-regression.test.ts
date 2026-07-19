import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const components = readFileSync("lib/amazon-statements/pdf/statement-pdf-components.tsx", "utf8");
const renderer = readFileSync("lib/amazon-statements/pdf/statement-pdf.tsx", "utf8");
const route = readFileSync("app/api/settlements/amazon-imports/candidates/[candidateId]/statement/route.ts", "utf8");

describe("reference-style Amazon statement PDF", () => {
  it("uses a three-section document with repeated header and footer", () => {
    expect(renderer.match(/<Page size="LETTER"/g)).toHaveLength(3);
    expect(renderer.match(/<StatementHeader model=\{model\}/g)).toHaveLength(3);
    expect(renderer.match(/<StatementFooter model=\{model\}/g)).toHaveLength(3);
  });

  it("uses navy bands, colored KPI cards, detailed tables, and signature panels", () => {
    expect(components).toContain('navy: "#173f5f"');
    expect(components).toContain("paleGreen");
    expect(components).toContain("paleGold");
    expect(components).toContain('label("revenueDetails"');
    expect(components).toContain("Expense Details");
    expect(components).toContain("Final Settlement Summary");
    expect(components).toContain("COMPANY SIGNATURE");
    expect(components).toContain("OWNER OPERATOR APPROVAL");
  });

  it("uses legal carrier identity and reviewed route fallbacks", () => {
    expect(route).toContain("resolveStatementCompanyIdentity");
    expect(route).toContain("resolveStatementRoute");
    expect(route).not.toContain('companyName: stringOrNull((organizationResult.data');
  });
});
