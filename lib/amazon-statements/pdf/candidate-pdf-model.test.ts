import { describe, expect, it } from "vitest";
import { candidatePdfModel } from "./candidate-pdf-model";
import { validateStatementViewModel } from "./statement-pdf-validation";

const fuelAmounts = [215.72, 127.63, 57.94, 537.42, 265.35, 222.27, 601.89];

function mCelebiCandidate(): Record<string, unknown> {
  return {
    id: "3ba0aaf8-15db-4a35-b84a-1f012327d7e5",
    statement_type: "owner_operator",
    status: "draft",
    period_start: "2026-07-05",
    period_end: "2026-07-11",
    people: [{ full_name: "M. Celebi" }],
    vehicles: [{ unit_number: "1501" }],
    template_version: "amazon-statement-v1",
    calculation_rule_version: "amazon-candidate-rules-v1",
    source_revision: "source-revision",
    preview_revision: "preview-revision",
    configuration_snapshot: { language_mode: "en_tr" },
    calculation_snapshot: {
      engineInputs: {
        loads: [
          { reference: "LOAD-1", grossAmount: 9291.84 },
        ],
        expenses: [
          ...fuelAmounts.map((amount, index) => ({
            category: index === 2 ? "def" : "fuel",
            amount,
          })),
          { category: "insurance", amount: 800 },
          { category: "eld_safety", amount: 100 },
        ],
      },
      lineItems: [
        { key: "company_fee", labelEn: "Company fee (12%)", amount: -1115.02 },
        ...fuelAmounts.map((amount, index) => ({
          key: index === 2 ? "expense_def" : "expense_fuel",
          labelEn: index === 2 ? "DEF" : "Fuel",
          amount: -amount,
        })),
        { key: "expense_insurance", labelEn: "Insurance", amount: -800 },
        { key: "expense_eld_safety", labelEn: "ELD/Safety", amount: -100 },
      ],
    },
    gross_amount: 9291.84,
    percentage_deductions_amount: 1115.02,
    fixed_deductions_amount: 900,
    fuel_deductions_amount: 2028.22,
    other_deductions_amount: 0,
    total_deductions_amount: 4043.24,
    net_amount: 5248.60,
    converted_settlement_id: null,
  };
}

describe("candidate PDF model", () => {
  it("renders owner-operator deductions as positive display amounts that reconcile", () => {
    const model = candidatePdfModel(mCelebiCandidate());

    expect(model.payee.name).toBe("M. Celebi");
    expect(model.vehicleDisplay).toBe("1501");
    expect(model.deductionLines.every((line) => line.amount > 0)).toBe(true);
    expect(model.deductionLines.reduce((sum, line) => sum + line.amount, 0)).toBeCloseTo(4043.24, 2);
    expect(model.fuelLines.reduce((sum, line) => sum + line.amount, 0)).toBeCloseTo(2028.22, 2);
    expect(validateStatementViewModel(model, ["amazon-statement-v1"])).toEqual([]);
  });

  it("does not treat positive driver pay lines as deductions", () => {
    const model = candidatePdfModel({
      id: "candidate-2",
      statement_type: "company_driver",
      status: "draft",
      period_start: "2026-07-05",
      period_end: "2026-07-11",
      people: { full_name: "Driver" },
      vehicles: { unit_number: "1502" },
      template_version: "amazon-statement-v1",
      configuration_snapshot: { language_mode: "en" },
      calculation_snapshot: {
        engineInputs: {
          loads: [{ reference: "LOAD-2", grossAmount: 1000 }],
          expenses: [{ category: "parking", amount: 25 }],
        },
        lineItems: [
          { key: "driver_pay", labelEn: "Driver pay (30%)", amount: 300 },
          { key: "expense_parking", labelEn: "Parking", amount: -25 },
        ],
      },
      gross_amount: 1000,
      percentage_deductions_amount: 0,
      fixed_deductions_amount: 25,
      fuel_deductions_amount: 0,
      other_deductions_amount: 0,
      total_deductions_amount: 25,
      net_amount: 975,
    });

    expect(model.deductionLines).toHaveLength(1);
    expect(model.deductionLines[0].type).toBe("expense_parking");
  });

  it("uses normalized invoice, revenue, route, component, and fuel transaction details", () => {
    const model = candidatePdfModel(mCelebiCandidate(), {
      companyName: "ZYNP LLC",
      companySecondary: "SCAC AVFYC",
      invoiceMetadata: {
        invoiceNumber: "AZNG06F58A614C4F42D498A8D4855095EDB5",
        invoiceDate: "2026-07-14",
        paymentDate: "2026-07-15",
        paymentStatus: "Paid",
      },
      revenueLines: [{
        id: "candidate-revenue-1",
        sourceRevenueItemId: "revenue-item-1",
        displayOrder: 1,
        tripId: "T-123",
        loadId: "LOAD-123",
        date: "2026-07-09",
        routeDisplay: "Memphis, TN -> Richmond, VA",
        routeVerified: true,
        distance: 998.13,
        baseAmount: 1528.30,
        fuelSurchargeAmount: 548.97,
        tollAmount: 79.28,
        grossAmount: 2156.55,
      }, {
        id: "candidate-revenue-2",
        sourceRevenueItemId: "revenue-item-2",
        displayOrder: 2,
        tripId: "T-124",
        loadId: "LOAD-124",
        date: "2026-07-11",
        routeDisplay: "Richmond, VA -> Knoxville, TN",
        routeVerified: true,
        distance: 312.12,
        baseAmount: 632.85,
        fuelSurchargeAmount: 171.67,
        tollAmount: 0,
        grossAmount: 804.52,
      }, {
        id: "candidate-revenue-balance",
        sourceRevenueItemId: "revenue-item-balance",
        displayOrder: 3,
        tripId: "T-BALANCE",
        loadId: null,
        date: "2026-07-11",
        routeDisplay: "Knoxville, TN -> Nashville, TN",
        routeVerified: true,
        distance: 0,
        baseAmount: 6330.77,
        fuelSurchargeAmount: 0,
        tollAmount: 0,
        grossAmount: 6330.77,
      }],
      fuelLines: fuelAmounts.map((amount, index) => ({
        id: `candidate-fuel-${index + 1}`,
        sourceTransactionLineId: `fuel-line-${index + 1}`,
        displayOrder: index + 1,
        date: "2026-07-11",
        invoice: `INV-${index + 1}`,
        merchant: "LOVE'S",
        location: "Knoxville, TN",
        product: index === 2 ? "DEF" : "ULSD",
        quantity: 50,
        chargedPpu: 3.99,
        discountAmount: 9.96,
        amount,
        maskedCard: "****0570",
      })),
    });

    expect(model.company).toEqual({ name: "ZYNP LLC", secondary: "SCAC AVFYC" });
    expect(model.invoiceMetadata?.invoiceNumber).toBe("AZNG06F58A614C4F42D498A8D4855095EDB5");
    expect(model.revenueLines[0]).toMatchObject({
      tripId: "T-123",
      date: "2026-07-09",
      routeDisplay: "Memphis, TN -> Richmond, VA",
      routeStatus: "verified",
      distance: 998.13,
      baseAmount: 1528.30,
      fuelSurchargeAmount: 548.97,
      tollAmount: 79.28,
    });
    expect(model.fuelLines[0]).toMatchObject({
      invoice: "INV-1",
      merchant: "LOVE'S",
      location: "Knoxville, TN",
      product: "ULSD",
      quantity: 50,
      chargedPpu: 3.99,
      discountAmount: 9.96,
    });
    expect(validateStatementViewModel(model, ["amazon-statement-v1"])).toEqual([]);
  });
});
