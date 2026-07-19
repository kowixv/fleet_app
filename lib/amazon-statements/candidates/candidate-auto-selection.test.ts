import { describe, expect, it } from "vitest";
import {
  autoSelectCandidateSources,
  uniqueOwnedVehicleId,
  type CandidateAutoSelectableSource,
} from "./candidate-auto-selection";

const exactDriverSource: CandidateAutoSelectableSource = {
  sourceId: "revenue-1",
  suggestedPersonIds: ["driver-1"],
  suggestedVehicleIds: ["vehicle-1"],
  autoSelectionStatus: "exact",
  autoSelectionReasons: ["approved_driver_mapping", "approved_vehicle_mapping"],
};

const exactVehicleOnlySource: CandidateAutoSelectableSource = {
  sourceId: "fuel-1",
  suggestedPersonIds: [],
  suggestedVehicleIds: ["vehicle-1"],
  autoSelectionStatus: "exact",
  autoSelectionReasons: ["approved_fuel_assignment"],
};

const ambiguousSource: CandidateAutoSelectableSource = {
  sourceId: "revenue-ambiguous",
  suggestedPersonIds: ["driver-1", "driver-2"],
  suggestedVehicleIds: [],
  autoSelectionStatus: "ambiguous",
  autoSelectionReasons: ["multiple_driver_targets"],
};

describe("candidate source auto-selection", () => {
  it("selects exact driver sources for company driver statements", () => {
    const result = autoSelectCandidateSources({
      statementType: "company_driver",
      payeeId: "driver-1",
      vehicleId: "vehicle-1",
      vehicles: [{ id: "vehicle-1", ownerId: null }],
      sources: [exactDriverSource, exactVehicleOnlySource, ambiguousSource],
    });

    expect(result.selectedSourceIds).toEqual(["revenue-1"]);
    expect(result.exactMatchCount).toBe(1);
    expect(result.reviewRequiredCount).toBe(2);
  });

  it("selects vehicle-attributed revenue and fuel for the vehicle owner", () => {
    const result = autoSelectCandidateSources({
      statementType: "owner_operator",
      payeeId: "owner-1",
      vehicleId: "vehicle-1",
      vehicles: [{ id: "vehicle-1", ownerId: "owner-1" }],
      sources: [exactVehicleOnlySource, exactDriverSource, ambiguousSource],
    });

    expect(result.selectedSourceIds).toEqual(["fuel-1", "revenue-1"]);
    expect(result.reviewRequiredCount).toBe(1);
  });

  it("does not select a source attributed to another selected unit", () => {
    const result = autoSelectCandidateSources({
      statementType: "owner_operator",
      payeeId: "owner-1",
      vehicleId: "vehicle-2",
      vehicles: [
        { id: "vehicle-1", ownerId: "owner-1" },
        { id: "vehicle-2", ownerId: "owner-1" },
      ],
      sources: [exactDriverSource],
    });

    expect(result.selectedSourceIds).toEqual([]);
  });

  it("chooses a unit automatically only when the owner has one unit", () => {
    expect(uniqueOwnedVehicleId({
      statementType: "owner_operator",
      payeeId: "owner-1",
      vehicles: [{ id: "vehicle-1", ownerId: "owner-1" }],
    })).toBe("vehicle-1");

    expect(uniqueOwnedVehicleId({
      statementType: "owner_operator",
      payeeId: "owner-1",
      vehicles: [
        { id: "vehicle-1", ownerId: "owner-1" },
        { id: "vehicle-2", ownerId: "owner-1" },
      ],
    })).toBeNull();
  });
});
