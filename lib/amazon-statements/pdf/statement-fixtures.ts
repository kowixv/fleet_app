import { AMAZON_STATEMENT_TEMPLATE_V1 } from "./statement-template-registry";
import { round2 } from "./statement-formatting";
import type {
  AmazonStatementDeductionLine,
  AmazonStatementFuelLine,
  AmazonStatementRevenueLine,
  AmazonStatementType,
  AmazonStatementViewModel,
} from "./statement-view-model";

const generatedAt = "2026-07-17T12:00:00Z";

export type AmazonStatementFixtureName =
  | "owner_operator_reference"
  | "company_driver"
  | "box_truck_driver_special_deductions"
  | "managed_investor"
  | "negative_net"
  | "void_statement"
  | "long_multi_page_statement"
  | "bilingual_statement"
  | "team_driver_allocation";

export function amazonStatementFixtureNames(): AmazonStatementFixtureName[] {
  return [
    "owner_operator_reference",
    "company_driver",
    "box_truck_driver_special_deductions",
    "managed_investor",
    "negative_net",
    "void_statement",
    "long_multi_page_statement",
    "bilingual_statement",
    "team_driver_allocation",
  ];
}

export function buildAmazonStatementFixture(name: AmazonStatementFixtureName): AmazonStatementViewModel {
  if (name === "owner_operator_reference") return ownerOperatorReference();
  if (name === "company_driver") return baseStatement({ name, type: "company_driver", gross: 1000, deductions: [deduction("driver-insurance", "Insurance", 50, 1)], fuel: [] });
  if (name === "box_truck_driver_special_deductions") {
    return baseStatement({
      name,
      type: "box_truck_driver",
      gross: 1800,
      deductions: [deduction("parking", "Parking", 80, 1), deduction("load-save", "Load Save", 45, 2)],
      fuel: [],
    });
  }
  if (name === "managed_investor") {
    return baseStatement({
      name,
      type: "managed_investor",
      gross: 5000,
      deductions: [deduction("driver-cost", "Driver Cost", 1500, 1), deduction("fuel", "Fuel", 600, 2)],
      fuel: [fuelLine("fuel-1", 600, 1)],
    });
  }
  if (name === "negative_net") {
    return baseStatement({
      name,
      type: "owner_operator",
      gross: 500,
      deductions: [deduction("maintenance", "Maintenance", 750, 1)],
      fuel: [],
    });
  }
  if (name === "void_statement") return { ...ownerOperatorReference(), candidateId: "candidate-void", documentId: "AMZ-STMT-VOID", candidateStatus: "void", settlementStatus: "void" };
  if (name === "long_multi_page_statement") return longMultiPageStatement();
  if (name === "bilingual_statement") return { ...ownerOperatorReference(), candidateId: "candidate-bilingual", documentId: "AMZ-STMT-BILINGUAL", language: "en_tr" };
  if (name === "team_driver_allocation") {
    const model = baseStatement({
      name,
      type: "company_driver",
      gross: 1000,
      deductions: [deduction("insurance", "Insurance", 100, 1)],
      fuel: [],
    });
    return {
      ...model,
      teamAllocations: [
        { id: "team-a", displayOrder: 1, memberName: "Alex Driver", basisPoints: 5000, amount: 500 },
        { id: "team-b", displayOrder: 2, memberName: "Blake Driver", basisPoints: 5000, amount: 500 },
      ],
    };
  }
  return ownerOperatorReference();
}

function ownerOperatorReference(): AmazonStatementViewModel {
  const fuel = [fuelLine("fuel-1", 2028.22, 1)];
  return baseStatement({
    name: "owner_operator_reference",
    type: "owner_operator",
    gross: 9291.84,
    deductions: [
      deduction("company-fee", "Company Fee", 1115.02, 1, "gross_percentage"),
      deduction("insurance", "Insurance", 800, 2),
      deduction("eld-safety", "ELD/Safety", 100, 3),
      deduction("fuel", "Fuel", 2028.22, 4, "selected_source_lines"),
    ],
    fuel,
  });
}

