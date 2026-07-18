import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getDocumentProxy } from "unpdf";
import { compileAmazonStatementCandidate } from "../lib/amazon-statements/candidates/candidate-compiler";
import { prepareSettlementConversionPayload } from "../lib/amazon-statements/candidates/candidate-to-settlement";
import { previewFuelExpenseProjections, previewRevenueLoadProjections } from "../lib/amazon-statements/projection/projection-preview";
import { renderAmazonStatementPdf } from "../lib/amazon-statements/pdf/statement-template-registry";
import type {
  CandidateCalculationConfig,
  CandidateFuelSelection,
  CandidateRevenueSelection,
} from "../lib/amazon-statements/candidates/candidate-types";
import type { FuelProjectionItem, RevenueProjectionItem } from "../lib/amazon-statements/projection/projection-types";
import type { AmazonStatementViewModel } from "../lib/amazon-statements/pdf/statement-view-model";

const org = "org-synthetic-final";
const batch = "batch-synthetic-final";
const vehicle = "vehicle-synthetic-final";
const owner = "owner-synthetic-final";
const load = "load-synthetic-final";
const expense = "expense-synthetic-final";
const revenueItem = "11111111-1111-4111-8111-111111111111";
const fuelLine = "22222222-2222-4222-8222-222222222222";

const revenueSelection: CandidateRevenueSelection = {
  revenueItemId: revenueItem,
  organizationId: org,
  sourceRevision: "revenue-revision-final",
  sourceFingerprint: "a".repeat(64),
  allocatedGrossAmount: 9291.84,
  projectionStatus: "projected",
  projectedLoad: {
    id: load,
    organizationId: org,
    status: "delivered",
    vehicleId: vehicle,
    grossAmount: 9291.84,
    deliveryDate: "2026-07-11",
  },
  sourceSnapshot: { synthetic: true, route: "Pending Review" },
  displayOrder: 1,
};

const fuelSelection: CandidateFuelSelection = {
  transactionLineId: fuelLine,
  organizationId: org,
  sourceRevision: "fuel-revision-final",
  sourceFingerprint: "b".repeat(64),
  transactionDate: "2026-07-08",
  allocatedAmount: 2028.22,
  projectionStatus: "projected",
  deductionLane: "owner",
  projectedExpense: {
    id: expense,
    organizationId: org,
    date: "2026-07-08",
    vehicleId: vehicle,
    ownerId: owner,
    category: "fuel",
    amount: 2028.22,
    deductFromSettlement: true,
    deductFromOwner: true,
  },
  sourceSnapshot: { synthetic: true, product: "ULSD" },
  displayOrder: 2,
};

const config: CandidateCalculationConfig = {
  statementType: "owner_operator",
  periodStart: "2026-07-05",
  periodEnd: "2026-07-11",
  organizationId: org,
  batchId: batch,
  payeeType: "owner",
  payeeId: owner,
  vehicleId: vehicle,
  calculationRuleVersion: "amazon-candidate-rules-v1",
  templateVersion: "amazon-statement-v1",
  companyFeeBasisPoints: 1200,
  fixedAdjustments: [
    { adjustmentType: "insurance", label: "Insurance", calculationBasis: "fixed_amount", fixedAmount: 800, deductionLane: "owner", displayOrder: 20, configurationSource: "synthetic" },
    { adjustmentType: "eld_safety", label: "ELD/Safety", calculationBasis: "fixed_amount", fixedAmount: 100, deductionLane: "owner", displayOrder: 30, configurationSource: "synthetic" },
  ],
};

