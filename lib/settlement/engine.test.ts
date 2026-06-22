import { describe, it, expect } from "vitest";
import { computeSettlement, type SettlementInput } from "./engine";

describe("settlement engine — brief examples", () => {
  it("Model 1: company driver (976.19 * 33% = 322.14)", () => {
    const input: SettlementInput = {
      config: {
        settlementType: "company_driver",
        companyFeePct: 0,
        driverPayPct: 0.33,
        externalCarrierFeePct: 0,
        managementCommission: { type: "none", amount: 0 },
      },
      loads: [{ grossAmount: 976.19 }],
      expenses: [],
    };
    const r = computeSettlement(input);
    expect(r.grossRevenue).toBe(976.19);
    expect(r.netPay).toBe(322.14);
    expect(r.ourCommissionEarned).toBe(0);
  });

  it("Model 2: box truck driver (relay 357.81 + street 1600 = 1957.81 * 20% = 391.56)", () => {
    const r = computeSettlement({
      config: {
        settlementType: "box_truck_driver",
        companyFeePct: 0,
        driverPayPct: 0.2,
        externalCarrierFeePct: 0,
        managementCommission: { type: "none", amount: 0 },
      },
      loads: [
        { grossAmount: 357.81, type: "Amazon Relay" },
        { grossAmount: 1600.0, type: "Street Load" },
      ],
    });
    expect(r.grossRevenue).toBe(1957.81);
    expect(r.netPay).toBe(391.56);
  });

  it("Model 3: owner operator (10454.39 net 6360.98)", () => {
    const r = computeSettlement({
      config: {
        settlementType: "owner_operator",
        companyFeePct: 0.12,
        driverPayPct: null,
        externalCarrierFeePct: 0,
        managementCommission: { type: "none", amount: 0 },
      },
      loads: [{ grossAmount: 10454.39 }],
      expenses: [
        { category: "fuel_def_fees", amount: 2338.88 },
        { category: "insurance", amount: 400 },
        { category: "eld_ifta", amount: 100 },
      ],
    });
    expect(r.grossRevenue).toBe(10454.39);
    expect(r.netPay).toBe(6360.98);
    // 12% of gross is our company revenue
    expect(r.ourCommissionEarned).toBe(1254.53);
  });

  it("Model 4: managed/investor (5500 net to investor 1306.85)", () => {
    const r = computeSettlement({
      config: {
        settlementType: "managed_investor",
        companyFeePct: 0,
        driverPayPct: 0.3,
        externalCarrierFeePct: 0.12,
        managementCommission: { type: "flat", amount: 250 },
      },
      loads: [{ grossAmount: 5500 }],
      expenses: [
        { category: "fuel", amount: 1553.15 },
        { category: "tolls", amount: 80 },
      ],
    });
    expect(r.grossRevenue).toBe(5500);
    expect(r.netPay).toBe(1306.85);
    expect(r.ourCommissionEarned).toBe(250);
    // external carrier fee is NOT our revenue
    const extFee = r.lineItems.find((l) => l.key === "external_carrier_fee");
    expect(extFee?.amount).toBe(-660);
    expect(extFee?.isOurRevenue).toBe(false);
  });

  it("Model 5: external carrier statement (6671.19 - 250 = 6421.19)", () => {
    const r = computeSettlement({
      config: {
        settlementType: "external_carrier_statement",
        companyFeePct: 0,
        driverPayPct: null,
        externalCarrierFeePct: 0,
        managementCommission: { type: "flat", amount: 250, onlyIfPositiveBase: true },
      },
      externalNetPay: 6671.19,
    });
    expect(r.netPay).toBe(6421.19);
    expect(r.ourCommissionEarned).toBe(250);
  });

  it("Model 5 rule: no commission when external net <= 0", () => {
    const r = computeSettlement({
      config: {
        settlementType: "external_carrier_statement",
        companyFeePct: 0,
        driverPayPct: null,
        externalCarrierFeePct: 0,
        managementCommission: { type: "flat", amount: 250, onlyIfPositiveBase: true },
      },
      externalNetPay: 0,
    });
    expect(r.netPay).toBe(0);
    expect(r.ourCommissionEarned).toBe(0);
  });

  it("net pay equals gross plus signed line items (owner operator)", () => {
    const r = computeSettlement({
      config: {
        settlementType: "owner_operator",
        companyFeePct: 0.1,
        driverPayPct: null,
        externalCarrierFeePct: 0,
        managementCommission: { type: "none", amount: 0 },
      },
      loads: [{ grossAmount: 8000 }],
      expenses: [{ category: "fuel", amount: 1200 }],
    });
    const sum = r.lineItems.reduce((s, l) => s + l.amount, r.grossRevenue);
    expect(r.netPay).toBe(Math.round(sum * 100) / 100);
  });
});
