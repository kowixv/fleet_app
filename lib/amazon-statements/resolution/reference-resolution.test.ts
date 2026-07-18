import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AmazonRevenueItem } from "../revenue/revenue-builder";
import type { FuelCardGroup } from "../fuel/fuel-normalization";
import type { FuelReportReconciliation } from "../fuel/fuel-reconciliation";
import { resolveDriverIdentifier } from "./driver-resolver";
import { resolveFacility } from "./facility-resolver";
import { fuelReferenceReadiness, revenueReferenceReadiness } from "./reference-readiness";
import { collectReferenceIssueModel, collectReferenceIssues, countReferenceIssues } from "./resolution-issues";
import { deterministicTeamKey, normalizeReferenceValue, referenceRootIssueKey, type ReferenceDependency, type ReferenceRootIssue } from "./resolution-types";
import { resolveTeamSplit, teamKeyFromDriverTokens } from "./team-split-resolver";
import { resolveVehicleIdentifier } from "./vehicle-resolver";

const migration = readFileSync("supabase/migrations/20260716040000_amazon_reference_resolution.sql", "utf8");
const schema = readFileSync("supabase/schema.sql", "utf8");
const schemaReferenceStart = schema.indexOf("-- Amazon reference resolution foundation.");
const schemaReferenceEnd = schema.indexOf("-- Amazon controlled projection links.");
const schemaReferenceBlock = schema.slice(schemaReferenceStart, schemaReferenceEnd);

function revenueItem(patch: Partial<AmazonRevenueItem> = {}): AmazonRevenueItem {
  return {
    id: "revenue-1",
    invoiceId: "invoice-1",
    groupingType: "load",
    groupingKey: "group-1",
    tripId: "trip-1",
    primaryLoadId: "load-1",
    startDate: "2026-07-05",
    endDate: "2026-07-05",
    originFacilityCode: "HOU6",
    destinationFacilityCode: "DAL2",
    routeResolutionStatus: "unresolved",
    distance: 250,
    baseAmount: 1000,
    fuelSurchargeAmount: 50,
    tollAmount: 0,
    detentionAmount: 0,
    tonuAmount: 0,
    otherAmount: 0,
    grossAmount: 1050,
    matchStatus: "exact",
    driverAssignmentStatus: "source_only",
    vehicleAssignmentStatus: "source_only",
    reconciliationStatus: "passed",
    sourceRevision: "rev-1",
    sources: [],
    ...patch,
  };
}

function fuelGroup(patch: Partial<FuelCardGroup> = {}): FuelCardGroup {
  return {
    sourceGroupNumber: 1,
    cardExternalId: "CARD-1",
    cardLastFour: "0001",
    driverLabelRaw: "Driver One",
    driverLabelNormalized: "DRIVER ONE",
    unitLabelRaw: "1501",
    unitLabelNormalized: "1501",
    reportedTransactionCount: 1,
    reportedTotalAmount: 10,
    reportedTotalQuantity: 2,
    reportedDiscountAmount: 1,
    isPlaceholderGroup: false,
    sourcePageStart: 1,
    sourcePageEnd: 1,
    sourceSnapshot: {},
    transactions: [],
    ...patch,
  };
}

function fuelReconciliation(patch: Partial<FuelReportReconciliation> = {}): FuelReportReconciliation {
  return {
    reportedTransactionCount: 1,
    parsedRealTransactionCount: 1,
    parsedProductLineCount: 1,
    reportedTotalAmount: 10,
    calculatedChargedAmount: 10,
    unresolvedFinancialAmount: 0,
    reportedQuantity: 2,
    calculatedQuantity: 2,
    reportedDiscount: 1,
    calculatedDiscount: 1,
    placeholderGroupCount: 0,
    groupMismatchCount: 0,
    blockingIssueCount: 0,
    warningIssueCount: 0,
    status: "passed",
    financialStatus: "passed",
    transactionCountStatus: "passed",
    quantityStatus: "passed",
    discountStatus: "passed",
    transactionResults: [],
    groupResults: [],
    issues: [],
    ...patch,
  };
}