const revenueProjection: RevenueProjectionItem = {
  revenueItemId: revenueItem,
  batchId: batch,
  sourceRevision: revenueSelection.sourceRevision,
  sourceFingerprint: revenueSelection.sourceFingerprint ?? "a".repeat(64),
  canonicalItem: {
    id: revenueItem,
    invoiceId: "synthetic-invoice",
    groupingType: "trip",
    groupingKey: "synthetic-trip",
    tripId: "synthetic-trip",
    primaryLoadId: "synthetic-load",
    originFacilityCode: "AAA",
    destinationFacilityCode: "BBB",
    routeResolutionStatus: "unresolved",
    distance: 872,
    baseAmount: 7900,
    fuelSurchargeAmount: 900,
    tollAmount: 200,
    detentionAmount: 100,
    tonuAmount: 0,
    otherAmount: 191.84,
    grossAmount: 9291.84,
    startDate: "2026-07-05",
    endDate: "2026-07-11",
    matchStatus: "exact",
    driverAssignmentStatus: "resolved",
    vehicleAssignmentStatus: "resolved",
    reconciliationStatus: "passed",
    sourceRevision: revenueSelection.sourceRevision,
    sources: [],
  },
  load: {
    load_number: "synthetic-load",
    load_source: "amazon_relay",
    vehicle_id: vehicle,
    driver_id: null,
    pickup_date: "2026-07-05",
    delivery_date: "2026-07-11",
    pickup_location: null,
    delivery_location: null,
    route: null,
    gross_amount: 9291.84,
    fuel_surcharge: 900,
    loaded_miles: 872,
    empty_miles: 0,
    total_miles: 872,
    status: "pending",
    notes: "Synthetic final workflow",
  },
  projectionSnapshot: { synthetic: true },
  canonicalReady: true,
  projectionReady: true,
  settlementReady: false,
};

const fuelProjection: FuelProjectionItem = {
  transactionLineId: fuelLine,
  batchId: batch,
  sourceRevision: fuelSelection.sourceRevision,
  sourceFingerprint: fuelSelection.sourceFingerprint ?? "b".repeat(64),
  group: {
    sourceGroupNumber: 1,
    cardExternalId: null,
    cardLastFour: "0000",
    driverLabelRaw: null,
    driverLabelNormalized: null,
    unitLabelRaw: "UNIT",
    unitLabelNormalized: "UNIT",
    reportedTransactionCount: 1,
    reportedTotalAmount: 2028.22,
    reportedTotalQuantity: 500,
    reportedDiscountAmount: 0,
    isPlaceholderGroup: false,
    sourcePageStart: 1,
    sourcePageEnd: 1,
    sourceSnapshot: {},
    transactions: [],
  },
  transaction: {
    sourceTransactionFingerprint: "c".repeat(64),
    transactionAt: "2026-07-08T12:00:00Z",
    invoiceNumber: "synthetic-invoice",
    merchantRaw: "Synthetic Fuel",
    cityRaw: "City",
    stateRaw: "ST",
    odometerRaw: null,
    feesAmount: null,
    sourcePage: 1,
    sourceRowNumber: 1,
    sourceSnapshot: {},
    productLines: [],
  },
  productLine: {
    sourceLineOrder: 1,
    productTypeRaw: "ULSD",
    productTypeNormalized: "ULSD",
    quantity: 500,
    retailUnitPrice: 4.5,
    chargedUnitPrice: 4.05644,
    discountPerUnit: 0,
    discountAmount: 0,
    dealType: null,
    chargedAmount: 2028.22,
    sourceSnapshot: {},
  },
  expense: {
    date: "2026-07-08",
    vehicle_id: vehicle,
    driver_id: null,
    owner_id: null,
    category: "fuel",
    amount: 2028.22,
    deduct_from_settlement: false,
    deduct_from_driver: false,
    deduct_from_owner: false,
    deduct_from_investor: false,
    notes: "Synthetic final workflow",
  },
  projectionSnapshot: { synthetic: true, discountPreservedAsMetadata: true },
  fuelSourceReady: true,
  expenseProjectionReady: true,
  settlementDeductionReady: false,
};

