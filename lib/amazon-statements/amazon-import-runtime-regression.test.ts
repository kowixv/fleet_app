import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import AmazonImportList from "@/app/(app)/settlements/amazon-imports/components/amazon-import-list";
import { isWriteRole, roleToWorkflowAccess } from "@/lib/auth-roles";
import { safeProfileName } from "./ui-safe";

const root = process.cwd();
const authRolesSource = read("lib/auth-roles.ts");
const sharedAuthSource = read("lib/auth.ts");
const amazonAuthSource = read("lib/amazon-statements/server/auth.ts");
const readService = read("lib/amazon-statements/server/ui-read-service.ts");
const referenceReviewService = read("lib/amazon-statements/server/reference-review-service.ts");
const listPage = read("app/(app)/settlements/amazon-imports/page.tsx");
const newPage = read("app/(app)/settlements/amazon-imports/new/page.tsx");
const actions = read("app/(app)/settlements/amazon-imports/actions.ts");
const createForm = read("app/(app)/settlements/amazon-imports/components/create-batch-form.tsx");

describe("amazon import runtime regressions", () => {
  it("derives writer access from approved authenticated profile roles", () => {
    for (const role of ["owner", "admin", "manager", "OWNER", " Admin "]) {
      expect(isWriteRole(role)).toBe(true);
      expect(roleToWorkflowAccess(role)).toBe("writer");
    }
  });

  it("keeps viewer and unknown roles read-only", () => {
    for (const role of ["viewer", "dispatcher", "", null, undefined]) {
      expect(isWriteRole(role)).toBe(false);
      expect(roleToWorkflowAccess(role)).toBe("viewer");
    }
  });

  it("uses one shared write-role helper for normal auth and Amazon actor access", () => {
    expect(authRolesSource).toContain('export const WRITE_ROLES: readonly WriteRole[] = ["owner", "admin", "manager"]');
    expect(sharedAuthSource).toContain("isWriteRole(profile.role)");
    expect(amazonAuthSource).toContain("roleToWorkflowAccess(profile.role)");
    expect(amazonAuthSource).not.toContain('options.writer ? "writer" : "viewer"');
  });

  it("allows read pages to load without writer permission while returning derived access", () => {
    expect(readService).toContain("requireAmazonImportActor()");
    expect(newPage).toContain("const actor = await requireAmazonImportActor()");
    expect(listPage).toContain('role === "writer"');
    expect(newPage).toContain('actor.access === "writer"');
    expect(readService).not.toContain("requireAmazonImportActor({ writer: true })");
    expect(newPage).not.toContain("requireAmazonImportActor({ writer: true })");
  });

  it("keeps mutations writer-gated and rejects viewer actors server-side", () => {
    expect(actions.match(/requireAmazonImportActor\(\{ writer: true \}\)/g)?.length ?? 0).toBeGreaterThanOrEqual(8);
    expect(amazonAuthSource).toContain("requireWriteRole()");
    expect(amazonAuthSource).toContain("Viewer users cannot mutate Amazon imports.");
  });

  it("enables the new batch page for OWNER-derived writer access", () => {
    expect(roleToWorkflowAccess("OWNER")).toBe("writer");
    expect(newPage).toContain('<CreateBatchForm canCreate={actor.access === "writer"} />');
    expect(createForm).toContain("Create Amazon import batch");
  });

  it("uses explicit named PostgREST profile relationships", () => {
    expect(readService).toContain("creator:profiles!amazon_import_batches_created_by_same_org_fk(full_name)");
    expect(readService).toContain("reviewer:profiles!amazon_import_review_decisions_decided_by_same_org_fk(full_name)");
    expect(referenceReviewService).toContain("reviewer:profiles!amazon_import_review_decisions_decided_by_same_org_fk(full_name)");
    expect(readService).toContain("report:fuel_import_reports!fuel_import_transactions_report_same_org_fk!inner(batch_id)");
    expect(readService).toContain("transaction:fuel_import_transactions!fuel_import_transaction_lines_transaction_same_org_fk!inner");
    expect(referenceReviewService).toContain("report:fuel_import_reports!fuel_import_card_groups_report_same_org_fk!inner(batch_id)");
  });

  it("does not leave ambiguous profile embeds in Amazon read services", () => {
    const combined = `${readService}\n${referenceReviewService}`;
    expect(combined).not.toContain("profiles:created_by(full_name)");
    expect(combined).not.toContain("profiles:decided_by(full_name)");
    expect(combined).not.toContain("decision.profiles");
    expect(combined).not.toContain("row.profiles");
  });

  it("renders an empty batch list without throwing", () => {
    vi.stubGlobal("React", React);
    const html = renderToStaticMarkup(AmazonImportList({ rows: [] }));
    expect(html).toContain("No Amazon imports yet");
  });

  it("renders missing creator and reviewer names safely", () => {
    expect(safeProfileName(null)).toBe("-");
    expect(safeProfileName({ full_name: "" })).toBe("-");
    expect(safeProfileName({ full_name: "  " })).toBe("-");
    expect(safeProfileName({ full_name: "Ops User" })).toBe("Ops User");
  });
});

function read(path: string) {
  return readFileSync(join(root, path), "utf8");
}
