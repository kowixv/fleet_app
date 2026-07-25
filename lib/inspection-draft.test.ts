import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  isLatestInspectionSave,
  mergeInspectionDraftResults,
  parseInspectionDraftPayload,
} from "./inspection-draft";
import type { InspectionTemplateItem } from "./inspection";

const items: InspectionTemplateItem[] = [
  { id: "pass", section: "S", label: "Pass", input_type: "pass_fail", required: true, warning_threshold: null, critical_threshold: null, axle_position: null },
  { id: "check", section: "S", label: "Check", input_type: "checkbox", required: false, warning_threshold: null, critical_threshold: null, axle_position: null },
  { id: "number", section: "S", label: "Number", input_type: "number", required: false, warning_threshold: null, critical_threshold: null, axle_position: null },
  { id: "select", section: "S", label: "Select", input_type: "select", required: false, warning_threshold: null, critical_threshold: null, axle_position: null },
  { id: "text", section: "S", label: "Text", input_type: "text", required: false, warning_threshold: null, critical_threshold: null, axle_position: null },
  { id: "new", section: "S", label: "New", input_type: "checkbox", required: false, warning_threshold: null, critical_threshold: null, axle_position: null },
];

describe("inspection draft lifecycle", () => {
  it("hydrates every input type and notes while defaulting only new template items", () => {
    const merged = mergeInspectionDraftResults(items, [
      { template_item_id: "pass", passed: false, notes: "fail note" },
      { template_item_id: "check", value_bool: true },
      { template_item_id: "number", value_number: 12.5 },
      { template_item_id: "select", value_text: "A" },
      { template_item_id: "text", value_text: "saved text" },
    ]);
    expect(merged.pass).toMatchObject({ passed: false, notes: "fail note" });
    expect(merged.check.value_bool).toBe(true);
    expect(merged.number.value_number).toBe(12.5);
    expect(merged.select.value_text).toBe("A");
    expect(merged.text.value_text).toBe("saved text");
    expect(merged.new).toMatchObject({ template_item_id: "new", passed: null });
  });

  it("validates unknown draft payloads before an RPC write", () => {
    expect(parseInspectionDraftPayload({
      inspector: "Alex",
      shop: "Fleet",
      notes: "draft",
      mark_rule_serviced: false,
      expected_updated_at: "2026-07-24T12:00:00.000Z",
      results: [{ template_item_id: "number", value_number: 8, notes: "ok" }],
    }).results[0]).toMatchObject({ template_item_id: "number", value_number: 8 });
    expect(() => parseInspectionDraftPayload({ results: [{ template_item_id: "number", value_number: "8" }] })).toThrow(/sayı/);
  });

  it("ignores stale autosave responses", () => {
    expect(isLatestInspectionSave(4, 5)).toBe(false);
    expect(isLatestInspectionSave(5, 5)).toBe(true);
  });

  it("keeps start, save, close, resume, edit and complete controls wired", () => {
    const source = readFileSync("components/MaintenanceInspectionWorkflow.tsx", "utf8");
    expect(source).toContain("startVehicleInspection");
    expect(source).toContain("saveVehicleInspectionDraft");
    expect(source).toContain("loadVehicleInspectionDraft");
    expect(source).toContain("MAINTENANCE_TERMS.saveDraft");
    expect(source).toContain("MAINTENANCE_TERMS.saveAndCloseDraft");
    expect(source).toContain("completeVehicleInspection");
    expect(source).toContain("mergeInspectionDraftResults");
  });
});
