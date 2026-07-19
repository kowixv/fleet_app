import { describe, expect, it } from "vitest";
import type {
  AmazonParsedSourceRow,
  AmazonPaymentDetailFields,
  AmazonTripsRowFields,
} from "../types";
import { matchPaymentTrips } from "./payment-trip-matcher";
import { buildAmazonRevenueItems } from "../revenue/revenue-builder";
import { revenueReferenceReadiness } from "../resolution/reference-readiness";

function paymentRow(): AmazonParsedSourceRow<AmazonPaymentDetailFields> {
  return {
    sourceFile: { originalFilename: "PAYMENT.xlsx", sha256Hash: "p".repeat(64), sourceType: "amazon_payment" },
    sourceSheet: "Payment Details",
    sourceRowNumber: 2,
    rawValues: {},
    normalizedValues: {
      invoiceNumber: "INV-1",
      blockId: null,
      tripId: "TRIP-1",
      loadId: null,
      startDate: "2026-07-05",
      endDate: "2026-07-06",
      route: null,
      operatorType: null,
      equipment: null,
      distanceMiles: 100,
      itemType: "Trip",
      programType: null,
      baseRate: 900,
      fuelSurcharge: 100,
      tolls: 0,
      detention: 0,
      tonu: 0,
      others: 0,
      grossPay: 1000,
      comments: null,
      rowClassification: "trip_parent",
    },
    parser: { name: "test", version: "1" },
    schemaSignature: { sourceType: "amazon_payment", signature: "test", parser: { name: "test", version: "1" } },
    parseStatus: "parsed",
    warnings: [],
    blockingIssues: [],
    sourceFingerprint: "payment-1",
  };
}

function tripRow(loadId: string, driver: string, fingerprint: string): AmazonParsedSourceRow<AmazonTripsRowFields> {
  return {
    sourceFile: { originalFilename: "Trips.csv", sha256Hash: "t".repeat(64), sourceType: "amazon_trips" },
    sourceSheet: null,
    sourceRowNumber: 2,
    rawValues: {},
    normalizedValues: {
      tripId: "TRIP-1",
      loadId,
      driverNameRaw: driver,
      driverTokens: [driver],
      requiresTeamAssignmentRule: true,
      tractorVehicleId: "UNIT-1",
      tripStage: null,
      loadExecutionStatus: null,
      estimatedDistance: 50,
      equipmentType: null,
      operatorType: null,
      soloTeamIndicator: "TEAM",
      facilitySequence: null,
      estimatedCost: null,
      stops: [],
    },
    parser: { name: "test", version: "1" },
    schemaSignature: { sourceType: "amazon_trips", signature: "test", parser: { name: "test", version: "1" } },
    parseStatus: "warning",
    warnings: ["team_assignment_rule_required"],
    blockingIssues: [],
    sourceFingerprint: fingerprint,
  };
}

describe("single-statement multi-driver policy", () => {
  it("matches one trip across multiple drivers without requiring a pay split", () => {
    const payment = paymentRow();
    const matching = matchPaymentTrips([
      payment,
    ], [
      tripRow("LOAD-1", "Driver One", "trip-1"),
      tripRow("LOAD-2", "Driver Two", "trip-2"),
    ]);

    expect(matching.matches).toHaveLength(1);
    expect(matching.matches[0].status).toBe("exact");
    expect(matching.matches[0].relatedTripRows).toHaveLength(2);
    expect(matching.issues.some((issue) => issue.issueCode === "missing_team_split")).toBe(false);
    expect(matching.issues.some((issue) => issue.issueCode === "conflicting_trip_drivers")).toBe(false);

    const revenue = buildAmazonRevenueItems({
      invoiceId: "invoice-1",
      paymentRows: [payment],
      matches: matching.matches,
    });

    expect(revenue.items).toHaveLength(1);
    expect(revenue.items[0].grossAmount).toBe(1000);
    expect(revenue.items[0].driverAssignmentStatus).toBe("source_only");

    const readiness = revenueReferenceReadiness({
      organizationId: "org-1",
      provider: "amazon",
      item: revenue.items[0],
      facilityMappings: [],
      requireFacilityForDisplay: false,
      driverResolved: true,
      vehicleResolved: true,
      teamSplitResolved: false,
      financialStatus: "passed",
    });

    expect(readiness.teamSplitStatus).toBe("not_required");
    expect(readiness.settlementReady).toBe(true);
    expect(readiness.blockingIssues.some((issue) => issue.issueCode === "missing_team_split")).toBe(false);
  });
});
