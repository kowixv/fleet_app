import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { amazonReferenceReviewFixtures } from "./ui-fixtures";
import {
  validateFacilityFields,
  validateTeamSplitBasisPoints,
  validateUniqueSelections,
} from "./reference-review-validation";

const root = process.cwd();
const page = read("app/(app)/settlements/amazon-imports/[id]/references/page.tsx");
const detailPage = read("app/(app)/settlements/amazon-imports/[id]/page.tsx");
const component = read("app/(app)/settlements/amazon-imports/components/reference-review-workspace.tsx");
const actions = read("app/(app)/settlements/amazon-imports/actions.ts");
const service = read("lib/amazon-statements/server/reference-review-service.ts");
const referenceService = read("lib/amazon-statements/server/reference-service.ts");

describe("amazon reference review mutation UI", () => {
  it("creates the reference route and links from the read-only batch detail references stage", () => {
    expect(page).toContain("getAmazonReferenceReviewForUi");
    expect(page).toContain("ReferenceReviewWorkspace");
    expect(detailPage).toContain("Open Reference Review");
    expect(detailPage).toContain("/references");
  });

  it("renders one root issue task per grouped reference issue instead of every dependent item", () => {
    expect(service).toContain("groupRootIssues");
    expect(service).toContain("details.rootIssueKey ?? details.issueKey");
    expect(component).toContain("Safe dependency impact preview");
    expect(amazonReferenceReviewFixtures.mixed.tasks.find((task) => task.category === "driver")?.affectedRevenueItems).toBe(8);
  });

  it("supports driver mapping through exact internal person selection without person creation or fuzzy approval", () => {
    expect(component).toContain("Select existing person");
    expect(actions).toContain("approveExternalDriverMapping");
    expect(actions).toContain("Select one internal person");
    expect(actions).toContain("assertKnownReferenceTarget");
    expect(service).not.toMatch(/from\(\"people\"\)\.insert|from\(\"vehicles\"\)\.insert/);
    expect(component).not.toMatch(/fuzzy|auto-approve|defaultValue=\{review\.options\.people\[0\]/i);
  });

  it("supports vehicle alias mapping, archives as history, and keeps resolution priority server-side", () => {
    expect(component).toContain("Select existing vehicle");
    expect(actions).toContain("approveVehicleAliasMapping");
    expect(component).toContain("Archive Rule");
    expect(referenceService).toContain("archiveVehicleAliasMapping");
    expect(read("lib/amazon-statements/resolution/vehicle-resolver.ts")).toContain("exact_amazon_tractor_vehicle_id");
    expect(component).not.toContain("driver-only vehicle selection");
  });

  it("requires manual facility verification fields and never guesses city or state", () => {
    expect(validateFacilityFields({ city: "", state: "", countryCode: "US" }).ok).toBe(false);
    expect(validateFacilityFields({ city: "City", state: "CA", countryCode: "US" }).ok).toBe(true);
    expect(component).toContain("Verification source");
    expect(actions).toContain("verifyFacilityMapping");
    expect(component).not.toMatch(/geocode|guess/i);
  });

  it("supports fuel card assignment with masked display, vehicle or driver targets, placeholder skip, and financial blocking", () => {
    expect(referenceService).toContain("fuel_card_assignments");
    expect(referenceService).toContain("vehicle_id: args.input.vehicleId || null");
    expect(referenceService).toContain("driver_id: args.input.driverId || null");
    expect(component).toContain("Driver label alone never approves a financial assignment automatically");
    expect(component).toContain("Placeholder fuel group");
    expect(component).toContain("Fuel financial reconciliation failure blocks approval");
    expect(amazonReferenceReviewFixtures.mixed.tasks.some((task) => task.placeholder)).toBe(true);
    expect(JSON.stringify(amazonReferenceReviewFixtures)).not.toMatch(/card_external_id|411111|invoice|storage_path|sha256/i);
  });

  it("enforces explicit team split basis points with no default 50/50", () => {
    expect(validateTeamSplitBasisPoints([5000, 4999])).toContain("10000");
    expect(validateTeamSplitBasisPoints([5000, 5000])).toBeNull();
    expect(validateTeamSplitBasisPoints([0, 10000])).toContain("greater than zero");
    expect(validateUniqueSelections(["person-1", "person-1"])).toContain("Duplicate");
    expect(component).toContain("Remaining basis points");
    expect(component).not.toContain("defaultValue=\"5000\"");
  });

  it("shows impact preview without claiming financial amount changes and marks resolved issues instead of deleting history", () => {
    expect(component).toContain("Financial amount changes");
    expect(component).toContain("None claimed");
    expect(actions).toContain("resolveOpenIssuesForTask");
    expect(service).toContain(".update({ status: \"resolved\"");
    expect(service).not.toMatch(/delete\(\)/);
  });

  it("shows safe review history without raw previous or selected JSON", () => {
    expect(component).toContain("Review decision history");
    expect(component).toContain("Raw previous and selected JSON values are reduced");
    expect(service).toContain("safeHistorySummary");
    expect(component).not.toContain("previous_value");
    expect(component).not.toContain("selected_value");
    expect(amazonReferenceReviewFixtures.mixed.history.some((item) => item.status === "rejected")).toBe(true);
  });

  it("handles role, archived, stale-source, and simultaneous-resolution conflicts through server checks", () => {
    expect(page).toContain("Viewer access can inspect");
    expect(page).toContain("This batch is archived");
    expect(actions).toContain("This batch is archived and cannot be changed");
    expect(actions).toContain("The source revision changed");
    expect(service).toContain("Reference task is no longer available. Refresh and try again.");
  });

  it("does not accept client-controlled organization, batch status, raw issue keys, or unrestricted source objects", () => {
    expect(actions).not.toContain("organizationId?:");
    expect(actions).not.toContain("organization_id?:");
    expect(actions).not.toContain("status?:");
    expect(component).not.toContain("issueKey");
    expect(component).not.toContain("rootIssueKey");
    expect(component).not.toMatch(/source_snapshot|raw_data|raw PDF|raw spreadsheet|storage_path|signedUrl|sha256/i);
  });

  it("keeps client components free of parser, PDF, and database imports", () => {
    for (const source of clientComponentSources()) {
      const imports = source.split("\n").filter((line) => line.startsWith("import ")).join("\n");
      expect(imports).not.toMatch(/from ["']xlsx["']|from ["']read-excel-file|from ["']unpdf["']|from ["']canvas["']|from ["']@napi-rs\/canvas["']|from ["']node:crypto["']|from ["']node:fs["']|amazon-statements\/parsers\/payment-xlsx|amazon-statements\/parsers\/parser-registry|amazon-statements\/server|createClient|createServiceClient/);
    }
  });

  it("uses keyboard-operable tabs, labels, aria-live feedback, and mobile-friendly layouts", () => {
    expect(component).toContain('role="tablist"');
    expect(component).toContain('role="tab"');
    expect(component).toContain("aria-live");
    expect(component).toContain("htmlFor");
    expect(component).toContain("md:grid");
    expect(component).toContain("overflow-x-auto");
  });
});

function read(path: string) {
  return readFileSync(join(root, path), "utf8");
}

function clientComponentSources() {
  return componentFiles(join(root, "app/(app)/settlements/amazon-imports/components"))
    .map((file) => readFileSync(file, "utf8"))
    .filter((source) => source.startsWith('"use client";'));
}

function componentFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? componentFiles(path) : path.endsWith(".tsx") ? [path] : [];
  });
}
