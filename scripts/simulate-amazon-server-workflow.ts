import { matchPaymentTrips, type PaymentSourceRow, type TripSourceRow } from "../lib/amazon-statements/matching/payment-trip-matcher";
import { buildAmazonRevenueItems } from "../lib/amazon-statements/revenue/revenue-builder";
import { reconcileAmazonRevenue } from "../lib/amazon-statements/revenue/revenue-reconciliation";
import { previewFuelExpenseProjections, previewRevenueLoadProjections } from "../lib/amazon-statements/projection/projection-preview";
import { compileAmazonStatementCandidate } from "../lib/amazon-statements/candidates/candidate-compiler";
import { prepareSettlementConversionPayload } from "../lib/amazon-statements/candidates/candidate-to-settlement";
import { buildAmazonStatementFixture } from "../lib/amazon-statements/pdf/statement-fixtures";
import { validateStatementViewModel } from "../lib/amazon-statements/pdf/statement-pdf-validation";
import { knownAmazonStatementTemplateVersions } from "../lib/amazon-statements/pdf/statement-template-registry";
import type { CandidateCalculationConfig, CandidateFuelSelection, CandidateRevenueSelection } from "../lib/amazon-statements/candidates/candidate-types";
import type { FuelProjectionItem, RevenueProjectionItem } from "../lib/amazon-statements/projection/projection-types";

const parser = { name: "synthetic-parser", version: "test-only" };
const sourceFile = { originalFilename: "synthetic", sha256Hash: "a".repeat(64), sourceType: "amazon_payment" as const };
const schemaSignature = { sourceType: "amazon_payment" as const, signature: "synthetic-schema", parser };

function paymentRow(): PaymentSourceRow {
  return {
    sourceFile,
    sourceSheet: "Payment Details",
    sourceRowNumber: 2,
    rawValues: {},
    normalizedValues: {
      invoiceNumber: "SYNTH",
      blockId: null,
      tripId: "TRIP-1",
      loadId: "LOAD-1",
      startDate: "2026-07-05",
      endDate: "2026-07-05",
      route: "AAA -> BBB",
      operatorType: null,
      equipment: null,
      distanceMiles: 100,
      itemType: "base",
      programType: null,
      baseRate: 1000,
      fuelSurcharge: 0,
      tolls: 0,
      detention: 0,
      tonu: 0,
      others: 0,
      grossPay: 1000,
      comments: null,
      rowClassification: "standalone_load",
    },
    parser,
    schemaSignature,
    parseStatus: "parsed",
    warnings: [],
    blockingIssues: [],
    sourceFingerprint: "p".repeat(64),
  };
}

function tripRow(): TripSourceRow {
  return {
    sourceFile: { ...sourceFile, sourceType: "amazon_trips" },
    sourceSheet: null,
    sourceRowNumber: 2,
    rawValues: {},
    normalizedValues: {
      tripId: "TRIP-1",
      loadId: "LOAD-1",
      driverNameRaw: "Synthetic Driver",
      driverTokens: ["Synthetic Driver"],
      requiresTeamAssignmentRule: false,
      tractorVehicleId: "UNIT-1",
      tripStage: "completed",
      loadExecutionStatus: "completed",
      estimatedDistance: 100,
      equipmentType: "tractor",
      operatorType: "solo",
      soloTeamIndicator: "solo",
      facilitySequence: "AAA-BBB",
      estimatedCost: null,
      stops: [],
    },
    parser,
    schemaSignature: { ...schemaSignature, sourceType: "amazon_trips" },
    parseStatus: "parsed",
    warnings: [],
    blockingIssues: [],
    sourceFingerprint: "t".repeat(64),
  };
}

function candidateConfig(): CandidateCalculationConfig {
  return {
    statementType: "owner_operator",
    periodStart: "2026-07-05",
    periodEnd: "2026-07-11",
    organizationId: "org-synthetic",
    batchId: "batch-synthetic",
    payeeType: "owner",
    payeeId: "owner-synthetic",
    vehicleId: "vehicle-synthetic",
    calculationRuleVersion: "rules-synthetic",
    templateVersion: "amazon-statement-v1",
    companyFeeBasisPoints: 1000,
    fixedAdjustments: [],
  };
}

