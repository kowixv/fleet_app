import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AMAZON_IMPORT_BATCH_STATUSES,
  AMAZON_IMPORT_ISSUE_SEVERITIES,
  type AmazonExternalVehicleIdentifier,
} from "./types";
import {
  effectiveDateRangesOverlap,
  effectiveDateRangeIsValid,
  externalVehicleIdentifierHasNormalizedValue,
  isAllowedAmazonBatchStatus,
  isAllowedAmazonIssueSeverity,
  isActiveAmazonImportFileStatus,
  normalizeExternalVehicleIdentifier,
  potentialExternalVehicleIdentifierConflict,
} from "./contracts";

const migration = readFileSync("supabase/migrations/20260716010000_amazon_import_core.sql", "utf8").replace(/\r\n/g, "\n");
const schema = readFileSync("supabase/schema.sql", "utf8").replace(/\r\n/g, "\n");
const contracts = readFileSync("lib/amazon-statements/contracts.ts", "utf8");
const types = readFileSync("lib/amazon-statements/types.ts", "utf8");

function countOccurrences(value: string, needle: string): number {
  return value.split(needle).length - 1;
}

function identifier(patch: Partial<AmazonExternalVehicleIdentifier> = {}): AmazonExternalVehicleIdentifier {
  return {
    id: "id-1",
    organizationId: "org-1",
    vehicleId: "vehicle-1",
    provider: "amazon",
    identifierType: "tractor_vehicle_id",
    externalValue: " unit 123 ",
    normalizedValue: "UNIT 123",
    effectiveFrom: "2026-07-01",
    effectiveTo: null,
    createdAt: "2026-07-16T00:00:00Z",
    updatedAt: "2026-07-16T00:00:00Z",
    ...patch,
  };
}

describe("amazon import TypeScript contracts", () => {
  it("defines the approved batch statuses", () => {
    expect([...AMAZON_IMPORT_BATCH_STATUSES]).toEqual([
      "uploaded",
      "parsing",
      "parsed",
      "needs_review",
      "reconciled",
      "ready",
      "failed",
      "archived",
    ]);
    expect(isAllowedAmazonBatchStatus("ready")).toBe(true);
    expect(isAllowedAmazonBatchStatus("applied")).toBe(false);
  });

  it("defines allowed issue severities", () => {
    expect([...AMAZON_IMPORT_ISSUE_SEVERITIES]).toEqual(["info", "warning", "blocking"]);
    expect(isAllowedAmazonIssueSeverity("blocking")).toBe(true);
    expect(isAllowedAmazonIssueSeverity("critical")).toBe(false);
  });

  it("defines active import file statuses for duplicate file protection", () => {
    expect(isActiveAmazonImportFileStatus("uploaded")).toBe(true);
    expect(isActiveAmazonImportFileStatus("parsing")).toBe(true);
    expect(isActiveAmazonImportFileStatus("parsed")).toBe(true);
    expect(isActiveAmazonImportFileStatus("failed")).toBe(false);
    expect(isActiveAmazonImportFileStatus("archived")).toBe(false);
  });

  it("normalizes external vehicle identifiers deterministically", () => {
    expect(normalizeExternalVehicleIdentifier("  unit   1501  ")).toBe("UNIT 1501");
    expect(externalVehicleIdentifierHasNormalizedValue(identifier())).toBe(true);
    expect(externalVehicleIdentifierHasNormalizedValue(identifier({ normalizedValue: "unit 123" }))).toBe(false);
  });

  it("models half-open effective-date conflicts inside one organization/provider/type/value", () => {
    const a = identifier({ effectiveFrom: "2026-07-01", effectiveTo: "2026-07-31" });
    const b = identifier({ id: "id-2", vehicleId: "vehicle-2", effectiveFrom: "2026-07-15", effectiveTo: null });
    const c = identifier({ id: "id-3", effectiveFrom: "2026-07-31", effectiveTo: null });
    expect(effectiveDateRangesOverlap(a, b)).toBe(true);
    expect(effectiveDateRangesOverlap(a, c)).toBe(false);
    expect(potentialExternalVehicleIdentifierConflict(a, b)).toBe(true);
    expect(potentialExternalVehicleIdentifierConflict(a, identifier({ organizationId: "org-2", effectiveFrom: "2026-07-15" }))).toBe(false);
  });

  it("allows same external value across different organizations, providers, or identifier types", () => {
    const base = identifier({ effectiveFrom: "2026-07-01", effectiveTo: null });
    expect(potentialExternalVehicleIdentifierConflict(base, identifier({ organizationId: "org-2" }))).toBe(false);
    expect(potentialExternalVehicleIdentifierConflict(base, identifier({ provider: "octane" }))).toBe(false);
    expect(potentialExternalVehicleIdentifierConflict(base, identifier({ identifierType: "fuel_unit" }))).toBe(false);
  });

  it("validates effective-date ranges", () => {
    expect(effectiveDateRangeIsValid(identifier({ effectiveFrom: "2026-07-01", effectiveTo: null }))).toBe(true);
    expect(effectiveDateRangeIsValid(identifier({ effectiveFrom: "2026-07-01", effectiveTo: "2026-07-02" }))).toBe(true);
    expect(effectiveDateRangeIsValid(identifier({ effectiveFrom: "2026-07-01", effectiveTo: "2026-07-01" }))).toBe(false);
    expect(effectiveDateRangeIsValid(identifier({ effectiveFrom: "2026-07-02", effectiveTo: "2026-07-01" }))).toBe(false);
  });

  it("keeps the parser contract independent from settlements", () => {
    expect(contracts).toContain("export interface AmazonStatementParser");
    expect(contracts).toContain("supports(metadata");
    expect(contracts).toContain("inspectSchema");
    expect(contracts).toContain("parse(input");
    expect(contracts).not.toMatch(/settlement/i);
    expect(types).not.toMatch(/settlement/i);
  });
});

