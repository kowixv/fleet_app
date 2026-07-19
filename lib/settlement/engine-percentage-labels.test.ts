import { describe, expect, it } from "vitest";
import { computeSettlement, formatPercentage } from "./engine";

describe("settlement percentage labels", () => {
  it("preserves decimal basis-point precision without trailing zeroes", () => {
    expect(formatPercentage(0.025)).toBe("2.5");
    expect(formatPercentage(0.33)).toBe("33");
    expect(formatPercentage(0.0255)).toBe("2.55");
  });

  it("shows a 2.5 percent managed-investor fee without rounding it to 3 percent", () => {
    const result = computeSettlement({
      config: {
        settlementType: "managed_investor",
        companyFeePct: 0,
        driverPayPct: 0.33,
        externalCarrierFeePct: 0.025,
        managementCommission: { type: "none", amount: 0 },
      },
      loads: [{ grossAmount: 11953.6 }],
    });

    const fee = result.lineItems.find((line) => line.key === "external_carrier_fee");
    expect(fee?.labelEn).toBe("External carrier fee (2.5%)");
    expect(fee?.amount).toBe(-298.84);
  });
});