describe("amazon reference resolvers", () => {
  it("does not warn for valid facility codes until final route display needs verified city/state", () => {
    const deferred = resolveFacility({
      organizationId: "org-1",
      provider: "amazon",
      facilityCode: "HOU6",
      serviceDate: "2026-07-05",
      mappings: [],
      requireVerifiedForDisplay: false,
    });
    expect(deferred.status).toBe("unmatched");
    expect(deferred.issues).toEqual([
      expect.objectContaining({ issueCode: "unresolved_facility", severity: "warning" }),
    ]);

    const finalDisplay = resolveFacility({
      organizationId: "org-1",
      provider: "amazon",
      facilityCode: "HOU6",
      serviceDate: "2026-07-05",
      mappings: [],
      requireVerifiedForDisplay: true,
    });
    expect(finalDisplay.issues).toEqual([
      expect.objectContaining({ issueCode: "unresolved_facility", severity: "blocking" }),
    ]);
  });

  it("resolves verified facility mappings by organization, provider, code, and active range", () => {
    const resolved = resolveFacility({
      organizationId: "org-1",
      provider: "amazon",
      facilityCode: " hou6 ",
      serviceDate: "2026-07-05",
      mappings: [{
        id: "facility-1",
        organizationId: "org-1",
        provider: "amazon",
        facilityCode: "HOU6",
        normalizedFacilityCode: "HOU6",
        city: "Houston",
        state: "TX",
        effectiveFrom: "2026-01-01",
        effectiveTo: null,
        verificationStatus: "manually_verified",
      }],
      requireVerifiedForDisplay: true,
    });
    expect(resolved.status).toBe("resolved");
    expect(resolved.value).toEqual({ facilityCode: "HOU6", city: "Houston", state: "TX" });
    expect(resolved.issues).toEqual([]);
  });

  it("resolves approved driver identifiers and keeps proposed mappings as warnings", () => {
    const approved = resolveDriverIdentifier({
      organizationId: "org-1",
      provider: "amazon",
      identifierType: "driver_display_name",
      externalValue: "Driver One",
      serviceDate: "2026-07-05",
      mappings: [{
        id: "driver-map-1",
        organizationId: "org-1",
        provider: "amazon",
        identifierType: "driver_display_name",
        externalValue: "Driver One",
        normalizedValue: "DRIVER ONE",
        personId: "person-1",
        effectiveFrom: "2026-01-01",
        effectiveTo: null,
        status: "approved",
        confidenceScore: 1,
      }],
    });
    expect(approved.status).toBe("resolved");

    const proposed = resolveDriverIdentifier({
      organizationId: "org-1",
      provider: "amazon",
      identifierType: "driver_display_name",
      externalValue: "Driver Two",
      serviceDate: "2026-07-05",
      mappings: [{
        id: "driver-map-2",
        organizationId: "org-1",
        provider: "amazon",
        identifierType: "driver_display_name",
        externalValue: "Driver Two",
        normalizedValue: "DRIVER TWO",
        personId: "person-2",
        effectiveFrom: "2026-01-01",
        effectiveTo: null,
        status: "proposed",
        confidenceScore: 0.5,
      }],
    });
    expect(proposed.status).toBe("proposed");
    expect(proposed.issues).toEqual([
      expect.objectContaining({ issueCode: "unresolved_driver_identifier", severity: "warning" }),
    ]);
  });

  it("uses vehicle identifier priority before fuel card assignment fallback", () => {
    const resolved = resolveVehicleIdentifier({
      organizationId: "org-1",
      serviceDate: "2026-07-05",
      amazonTractorId: "tractor-1501",
      approvedFuelCardAssignment: {
        id: "assignment-1",
        organizationId: "org-1",
        fuelCardId: "card-1",
        vehicleId: "vehicle-from-card",
        driverId: null,
        status: "approved",
        effectiveFrom: "2026-01-01",
        effectiveTo: null,
      },
      mappings: [{
        id: "vehicle-map-1",
        organizationId: "org-1",
        provider: "amazon",
        identifierType: "tractor_vehicle_id",
        externalValue: "tractor-1501",
        normalizedValue: "TRACTOR-1501",
        vehicleId: "vehicle-from-tractor",
        effectiveFrom: "2026-01-01",
        effectiveTo: null,
      }],
    });
    expect(resolved.value).toEqual({ vehicleId: "vehicle-from-tractor" });
    expect(resolved.method).toBe("exact_amazon_tractor_vehicle_id");
  });

  it("requires explicit approved team split rules for multi-driver revenue", () => {
    const tokens = ["Driver One", "Driver Two"];
    const unresolved = resolveTeamSplit({
      organizationId: "org-1",
      provider: "amazon",
      driverTokens: tokens,
      driverResolutions: [
        { status: "resolved", method: "test", confidence: 1, value: { personId: "person-1" }, sourceMappingId: "m1", issues: [] },
        { status: "resolved", method: "test", confidence: 1, value: { personId: "person-2" }, sourceMappingId: "m2", issues: [] },
      ],
      serviceDate: "2026-07-05",
      rules: [],
      members: [],
    });
    expect(unresolved.issues).toContainEqual(expect.objectContaining({ issueCode: "missing_team_split", severity: "blocking" }));

    const teamKey = teamKeyFromDriverTokens(tokens);
    const resolved = resolveTeamSplit({
      organizationId: "org-1",
      provider: "amazon",
      driverTokens: tokens,
      driverResolutions: [
        { status: "resolved", method: "test", confidence: 1, value: { personId: "person-1" }, sourceMappingId: "m1", issues: [] },
        { status: "resolved", method: "test", confidence: 1, value: { personId: "person-2" }, sourceMappingId: "m2", issues: [] },
      ],
      serviceDate: "2026-07-05",
      rules: [{
        id: "team-rule-1",
        organizationId: "org-1",
        provider: "amazon",
        teamKey,
        effectiveFrom: "2026-01-01",
        effectiveTo: null,
        status: "approved",
      }],
      members: [
        { id: "member-1", organizationId: "org-1", teamSplitRuleId: "team-rule-1", personId: "person-1", memberOrder: 1, splitBasisPoints: 5000 },
        { id: "member-2", organizationId: "org-1", teamSplitRuleId: "team-rule-1", personId: "person-2", memberOrder: 2, splitBasisPoints: 5000 },
      ],
    });
    expect(resolved.status).toBe("resolved");
    expect(resolved.value?.allocations.map((member) => member.splitBasisPoints)).toEqual([5000, 5000]);
  });

  it("keeps fuel placeholders out of required financial assignment while requiring real groups", () => {
    const placeholder = fuelReferenceReadiness({
      group: fuelGroup({ cardExternalId: null, isPlaceholderGroup: true, reportedTotalAmount: 0 }),
      reconciliation: fuelReconciliation(),
      matchingContext: { organizationId: "org-1", cardAssignments: [], knownCards: [], unitAliases: [], driverLabels: [] },
    });
    expect(placeholder.projectionReady).toBe(false);
    expect(placeholder.blockingIssues).toEqual([]);
    expect(placeholder.warnings).toContainEqual(expect.objectContaining({ issueCode: "placeholder_group", severity: "warning" }));

    const unresolved = fuelReferenceReadiness({
      group: fuelGroup(),
      reconciliation: fuelReconciliation(),
      matchingContext: { organizationId: "org-1", cardAssignments: [], knownCards: [], unitAliases: [], driverLabels: [] },
    });
    expect(unresolved.blockingIssues).toContainEqual(expect.objectContaining({ issueCode: "unmatched_fuel_assignment", severity: "blocking" }));
  });

  it("aggregates reference warning and blocking categories without changing financial totals", () => {
    const item = revenueItem({ grossAmount: 30665.09, driverAssignmentStatus: "needs_team_split" });
    const readiness = revenueReferenceReadiness({
      organizationId: "org-1",
      provider: "amazon",
      item,
      facilityMappings: [],
      requireFacilityForDisplay: true,
      driverResolved: false,
      vehicleResolved: false,
      teamSplitResolved: false,
      financialStatus: "passed",
    });
    const counts = countReferenceIssues(collectReferenceIssues([readiness]));
    expect(counts.blocking).toBe(5);
    expect(counts.byCode).toMatchObject({
      unresolved_facility: 2,
      unresolved_driver_identifier: 1,
      unresolved_vehicle_identifier: 1,
      missing_team_split: 1,
    });
    expect(item.grossAmount).toBe(30665.09);
  });

  it("deduplicates one driver blocker shared by multiple revenue items while preserving dependencies", () => {
    const issueKey = referenceRootIssueKey("driver", { organizationId: "org-1", provider: "amazon", normalizedIdentifier: "DRIVER ONE" });
    const collection = collectReferenceIssueModel({
      rootIssues: [
        rootIssue(issueKey, "driver", "unresolved_driver_identifier"),
        rootIssue(issueKey, "driver", "unresolved_driver_identifier"),
      ],
      dependencies: [
        dependency("revenue-item:1", "revenue-1", ["settlement"], [issueKey]),
        dependency("revenue-item:2", "revenue-2", ["settlement"], [issueKey]),
      ],
    });
    expect(collection.counts.uniqueBlocking).toBe(1);
    expect(collection.counts.byCategory.driver).toBe(1);
    expect(collection.counts.dependencyCount).toBe(2);
  });

  it("deduplicates vehicle, facility, and team blockers independently", () => {
    const vehicleKey = referenceRootIssueKey("vehicle", { organizationId: "org-1", provider: "amazon", identifierType: "tractor_vehicle_id", normalizedValue: "TRACTOR 1" });
    const facilityKey = referenceRootIssueKey("facility", { organizationId: "org-1", provider: "amazon", normalizedCode: "FAC1" });
    const teamKey = referenceRootIssueKey("team_split", { organizationId: "org-1", teamKey: deterministicTeamKey(["Driver One", "Driver Two"]) });
    const collection = collectReferenceIssueModel({
      rootIssues: [
        rootIssue(vehicleKey, "vehicle", "unresolved_vehicle_identifier"),
        rootIssue(vehicleKey, "vehicle", "unresolved_vehicle_identifier"),
        rootIssue(facilityKey, "facility", "unresolved_facility"),
        rootIssue(facilityKey, "facility", "unresolved_facility"),
        rootIssue(teamKey, "team_split", "missing_team_split"),
        rootIssue(teamKey, "team_split", "missing_team_split"),
      ],
      dependencies: [
        dependency("revenue-item:1", "revenue-1", ["settlement", "statement_display"], [vehicleKey, facilityKey, teamKey]),
        dependency("revenue-item:2", "revenue-2", ["settlement", "statement_display"], [vehicleKey, facilityKey]),
      ],
    });
    expect(collection.counts.uniqueBlocking).toBe(3);
    expect(collection.counts.byCategory).toMatchObject({ vehicle: 1, facility: 1, team_split: 1 });
    expect(collection.counts.dependencyCount).toBe(5);
  });

  it("deduplicates one fuel assignment blocker shared across reruns", () => {
    const issueKey = referenceRootIssueKey("fuel_assignment", { organizationId: "org-1", provider: "octane", groupIdentity: "CARD 1" });
    const collection = collectReferenceIssueModel({
      rootIssues: [
        rootIssue(issueKey, "fuel_assignment", "unmatched_fuel_assignment"),
        rootIssue(issueKey, "fuel_assignment", "unmatched_fuel_assignment"),
      ],
      dependencies: [
        fuelDependency("fuel-group:1", [issueKey]),
        fuelDependency("fuel-group:1", [issueKey]),
      ],
    });
    expect(collection.counts.uniqueBlocking).toBe(1);
    expect(collection.counts.byCategory.fuel_assignment).toBe(1);
    expect(collection.dependencies).toHaveLength(1);
  });

  it("creates deterministic organization-scoped hashed issue keys without private values", () => {
    const rawDriver = "Private Driver Name";
    const rawFacility = "FAC-PRIVATE";
    const rawVehicle = "TRUCK-PRIVATE";
    const driverKey = referenceRootIssueKey("driver", { organizationId: "org-1", provider: "amazon", normalizedIdentifier: normalizeReferenceValue(rawDriver) });
    const sameDriverKey = referenceRootIssueKey("driver", { organizationId: "org-1", provider: "amazon", normalizedIdentifier: normalizeReferenceValue(rawDriver) });
    const otherOrgDriverKey = referenceRootIssueKey("driver", { organizationId: "org-2", provider: "amazon", normalizedIdentifier: normalizeReferenceValue(rawDriver) });
    const facilityKey = referenceRootIssueKey("facility", { organizationId: "org-1", provider: "amazon", normalizedCode: normalizeReferenceValue(rawFacility) });
    const vehicleKey = referenceRootIssueKey("vehicle", { organizationId: "org-1", provider: "amazon", identifierType: "tractor_vehicle_id", normalizedValue: normalizeReferenceValue(rawVehicle) });
    expect(driverKey).toBe(sameDriverKey);
    expect(driverKey).not.toBe(otherOrgDriverKey);
    for (const key of [driverKey, facilityKey, vehicleKey]) {
      expect(key).not.toContain(rawDriver.toUpperCase());
      expect(key).not.toContain(rawFacility);
      expect(key).not.toContain(rawVehicle);
      expect(key).toMatch(/:[a-f0-9]{24}$/);
    }
  });

  it("does not create generic readiness blockers when specific root issues explain failure", () => {
    const readiness = revenueReferenceReadiness({
      organizationId: "org-1",
      provider: "amazon",
      item: revenueItem({ originFacilityCode: null, destinationFacilityCode: null }),
      facilityMappings: [],
      requireFacilityForDisplay: false,
      driverResolved: false,
      vehicleResolved: false,
      teamSplitResolved: true,
      financialStatus: "passed",
    });
    expect(readiness.blockingIssues.map((issue) => issue.issueCode)).toEqual([
      "unresolved_driver_identifier",
      "unresolved_vehicle_identifier",
    ]);
    expect(readiness.blockingIssues.map((issue) => issue.issueCode)).not.toContain("projection_not_ready");
    expect(readiness.blockingIssues.map((issue) => issue.issueCode)).not.toContain("reference_not_ready");
  });

  it("can be canonical and projection ready while statement display is blocked by facility mapping", () => {
    const readiness = revenueReferenceReadiness({
      organizationId: "org-1",
      provider: "amazon",
      item: revenueItem(),
      facilityMappings: [],
      requireFacilityForDisplay: true,
      driverResolved: true,
      vehicleResolved: true,
      teamSplitResolved: true,
      financialStatus: "passed",
    });
    expect(readiness.canonicalReady).toBe(true);
    expect(readiness.projectionReady).toBe(true);
    expect(readiness.settlementReady).toBe(true);
    expect(readiness.statementDisplayReady).toBe(false);
    expect(readiness.blockedBy.statement_display).toHaveLength(2);
  });

  it("can be projection ready while settlement team split is unresolved", () => {
    const readiness = revenueReferenceReadiness({
      organizationId: "org-1",
      provider: "amazon",
      item: revenueItem({ driverAssignmentStatus: "needs_team_split", originFacilityCode: null, destinationFacilityCode: null }),
      facilityMappings: [],
      requireFacilityForDisplay: false,
      driverResolved: true,
      vehicleResolved: true,
      teamSplitResolved: false,
      financialStatus: "passed",
    });
    expect(readiness.projectionReady).toBe(true);
    expect(readiness.settlementReady).toBe(false);
    expect(readiness.blockingIssues).toContainEqual(expect.objectContaining({ issueCode: "missing_team_split" }));
  });

  it("keeps fuel source and expense projection ready when only deduction assignment is unresolved", () => {
    const readiness = fuelReferenceReadiness({
      group: fuelGroup(),
      reconciliation: fuelReconciliation({ transactionCountStatus: "warning", status: "warning", warningIssueCount: 1 }),
      matchingContext: { organizationId: "org-1", cardAssignments: [], knownCards: [], unitAliases: [], driverLabels: [] },
    });
    expect(readiness.fuelSourceReady).toBe(true);
    expect(readiness.expenseProjectionReady).toBe(true);
    expect(readiness.settlementDeductionReady).toBe(false);
    expect(readiness.blockingIssues).toContainEqual(expect.objectContaining({ issueCode: "unmatched_fuel_assignment" }));
  });

  it("shows resolving one root issue unblocks all dependent items when dependencies are recomputed", () => {
    const issueKey = referenceRootIssueKey("facility", { organizationId: "org-1", provider: "amazon", normalizedCode: "FAC1" });
    const before = collectReferenceIssueModel({
      rootIssues: [rootIssue(issueKey, "facility", "unresolved_facility")],
      dependencies: [
        dependency("revenue-item:1", "revenue-1", ["statement_display"], [issueKey]),
        dependency("revenue-item:2", "revenue-2", ["statement_display"], [issueKey]),
      ],
    });
    const after = collectReferenceIssueModel({ rootIssues: [], dependencies: [] });
    expect(before.counts.uniqueBlocking).toBe(1);
    expect(before.counts.dependencyCount).toBe(2);
    expect(after.counts.uniqueBlocking).toBe(0);
    expect(after.counts.dependencyCount).toBe(0);
  });

  it("derives deterministic team keys independent of input order", () => {
    expect(deterministicTeamKey(["Driver Two", "Driver One"])).toBe(deterministicTeamKey(["driver one", "driver two"]));
    expect(deterministicTeamKey(["Driver One"])).toMatch(/^team_[a-f0-9]{24}$/);
  });
});