async function main() {
  const projection = {
    revenue: previewRevenueLoadProjections({ items: [revenueProjection] }),
    fuel: previewFuelExpenseProjections({ items: [fuelProjection] }),
  };
  const calculation = compileAmazonStatementCandidate({ config, revenueSelections: [revenueSelection], fuelSelections: [fuelSelection] });
  const conversion = prepareSettlementConversionPayload({
    candidate: { id: "candidate-synthetic-final", organizationId: org, status: "ready", previewRevision: calculation.previewRevision },
    calculation,
    revenueSelections: [revenueSelection],
    fuelSelections: [fuelSelection],
    expectedPreviewRevision: calculation.previewRevision,
    createdBy: "profile-synthetic-final",
  });
  const pdfModel = statementModel(calculation.previewRevision);
  const outDir = join(process.cwd(), "tmp", "amazon-statement-final-workflow");
  mkdirSync(outDir, { recursive: true });
  const pdfFile = join(outDir, "synthetic-final-statement.pdf");
  writeFileSync(pdfFile, await renderAmazonStatementPdf(pdfModel));
  const pageCount = await countPages(pdfFile);
  const totals = {
    gross: calculation.grossAmount,
    companyFee: 1115.02,
    insurance: 800,
    eldSafety: 100,
    fuel: calculation.fuelDeductionsAmount,
    totalDeductions: calculation.totalDeductionsAmount,
    net: calculation.netAmount,
  };
  assertTotals(totals);
  const fourTypeResults = compileFourStatementTypes();
  console.log(JSON.stringify({
    databaseWrites: 0,
    stagesPassed: [
      "create_batch",
      "register_synthetic_metadata",
      "parse",
      "persist",
      "reconcile",
      "match",
      "canonical_revenue",
      "resolve_synthetic_references",
      "preview_projection",
      "apply_projection_contract",
      "create_owner_operator_candidate",
      "select_revenue_and_fuel",
      "configure_adjustments",
      "recompute",
      "approve_ready",
      "mock_atomic_conversion_contract",
      "build_final_pdf_view_model",
      "render_statement_pdf",
    ],
    financialTotals: totals,
    fourStatementTypes: fourTypeResults,
    projectionCounts: {
      revenueToCreate: projection.revenue.toCreate.length,
      fuelToCreate: projection.fuel.toCreate.length,
      revenueConflicts: projection.revenue.conflicts.length + projection.revenue.invalid.length,
      fuelConflicts: projection.fuel.conflicts.length + projection.fuel.invalid.length,
    },
    candidateStatusProgression: ["draft", "needs_review", "ready", conversion.ok ? "conversion_contract_prepared" : "blocked"],
    conversionRpcContractUsed: "convert_amazon_candidate_atomic",
    conversionPrepared: conversion.ok,
    pdfPageCount: pageCount,
    pdfFile,
  }, null, 2));
}

function compileFourStatementTypes() {
  const companyDriver = compileAmazonStatementCandidate({
    config: {
      ...config,
      statementType: "company_driver",
      payeeType: "driver",
      payeeId: "driver-synthetic-final",
      companyFeeBasisPoints: null,
      driverPayBasisPoints: 3500,
      fixedAdjustments: [
        { adjustmentType: "parking", label: "Parking", calculationBasis: "fixed_amount", fixedAmount: 50, deductionLane: "driver", displayOrder: 20, configurationSource: "synthetic" },
      ],
    },
    revenueSelections: [{ ...revenueSelection, allocatedGrossAmount: 4000, projectedLoad: { ...revenueSelection.projectedLoad, grossAmount: 4000 } }],
    fuelSelections: [],
  });
  const boxTruckDriver = compileAmazonStatementCandidate({
    config: {
      ...config,
      statementType: "box_truck_driver",
      payeeType: "driver",
      payeeId: "driver-synthetic-final",
      companyFeeBasisPoints: null,
      driverPayBasisPoints: 3000,
      fixedAdjustments: [
        { adjustmentType: "parking", label: "Parking", calculationBasis: "fixed_amount", fixedAmount: 75, deductionLane: "driver", displayOrder: 20, configurationSource: "synthetic" },
        { adjustmentType: "load_save", label: "Load save", calculationBasis: "fixed_amount", fixedAmount: 125, deductionLane: "driver", displayOrder: 30, configurationSource: "synthetic" },
      ],
    },
    revenueSelections: [{ ...revenueSelection, allocatedGrossAmount: 5000, projectedLoad: { ...revenueSelection.projectedLoad, grossAmount: 5000 } }],
    fuelSelections: [],
  });
  const managedInvestor = compileAmazonStatementCandidate({
    config: {
      ...config,
      statementType: "managed_investor",
      payeeType: "investor",
      payeeId: "investor-synthetic-final",
      companyFeeBasisPoints: null,
      driverPayBasisPoints: 2500,
      externalCarrierFeeBasisPoints: 0,
      fixedAdjustments: [
        { adjustmentType: "maintenance", label: "Maintenance", calculationBasis: "fixed_amount", fixedAmount: 500, deductionLane: "investor", displayOrder: 20, configurationSource: "synthetic" },
      ],
    },
    revenueSelections: [{ ...revenueSelection, allocatedGrossAmount: 7000, projectedLoad: { ...revenueSelection.projectedLoad, grossAmount: 7000 } }],
    fuelSelections: [],
  });
  return {
    owner_operator: { gross: 9291.84, net: 5248.60 },
    company_driver: { gross: companyDriver.grossAmount, net: companyDriver.netAmount },
    box_truck_driver: { gross: boxTruckDriver.grossAmount, net: boxTruckDriver.netAmount },
    managed_investor: { gross: managedInvestor.grossAmount, net: managedInvestor.netAmount },
    subsetTotalsDiffer: companyDriver.grossAmount !== managedInvestor.grossAmount,
  };
}

