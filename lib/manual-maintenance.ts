export type ManualMaintenanceKind = "periodic" | "repair";

export interface ManualServiceOption {
  label: string;
  value: string;
  kind: ManualMaintenanceKind;
  category: string;
  planned: boolean;
  recurring: boolean;
  aliases?: string[];
  serviceGroup?: string;
}

export interface ManualServiceValidation {
  ok: boolean;
  value: string;
  error?: string;
}

const GROUP = {
  preventive: "Preventive Maintenance",
  engine: "Engine",
  fuel: "Fuel System",
  turbo: "Turbo / Air Intake",
  aftertreatment: "Aftertreatment",
  transmission: "Transmission / Clutch",
  driveline: "Driveline / Differential",
  cooling: "Cooling System",
  air: "Air System",
  brakes: "Brakes / Wheel End",
  suspension: "Suspension / Steering",
  tires: "Tires",
  electrical: "Electrical",
  hvac: "HVAC / AC",
  apu: "APU",
  cab: "Cab / Body / Glass",
  fifthWheel: "Fifth Wheel / Coupling",
  trailer: "Trailer",
  dot: "DOT / Inspection",
  other: "Other",
} as const;

function periodic(
  label: string,
  category: string,
  serviceGroup: string,
  aliases: string[] = [],
): ManualServiceOption {
  return { label, value: label, kind: "periodic", category, planned: true, recurring: true, aliases, serviceGroup };
}

function repair(
  label: string,
  category: string,
  serviceGroup: string,
  aliases: string[] = [],
  recurring = false,
): ManualServiceOption {
  return { label, value: label, kind: "repair", category, planned: false, recurring, aliases, serviceGroup };
}