function baseStatement(args: {
  name: string;
  type: AmazonStatementType;
  gross: number;
  deductions: AmazonStatementDeductionLine[];
  fuel: AmazonStatementFuelLine[];
}): AmazonStatementViewModel {
  const deductions = round2(args.deductions.reduce((sum, line) => sum + line.amount, 0));
  const fuelTotal = round2(args.fuel.reduce((sum, line) => sum + line.amount, 0));
  return {
    candidateId: `candidate-${args.name}`,
    documentId: `AMZ-STMT-${args.name.toUpperCase().replace(/_/g, "-")}`,
    statementType: args.type,
    candidateStatus: "ready",
    settlementStatus: null,
    ruleVersion: "synthetic-rules-v1",
    templateVersion: AMAZON_STATEMENT_TEMPLATE_V1,
    language: "en",
    company: { name: "Example Logistics LLC", secondary: "Synthetic fixture" },
    payee: { name: "Example Payee", secondary: "Synthetic payee" },
    vehicleDisplay: "Unit 100",
    periodStart: "2026-07-05",
    periodEnd: "2026-07-11",
    invoiceMetadata: { invoiceNumber: "SYNTHETIC", invoiceDate: "2026-07-14", paymentDate: "2026-07-15", paymentStatus: "Paid" },
    summary: {
      grossRevenue: args.gross,
      percentageDeductions: args.deductions.filter((line) => line.calculationBasis === "gross_percentage").reduce((sum, line) => sum + line.amount, 0),
      fixedDeductions: args.deductions.filter((line) => line.calculationBasis === "fixed_amount").reduce((sum, line) => sum + line.amount, 0),
      fuelDeductions: fuelTotal,
      otherDeductions: 0,
      totalDeductions: deductions,
      netAmount: round2(args.gross - deductions),
    },
    revenueLines: [revenueLine("revenue-1", args.gross, 1)],
    fuelLines: args.fuel,
    deductionLines: args.deductions,
    teamAllocations: [],
    calculationNotes: ["Synthetic fixture generated from a saved candidate calculation snapshot."],
    reconciliationIndicators: ["Revenue and deduction totals reconcile to the saved calculation result."],
    companySignature: { printedName: "Authorized Manager", title: "Manager", signedStatus: "pending" },
    payeeSignature: { printedName: null, signedStatus: "pending" },
    generatedAt,
    footer: { templateVersion: AMAZON_STATEMENT_TEMPLATE_V1, sourceRevision: "synthetic-source-v1", previewRevision: "synthetic-preview-v1" },
  };
}

function longMultiPageStatement(): AmazonStatementViewModel {
  const revenueLines = Array.from({ length: 65 }, (_, index) => revenueLine(`revenue-${index + 1}`, 100, index + 1));
  const fuelLines = Array.from({ length: 45 }, (_, index) => fuelLine(`fuel-${index + 1}`, 20, index + 1));
  const fuelTotal = round2(fuelLines.reduce((sum, line) => sum + line.amount, 0));
  const gross = round2(revenueLines.reduce((sum, line) => sum + line.grossAmount, 0));
  const deductions = [deduction("fuel", "Fuel", fuelTotal, 1, "selected_source_lines"), deduction("insurance", "Insurance", 100, 2)];
  const totalDeductions = round2(deductions.reduce((sum, line) => sum + line.amount, 0));
  return {
    ...baseStatement({ name: "long_multi_page_statement", type: "owner_operator", gross, deductions, fuel: fuelLines }),
    revenueLines,
    summary: {
      grossRevenue: gross,
      percentageDeductions: 0,
      fixedDeductions: 100,
      fuelDeductions: fuelTotal,
      otherDeductions: 0,
      totalDeductions,
      netAmount: round2(gross - totalDeductions),
    },
  };
}

function revenueLine(id: string, amount: number, order: number): AmazonStatementRevenueLine {
  return {
    id,
    sourceRevenueItemId: id,
    displayOrder: order,
    tripId: `TRIP-${String(order).padStart(3, "0")}`,
    loadId: `LOAD-${String(order).padStart(3, "0")}`,
    date: "2026-07-06",
    routeDisplay: order % 3 === 0 ? null : "Houston, TX -> Dallas, TX",
    routeStatus: order % 3 === 0 ? "pending_review" : "verified",
    weight: null,
    distance: 250,
    baseAmount: round2(amount * 0.82),
    fuelSurchargeAmount: round2(amount * 0.12),
    tollAmount: round2(amount * 0.03),
    detentionAmount: 0,
    tonuAmount: 0,
    otherAmount: round2(amount * 0.03),
    grossAmount: amount,
  };
}

function fuelLine(id: string, amount: number, order: number): AmazonStatementFuelLine {
  return {
    id,
    sourceTransactionLineId: id,
    displayOrder: order,
    date: "2026-07-07",
    invoice: `INV-${String(Math.ceil(order / 2)).padStart(3, "0")}`,
    merchant: "Example Fuel Stop With Long Name",
    location: "Example City, TX",
    product: order % 2 === 0 ? "DEF" : "ULSD",
    quantity: amount < 0 ? -5 : 75.25,
    chargedPpu: amount < 0 ? 2 : 3.95,
    discountAmount: order % 2 === 0 ? 4.5 : 12.34,
    amount,
    maskedCard: "****1234",
    continuation: order % 2 === 0,
  };
}

function deduction(
  id: string,
  label: string,
  amount: number,
  displayOrder: number,
  calculationBasis: AmazonStatementDeductionLine["calculationBasis"] = "fixed_amount",
): AmazonStatementDeductionLine {
  return {
    id,
    displayOrder,
    type: id,
    label,
    calculationBasis,
    amount,
    explicitZero: amount === 0,
    source: "synthetic",
  };
}
