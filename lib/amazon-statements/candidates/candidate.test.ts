import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { computeSettlement } from "@/lib/settlement/engine";
import { compileAmazonStatementCandidate } from "./candidate-compiler";
import { prepareSettlementConversionPayload } from "./candidate-to-settlement";
import type {
  CandidateCalculationConfig,
  CandidateFuelSelection,
  CandidateRevenueSelection,
} from "./candidate-types";

const migration = readFileSync("supabase/migrations/20260716060000_amazon_statement_candidates.sql", "utf8");
const schema = readFileSync("supabase/schema.sql", "utf8");
const schemaCandidateBlock = schema.slice(schema.indexOf("-- Amazon statement candidates."));
const candidateCompilerSource = readFileSync("lib/amazon-statements/candidates/candidate-compiler.ts", "utf8");
const candidateConfigSource = readFileSync("lib/amazon-statements/candidates/candidate-config.ts", "utf8");
const candidateAdapterSource = readFileSync("lib/amazon-statements/candidates/candidate-to-settlement.ts", "utf8");

function baseConfig(patch: Partial<CandidateCalculationConfig> = {}): CandidateCalculationConfig {
  return {
    statementType: "owner_operator",
    periodStart: "2026-07-05",
    periodEnd: "2026-07-11",
    organizationId: "org-1",
    batchId: "batch-1",
    payeeType: "owner",
    payeeId: "owner-1",
    vehicleId: "vehicle-1",
    calculationRuleVersion: "rules-1",
    templateVersion: "template-1",
    settlementSettingsRevision: "settings-1",
    companyFeeBasisPoints: 1200,
    driverPayBasisPoints: null,
    fixedAdjustments: [
      fixedAdjustment("insurance", 800, 10),
      fixedAdjustment("eld_safety", 100, 20),
    ],
    ...patch,
  };
}

function revenueSelection(amount = 9291.84, patch: Partial<CandidateRevenueSelection> = {}): CandidateRevenueSelection {
  return {
    revenueItemId: "revenue-1",
    organizationId: "org-1",
    sourceRevision: "revenue-revision-1",
    sourceFingerprint: "a".repeat(64),
    sourceDate: "2026-07-06",
    allocatedGrossAmount: amount,
    projectionStatus: "projected",
    projectedLoad: {
      id: "load-1",
      organizationId: "org-1",
      status: "delivered",
      vehicleId: "vehicle-1",
      deliveryDate: "2026-07-06",
      grossAmount: amount,
    },
    sourceSnapshot: { grossAmount: amount },
    displayOrder: 1,
    ...patch,
  };
}

function fuelSelection(amount = 2028.22, patch: Partial<CandidateFuelSelection> = {}): CandidateFuelSelection {
  return {
    transactionLineId: "fuel-line-1",
    organizationId: "org-1",
    sourceRevision: "fuel-revision-1",
    sourceFingerprint: "b".repeat(64),
    transactionDate: "2026-07-07",
    groupIsPlaceholder: false,
    productType: "ULSD",
    allocatedAmount: amount,
    projectionStatus: "projected",
    deductionLane: "owner",
    projectedExpense: {
      id: "expense-1",
      organizationId: "org-1",
      date: "2026-07-07",
      vehicleId: "vehicle-1",
      category: "fuel",
      amount,
      deductFromSettlement: false,
      deductFromOwner: false,
    },
    sourceSnapshot: { chargedAmount: amount },
    displayOrder: 30,
    ...patch,
  };
}

function fixedAdjustment(type: "insurance" | "eld_safety" | "parking" | "load_save" | "maintenance" | "miscellaneous" | "carryover", amount: number | null, displayOrder: number) {
  return {
    adjustmentType: type,
    label: type.replace(/_/g, " "),
    calculationBasis: "fixed_amount" as const,
    fixedAmount: amount,
    deductionLane: "owner" as const,
    displayOrder,
    configurationSource: "synthetic-policy",
  };
}