const revenueSelection: CandidateRevenueSelection = {
  revenueItemId: "revenue-synthetic",
  organizationId: "org-synthetic",
  sourceRevision: "rev-r",
  sourceFingerprint: "r".repeat(64),
  allocatedGrossAmount: 1000,
  projectionStatus: "projected",
  projectedLoad: {
    id: "load-synthetic",
    organizationId: "org-synthetic",
    status: "delivered",
    vehicleId: "vehicle-synthetic",
    deliveryDate: "2026-07-05",
    grossAmount: 1000,
  },
  sourceSnapshot: { synthetic: true },
  displayOrder: 1,
};

const fuelSelection: CandidateFuelSelection = {
  transactionLineId: "fuel-line-synthetic",
  organizationId: "org-synthetic",
  sourceRevision: "rev-f",
  sourceFingerprint: "f".repeat(64),
  transactionDate: "2026-07-06",
  allocatedAmount: 100,
  projectionStatus: "projected",
  deductionLane: "owner",
  projectedExpense: {
    id: "expense-synthetic",
    organizationId: "org-synthetic",
    date: "2026-07-06",
    vehicleId: "vehicle-synthetic",
    category: "fuel",
    amount: 100,
    deductFromSettlement: true,
    deductFromOwner: true,
  },
  sourceSnapshot: { synthetic: true },
  displayOrder: 2,
};

const revenueProjection: RevenueProjectionItem = {
  revenueItemId: revenueSelection.revenueItemId,
  sourceRevision: revenueSelection.sourceRevision,
  sourceFingerprint: revenueSelection.sourceFingerprint ?? "r".repeat(64),
  canonicalItem: {
    id: revenueSelection.revenueItemId,
    invoiceId: "invoice-synthetic",
    groupingType: "load",
    groupingKey: "LOAD-1",
    tripId: "TRIP-1",
    primaryLoadId: "LOAD-1",
    originFacilityCode: "AAA",
    destinationFacilityCode: "BBB",
    routeResolutionStatus: "resolved",
    grossAmount: 1000,
    baseAmount: 1000,
    fuelSurchargeAmount: 0,
    tollAmount: 0,
    detentionAmount: 0,
    tonuAmount: 0,
    otherAmount: 0,
    startDate: "2026-07-05",
    endDate: "2026-07-05",
    distance: 100,
    matchStatus: "exact",
    driverAssignmentStatus: "resolved",
    vehicleAssignmentStatus: "resolved",
    reconciliationStatus: "passed",
    sourceRevision: "rev-r",
    sources: [],
  },
  load: {
    load_number: "LOAD-1",
    load_source: "amazon_relay",
    vehicle_id: "vehicle-synthetic",
    driver_id: null,
    pickup_date: "2026-07-05",
    delivery_date: "2026-07-05",
    pickup_location: null,
    delivery_location: null,
    route: "AAA -> BBB",
    gross_amount: 1000,
    fuel_surcharge: 0,
    loaded_miles: 100,
    empty_miles: 0,
    total_miles: 100,
    status: "pending",
    notes: null,
  },
  projectionSnapshot: { synthetic: true },
  canonicalReady: true,
  projectionReady: true,
  settlementReady: false,
};