export const PERIODIC_SERVICE_OPTIONS: ManualServiceOption[] = [
  periodic("Wet PM / Oil Service", "preventive_maintenance", GROUP.preventive, ["Oil Service", "Oil Change"]),
  periodic("PM-A", "preventive_maintenance", GROUP.preventive),
  periodic("PM-B", "preventive_maintenance", GROUP.preventive),
  periodic("Grease / Chassis Lubrication", "preventive_maintenance", GROUP.preventive, ["Chassis Lubrication"]),
  periodic("Complete Vehicle Inspection", "dot_inspection", GROUP.dot, ["Full Inspection"]),
  periodic("Heavy Inspection", "dot_inspection", GROUP.dot),
  periodic("Engine Air Filter", "engine", GROUP.engine, ["Engine Air Filter Replacement"]),
  periodic("Cabin Air Filter", "hvac_ac", GROUP.hvac, ["Cabin Air Filter Inspection/Replacement", "Cabin Air Filter Replacement"]),
  periodic("Fuel Filters", "fuel_system", GROUP.fuel, ["Fuel Filter Replacement"]),
  periodic("DEF Filter", "aftertreatment", GROUP.aftertreatment, ["DEF Filter Replacement"]),
  periodic("Air Dryer Cartridge", "air_system", GROUP.air, ["Air Dryer", "Air Dryer Replacement", "Air Dryer Service"]),
  periodic("Valve Overhead / Valve Adjustment", "engine", GROUP.engine, ["Valve Overhead", "Valve Adjustment"]),
  periodic("Engine Belt Inspection / Replacement", "engine", GROUP.engine, ["Belt Replacement", "Serpentine Belt Replacement"]),
  periodic("Engine Mount Inspection", "engine", GROUP.engine),
  periodic("Crankcase Filter Replacement", "engine", GROUP.engine),
  periodic("Coolant Chemistry Test", "cooling_system", GROUP.cooling),
  periodic("Coolant Service / Flush", "cooling_system", GROUP.cooling, ["Coolant Flush", "Coolant Service"]),
  periodic("Radiator Inspection", "cooling_system", GROUP.cooling),
  periodic("Cooling Hose Inspection", "cooling_system", GROUP.cooling),
  periodic("Water Pump Inspection", "cooling_system", GROUP.cooling),
  periodic("Transmission Service", "transmission_clutch", GROUP.transmission),
  periodic("Transmission Fluid Change", "transmission_clutch", GROUP.transmission),
  periodic("Transmission Filter Change", "transmission_clutch", GROUP.transmission),
  periodic("Clutch Inspection", "transmission_clutch", GROUP.transmission),
  periodic("Clutch Adjustment", "transmission_clutch", GROUP.transmission),
  periodic("Clutch Replacement", "transmission_clutch", GROUP.transmission, ["Clutch Repair", "Clutch Assembly Replacement", "Replace Clutch", "Complete Clutch Job"]),
  periodic("Drive Axle Oil", "driveline_differential", GROUP.driveline, ["Synthetic Drive Axle Oil", "Drive Axle Oil Change"]),
  periodic("Differential Service", "driveline_differential", GROUP.driveline),
  periodic("Driveshaft Inspection", "driveline_differential", GROUP.driveline),
  periodic("U-Joint Inspection / Lubrication", "driveline_differential", GROUP.driveline, ["U-Joint Lubrication"]),
  periodic("Battery Test", "electrical", GROUP.electrical),
  periodic("Battery Replacement", "electrical", GROUP.electrical, ["Batteries Replaced", "Battery Set Replacement", "Replace Batteries", "Truck Batteries"]),
  periodic("Charging System Test", "electrical", GROUP.electrical),
  periodic("Alternator Inspection", "electrical", GROUP.electrical),
  periodic("Starter Inspection", "electrical", GROUP.electrical),
  periodic("Air Dryer Service", "air_system", GROUP.air, ["Air Dryer", "Air Dryer Cartridge", "Air Dryer Replacement"]),
  periodic("Air Compressor Inspection", "air_system", GROUP.air),
  periodic("Air Leak Inspection", "air_system", GROUP.air),
  periodic("Brake Inspection", "brakes_wheel_end", GROUP.brakes),
  periodic("Brake Adjustment", "brakes_wheel_end", GROUP.brakes),
  periodic("Brake Chamber Inspection", "brakes_wheel_end", GROUP.brakes),
  periodic("Slack Adjuster Inspection", "brakes_wheel_end", GROUP.brakes),
  periodic("Wheel Bearing Inspection", "brakes_wheel_end", GROUP.brakes),
  periodic("Wheel Seal Inspection", "brakes_wheel_end", GROUP.brakes),
  periodic("Hub Oil Service", "brakes_wheel_end", GROUP.brakes),
  periodic("Tire Inspection", "tires", GROUP.tires),
  periodic("Tire Rotation", "tires", GROUP.tires),
  periodic("Tire Replacement", "tires", GROUP.tires),
  periodic("Wheel Alignment", "tires", GROUP.tires),
  periodic("DPF Inspection", "aftertreatment", GROUP.aftertreatment),
  periodic("DPF Cleaning", "aftertreatment", GROUP.aftertreatment),
  periodic("DEF System Inspection", "aftertreatment", GROUP.aftertreatment),
  periodic("SCR System Inspection", "aftertreatment", GROUP.aftertreatment),
  periodic("Aftertreatment Inspection", "aftertreatment", GROUP.aftertreatment),
  periodic("APU Service", "apu", GROUP.apu),
  periodic("HVAC / AC Service", "hvac_ac", GROUP.hvac, ["AC Service", "A/C Service"]),
  periodic("Fifth Wheel Inspection / Lubrication", "fifth_wheel_coupling", GROUP.fifthWheel, ["Fifth Wheel Lubrication"]),
  periodic("DOT Annual", "dot_inspection", GROUP.dot, ["Annual Inspection", "DOT Inspection", "Annual DOT"]),
  periodic("Trailer PM", "trailer", GROUP.trailer),
  periodic("Trailer Brake Inspection", "trailer", GROUP.trailer),
  periodic("Trailer Wheel-End Inspection", "trailer", GROUP.trailer),
  periodic("Liftgate Service", "trailer", GROUP.trailer),
  periodic("Other Scheduled Maintenance", "other", GROUP.other),
];

