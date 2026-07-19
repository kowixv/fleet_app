import { describe, expect, it } from "vitest";
import { buildCandidateSettlementConfig } from "./candidate-config";
import type { CandidateCalculationConfig } from "./candidate-types";

function managedInvestorConfig(overrides: Partial<CandidateCalculationConfig> = {}): CandidateCalculationConfig {
  return {
    statementType: "managed_investor",
    periodStart: "2026-07-05",
    periodEnd: "2026-07-11",
    organizationId: "organization-1",
    batchId: "batch-1",
    payeeType: "investor",
    payeeId: "investor-1",
    vehicleId: "vehicle-829",
    calculationRuleVersion: "amazon-candidate-rules-v1",
    templateVersion: "amazon-statement-v1",
    driverPayBasisPoints: 3300,
    companyFeeBasisPoints: 250,
    externalCarrierFeeBasisPoints: 0,
    ...overrides,
  };
}

describe("managed-investor percentage fee mapping", () => {
  it("uses the candidate editor company fee as the managed-investor external carrier fee", () => {
    const result = buildCandidateSettlementConfig(managedInvestorConfig());

    expect(result.issues).toEqual([]);
    expect(result.settlementConfig.driverPayPct).toBe(0.33);
    expect(result.settlementConfig.externalCarrierFeePct).toBe(0.025);
  });

  it("keeps the explicit external carrier fee fallback when no company fee was entered", () => {
    const result = buildCandidateSettlementConfig(managedInvestorConfig({
      companyFeeBasisPoints: null,
      externalCarrierFeeBasisPoints: 400,
    }));

    expect(result.settlementConfig.externalCarrierFeePct).toBe(0.04);
  });
});