const fuelProjection: FuelProjectionItem = {
  transactionLineId: fuelSelection.transactionLineId,
  sourceRevision: fuelSelection.sourceRevision,
  sourceFingerprint: fuelSelection.sourceFingerprint ?? "f".repeat(64),
  group: {
    sourceGroupNumber: 1,
    cardExternalId: "CARD",
    cardLastFour: "0000",
    driverLabelRaw: null,
    driverLabelNormalized: null,
    unitLabelRaw: "UNIT",
    unitLabelNormalized: "UNIT",
    reportedTransactionCount: 1,
    reportedTotalAmount: 100,
    reportedTotalQuantity: 10,
    reportedDiscountAmount: 0,
    isPlaceholderGroup: false,
    sourcePageStart: 1,
    sourcePageEnd: 1,
    sourceSnapshot: {},
    transactions: [],
  },
  transaction: {
    sourceTransactionFingerprint: "f".repeat(64),
    transactionAt: "2026-07-06T12:00:00",
    invoiceNumber: "INV",
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
    quantity: 10,
    retailUnitPrice: 10,
    chargedUnitPrice: 10,
    discountPerUnit: 0,
    discountAmount: 0,
    dealType: null,
    chargedAmount: 100,
    sourceSnapshot: {},
  },
  expense: {
    date: "2026-07-06",
    vehicle_id: "vehicle-synthetic",
    driver_id: null,
    owner_id: null,
    category: "fuel",
    amount: 100,
    deduct_from_settlement: false,
    deduct_from_driver: false,
    deduct_from_owner: false,
    deduct_from_investor: false,
    notes: null,
  },
  projectionSnapshot: { synthetic: true },
  fuelSourceReady: true,
  expenseProjectionReady: true,
  settlementDeductionReady: false,
};

const matching = matchPaymentTrips([paymentRow()], [tripRow()]);
const canonicalRevenue = buildAmazonRevenueItems({
  invoiceId: "invoice-synthetic",
  paymentRows: [paymentRow()],
  matches: matching.matches,
});
const revenueReconciliation = reconcileAmazonRevenue({
  summaryInvoiceTotal: 1000,
  validPaymentRowGrossTotal: 1000,
  parentRowCount: 0,
  childRowCount: 0,
  standaloneRowCount: 1,
  matching,
  revenue: canonicalRevenue,
});
const projection = {
  revenue: previewRevenueLoadProjections({ items: [revenueProjection] }),
  fuel: previewFuelExpenseProjections({ items: [fuelProjection] }),
};
const calculation = compileAmazonStatementCandidate({
  config: candidateConfig(),
  revenueSelections: [revenueSelection],
  fuelSelections: [fuelSelection],
});
const conversion = prepareSettlementConversionPayload({
  candidate: {
    id: "candidate-synthetic",
    organizationId: "org-synthetic",
    status: "ready",
    previewRevision: calculation.previewRevision,
  },
  calculation,
  revenueSelections: [revenueSelection],
  fuelSelections: [fuelSelection],
  expectedPreviewRevision: calculation.previewRevision,
  createdBy: "profile-synthetic",
});
const pdfSnapshot = buildAmazonStatementFixture("owner_operator_reference");
const pdfErrors = validateStatementViewModel(pdfSnapshot, knownAmazonStatementTemplateVersions());

console.log(JSON.stringify({
  databaseWrites: 0,
  privateFixturesUsed: false,
  stages: [
    "synthetic_upload_metadata",
    "parse",
    "normalize",
    "reconcile",
    "match",
    "projection_preview",
    "candidate_compilation",
    "conversion_payload_preparation",
    "pdf_view_model",
  ],
  matching: matching.counts,
  reconciliation: {
    canonicalRevenueItems: canonicalRevenue.items.length,
    canonicalRevenueTotal: revenueReconciliation.canonicalRevenueTotal,
    validPaymentRowGrossTotal: revenueReconciliation.validPaymentRowGrossTotal,
    unassignedRevenueTotal: revenueReconciliation.unassignedRevenueTotal,
    finalStatus: revenueReconciliation.finalStatus,
  },
  projection: {
    revenueToCreate: projection.revenue.toCreate.length,
    fuelToCreate: projection.fuel.toCreate.length,
  },
  candidate: {
    ready: calculation.readiness.ready,
    gross: calculation.grossAmount,
    net: calculation.netAmount,
  },
  conversionPayloadPrepared: conversion.ok,
  pdfViewModelValid: pdfErrors.length === 0,
}, null, 2));