describe("amazon statement candidate compiler", () => {
  it("calculates the synthetic owner-operator reference statement with the existing settlement engine", () => {
    const result = compileAmazonStatementCandidate({
      config: baseConfig(),
      revenueSelections: [revenueSelection()],
      fuelSelections: [fuelSelection()],
    });
    expect(result.grossAmount).toBe(9291.84);
    expect(result.percentageDeductionsAmount).toBe(1115.02);
    expect(result.fixedDeductionsAmount).toBe(900);
    expect(result.fuelDeductionsAmount).toBe(2028.22);
    expect(result.totalDeductionsAmount).toBe(4043.24);
    expect(result.netAmount).toBe(5248.6);
    expect(result.settlementResult.settlementType).toBe("owner_operator");
    expect(result.readiness.status).toBe("ready");
  });

  it("matches the direct computeSettlement result exactly", () => {
    const result = compileAmazonStatementCandidate({
      config: baseConfig(),
      revenueSelections: [revenueSelection()],
      fuelSelections: [fuelSelection()],
    });
    const direct = computeSettlement({
      config: result.settlementConfig,
      loads: result.settlementInput.loads,
      expenses: result.settlementInput.expenses,
    });
    expect(result.settlementResult).toEqual(direct);
    expect(result.netAmount).toBe(direct.netPay);
    expect(result.totalDeductionsAmount).toBe(direct.totalDeductions);
  });

  it("calculates company fee only once from the engine line item", () => {
    const result = compileAmazonStatementCandidate({
      config: baseConfig({ fixedAdjustments: [] }),
      revenueSelections: [revenueSelection(1000)],
    });
    expect(result.settlementResult.lineItems.filter((item) => item.key === "company_fee")).toHaveLength(1);
    expect(result.adjustmentLines.filter((line) => line.adjustmentType === "company_percentage")).toHaveLength(1);
    expect(result.percentageDeductionsAmount).toBe(120);
    expect(result.totalDeductionsAmount).toBe(120);
  });

  it("deducts selected fuel only once through engine expenses", () => {
    const result = compileAmazonStatementCandidate({
      config: baseConfig({ companyFeeBasisPoints: 0, fixedAdjustments: [] }),
      revenueSelections: [revenueSelection(1000)],
      fuelSelections: [fuelSelection(100)],
    });
    expect(result.settlementInput.expenses).toHaveLength(1);
    expect(result.settlementResult.lineItems.filter((item) => item.key === "expense_fuel")).toHaveLength(1);
    expect(result.fuelDeductionsAmount).toBe(100);
    expect(result.totalDeductionsAmount).toBe(100);
    expect(result.netAmount).toBe(900);
  });

  it("supports company-driver percentage pay without inventing deductions", () => {
    const result = compileAmazonStatementCandidate({
      config: baseConfig({ statementType: "company_driver", payeeType: "driver", payeeId: "driver-1", driverPayBasisPoints: 6000, companyFeeBasisPoints: null, fixedAdjustments: [] }),
      revenueSelections: [revenueSelection(1000)],
    });
    expect(result.settlementResult.netPay).toBe(600);
    expect(result.totalDeductionsAmount).toBe(0);
  });

  it("supports box-truck driver parking and load-save deductions only when explicitly added", () => {
    const result = compileAmazonStatementCandidate({
      config: baseConfig({
        statementType: "box_truck_driver",
        payeeType: "driver",
        payeeId: "driver-1",
        driverPayBasisPoints: 5000,
        companyFeeBasisPoints: null,
        fixedAdjustments: [
          { ...fixedAdjustment("parking", 100, 10), deductionLane: "driver" },
          { ...fixedAdjustment("load_save", 50, 20), deductionLane: "driver" },
        ],
      }),
      revenueSelections: [revenueSelection(1000)],
    });
    expect(result.settlementResult.calculationBaseAmount).toBe(500);
    expect(result.totalDeductionsAmount).toBe(150);
    expect(result.netAmount).toBe(350);
  });

  it("supports managed-investor driver cost and explicit operating deductions", () => {
    const result = compileAmazonStatementCandidate({
      config: baseConfig({ statementType: "managed_investor", payeeType: "investor", payeeId: "investor-1", driverPayBasisPoints: 3000, companyFeeBasisPoints: null, fixedAdjustments: [] }),
      revenueSelections: [revenueSelection(5000)],
      fuelSelections: [fuelSelection(500, { deductionLane: "investor", projectedExpense: { ...fuelSelection(500).projectedExpense, amount: 500 } })],
    });
    expect(result.percentageDeductionsAmount).toBe(1500);
    expect(result.fuelDeductionsAmount).toBe(500);
    expect(result.netAmount).toBe(3000);
  });

  it("requires exact gross reconciliation between selected revenue and projected load", () => {
    const result = compileAmazonStatementCandidate({
      config: baseConfig(),
      revenueSelections: [revenueSelection(100, { projectedLoad: { ...revenueSelection(100).projectedLoad, grossAmount: 99 } })],
    });
    expect(result.readiness.issues).toContainEqual(expect.objectContaining({ issueCode: "financial_mismatch" }));
  });

  it("selects each fuel line exactly once and keeps fuel amount as charged amount authority", () => {
    const result = compileAmazonStatementCandidate({
      config: baseConfig({ fixedAdjustments: [] }),
      revenueSelections: [revenueSelection(1000)],
      fuelSelections: [fuelSelection(25), fuelSelection(35, { transactionLineId: "fuel-line-2", projectedExpense: { ...fuelSelection(35).projectedExpense, id: "expense-2", amount: 35 } })],
    });
    expect(result.fuelDeductionsAmount).toBe(60);
    expect(result.settlementInput.expenses.map((expense) => expense.amount)).toEqual([25, 35]);
  });

  it("uses existing cent rounding for percentage calculations", () => {
    const result = compileAmazonStatementCandidate({
      config: baseConfig({ companyFeeBasisPoints: 3333, fixedAdjustments: [] }),
      revenueSelections: [revenueSelection(100)],
    });
    expect(result.percentageDeductionsAmount).toBe(33.33);
  });

  it("treats explicit zero configuration as present and null configuration as blocking", () => {
    const zero = compileAmazonStatementCandidate({
      config: baseConfig({ statementType: "company_driver", payeeType: "driver", payeeId: "driver-1", driverPayBasisPoints: 0, companyFeeBasisPoints: null, fixedAdjustments: [] }),
      revenueSelections: [revenueSelection(1000)],
    });
    expect(zero.netAmount).toBe(0);
    expect(zero.readiness.status).toBe("ready");

    const missing = compileAmazonStatementCandidate({
      config: baseConfig({ statementType: "company_driver", payeeType: "driver", payeeId: "driver-1", driverPayBasisPoints: null, companyFeeBasisPoints: null, fixedAdjustments: [] }),
      revenueSelections: [revenueSelection(1000)],
    });
    expect(missing.readiness.issues).toContainEqual(expect.objectContaining({ issueCode: "missing_configuration" }));
  });

  it("uses the intended no-commission fallback when management commission is missing", () => {
    const result = compileAmazonStatementCandidate({
      config: baseConfig({ managementCommission: undefined, fixedAdjustments: [] }),
      revenueSelections: [revenueSelection(1000)],
    });
    expect(result.settlementConfig.managementCommission).toEqual({ type: "none", amount: 0 });
    expect(result.settlementResult.lineItems.some((item) => item.key === "our_commission")).toBe(false);
  });

  it("ignores browser-provided calculated amounts and blocks ad hoc percentage formulas", () => {
    const result = compileAmazonStatementCandidate({
      config: baseConfig({
        companyFeeBasisPoints: 0,
        fixedAdjustments: [
          { ...fixedAdjustment("insurance", 10, 10), calculatedAmount: 999 },
          {
            adjustmentType: "miscellaneous",
            label: "unsupported percent",
            calculationBasis: "gross_percentage",
            rateBasisPoints: 500,
            deductionLane: "owner",
            displayOrder: 20,
            configurationSource: "browser",
          },
        ],
      }),
      revenueSelections: [revenueSelection(100)],
    });
    expect(result.totalDeductionsAmount).toBe(10);
    expect(result.netAmount).toBe(90);
    expect(result.readiness.issues).toContainEqual(expect.objectContaining({ issueCode: "missing_configuration" }));
  });

  it("keeps carryover sign aligned with existing expense conventions", () => {
    const deduction = compileAmazonStatementCandidate({
      config: baseConfig({ companyFeeBasisPoints: 0, fixedAdjustments: [fixedAdjustment("carryover", 25, 10)] }),
      revenueSelections: [revenueSelection(100)],
    });
    const credit = compileAmazonStatementCandidate({
      config: baseConfig({ companyFeeBasisPoints: 0, fixedAdjustments: [fixedAdjustment("carryover", -25, 10)] }),
      revenueSelections: [revenueSelection(100)],
    });
    expect(deduction.totalDeductionsAmount).toBe(25);
    expect(deduction.netAmount).toBe(75);
    expect(credit.totalDeductionsAmount).toBe(-25);
    expect(credit.netAmount).toBe(125);
  });

  it("keeps negative fuel credits negative instead of converting them into positive deductions", () => {
    const result = compileAmazonStatementCandidate({
      config: baseConfig({ companyFeeBasisPoints: 0, fixedAdjustments: [] }),
      revenueSelections: [revenueSelection(100)],
      fuelSelections: [fuelSelection(-10, { projectedExpense: { ...fuelSelection(-10).projectedExpense, amount: -10 } })],
    });
    expect(result.fuelDeductionsAmount).toBe(-10);
    expect(result.totalDeductionsAmount).toBe(-10);
    expect(result.netAmount).toBe(110);
  });

  it("allows negative net using existing engine conventions", () => {
    const result = compileAmazonStatementCandidate({
      config: baseConfig({ companyFeeBasisPoints: 0, fixedAdjustments: [fixedAdjustment("maintenance", 200, 10)] }),
      revenueSelections: [revenueSelection(100)],
    });
    expect(result.netAmount).toBe(-100);
  });

  it("requires explicit matching team split and assigns rounding residual deterministically", () => {
    const result = compileAmazonStatementCandidate({
      config: baseConfig({
        teamRequired: true,
        teamExternalPersonIds: ["person-a", "person-b", "person-c"],
        teamSplitRule: {
          ruleId: "team-1",
          externalDriverPersonIds: ["person-c", "person-a", "person-b"],
          members: [
            { personId: "person-b", basisPoints: 3333 },
            { personId: "person-c", basisPoints: 3334 },
            { personId: "person-a", basisPoints: 3333 },
          ],
        },
      }),
      revenueSelections: [revenueSelection(10)],
    });
    expect(result.teamAllocations).toEqual([
      { personId: "person-a", basisPoints: 3333, amount: 3.34 },
      { personId: "person-b", basisPoints: 3333, amount: 3.33 },
      { personId: "person-c", basisPoints: 3334, amount: 3.33 },
    ]);
    expect(result.readiness.status).toBe("ready");
  });

  it("blocks team candidates without a valid approved split rule", () => {
    const result = compileAmazonStatementCandidate({
      config: baseConfig({ teamRequired: true, teamExternalPersonIds: ["person-a", "person-b"], teamSplitRule: null }),
      revenueSelections: [revenueSelection()],
    });
    expect(result.readiness.issues).toContainEqual(expect.objectContaining({ issueCode: "missing_team_split" }));
  });

  it("detects stale preview inputs and changed settlement settings", () => {
    const result = compileAmazonStatementCandidate({
      config: baseConfig({ settlementSettingsRevision: "settings-old" }),
      existingSettlementSettingsRevision: "settings-new",
      revenueSelections: [revenueSelection()],
    });
    expect(result.readiness.status).toBe("stale");
    expect(result.readiness.issues).toContainEqual(expect.objectContaining({ issueCode: "changed_settlement_settings" }));
  });

  it("detects changed source revisions", () => {
    const result = compileAmazonStatementCandidate({
      config: baseConfig(),
      revenueSelections: [revenueSelection(100, { expectedSourceRevision: "old" })],
      fuelSelections: [fuelSelection(10, { expectedSourceRevision: "old" })],
    });
    expect(result.readiness.issues.filter((issue) => issue.issueCode === "source_revision_changed")).toHaveLength(2);
  });

  it("detects duplicate revenue and fuel source selections", () => {
    const duplicateRevenue = revenueSelection(100, { projectedLoad: { ...revenueSelection(100).projectedLoad, id: "load-2" }, displayOrder: 2 });
    const duplicateFuel = fuelSelection(10, { projectedExpense: { ...fuelSelection(10).projectedExpense, id: "expense-2" }, displayOrder: 31 });
    const result = compileAmazonStatementCandidate({
      config: baseConfig(),
      revenueSelections: [revenueSelection(100), duplicateRevenue],
      fuelSelections: [fuelSelection(10), duplicateFuel],
    });
    expect(result.readiness.issues).toContainEqual(expect.objectContaining({ issueCode: "duplicate_revenue_source" }));
    expect(result.readiness.issues).toContainEqual(expect.objectContaining({ issueCode: "duplicate_fuel_source" }));
  });

  it("blocks unresolved payee/reference and incorrect accounting lane", () => {
    const result = compileAmazonStatementCandidate({
      config: baseConfig({ payeeId: null, payeeType: "driver" }),
      revenueSelections: [revenueSelection()],
    });
    expect(result.readiness.issues).toContainEqual(expect.objectContaining({ issueCode: "missing_payee" }));
    expect(result.readiness.issues).toContainEqual(expect.objectContaining({ issueCode: "invalid_accounting_lane" }));
  });

  it("blocks unresolved fuel assignments and placeholder fuel groups", () => {
    const result = compileAmazonStatementCandidate({
      config: baseConfig(),
      revenueSelections: [revenueSelection()],
      fuelSelections: [
        fuelSelection(10, { deductionLane: "none" }),
        fuelSelection(20, { transactionLineId: "fuel-line-2", groupIsPlaceholder: true, projectedExpense: { ...fuelSelection(20).projectedExpense, id: "expense-2", amount: 20 } }),
      ],
    });
    expect(result.readiness.issues).toContainEqual(expect.objectContaining({ issueCode: "unresolved_fuel_assignment" }));
    expect(result.readiness.issues).toContainEqual(expect.objectContaining({ issueCode: "placeholder_fuel_selected" }));
  });

  it("keeps preview revision deterministic and source-order independent", () => {
    const a = revenueSelection(100, { revenueItemId: "revenue-a", projectedLoad: { ...revenueSelection(100).projectedLoad, id: "load-a" }, displayOrder: 1 });
    const b = revenueSelection(200, { revenueItemId: "revenue-b", projectedLoad: { ...revenueSelection(200).projectedLoad, id: "load-b" }, displayOrder: 2 });
    const first = compileAmazonStatementCandidate({ config: baseConfig({ fixedAdjustments: [] }), revenueSelections: [a, b] });
    const second = compileAmazonStatementCandidate({ config: baseConfig({ fixedAdjustments: [] }), revenueSelections: [b, a] });
    expect(first.previewRevision).toBe(second.previewRevision);
    expect(first.calculationSnapshot).toEqual(second.calculationSnapshot);
  });

  it("changes preview revision when team split or source revision changes", () => {
    const teamA = compileAmazonStatementCandidate({
      config: baseConfig({
        teamRequired: true,
        teamExternalPersonIds: ["person-a", "person-b"],
        teamSplitRule: {
          ruleId: "team-1",
          externalDriverPersonIds: ["person-a", "person-b"],
          members: [{ personId: "person-a", basisPoints: 5000 }, { personId: "person-b", basisPoints: 5000 }],
        },
      }),
      revenueSelections: [revenueSelection(100)],
    });
    const teamB = compileAmazonStatementCandidate({
      config: baseConfig({
        teamRequired: true,
        teamExternalPersonIds: ["person-a", "person-b"],
        teamSplitRule: {
          ruleId: "team-1",
          externalDriverPersonIds: ["person-a", "person-b"],
          members: [{ personId: "person-a", basisPoints: 6000 }, { personId: "person-b", basisPoints: 4000 }],
        },
      }),
      revenueSelections: [revenueSelection(100)],
    });
    const sourceChanged = compileAmazonStatementCandidate({
      config: baseConfig(),
      revenueSelections: [revenueSelection(100, { sourceRevision: "revenue-revision-2" })],
    });
    expect(teamA.previewRevision).not.toBe(teamB.previewRevision);
    expect(sourceChanged.previewRevision).not.toBe(compileAmazonStatementCandidate({ config: baseConfig(), revenueSelections: [revenueSelection(100)] }).previewRevision);
  });

  it("preserves manual out-of-period override reasons in source snapshots", () => {
    const result = compileAmazonStatementCandidate({
      config: baseConfig(),
      revenueSelections: [revenueSelection(100, { sourceDate: "2026-07-20", periodOverrideApproved: true, periodOverrideReason: "approved_manual_review" })],
      fuelSelections: [fuelSelection(10, { transactionDate: "2026-07-20", periodOverrideApproved: true, periodOverrideReason: "approved_manual_review" })],
    });
    expect(result.readiness.issues.map((issue) => issue.issueCode)).not.toContain("source_outside_period");
    expect(result.sourceSnapshot.revenue[0]).toMatchObject({ periodOverrideApproved: true, periodOverrideReason: "approved_manual_review" });
    expect(result.sourceSnapshot.fuel[0]).toMatchObject({ periodOverrideApproved: true, periodOverrideReason: "approved_manual_review" });
  });

  it("blocks out-of-period overrides that lack an audit reason", () => {
    const result = compileAmazonStatementCandidate({
      config: baseConfig(),
      revenueSelections: [revenueSelection(100, { sourceDate: "2026-07-20", periodOverrideApproved: true })],
    });
    expect(result.readiness.issues).toContainEqual(expect.objectContaining({ issueCode: "source_outside_period" }));
  });

  it("keeps candidate modules free of independent final-net and percentage formula paths", () => {
    expect(candidateCompilerSource).not.toContain("function percentageDeductions(");
    expect(candidateCompilerSource).not.toMatch(/gross\s*\*\s*\(config\./);
    expect(candidateConfigSource).not.toMatch(/gross\s*\*\s*\(rate/);
    expect(candidateCompilerSource).not.toMatch(/gross\s*-\s*.+deductions/i);
  });
});

describe("amazon candidate settlement conversion adapter", () => {
  it("rejects pending projected loads, non-deductible expenses, already-linked sources and converted candidates", () => {
    const calculation = compileAmazonStatementCandidate({
      config: baseConfig(),
      revenueSelections: [revenueSelection(100, { projectedLoad: { ...revenueSelection(100).projectedLoad, status: "pending", alreadyLinked: true } })],
      fuelSelections: [fuelSelection(10, { projectedExpense: { ...fuelSelection(10).projectedExpense, alreadyLinked: true } })],
    });
    const result = prepareSettlementConversionPayload({
      candidate: { id: "candidate-1", organizationId: "org-1", status: "converted", previewRevision: calculation.previewRevision, convertedSettlementId: "settlement-1" },
      calculation,
      revenueSelections: [revenueSelection(100, { projectedLoad: { ...revenueSelection(100).projectedLoad, status: "pending", alreadyLinked: true } })],
      fuelSelections: [fuelSelection(10, { projectedExpense: { ...fuelSelection(10).projectedExpense, alreadyLinked: true } })],
      expectedPreviewRevision: calculation.previewRevision,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.issueCode)).toEqual(expect.arrayContaining([
        "converted_candidate",
        "not_ready",
        "pending_projected_load",
        "non_deductible_projected_expense",
        "source_already_linked",
      ]));
    }
  });

  it("rejects stale preview conversion", () => {
    const calculation = compileAmazonStatementCandidate({ config: baseConfig({ fixedAdjustments: [] }), revenueSelections: [revenueSelection(100)] });
    const result = prepareSettlementConversionPayload({
      candidate: { id: "candidate-1", organizationId: "org-1", status: "ready", previewRevision: calculation.previewRevision },
      calculation,
      revenueSelections: [revenueSelection(100)],
      fuelSelections: [],
      expectedPreviewRevision: "stale",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues).toContainEqual(expect.objectContaining({ issueCode: "stale_preview" }));
  });

  it("prepares a safe existing-workflow payload and ignores browser totals", () => {
    const revenue = revenueSelection(100);
    const fuel = fuelSelection(10, { projectedExpense: { ...fuelSelection(10).projectedExpense, deductFromSettlement: true, deductFromOwner: true } });
    const calculation = compileAmazonStatementCandidate({ config: baseConfig({ fixedAdjustments: [] }), revenueSelections: [revenue], fuelSelections: [fuel] });
    const result = prepareSettlementConversionPayload({
      candidate: { id: "candidate-1", organizationId: "org-1", status: "ready", previewRevision: calculation.previewRevision },
      calculation,
      revenueSelections: [revenue],
      fuelSelections: [fuel],
      expectedPreviewRevision: calculation.previewRevision,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.selectedLoadIds).toEqual(["load-1"]);
      expect(result.payload.selectedExpenseIds).toEqual(["expense-1"]);
      expect(result.payload.grossRevenue).toBe(100);
      expect(result.payload.config).toMatchObject({ amazon_statement_candidate_id: "candidate-1" });
    }
  });

  it("does not invoke database insertion, RPCs, or settlement creation itself", () => {
    expect(candidateAdapterSource).not.toMatch(/\.from\s*\(/);
    expect(candidateAdapterSource).not.toMatch(/\.insert\s*\(/);
    expect(candidateAdapterSource).not.toMatch(/\.rpc\s*\(/);
    expect(candidateAdapterSource).not.toContain("create_settlement_with_links_atomic");
  });
});

describe("amazon statement candidate SQL source contracts", () => {
  it("creates exactly the four approved candidate tables", () => {
    for (const source of [migration, schemaCandidateBlock]) {
      expect(source).toContain("create table if not exists public.amazon_statement_candidates");
      expect(source).toContain("create table if not exists public.amazon_statement_candidate_revenue");
      expect(source).toContain("create table if not exists public.amazon_statement_candidate_fuel_lines");
      expect(source).toContain("create table if not exists public.amazon_statement_candidate_adjustments");
      expect(source).not.toContain("create table if not exists public.amazon_settlements");
    }
  });

  it("uses same-organization foreign keys and active uniqueness constraints", () => {
    for (const source of [migration, schemaCandidateBlock]) {
      expect(source).toContain("foreign key (organization_id, candidate_id)");
      expect(source).toContain("references public.amazon_statement_candidates (organization_id, id)");
      expect(source).toContain("references public.amazon_revenue_items (organization_id, id)");
      expect(source).toContain("references public.fuel_import_transaction_lines (organization_id, id)");
      expect(source).toContain("amazon_statement_candidate_revenue_source_key");
      expect(source).toContain("amazon_statement_candidate_fuel_lines_source_key");
      expect(source).toContain("amazon_statement_candidates_converted_settlement_key");
    }
  });

  it("enables RLS with same-org select and writer-only editable policies", () => {
    for (const source of [migration, schemaCandidateBlock]) {
      expect(source).toContain("alter table public.%I enable row level security");
      expect(source).toContain("for select to authenticated using (organization_id = (select public.current_org_id()))");
      expect(source).toContain("select public.is_org_writer()");
      expect(source).toContain("status <> 'converted'");
      expect(source).not.toContain("for all");
    }
  });

  it("guards immutability and avoids direct settlement or executable formula behavior", () => {
    for (const source of [migration, schemaCandidateBlock]) {
      expect(source).toContain("Converted Amazon statement candidates are immutable");
      expect(source).toContain("Amazon statement candidate revenue identity cannot be changed");
      expect(source).toContain("Amazon statement candidate fuel identity cannot be changed");
      expect(source).not.toContain("insert into public.settlements");
      expect(source).not.toContain("insert into settlement_load_links");
      expect(source).not.toContain("insert into settlement_expense_links");
      expect(source).not.toMatch(/\bformula\b/i);
      expect(source).not.toMatch(/\bjavascript\b/i);
    }
  });

  it("uses fixed search paths and does not expose guard functions to public execution", () => {
    for (const source of [migration, schemaCandidateBlock]) {
      expect(source).toContain("set search_path = public");
      expect(source).toContain("revoke execute on function public.guard_amazon_statement_candidate() from public, anon");
      expect(source).toContain("revoke execute on function public.guard_amazon_statement_candidate_revenue_identity() from public, anon");
      expect(source).toContain("revoke execute on function public.guard_amazon_statement_candidate_fuel_identity() from public, anon");
    }
  });
});
