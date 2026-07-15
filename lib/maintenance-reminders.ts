import { computePM, type PMResult, type PMThresholds } from "@/lib/maintenance";
import { todayISO } from "@/lib/tz";

export const VEHICLE_TYPE_OPTIONS = [
  { value: "truck", label: "Truck" },
  { value: "box_truck", label: "Box Truck" },
  { value: "hotshot", label: "Hotshot" },
  { value: "trailer", label: "Trailer" },
  { value: "other", label: "Other" },
] as const;

export type VehicleType = (typeof VEHICLE_TYPE_OPTIONS)[number]["value"];
export type ReminderScope = "vehicle" | "vehicle_type";

export interface ReminderVehicle {
  id: string;
  unit_number: string;
  vehicle_type: VehicleType | string;
  current_mileage: number | null;
  status?: string | null;
  engine_hours?: number | null;
}

export interface ReminderRule {
  id: string;
  organization_id?: string;
  vehicle_id: string | null;
  vehicle_type: VehicleType | string | null;
  service_type: string;
  interval_type?: "mileage" | "date";
  interval_miles: number | null;
  interval_days: number | null;
  interval_engine_hours: number | null;
  last_done_mileage: number | null;
  last_done_date: string | null;
  last_done_engine_hours: number | null;
  active: boolean;
  created_at?: string | null;
}

export interface ReminderState {
  id?: string;
  rule_id: string;
  vehicle_id: string;
  last_done_mileage: number | null;
  last_done_date: string | null;
  last_done_engine_hours: number | null;
}

export interface EffectiveReminderRow extends ReminderRule {
  scope: ReminderScope;
  effective_vehicle_id: string;
  state_id: string | null;
  vehicles: {
    id: string;
    unit_number: string;
    vehicle_type: string;
    current_mileage: number | null;
  } | null;
}

export function isVehicleType(value: string | null | undefined): value is VehicleType {
  return VEHICLE_TYPE_OPTIONS.some((option) => option.value === value);
}

export function vehicleTypeLabel(value: string | null | undefined): string {
  return VEHICLE_TYPE_OPTIONS.find((option) => option.value === value)?.label ?? "Other";
}

function stateKey(ruleId: string, vehicleId: string): string {
  return `${ruleId}:${vehicleId}`;
}

export function expandEffectiveMaintenanceRules(
  rules: ReminderRule[],
  vehicles: ReminderVehicle[],
  states: ReminderState[] = [],
  includeInactiveVehicles = false,
): EffectiveReminderRow[] {
  const vehiclesById = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]));
  const statesByRuleVehicle = new Map(states.map((state) => [stateKey(state.rule_id, state.vehicle_id), state]));
  const activeVehicles = includeInactiveVehicles
    ? vehicles
    : vehicles.filter((vehicle) => (vehicle.status ?? "active") === "active");
  const rows: EffectiveReminderRow[] = [];

  for (const rule of rules) {
    if (rule.vehicle_id) {
      const vehicle = vehiclesById.get(rule.vehicle_id);
      if (!vehicle || (!includeInactiveVehicles && (vehicle.status ?? "active") !== "active")) continue;
      rows.push({
        ...rule,
        scope: "vehicle",
        effective_vehicle_id: vehicle.id,
        state_id: null,
        vehicles: {
          id: vehicle.id,
          unit_number: vehicle.unit_number,
          vehicle_type: vehicle.vehicle_type,
          current_mileage: vehicle.current_mileage,
        },
      });
      continue;
    }

    if (!rule.vehicle_type) continue;
    for (const vehicle of activeVehicles) {
      if (vehicle.vehicle_type !== rule.vehicle_type) continue;
      const state = statesByRuleVehicle.get(stateKey(rule.id, vehicle.id));
      rows.push({
        ...rule,
        scope: "vehicle_type",
        effective_vehicle_id: vehicle.id,
        state_id: state?.id ?? null,
        last_done_mileage: state?.last_done_mileage ?? null,
        last_done_date: state?.last_done_date ?? null,
        last_done_engine_hours: state?.last_done_engine_hours ?? null,
        vehicles: {
          id: vehicle.id,
          unit_number: vehicle.unit_number,
          vehicle_type: vehicle.vehicle_type,
          current_mileage: vehicle.current_mileage,
        },
      });
    }
  }

  return rows;
}

export function computeEffectiveReminderPM(
  row: EffectiveReminderRow,
  thresholds: PMThresholds,
  engineHours: number | null = null,
): PMResult {
  return computePM(
    row,
    Number(row.vehicles?.current_mileage ?? 0),
    thresholds,
    todayISO(),
    engineHours,
  );
}
