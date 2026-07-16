export const VEHICLE_FORM_BUSINESS_LABELS = [
  "Tip",
  "Şoför",
  "Driver Pay",
  "VIN",
  "Yıl",
  "Make",
  "Model",
  "Plaka",
  "Durum",
  "Not",
  "Engine Hour",
  "Engine Type",
  "Truck Color",
] as const;

export const VEHICLE_TYPE_OPTIONS = [
  { value: "truck", label: "Semi Truck" },
  { value: "box_truck", label: "Box Truck" },
] as const;

export const VEHICLE_STATUS_OPTIONS = [
  { value: "active", label: "Aktif" },
  { value: "in_repair", label: "Tamirde" },
  { value: "inactive", label: "Pasif" },
] as const;

export const ENGINE_TYPE_SUGGESTIONS = [
  "Cummins X15",
  "PACCAR MX-13",
  "Detroit DD15",
  "International A26",
  "Other / Custom",
] as const;

export const TRUCK_COLOR_SUGGESTIONS = [
  "White",
  "Black",
  "Blue",
  "Yellow",
  "Red",
  "Silver",
  "Gray",
] as const;

export const GENERATED_UNIT_NUMBER_PREFIX = "UNIT-";
export const VEHICLES_ORG_UNIT_NUMBER_CONSTRAINT = "vehicles_org_unit_number_key";

export const VEHICLE_FORM_FIELDS = [
  "vehicle_type",
  "assigned_driver_id",
  "default_driver_pay_pct",
  "vin",
  "year",
  "make",
  "model",
  "plate",
  "status",
  "notes",
  "engine_hours",
  "engine_model",
  "truck_color",
] as const;

export const REMOVED_VEHICLE_FORM_FIELDS = [
  "ownership_type",
  "company_id",
  "external_carrier_id",
  "owner_id",
  "company_fee_pct",
  "company_fee_is_our_revenue",
  "external_carrier_fee_pct",
  "management_commission_type",
  "management_commission_amount",
  "current_mileage",
] as const;

export type VehicleTypeValue = (typeof VEHICLE_TYPE_OPTIONS)[number]["value"];
export type VehicleStatusValue = (typeof VEHICLE_STATUS_OPTIONS)[number]["value"];

export function normalizeUpperText(value: unknown): string | null {
  const cleaned = typeof value === "string" ? value.trim().toUpperCase() : "";
  return cleaned || null;
}

export function optionalText(value: unknown): string | null {
  const cleaned = typeof value === "string" ? value.trim() : "";
  return cleaned || null;
}

export function optionalNonNegativeNumber(value: unknown, label: string): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${label} must be zero or greater.`);
  }
  return parsed;
}

export function optionalPercentFraction(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    throw new Error("Driver Pay must be between 0 and 100.");
  }
  return parsed / 100;
}

export function isVehicleFormType(value: unknown): value is VehicleTypeValue {
  return VEHICLE_TYPE_OPTIONS.some((option) => option.value === value);
}

export function isVehicleStatus(value: unknown): value is VehicleStatusValue {
  return VEHICLE_STATUS_OPTIONS.some((option) => option.value === value);
}

export function generatedVehicleUnitNumber(seed = crypto.randomUUID()): string {
  const token = seed.replace(/[^a-z0-9]/gi, "").slice(0, 8).toUpperCase();
  return `${GENERATED_UNIT_NUMBER_PREFIX}${token}`;
}

export interface DatabaseErrorLike {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
  constraint?: string | null;
}

export function isGeneratedUnitNumberCollision(error: DatabaseErrorLike | null | undefined): boolean {
  if (error?.code !== "23505") return false;
  if (error.constraint === VEHICLES_ORG_UNIT_NUMBER_CONSTRAINT) return true;

  const text = [error.message, error.details, error.hint].filter(Boolean).join("\n");
  return (
    text.includes(VEHICLES_ORG_UNIT_NUMBER_CONSTRAINT)
    || /\(\s*organization_id\s*,\s*unit_number\s*\)/i.test(text)
  );
}