describe("amazon import SQL source contracts", () => {
  it("creates only the approved core tables", () => {
    for (const table of [
      "amazon_import_batches",
      "amazon_import_files",
      "amazon_import_raw_rows",
      "amazon_import_issues",
      "amazon_import_reconciliations",
      "amazon_import_review_decisions",
      "amazon_external_vehicle_identifiers",
    ]) {
      expect(migration).toContain(`create table if not exists public.${table}`);
      expect(schema).toContain(`create table if not exists public.${table}`);
      expect(countOccurrences(migration, `create table if not exists public.${table}`)).toBe(1);
      expect(countOccurrences(schema, `create table if not exists public.${table}`)).toBe(1);
    }
    expect(migration).not.toContain("amazon_payment_rows");
    expect(migration).not.toContain("amazon_trip_rows");
    expect(migration).not.toContain("amazon_fuel_transactions");
  });

  it("protects duplicate active imports of the same organization and file hash", () => {
    expect(migration).toContain("amazon_import_files_active_hash_key");
    expect(migration).toContain("on public.amazon_import_files (organization_id, source_type, sha256_hash)");
    expect(migration).toContain("where status in ('uploaded','parsing','parsed')");
  });

  it("uses same-organization composite foreign keys", () => {
    for (const source of [migration, schema]) {
      expect(source).toContain("amazon_import_batches_org_id_id_key unique (organization_id, id)");
      expect(source).toContain("amazon_import_files_batch_same_org_fk");
      expect(source).toContain("foreign key (organization_id, batch_id)");
      expect(source).toContain("amazon_import_raw_rows_file_same_batch_fk");
      expect(source).toContain("foreign key (organization_id, batch_id, file_id)");
      expect(source).toContain("amazon_import_raw_rows_org_batch_id_id_key unique (organization_id, batch_id, id)");
      expect(source).toContain("amazon_import_issues_org_batch_id_id_key unique (organization_id, batch_id, id)");
      expect(source).toContain("foreign key (organization_id, batch_id, raw_row_id)");
      expect(source).toContain("references public.amazon_import_raw_rows (organization_id, batch_id, id) on delete set null (raw_row_id)");
      expect(source).toContain("foreign key (organization_id, batch_id, issue_id)");
      expect(source).toContain("references public.amazon_import_issues (organization_id, batch_id, id) on delete set null (issue_id)");
      expect(source).toContain("amazon_external_vehicle_identifiers_vehicle_same_org_fk");
      expect(source).toContain("references public.vehicles (organization_id, id)");
    }
  });

  it("prevents nullable source lineage from bypassing raw row uniqueness", () => {
    for (const source of [migration, schema]) {
      expect(source).toContain("amazon_import_raw_rows_source_lineage_key");
      expect(source).toContain("organization_id,\n    batch_id,\n    file_id");
      expect(source).toContain("coalesce(source_sheet, '__NULL_SOURCE_SHEET__')");
      expect(source).toContain("coalesce(source_page, -2147483648)");
      expect(source).toContain("coalesce(source_group, '__NULL_SOURCE_GROUP__')");
      expect(source).toContain("coalesce(source_row_number, -2147483648)");
      expect(source).toContain("amazon_import_raw_rows_source_sheet_sentinel_check");
      expect(source).toContain("amazon_import_raw_rows_source_group_sentinel_check");
      expect(source).toContain("source_page is null or source_page >= 0");
      expect(source).toContain("source_row_number is null or source_row_number > 0");
    }
  });

  it("enables RLS and separates select from writer mutations", () => {
    for (const source of [migration, schema]) {
      expect(source).toContain("enable row level security");
      expect(source).toContain("for select to authenticated using (organization_id = (select public.current_org_id()))");
      expect(source).toContain("for insert to authenticated with check (organization_id = (select public.current_org_id()) and (select public.is_org_writer()))");
      expect(source).toContain("for update to authenticated using (organization_id = (select public.current_org_id()) and (select public.is_org_writer()))");
      expect(source).toContain("for delete to authenticated using (organization_id = (select public.current_org_id()) and (select public.is_org_writer()))");
    }
  });

  it("does not create update/delete RLS policies for append-only review decisions", () => {
    for (const source of [migration, schema]) {
      expect(source).toContain("if t <> 'amazon_import_review_decisions' then");
      expect(source).toContain("create policy %I_insert");
      expect(source).toContain("create policy %I_select");
    }
  });

  it("does not leave broad all-policies on amazon import tables", () => {
    for (const source of [migration, schema]) {
      expect(source).not.toMatch(/create policy .* on public\.amazon_.* for all/i);
    }
  });

  it("keeps migration and schema definitions single-sourced", () => {
    for (const source of [migration, schema]) {
      expect(countOccurrences(source, "create extension if not exists \"btree_gist\" with schema extensions")).toBe(1);
      for (const fn of [
        "public.touch_amazon_import_updated_at()",
        "public.normalize_amazon_external_vehicle_identifier()",
        "public.guard_amazon_import_organization_id()",
        "public.guard_amazon_import_file_lineage()",
        "public.guard_amazon_import_raw_row_lineage()",
        "public.guard_amazon_import_review_decision_immutable()",
      ]) {
        expect(countOccurrences(source, `create or replace function ${fn}`)).toBe(1);
      }
      for (const trigger of [
        "amazon_import_batches_updated_at",
        "amazon_external_vehicle_identifiers_updated_at",
        "amazon_external_vehicle_identifiers_normalize",
        "amazon_import_files_lineage_guard",
        "amazon_import_raw_rows_lineage_guard",
        "amazon_import_review_decisions_update_guard",
        "amazon_import_review_decisions_delete_guard",
      ]) {
        expect(countOccurrences(source, `create trigger ${trigger}`)).toBe(1);
      }
    }
  });

  it("guards immutable organization_id and source lineage", () => {
    for (const source of [migration, schema]) {
      expect(source).toContain("guard_amazon_import_organization_id");
      expect(source).toContain("Amazon import organization_id cannot be changed.");
      expect(source).toContain("guard_amazon_import_file_lineage");
      expect(source).toContain("Amazon import file source lineage cannot be changed after raw rows exist.");
      expect(source).toContain("guard_amazon_import_raw_row_lineage");
      expect(source).toContain("Amazon import raw source lineage cannot be changed after normalized data exists.");
    }
  });

  it("keeps review decisions append-only for audit history", () => {
    expect(migration).toContain("guard_amazon_import_review_decision_immutable");
    expect(migration).toContain("before update on public.amazon_import_review_decisions");
    expect(migration).toContain("before delete on public.amazon_import_review_decisions");
    expect(migration).toContain("Amazon import review decisions are append-only.");
  });

  it("documents and enforces external vehicle identifier overlap expectations", () => {
    for (const source of [migration, schema]) {
      expect(source).toContain("create extension if not exists \"btree_gist\" with schema extensions");
      expect(source).toContain("amazon_external_vehicle_identifiers_no_overlap");
      expect(source).toContain("provider with =");
      expect(source).toContain("identifier_type with =");
      expect(source).toContain("normalized_value with =");
      expect(source).toContain("effective_to is null or effective_to > effective_from");
      expect(source).toContain("daterange(effective_from, coalesce(effective_to, 'infinity'::date), '[)') with &&");
      expect(source).toContain("normalize_amazon_external_vehicle_identifier");
    }
  });

  it("does not create settlements or direct settlement foreign keys", () => {
    expect(migration).not.toContain("create_settlement");
    expect(migration).not.toContain("references public.settlements");
    expect(migration).not.toContain("settlement_id");
  });

  it("marks live database checks as real migration behavior, not pure unit behavior", () => {
    expect(migration).toContain("exclude using gist");
    expect(migration).toContain("alter table public.%I enable row level security");
    expect(migration).toContain("create trigger amazon_import_raw_rows_lineage_guard");
  });
});
