import { describe, expect, it } from "vitest";
import {
  calculateBudgetPerformance,
  calculateOperationalImpact,
  canTransitionWarrantyClaim,
  committedWorkOrderCost,
  evaluateRepairReplace,
  parseMaintenanceBudgetForm,
  parseWarrantyClaimForm,
} from "./maintenance-decision-support";

function form(values: Record<string, string>) {
  const data = new FormData();
  Object.entries(values).forEach(([key, value]) => data.set(key, value));
  return data;
}

describe("maintenance budget and committed cost", () => {
  it("calculates actual, committed, forecast, variance and percentage used", () => {
    expect(calculateBudgetPerformance({
      budget: 120_000,
      actual: 40_000,
      committed: 10_000,
      elapsedFraction: 0.5,
    })).toEqual({
      budget: 120_000,
      actual: 40_000,
      committed: 10_000,
      forecast: 90_000,
      variance: 30_000,
      percentageUsed: 50_000 / 120_000,
    });
  });

  it("includes only approved open work orders in committed cost", () => {
    expect(committedWorkOrderCost({ status: "in_repair", approval_state: "approved", approved_cost_limit: 3200, estimated_cost: 3000 })).toBe(3200);
    expect(committedWorkOrderCost({ status: "closed", approval_state: "approved", approved_cost_limit: 3200, estimated_cost: 3000 })).toBe(0);
    expect(committedWorkOrderCost({ status: "awaiting_approval", approval_state: "pending", approved_cost_limit: null, estimated_cost: 3000 })).toBe(0);
  });

  it("validates scope-specific budget dimensions", () => {
    expect(parseMaintenanceBudgetForm(form({ fiscal_year: "2026", scope: "monthly_org", month: "7", budget_amount: "12,500" }))).toMatchObject({ month: 7, budget_amount: 12500 });
    expect(() => parseMaintenanceBudgetForm(form({ fiscal_year: "2026", scope: "monthly_org", budget_amount: "1" }))).toThrow(/ay gerekli/);
  });
});

describe("warranty lifecycle", () => {
  it("allows explicit lifecycle edges only", () => {
    expect(canTransitionWarrantyClaim("draft", "submitted")).toBe(true);
    expect(canTransitionWarrantyClaim("submitted", "paid")).toBe(false);
    expect(canTransitionWarrantyClaim("partially_approved", "paid")).toBe(true);
    expect(canTransitionWarrantyClaim("closed", "draft")).toBe(false);
  });

  it("validates linked records and amount ordering", () => {
    expect(parseWarrantyClaimForm(form({
      work_order_id: "6f72e322-7138-44cc-8b12-a9188f27379e",
      vehicle_id: "f0bec21a-3be9-4914-a9f9-12c07d65f00d",
      vendor_manufacturer: "Detroit",
      submitted_amount: "1200",
      approved_amount: "900",
      received_amount: "900",
    }))).toMatchObject({ vendor_manufacturer: "Detroit", submitted_amount: 1200, approved_amount: 900 });
    expect(() => parseWarrantyClaimForm(form({
      work_order_id: "6f72e322-7138-44cc-8b12-a9188f27379e",
      vehicle_id: "f0bec21a-3be9-4914-a9f9-12c07d65f00d",
      vendor_manufacturer: "Detroit",
      submitted_amount: "100",
      approved_amount: "200",
    }))).toThrow(/aşamaz/);
  });
});

describe("decision support and downtime impact", () => {
  it("keeps all operational impact dimensions separate", () => {
    expect(calculateOperationalImpact({
      directMaintenanceCost: 5000,
      hotelTravelCost: 500,
      towingRoadServiceCost: 750,
      downtimeDays: 4,
      averageDailyContribution: 600,
    })).toEqual({
      directMaintenanceCost: 5000,
      travelHotelImpact: 500,
      towingRoadServiceImpact: 750,
      estimatedLostContribution: 2400,
      totalEstimatedOperationalImpact: 8650,
    });
  });

  it("labels repair-vs-replace output as an advisory driven by configurable thresholds", () => {
    expect(evaluateRepairReplace({
      maintenanceCost12m: 35_000,
      cpm12m: 0.42,
      downtimeDays12m: 12,
      vehicleAgeYears: 5,
      repeatRepairs12m: 3,
      openEstimatedRepairs: 8_000,
    }, {
      cost12m: 30_000,
      cpm: 0.35,
      downtimeDays12m: 30,
      vehicleAgeYears: 8,
    })).toEqual({ triggeredSignals: 2, advisory: "replacement_review" });
  });
});
