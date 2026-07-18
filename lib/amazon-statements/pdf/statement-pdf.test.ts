import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { label, statementTitle } from "./statement-labels";
import {
  AMAZON_STATEMENT_TEMPLATE_V1,
  getAmazonStatementTemplate,
  knownAmazonStatementTemplateVersions,
} from "./statement-template-registry";
import { validateStatementViewModel } from "./statement-pdf-validation";
import { buildAmazonStatementFixture } from "./statement-fixtures";

const componentsSource = readFileSync("lib/amazon-statements/pdf/statement-pdf-components.tsx", "utf8");
const rendererSource = readFileSync("lib/amazon-statements/pdf/statement-pdf.tsx", "utf8");
const registrySource = readFileSync("lib/amazon-statements/pdf/statement-template-registry.ts", "utf8");

describe("amazon statement PDF template registry", () => {
  it("selects the known version and rejects unknown versions", () => {
    expect(knownAmazonStatementTemplateVersions()).toEqual([AMAZON_STATEMENT_TEMPLATE_V1]);
    expect(getAmazonStatementTemplate(AMAZON_STATEMENT_TEMPLATE_V1).version).toBe(AMAZON_STATEMENT_TEMPLATE_V1);
    expect(() => getAmazonStatementTemplate("missing")).toThrow(/Unknown Amazon statement PDF template version/);
  });

  it("does not select templates from current date or executable content", () => {
    expect(registrySource).not.toMatch(/new Date\(/);
    expect(registrySource).not.toMatch(/eval|Function\(/);
    expect(registrySource).not.toMatch(/sql|html/i);
  });
});

describe("amazon statement PDF view model behavior", () => {
  it("uses statement-type-specific titles", () => {
    expect(statementTitle("company_driver", "en")).toBe("Driver Statement");
    expect(statementTitle("box_truck_driver", "en")).toBe("Box Truck Driver Statement");
    expect(statementTitle("owner_operator", "en")).toBe("Owner Operator Statement");
    expect(statementTitle("managed_investor", "en")).toBe("Owner / Investor Statement");
  });

  it("uses deterministic bilingual labels without runtime translation", () => {
    expect(label("grossRevenue", "en")).toBe("Gross Revenue");
    expect(label("grossRevenue", "tr")).toBe("Brut Gelir");
    expect(label("grossRevenue", "en_tr")).toBe("Gross Revenue / Brut Gelir");
  });

  it("preserves one consolidated revenue row per canonical item", () => {
    const model = buildAmazonStatementFixture("owner_operator_reference");
    expect(model.revenueLines).toHaveLength(1);
    expect(model.revenueLines[0].sourceRevenueItemId).toBe("revenue-1");
    expect(validateStatementViewModel(model, knownAmazonStatementTemplateVersions())).toEqual([]);
  });

  it("displays unresolved routes and missing weight as neutral values in components", () => {
    const long = buildAmazonStatementFixture("long_multi_page_statement");
    expect(long.revenueLines.some((line) => line.routeStatus === "pending_review" && line.routeDisplay === null)).toBe(true);
    expect(long.revenueLines.every((line) => line.weight === null)).toBe(true);
    expect(componentsSource).toContain("Pending Review");
    expect(componentsSource).toContain("formatNumber(line.distance");
  });

  it("keeps DEF and ULSD as separate fuel display lines and does not duplicate discount as a deduction", () => {
    const model = buildAmazonStatementFixture("managed_investor");
    const products = model.fuelLines.map((line) => line.product);
    expect(products).toContain("ULSD");
    const long = buildAmazonStatementFixture("long_multi_page_statement");
    expect(new Set(long.fuelLines.map((line) => line.product))).toEqual(new Set(["ULSD", "DEF"]));
    expect(long.deductionLines.filter((line) => /discount/i.test(line.label))).toHaveLength(0);
  });

  it("preserves negative fuel credit sign", () => {
    const model = buildAmazonStatementFixture("owner_operator_reference");
    model.fuelLines = [{ ...model.fuelLines[0], amount: -25, sourceTransactionLineId: "credit-line", id: "credit-line" }];
    model.deductionLines = model.deductionLines.map((line) => line.type === "fuel" ? { ...line, amount: -25 } : line);
    model.summary.fuelDeductions = -25;
    model.summary.totalDeductions = 1990.02;
    model.summary.netAmount = 7301.82;
    expect(validateStatementViewModel(model, knownAmazonStatementTemplateVersions())).toEqual([]);
  });

  it("validates owner-operator exact totals", () => {
    const model = buildAmazonStatementFixture("owner_operator_reference");
    expect(model.summary).toMatchObject({
      grossRevenue: 9291.84,
      fuelDeductions: 2028.22,
      totalDeductions: 4043.24,
      netAmount: 5248.6,
    });
    expect(model.deductionLines.find((line) => line.id === "company-fee")?.amount).toBe(1115.02);
    expect(validateStatementViewModel(model, knownAmazonStatementTemplateVersions())).toEqual([]);
  });

  it("supports negative net and status watermarks", () => {
    expect(buildAmazonStatementFixture("negative_net").summary.netAmount).toBeLessThan(0);
    expect(componentsSource).toContain("DRAFT");
    expect(componentsSource).toContain("NEEDS REVIEW");
    expect(componentsSource).toContain("VOID");
    const converted = { ...buildAmazonStatementFixture("owner_operator_reference"), candidateStatus: "converted" as const };
    expect(validateStatementViewModel(converted, knownAmazonStatementTemplateVersions())).toEqual([]);
  });

  it("validates team allocation reconciliation", () => {
    const model = buildAmazonStatementFixture("team_driver_allocation");
    expect(model.teamAllocations.reduce((sum, line) => sum + line.amount, 0)).toBe(model.summary.grossRevenue);
    expect(validateStatementViewModel(model, knownAmazonStatementTemplateVersions())).toEqual([]);
  });

  it("rejects duplicate sources and calculation mismatches", () => {
    const duplicateRevenue = buildAmazonStatementFixture("owner_operator_reference");
    duplicateRevenue.revenueLines = [duplicateRevenue.revenueLines[0], { ...duplicateRevenue.revenueLines[0], id: "copy" }];
    expect(validateStatementViewModel(duplicateRevenue, knownAmazonStatementTemplateVersions()).map((error) => error.code)).toEqual(expect.arrayContaining(["duplicate_revenue_source", "gross_mismatch"]));

    const duplicateFuel = buildAmazonStatementFixture("owner_operator_reference");
    duplicateFuel.fuelLines = [duplicateFuel.fuelLines[0], { ...duplicateFuel.fuelLines[0], id: "copy" }];
    expect(validateStatementViewModel(duplicateFuel, knownAmazonStatementTemplateVersions()).map((error) => error.code)).toEqual(expect.arrayContaining(["duplicate_fuel_source", "fuel_mismatch"]));

    const missingFuelSources = buildAmazonStatementFixture("owner_operator_reference");
    missingFuelSources.fuelLines = [];
    expect(validateStatementViewModel(missingFuelSources, knownAmazonStatementTemplateVersions()).map((error) => error.code)).toContain("fuel_mismatch");

    const badNet = buildAmazonStatementFixture("owner_operator_reference");
    badNet.summary.netAmount = 1;
    expect(validateStatementViewModel(badNet, knownAmazonStatementTemplateVersions()).map((error) => error.code)).toContain("net_mismatch");
  });

  it("keeps ordering and metadata stable", () => {
    const first = buildAmazonStatementFixture("long_multi_page_statement");
    const second = buildAmazonStatementFixture("long_multi_page_statement");
    expect(first.revenueLines.map((line) => line.id)).toEqual(second.revenueLines.map((line) => line.id));
    expect(first.fuelLines.map((line) => line.id)).toEqual(second.fuelLines.map((line) => line.id));
    expect(first.generatedAt).toBe("2026-07-17T12:00:00Z");
    expect(first.footer.templateVersion).toBe(AMAZON_STATEMENT_TEMPLATE_V1);
  });

  it("uses React PDF pagination primitives for long tables", () => {
    expect(componentsSource).toContain("fixed");
    expect(componentsSource).toContain("wrap={false}");
    expect(rendererSource).toContain('size="LETTER"');
  });

  it("keeps PDF server modules free of client-component markers", () => {
    for (const source of [componentsSource, rendererSource, registrySource]) {
      expect(source).not.toContain('"use client"');
      expect(source).not.toContain("'use client'");
      expect(source).not.toMatch(/window\.|document\./);
    }
  });
});
