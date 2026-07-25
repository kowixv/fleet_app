import { normalizeMaintenanceCostCategory } from "@/lib/maintenance-cost";
import {
  manualMaintenanceCategory,
  validateManualServiceName,
  type ManualMaintenanceKind,
} from "@/lib/manual-maintenance";
import { validateMileageInput } from "@/lib/vehicle-mileage";

export interface MaintenanceRecordPayload {
  entry_kind: ManualMaintenanceKind;
  service_type: string;
  performed_date: string;
  mileage: number;
  total_cost: number | null;
  cost: number | null;
  shop_name: string | null;
  vendor: string | null;
  parts_used: string[];
  invoice_number: string | null;
  notes: string | null;
  labor_cost: number | null;
  parts_cost: number | null;
  shop_fees: number | null;
  tax_cost: number | null;
  towing_cost: number | null;
  road_service_cost: number | null;
  hotel_travel_cost: number | null;
  diagnostic_cost: number | null;
  freight_shipping_cost: number | null;
  core_charge_cost: number | null;
  environmental_fee_cost: number | null;
  machine_shop_cost: number | null;
  sublet_cost: number | null;
  other_cost: number | null;
  warranty_recovery: number | null;
  refund_credit: number | null;
  downtime_start: string | null;
  downtime_end: string | null;
  category: string;
  cause: string | null;
  breakdown_occurred: boolean;
  planned: boolean;
}

function text(value: FormDataEntryValue | null): string | null {
  const raw = typeof value === "string" ? value.trim() : "";
  return raw || null;
}