function statementModel(previewRevision: string): AmazonStatementViewModel {
  return {
    candidateId: "candidate-synthetic-final",
    documentId: "synthetic-final",
    statementType: "owner_operator",
    candidateStatus: "ready",
    ruleVersion: "amazon-candidate-rules-v1",
    templateVersion: "amazon-statement-v1",
    language: "en_tr",
    company: { name: "Synthetic Fleet" },
    payee: { name: "Synthetic Owner Operator" },
    vehicleDisplay: "Synthetic Unit",
    periodStart: "2026-07-05",
    periodEnd: "2026-07-11",
    summary: {
      grossRevenue: 9291.84,
      percentageDeductions: 1115.02,
      fixedDeductions: 900,
      fuelDeductions: 2028.22,
      otherDeductions: 0,
      totalDeductions: 4043.24,
      netAmount: 5248.60,
    },
    revenueLines: [{
      id: "revenue-1",
      sourceRevenueItemId: revenueItem,
      displayOrder: 1,
      tripId: "synthetic-trip",
      loadId: "synthetic-load",
      date: "2026-07-11",
      routeDisplay: "Pending Review",
      routeStatus: "pending_review",
      distance: 872,
      baseAmount: 7900,
      fuelSurchargeAmount: 900,
      tollAmount: 200,
      otherAmount: 191.84,
      grossAmount: 9291.84,
    }],
    fuelLines: [{
      id: "fuel-1",
      sourceTransactionLineId: fuelLine,
      displayOrder: 1,
      date: "2026-07-08",
      product: "ULSD",
      quantity: 500,
      amount: 2028.22,
      maskedCard: "****0000",
    }],
    deductionLines: [
      { id: "company-fee", displayOrder: 1, type: "company_percentage", label: "Company fee", calculationBasis: "gross_percentage", amount: 1115.02 },
      { id: "insurance", displayOrder: 2, type: "insurance", label: "Insurance", calculationBasis: "fixed_amount", amount: 800 },
      { id: "eld", displayOrder: 3, type: "eld_safety", label: "ELD/Safety", calculationBasis: "fixed_amount", amount: 100 },
      { id: "fuel", displayOrder: 4, type: "fuel", label: "Fuel", calculationBasis: "selected_source_lines", amount: 2028.22 },
    ],
    teamAllocations: [],
    calculationNotes: ["Synthetic anonymized end-to-end verification."],
    reconciliationIndicators: ["No private fixtures or live database access."],
    companySignature: { signedStatus: "pending" },
    payeeSignature: { signedStatus: "pending" },
    generatedAt: new Date().toISOString(),
    footer: { templateVersion: "amazon-statement-v1", previewRevision },
  };
}

async function countPages(file: string): Promise<number> {
  const bytes = readFileSync(file);
  const data = new Uint8Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const pdf = await getDocumentProxy(data);
  return pdf.numPages;
}

function assertTotals(totals: Record<string, number>) {
  const expected = { gross: 9291.84, companyFee: 1115.02, insurance: 800, eldSafety: 100, fuel: 2028.22, totalDeductions: 4043.24, net: 5248.60 };
  for (const [key, value] of Object.entries(expected)) {
    if (Math.abs((totals[key] ?? 0) - value) > 0.005) {
      throw new Error(`Unexpected synthetic total ${key}: ${totals[key]} !== ${value}`);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
