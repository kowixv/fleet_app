export type ManualMaintenanceKind = "periodic" | "repair";

export interface ManualServiceOption {
  label: string;
  value: string;
  kind: ManualMaintenanceKind;
  category: string;
  planned: boolean;
  recurring: boolean;
  aliases?: string[];
}

export const PERIODIC_SERVICE_OPTIONS: ManualServiceOption[] = [
  { label: "Wet PM / Oil Service", value: "Wet PM / Oil Service", kind: "periodic", category: "routine_pm", planned: true, recurring: true },
  { label: "PM-A", value: "PM-A", kind: "periodic", category: "routine_pm", planned: true, recurring: true },
  { label: "PM-B", value: "PM-B", kind: "periodic", category: "routine_pm", planned: true, recurring: true },
  { label: "Heavy Inspection", value: "Heavy Inspection", kind: "periodic", category: "routine_pm", planned: true, recurring: true },
  { label: "Engine Air Filter", value: "Engine Air Filter", kind: "periodic", category: "engine", planned: true, recurring: true, aliases: ["Engine Air Filter Replacement"] },
  { label: "Cabin Air Filter", value: "Cabin Air Filter", kind: "periodic", category: "routine_pm", planned: true, recurring: true, aliases: ["Cabin Air Filter Inspection/Replacement", "Cabin Air Filter Replacement"] },
  { label: "Fuel Filters", value: "Fuel Filters", kind: "periodic", category: "engine", planned: true, recurring: true },
  { label: "DEF Filter", value: "DEF Filter", kind: "periodic", category: "aftertreatment", planned: true, recurring: true },
  { label: "Valve Overhead", value: "Valve Overhead", kind: "periodic", category: "engine", planned: true, recurring: true },
  { label: "Air Dryer", value: "Air Dryer", kind: "periodic", category: "other", planned: true, recurring: true },
  { label: "DOT Annual", value: "DOT Annual", kind: "periodic", category: "routine_pm", planned: true, recurring: true, aliases: ["Annual Inspection", "DOT Inspection", "Annual DOT"] },
  { label: "Coolant Chemistry Test", value: "Coolant Chemistry Test", kind: "periodic", category: "cooling", planned: true, recurring: true },
  { label: "Transmission Service", value: "Transmission Service", kind: "periodic", category: "transmission_driveline", planned: true, recurring: true },
  { label: "Drive Axle Oil", value: "Drive Axle Oil", kind: "periodic", category: "transmission_driveline", planned: true, recurring: true, aliases: ["Synthetic Drive Axle Oil", "Drive Axle Oil Change"] },
  { label: "Other Scheduled Maintenance", value: "Other Scheduled Maintenance", kind: "periodic", category: "other", planned: true, recurring: true },
];

export const REPAIR_SERVICE_OPTIONS: ManualServiceOption[] = [
  { label: "Engine Repair", value: "Engine Repair", kind: "repair", category: "engine", planned: false, recurring: false },
  { label: "Turbo Repair", value: "Turbo Repair", kind: "repair", category: "engine", planned: false, recurring: false },
  { label: "Electrical Repair", value: "Electrical Repair", kind: "repair", category: "electrical", planned: false, recurring: false },
  { label: "Suspension Repair", value: "Suspension Repair", kind: "repair", category: "suspension_steering", planned: false, recurring: false },
  { label: "Brake Repair", value: "Brake Repair", kind: "repair", category: "brakes_wheel_end", planned: false, recurring: false },
  { label: "Tire Repair", value: "Tire Repair", kind: "repair", category: "tires", planned: false, recurring: false },
  { label: "Coolant Leak Repair", value: "Coolant Leak Repair", kind: "repair", category: "cooling", planned: false, recurring: false },
  { label: "DPF Regeneration", value: "DPF Regeneration", kind: "repair", category: "aftertreatment", planned: false, recurring: false },
  { label: "DEF System Repair", value: "DEF System Repair", kind: "repair", category: "aftertreatment", planned: false, recurring: false },
  { label: "APU / TriPac Repair", value: "APU / TriPac Repair", kind: "repair", category: "other", planned: false, recurring: false },
  { label: "Towing", value: "Towing", kind: "repair", category: "road_service_towing", planned: false, recurring: false },
  { label: "Diagnostic", value: "Diagnostic", kind: "repair", category: "other", planned: false, recurring: false },
  { label: "Road Service", value: "Road Service", kind: "repair", category: "road_service_towing", planned: false, recurring: false },
  { label: "Other Repair", value: "Other Repair", kind: "repair", category: "other", planned: false, recurring: false },
];

export const MANUAL_SERVICE_OPTIONS = [...PERIODIC_SERVICE_OPTIONS, ...REPAIR_SERVICE_OPTIONS];

export function manualServiceKey(value: string): string {
  return value.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
}

function matchesOption(option: ManualServiceOption, serviceType: string): boolean {
  const normalized = manualServiceKey(serviceType);
  return [option.value, option.label, ...(option.aliases ?? [])].some((candidate) => manualServiceKey(candidate) === normalized);
}

export function manualServiceOption(kind: ManualMaintenanceKind, serviceType: string): ManualServiceOption | null {
  return MANUAL_SERVICE_OPTIONS.find((option) => option.kind === kind && matchesOption(option, serviceType)) ?? null;
}

export function manualServiceKeys(kind: ManualMaintenanceKind, serviceType: string): string[] {
  const option = manualServiceOption(kind, serviceType);
  const values = option ? [option.value, option.label, ...(option.aliases ?? [])] : [serviceType];
  return [...new Set(values.map(manualServiceKey))];
}

export function shouldUpdateMaintenancePlan(kind: ManualMaintenanceKind, serviceType: string, requested: boolean): boolean {
  const option = manualServiceOption(kind, serviceType);
  return kind === "periodic" && requested && option?.recurring === true;
}

export function isRepairHistoryOnly(serviceType: string): boolean {
  const option = manualServiceOption("repair", serviceType);
  return option?.recurring === false;
}

export function manualMaintenanceCategory(kind: ManualMaintenanceKind, serviceType: string): string {
  return manualServiceOption(kind, serviceType)?.category ?? (kind === "periodic" ? "routine_pm" : "other");
}

export function normalizeUnitNumber(value: string): string {
  return value.trim().replace(/^(unit|truck|tractor|vehicle|veh|#)\s*[:#-]?\s*/i, "").replace(/\s+/g, "").toUpperCase();
}