export const REPAIR_SERVICE_OPTIONS: ManualServiceOption[] = [
  repair("Engine Repair", "engine", GROUP.engine),
  repair("Engine Replacement", "engine", GROUP.engine),
  repair("Injector Replacement", "fuel_system", GROUP.fuel),
  repair("Fuel Pump Replacement", "fuel_system", GROUP.fuel),
  repair("Oil Leak Repair", "engine", GROUP.engine),
  repair("Valve Cover Repair", "engine", GROUP.engine),
  repair("EGR Repair", "engine", GROUP.engine),
  repair("Turbo Repair", "turbo_air_intake", GROUP.turbo),
  repair("Turbo Replacement", "turbo_air_intake", GROUP.turbo),
  repair("Charge Air Cooler Repair", "turbo_air_intake", GROUP.turbo, ["CAC Repair"]),
  repair("Intake Leak Repair", "turbo_air_intake", GROUP.turbo),
  repair("Transmission Repair", "transmission_clutch", GROUP.transmission),
  repair("Transmission Replacement", "transmission_clutch", GROUP.transmission),
  repair("Clutch Replacement", "transmission_clutch", GROUP.transmission, ["Clutch Repair", "Clutch Assembly Replacement", "Replace Clutch", "Complete Clutch Job"], true),
  repair("Clutch Actuator Replacement", "transmission_clutch", GROUP.transmission),
  repair("Shift Controller / Shifter Repair", "transmission_clutch", GROUP.transmission, ["Shifter Repair", "Shift Controller Repair"]),
  repair("Differential Repair", "driveline_differential", GROUP.driveline),
  repair("Differential Replacement", "driveline_differential", GROUP.driveline),
  repair("Driveshaft Repair", "driveline_differential", GROUP.driveline),
  repair("U-Joint Replacement", "driveline_differential", GROUP.driveline),
  repair("Carrier Bearing Replacement", "driveline_differential", GROUP.driveline),
  repair("Coolant Leak Repair", "cooling_system", GROUP.cooling),
  repair("Radiator Replacement", "cooling_system", GROUP.cooling),
  repair("Water Pump Replacement", "cooling_system", GROUP.cooling),
  repair("Thermostat Replacement", "cooling_system", GROUP.cooling),
  repair("Cooling Hose Replacement", "cooling_system", GROUP.cooling),
  repair("Fan Clutch Replacement", "cooling_system", GROUP.cooling),
  repair("Battery Replacement", "electrical", GROUP.electrical, ["Batteries Replaced", "Battery Set Replacement", "Replace Batteries", "Truck Batteries"], true),
  repair("Alternator Replacement", "electrical", GROUP.electrical),
  repair("Starter Replacement", "electrical", GROUP.electrical),
  repair("Wiring Repair", "electrical", GROUP.electrical),
  repair("Sensor Replacement", "electrical", GROUP.electrical),
  repair("Headlight / Lighting Repair", "electrical", GROUP.electrical, ["Lighting Repair", "Headlight Repair"]),
  repair("DPF Regeneration", "aftertreatment", GROUP.aftertreatment),
  repair("DPF Cleaning", "aftertreatment", GROUP.aftertreatment, [], true),
  repair("DPF Replacement", "aftertreatment", GROUP.aftertreatment),
  repair("DEF System Repair", "aftertreatment", GROUP.aftertreatment),
  repair("DEF Pump Replacement", "aftertreatment", GROUP.aftertreatment),
  repair("SCR Repair", "aftertreatment", GROUP.aftertreatment),
  repair("NOx Sensor Replacement", "aftertreatment", GROUP.aftertreatment),
  repair("Air Compressor Replacement", "air_system", GROUP.air),
  repair("Air Dryer Replacement", "air_system", GROUP.air, ["Air Dryer", "Air Dryer Service", "Air Dryer Cartridge"], true),
  repair("Air Leak Repair", "air_system", GROUP.air),
  repair("Brake Repair", "brakes_wheel_end", GROUP.brakes),
  repair("Brake Chamber Replacement", "brakes_wheel_end", GROUP.brakes),
  repair("Slack Adjuster Replacement", "brakes_wheel_end", GROUP.brakes),
  repair("Brake Shoe / Pad Replacement", "brakes_wheel_end", GROUP.brakes, ["Brake Shoe Replacement", "Brake Pad Replacement"]),
  repair("Brake Drum / Rotor Replacement", "brakes_wheel_end", GROUP.brakes, ["Brake Drum Replacement", "Brake Rotor Replacement"]),
  repair("Wheel Seal Replacement", "brakes_wheel_end", GROUP.brakes),
  repair("Wheel Bearing Replacement", "brakes_wheel_end", GROUP.brakes),
  repair("Hub Replacement", "brakes_wheel_end", GROUP.brakes),
  repair("Tire Repair", "tires", GROUP.tires),
  repair("Tire Replacement", "tires", GROUP.tires, [], true),
  repair("Suspension Repair", "suspension_steering", GROUP.suspension),
  repair("Air Bag Replacement", "suspension_steering", GROUP.suspension),
  repair("Shock Replacement", "suspension_steering", GROUP.suspension),
  repair("Leaf Spring Replacement", "suspension_steering", GROUP.suspension),
  repair("Tie Rod Replacement", "suspension_steering", GROUP.suspension),
  repair("Drag Link Replacement", "suspension_steering", GROUP.suspension),
  repair("Steering Gear Repair", "suspension_steering", GROUP.suspension),
  repair("HVAC / AC Repair", "hvac_ac", GROUP.hvac, ["AC Repair", "A/C Repair"]),
  repair("APU / TriPac Repair", "apu", GROUP.apu, ["APU Repair", "TriPac Repair"]),
  repair("Windshield Replacement", "cab_body_glass", GROUP.cab),
  repair("Body Repair", "cab_body_glass", GROUP.cab),
  repair("Fifth Wheel Repair", "fifth_wheel_coupling", GROUP.fifthWheel),
  repair("Trailer Repair", "trailer", GROUP.trailer),
  repair("Liftgate Repair", "trailer", GROUP.trailer),
  repair("Diagnostic", "other", GROUP.other),
  repair("Road Service", "other", GROUP.other),
  repair("Towing", "other", GROUP.other),
  repair("Other Repair", "other", GROUP.other),
];

