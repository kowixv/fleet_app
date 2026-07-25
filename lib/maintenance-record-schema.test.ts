import { describe, expect, it } from "vitest";
import { parseMaintenanceRecordForm } from "./maintenance-record-schema";

function recordForm(overrides: Record<string, string> = {}): FormData {
  const values: Record<string, string> = {
    entry_kind: "repair",
    service_type: "Brake repair",
    performed_date: "2026-07-24",
    mileage: "125000",
    cost: "100",
    parts_cost: "60",
    labor_cost: "40",
    planned: "unplanned",
    category: "brakes_wheel_end",
    ...overrides,
  };
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  return form;
}

describe("maintenance record create/edit schema parity", () => {
  it("normalizes the same complete payload for create and edit", () => {
    const create = parseMaintenanceRecordForm(recordForm());
    const edit = parseMaintenanceRecordForm(recordForm(), { allowCategoryFromForm: true });
    expect(edit).toEqual(create);
    expect(edit).toMatchObject({
      category: "brakes_wheel_end",
      total_cost: 100,
      parts_cost: 60,
      labor_cost: 40,
      planned: false,
    });
  });

  it("rejects downtime end before start and invalid dates", () => {
    expect(() => parseMaintenanceRecordForm(recordForm({
      downtime_start: "2026-07-24T12:00",
      downtime_end: "2026-07-24T11:59",
    }))).toThrow(/Downtime/);
    expect(() => parseMaintenanceRecordForm(recordForm({ performed_date: "2026-02-30" }))).toThrow(/gecersiz|geçersiz/i);
  });

  it("rejects negative money and contradictory itemization", () => {
    expect(() => parseMaintenanceRecordForm(recordForm({ parts_cost: "-1" }))).toThrow(/negatif/);
    expect(() => parseMaintenanceRecordForm(recordForm({ cost: "99" }))).toThrow(/uyusmuyor|uyuşmuyor/i);
  });

  it("stores recovery and credits as positive magnitudes and subtracts them", () => {
    const parsed = parseMaintenanceRecordForm(recordForm({
      cost: "85",
      warranty_recovery: "10",
      refund_credit: "5",
    }));
    expect(parsed).toMatchObject({ total_cost: 85, warranty_recovery: 10, refund_credit: 5 });
  });
});