function rootIssue(issueKey: string, category: ReferenceRootIssue["category"], issueCode: string): ReferenceRootIssue {
  return { issueKey, category, issueCode, severity: "blocking", message: issueCode, details: {} };
}

function dependency(
  dependencyKey: string,
  itemId: string,
  blockedLevels: ReferenceDependency["blockedLevels"],
  rootIssueKeys: string[],
): ReferenceDependency {
  return { dependencyKey, itemType: "revenue_item", itemId, blockedLevels, rootIssueKeys, sourceReferences: [{ sourceFingerprint: itemId }] };
}

function fuelDependency(dependencyKey: string, rootIssueKeys: string[]): ReferenceDependency {
  return { dependencyKey, itemType: "fuel_group", itemId: dependencyKey, blockedLevels: ["settlement_deduction"], rootIssueKeys, sourceReferences: [{ sourceGroupNumber: 1 }] };
}

describe("amazon reference resolution SQL contracts", () => {
  it("creates only the approved reference tables", () => {
    for (const source of [migration, schemaReferenceBlock]) {
      for (const table of [
        "amazon_facility_locations",
        "amazon_external_driver_identifiers",
        "amazon_team_split_rules",
        "amazon_team_split_rule_members",
      ]) {
        expect(source).toContain(`create table if not exists public.${table}`);
      }
      expect(source).not.toContain("create table if not exists public.amazon_reference_load_projection");
      expect(source).not.toContain("create table if not exists public.amazon_statement_candidates");
    }
  });

  it("keeps projection and settlement lanes untouched", () => {
    for (const source of [migration, schemaReferenceBlock]) {
      expect(source).not.toContain("references public.settlements");
      expect(source).not.toContain("settlement_id");
      expect(source).not.toContain("references public.loads");
      expect(source).not.toContain("references public.expenses");
    }
  });

  it("uses existing vehicle, fuel card, review decision, people, and RLS foundations", () => {
    for (const source of [migration, schema]) {
      expect(source).toContain("people_org_id_id_key");
      expect(source).toContain("vehicles_org_id_id_key");
      expect(source).toContain("references public.people (organization_id, id)");
      expect(source).toContain("references public.profiles (organization_id, id)");
      expect(source).toContain("guard_amazon_import_organization_id");
      expect(source).toContain("alter table public.%I enable row level security");
      expect(source).toContain("for select to authenticated using (organization_id = (select public.current_org_id()))");
      expect(source).toContain("for insert to authenticated with check (organization_id = (select public.current_org_id()) and (select public.is_org_writer()))");
    }
  });

  it("prevents overlapping approved mappings by external reference", () => {
    for (const source of [migration, schema]) {
      expect(source).toContain("amazon_facility_locations_no_verified_overlap");
      expect(source).toContain("amazon_external_driver_identifiers_no_approved_overlap");
      expect(source).toContain("amazon_team_split_rules_no_approved_overlap");
      expect(source).toContain("daterange(effective_from, coalesce(effective_to, 'infinity'::date), '[)') with &&");
      expect(source).toContain("where (verification_status in ('manually_verified','imported_verified'))");
      expect(source).toContain("where (status = 'approved')");
    }
  });

  it("enforces team split basis-point contracts", () => {
    for (const source of [migration, schema]) {
      expect(source).toContain("split_basis_points int not null check (split_basis_points > 0 and split_basis_points <= 10000)");
      expect(source).toContain("amazon_team_split_rule_members_person_key unique");
      expect(source).toContain("amazon_team_split_rule_members_order_key unique");
      expect(source).toContain("guard_amazon_team_split_rule_members_total");
      expect(source).toContain("Approved Amazon team split members must sum to 10000 basis points.");
      expect(source).toContain("create constraint trigger amazon_team_split_rule_members_total_guard");
      expect(source).toContain("create constraint trigger amazon_team_split_rules_total_guard");
    }
  });

  it("exposes reference tables through explicit grants while retaining RLS", () => {
    for (const source of [migration, schema]) {
      expect(source).toContain("grant select, insert, update, delete on table");
      expect(source).toContain("to authenticated, service_role");
      expect(source).not.toMatch(/create policy .* on public\.amazon_.* for all/i);
    }
  });
});