export const MANUAL_SERVICE_OPTIONS = [...PERIODIC_SERVICE_OPTIONS, ...REPAIR_SERVICE_OPTIONS];

export const REMINDER_SERVICE_OPTIONS = MANUAL_SERVICE_OPTIONS.filter((option, index, options) => (
  option.recurring && options.findIndex((candidate) => manualServiceKey(candidate.value) === manualServiceKey(option.value)) === index
));

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

export function canonicalManualServiceKey(kind: ManualMaintenanceKind, serviceType: string): string {
  return manualServiceKey(manualServiceOption(kind, serviceType)?.value ?? serviceType);
}

export function validateManualServiceName(value: string | null | undefined): ManualServiceValidation {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return { ok: false, value: "", error: "Bakim / tamir cesidi gerekli." };
  if (trimmed.length < 2) return { ok: false, value: trimmed, error: "Servis adi en az 2 karakter olmali." };
  if (trimmed.length > 120) return { ok: false, value: trimmed, error: "Servis adi en fazla 120 karakter olabilir." };
  if (/[\x00-\x1F\x7F]/.test(trimmed)) return { ok: false, value: trimmed, error: "Servis adi kontrol karakteri iceremez." };
  if (!/[A-Za-z0-9]/.test(trimmed)) return { ok: false, value: trimmed, error: "Servis adi yalnizca noktalama isaretlerinden olusamaz." };
  return { ok: true, value: trimmed };
}

export function isCustomManualService(kind: ManualMaintenanceKind, serviceType: string): boolean {
  return validateManualServiceName(serviceType).ok && manualServiceOption(kind, serviceType) == null;
}

export function shouldDefaultUpdateMaintenancePlan(kind: ManualMaintenanceKind, serviceType: string): boolean {
  const option = manualServiceOption(kind, serviceType);
  if (kind === "periodic") return option?.recurring !== false;
  return option?.recurring === true;
}

export function shouldUpdateMaintenancePlan(kind: ManualMaintenanceKind, serviceType: string, requested: boolean): boolean {
  return requested && validateManualServiceName(serviceType).ok && (kind === "periodic" || kind === "repair");
}

export function isRepairHistoryOnly(serviceType: string): boolean {
  const option = manualServiceOption("repair", serviceType);
  return option?.recurring !== true;
}

export function inferManualMaintenanceCategory(kind: ManualMaintenanceKind, serviceType: string): string {
  const text = serviceType.toLowerCase();
  if (/\b(battery|batteries|alternator|starter|wiring|electrical|light|lighting|headlight|sensor)\b/.test(text)) return "electrical";
  if (/\b(clutch|transmission|gearbox|shift actuator|shifter|shift controller)\b/.test(text)) return "transmission_clutch";
  if (/\b(driveshaft|u-joint|u joint|differential|axle|carrier bearing|driveline)\b/.test(text)) return "driveline_differential";
  if (/\b(turbo|charge air cooler|intercooler|intake|cac)\b/.test(text)) return "turbo_air_intake";
  if (/\b(dpf|def|scr|nox|regen|regeneration|aftertreatment)\b/.test(text)) return "aftertreatment";
  if (/\b(radiator|coolant|water pump|thermostat|fan clutch)\b/.test(text)) return "cooling_system";
  if (/\b(air compressor|air dryer|air leak|air line)\b/.test(text)) return "air_system";
  if (/\b(brake|chamber|slack adjuster|drum|rotor|wheel seal|wheel bearing|hub)\b/.test(text)) return "brakes_wheel_end";
  if (/\b(tire|alignment)\b/.test(text)) return "tires";
  if (/\b(suspension|air bag|shock|leaf spring|steering|tie rod|drag link)\b/.test(text)) return "suspension_steering";
  if (/\b(apu|tripac)\b/.test(text)) return "apu";
  if (/\b(hvac|a\/c|ac|air conditioning|heater|sleeper heater)\b/.test(text)) return "hvac_ac";
  if (/\b(trailer|liftgate)\b/.test(text)) return "trailer";
  if (/\b(windshield|glass|body|bumper|door|mirror|cab)\b/.test(text)) return "cab_body_glass";
  if (/\b(fifth wheel|kingpin|coupling)\b/.test(text)) return "fifth_wheel_coupling";
  if (/\b(dot|annual inspection|federal inspection)\b/.test(text)) return "dot_inspection";
  return kind === "periodic" ? "preventive_maintenance" : "other";
}

export function manualMaintenanceCategory(kind: ManualMaintenanceKind, serviceType: string): string {
  return manualServiceOption(kind, serviceType)?.category ?? inferManualMaintenanceCategory(kind, serviceType);
}

export function normalizeUnitNumber(value: string): string {
  return value.trim().replace(/^(unit|truck|tractor|vehicle|veh|#)\s*[:#-]?\s*/i, "").replace(/\s+/g, "").toUpperCase();
}