function money(value: FormDataEntryValue | null, label: string): number | null {
  const raw = typeof value === "string" ? value.trim().replace(/,/g, "") : "";
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${label} negatif olamaz.`);
  return Math.round(parsed * 100) / 100;
}

function validDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function dateOnly(value: FormDataEntryValue | null, label: string): string {
  const raw = text(value);
  if (!raw || !validDateOnly(raw)) throw new Error(`${label} geçersiz.`);
  return raw;
}

function dateTime(value: FormDataEntryValue | null, label: string): string | null {
  const raw = text(value);
  if (!raw) return null;
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) throw new Error(`${label} geçersiz.`);
  const [, year, month, day, hour, minute, second = "00"] = match;
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)));
  if (
    parsed.getUTCFullYear() !== Number(year) ||
    parsed.getUTCMonth() !== Number(month) - 1 ||
    parsed.getUTCDate() !== Number(day) ||
    parsed.getUTCHours() !== Number(hour) ||
    parsed.getUTCMinutes() !== Number(minute) ||
    parsed.getUTCSeconds() !== Number(second)
  ) {
    throw new Error(`${label} geçersiz.`);
  }
  return raw;
}

export function partsFromMaintenanceForm(formData: FormData): string[] {
  return formData
    .getAll("parts_used")
    .flatMap((value) => (typeof value === "string" ? value.split(",") : []))
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 25);
}

function itemizedTotal(payload: Pick<MaintenanceRecordPayload,
  "parts_cost" | "labor_cost" | "diagnostic_cost" | "shop_fees" | "tax_cost" | "towing_cost" |
  "road_service_cost" | "hotel_travel_cost" | "freight_shipping_cost" | "core_charge_cost" |
  "environmental_fee_cost" | "machine_shop_cost" | "sublet_cost" | "other_cost" |
  "warranty_recovery" | "refund_credit"
>): { total: number; hasItems: boolean } {
  const add = [
    payload.parts_cost,
    payload.labor_cost,
    payload.diagnostic_cost,
    payload.shop_fees,
    payload.tax_cost,
    payload.towing_cost,
    payload.road_service_cost,
    payload.hotel_travel_cost,
    payload.freight_shipping_cost,
    payload.core_charge_cost,
    payload.environmental_fee_cost,
    payload.machine_shop_cost,
    payload.sublet_cost,
    payload.other_cost,
  ];
  const credits = [payload.warranty_recovery, payload.refund_credit];
  const hasItems = [...add, ...credits].some((value) => value != null && Number(value) !== 0);
  const total = add.reduce<number>((sum, value) => sum + Number(value ?? 0), 0)
    - credits.reduce<number>((sum, value) => sum + Math.abs(Number(value ?? 0)), 0);
  return { total: Math.round(total * 100) / 100, hasItems };
}

export function parseMaintenanceRecordForm(
  formData: FormData,
  options: { allowCategoryFromForm?: boolean } = {},
): MaintenanceRecordPayload {
  const kind = text(formData.get("entry_kind")) as ManualMaintenanceKind | null;
  if (kind !== "periodic" && kind !== "repair") throw new Error("İşlem türü gerekli.");

  const serviceValidation = validateManualServiceName(text(formData.get("service_type")));
  if (!serviceValidation.ok) throw new Error(serviceValidation.error ?? "Bakım / tamir çeşidi gerekli.");

  const mileage = validateMileageInput(text(formData.get("mileage")));
  if (!mileage.ok) throw new Error(mileage.error);

  const serviceName = serviceValidation.value;
  const plannedValue = text(formData.get("planned"));
  const categorySource = options.allowCategoryFromForm
    ? text(formData.get("category")) ?? manualMaintenanceCategory(kind, serviceName)
    : manualMaintenanceCategory(kind, serviceName);
  const payload: MaintenanceRecordPayload = {
    entry_kind: kind,
    service_type: serviceName,
    performed_date: dateOnly(formData.get("performed_date"), "Yapılma tarihi"),
    mileage: mileage.mileage,
    total_cost: money(formData.get("cost"), "Toplam maliyet"),
    cost: money(formData.get("cost"), "Toplam maliyet"),
    shop_name: text(formData.get("shop_name")),
    vendor: text(formData.get("shop_name")),
    parts_used: partsFromMaintenanceForm(formData),
    invoice_number: text(formData.get("invoice_number")),
    notes: text(formData.get("notes")),
    labor_cost: money(formData.get("labor_cost"), "Labor"),
    parts_cost: money(formData.get("parts_cost"), "Parts"),
    shop_fees: money(formData.get("shop_fees"), "Shop fees"),
    tax_cost: money(formData.get("tax_cost"), "Tax"),
    towing_cost: money(formData.get("towing_cost"), "Towing"),
    road_service_cost: money(formData.get("road_service_cost"), "Road service"),
    hotel_travel_cost: money(formData.get("hotel_travel_cost"), "Hotel / travel"),
    diagnostic_cost: money(formData.get("diagnostic_cost"), "Diagnostic"),
    freight_shipping_cost: money(formData.get("freight_shipping_cost"), "Freight / shipping"),
    core_charge_cost: money(formData.get("core_charge_cost"), "Core charge"),
    environmental_fee_cost: money(formData.get("environmental_fee_cost"), "Environmental fee"),
    machine_shop_cost: money(formData.get("machine_shop_cost"), "Machine shop"),
    sublet_cost: money(formData.get("sublet_cost"), "Sublet"),
    other_cost: money(formData.get("other_cost"), "Other cost"),
    warranty_recovery: money(formData.get("warranty_recovery"), "Warranty recovery"),
    refund_credit: money(formData.get("refund_credit"), "Refund / credit"),
    downtime_start: dateTime(formData.get("downtime_start"), "Downtime start"),
    downtime_end: dateTime(formData.get("downtime_end"), "Downtime end"),
    category: normalizeMaintenanceCostCategory(categorySource, serviceName),
    cause: text(formData.get("cause")),
    breakdown_occurred: formData.get("breakdown_occurred") === "on",
    planned: plannedValue == null ? kind === "periodic" : plannedValue === "planned",
  };

  if (payload.downtime_start && payload.downtime_end && Date.parse(payload.downtime_end) < Date.parse(payload.downtime_start)) {
    throw new Error("Downtime bitişi başlangıçtan önce olamaz.");
  }

  const allocation = itemizedTotal(payload);
  if (allocation.total < 0) {
    throw new Error("Refund / recovery toplam maliyeti negatif yapamaz.");
  }
  if (payload.total_cost != null && allocation.hasItems && Math.abs(payload.total_cost - allocation.total) > 0.01) {
    throw new Error("Toplam maliyet ile kalem maliyetleri birbiriyle uyuşmuyor.");
  }
  if (payload.total_cost == null && allocation.hasItems) {
    payload.total_cost = allocation.total;
    payload.cost = allocation.total;
  }

  return payload;
}
