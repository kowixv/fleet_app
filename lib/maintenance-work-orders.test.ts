import { describe, expect, it } from "vitest";
import {
  allowedWorkOrderTransitions,
  assertWorkOrderTransition,
  calculateWorkOrderTiming,
  canTransitionWorkOrderPart,
  canTransitionWorkOrderTask,
  canTransitionWorkOrder,
  parseWorkOrderCreateForm,
  parseWorkOrderPartForm,
  parseWorkOrderTaskForm,
  workOrderApprovalRequired,
} from "./maintenance-work-orders";

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe("maintenance work-order transitions", () => {
  it("allows only explicit lifecycle edges", () => {
    expect(canTransitionWorkOrder("reported", "triage")).toBe(true);
    expect(canTransitionWorkOrder("reported", "completed")).toBe(false);
    expect(allowedWorkOrderTransitions("closed")).toEqual([]);
    expect(() => assertWorkOrderTransition("reported", "completed")).toThrow(/izin verilmiyor/);
  });

  it("keeps quality-check rework and closure paths explicit", () => {
    expect(canTransitionWorkOrder("quality_check", "in_repair")).toBe(true);
    expect(canTransitionWorkOrder("quality_check", "completed")).toBe(true);
    expect(canTransitionWorkOrder("completed", "closed")).toBe(true);
    expect(canTransitionWorkOrder("closed", "in_repair")).toBe(false);
  });

  it("enforces task and part lifecycle ordering", () => {
    expect(canTransitionWorkOrderTask("pending", "completed")).toBe(true);
    expect(canTransitionWorkOrderTask("completed", "pending")).toBe(false);
    expect(canTransitionWorkOrderPart("needed", "ordered")).toBe(true);
    expect(canTransitionWorkOrderPart("ordered", "installed")).toBe(false);
    expect(canTransitionWorkOrderPart("received", "installed")).toBe(true);
  });
});

describe("maintenance work-order forms", () => {
  it("normalizes a manual work order without trusting organization metadata", () => {
    const parsed = parseWorkOrderCreateForm(form({
      vehicle_id: "6f72e322-7138-44cc-8b12-a9188f27379e",
      source_type: "breakdown",
      title: "Roadside coolant leak",
      priority: "critical",
      estimated_cost: "1,250.50",
      appointment_start: "2026-07-25T10:00:00-04:00",
      estimated_completion: "2026-07-26T14:00:00-04:00",
    }));
    expect(parsed).toMatchObject({
      source_type: "breakdown",
      title: "Roadside coolant leak",
      priority: "critical",
      estimated_cost: 1250.5,
    });
    expect(parsed).not.toHaveProperty("organization_id");
  });

  it("rejects invalid scheduling and negative money", () => {
    expect(() => parseWorkOrderCreateForm(form({
      vehicle_id: "6f72e322-7138-44cc-8b12-a9188f27379e",
      source_type: "manual",
      title: "Brake repair",
      estimated_cost: "-1",
    }))).toThrow(/negatif/);
    expect(() => parseWorkOrderCreateForm(form({
      vehicle_id: "6f72e322-7138-44cc-8b12-a9188f27379e",
      source_type: "manual",
      title: "Brake repair",
      appointment_start: "2026-07-26T10:00:00Z",
      estimated_completion: "2026-07-25T10:00:00Z",
    }))).toThrow(/önce olamaz/);
  });

  it("validates task and part lifecycle inputs", () => {
    expect(parseWorkOrderTaskForm(form({
      title: "Inspect wheel end",
      priority: "high",
      due_date: "2026-08-01",
    }))).toMatchObject({ title: "Inspect wheel end", priority: "high" });
    expect(parseWorkOrderPartForm(form({
      part_name: "Brake chamber",
      quantity: "2",
      ordered_date: "2026-07-25",
      received_date: "2026-07-26",
      unit_cost: "180",
    }))).toMatchObject({ part_name: "Brake chamber", quantity: 2, unit_cost: 180 });
    expect(() => parseWorkOrderPartForm(form({
      part_name: "Brake chamber",
      ordered_date: "2026-07-26",
      received_date: "2026-07-25",
    }))).toThrow(/önce olamaz/);
  });
});

describe("maintenance work-order approval and downtime", () => {
  it("requires approval only above the configured threshold", () => {
    expect(workOrderApprovalRequired(2500, 2500)).toBe(false);
    expect(workOrderApprovalRequired(2500.01, 2500)).toBe(true);
    expect(workOrderApprovalRequired(null, 2500)).toBe(false);
  });

  it("calculates waiting, repair, and current downtime deterministically", () => {
    const now = new Date("2026-07-25T12:00:00.000Z");
    expect(calculateWorkOrderTiming({
      status: "awaiting_estimate",
      status_changed_at: "2026-07-23T12:00:00.000Z",
      downtime_start: "2026-07-24T00:00:00.000Z",
      downtime_end: null,
      actual_start: null,
      actual_completion: null,
    }, now)).toEqual({
      currentDowntimeDays: 1.5,
      daysWaitingForEstimate: 2,
      daysWaitingForParts: null,
      daysInRepair: null,
    });

    expect(calculateWorkOrderTiming({
      status: "completed",
      status_changed_at: "2026-07-25T10:00:00.000Z",
      downtime_start: "2026-07-20T12:00:00.000Z",
      downtime_end: "2026-07-25T12:00:00.000Z",
      actual_start: "2026-07-21T12:00:00.000Z",
      actual_completion: "2026-07-24T12:00:00.000Z",
    }, now)).toMatchObject({
      currentDowntimeDays: 5,
      daysInRepair: 3,
    });
  });
});
