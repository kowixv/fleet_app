import {
  engineModelMatchesRequirement,
  getMaintenanceProgramPresets,
  isMaintenancePackageLevel,
  isMaintenanceProgramVehicleType,
  presetDefaultEnabled,
  type MaintenancePackageLevel,
  type MaintenanceProgramVehicleType,
} from "@/lib/maintenance-program-presets";
import type { MaintenanceProgramBulkItem } from "@/lib/maintenance/program-installation";

export type VehicleMaintenanceSetupMode = MaintenancePackageLevel | "copy" | "none";
export type VehicleMaintenanceBaselineMode = "current" | "manual";

export interface VehicleMaintenanceDefaults {
  automaticSetup: boolean;
  packageByVehicleType: Record<MaintenanceProgramVehicleType, MaintenancePackageLevel>;
  baselineMode: VehicleMaintenanceBaselineMode;
}

export interface VehicleMaintenanceSetupInput {
  mode: VehicleMaintenanceSetupMode;
  baselineMode: VehicleMaintenanceBaselineMode;
  sourceVehicleId?: string | null;
}

export interface VehicleMaintenancePlan {
  items: MaintenanceProgramBulkItem[];
  needsInformation: string[];
}

export const DEFAULT_VEHICLE_MAINTENANCE_SETTINGS: VehicleMaintenanceDefaults = {
  automaticSetup: true,
  packageByVehicleType: { truck: "basic", box_truck: "basic" },
  baselineMode: "current",
};

export function isVehicleMaintenanceSetupMode(value: unknown): value is VehicleMaintenanceSetupMode {
  return value === "basic" || value === "full" || value === "copy" || value === "none";
}

export function isVehicleMaintenanceBaselineMode(value: unknown): value is VehicleMaintenanceBaselineMode {
  return value === "current" || value === "manual";
}

export function parseVehicleMaintenanceDefaults(
  row: Record<string, unknown> | null | undefined,
): VehicleMaintenanceDefaults {
  const truck = row?.new_truck_maintenance_package;
  const boxTruck = row?.new_box_truck_maintenance_package;
  const baseline = row?.new_vehicle_maintenance_baseline_mode;
  return {
    automaticSetup:
      typeof row?.new_vehicle_auto_maintenance_setup === "boolean"
        ? row.new_vehicle_auto_maintenance_setup
        : DEFAULT_VEHICLE_MAINTENANCE_SETTINGS.automaticSetup,
    packageByVehicleType: {
      truck: isMaintenancePackageLevel(truck) ? truck : "basic",
      box_truck: isMaintenancePackageLevel(boxTruck) ? boxTruck : "basic",
    },
    baselineMode: isVehicleMaintenanceBaselineMode(baseline) ? baseline : "current",
  };
}

export function defaultVehicleMaintenanceSetup(
  vehicleType: string,
  settings: VehicleMaintenanceDefaults,
): VehicleMaintenanceSetupInput {
  if (!settings.automaticSetup || !isMaintenanceProgramVehicleType(vehicleType)) {
    return { mode: "none", baselineMode: settings.baselineMode };
  }
  return {
    mode: settings.packageByVehicleType[vehicleType],
    baselineMode: settings.baselineMode,
  };
}

export function buildVehicleMaintenancePresetPlan(input: {
  vehicleId: string;
  vehicleType: string;
  engineModel: string | null;
  packageLevel: MaintenancePackageLevel;
}): VehicleMaintenancePlan {
  const vehicleType = input.vehicleType;
  if (!isMaintenanceProgramVehicleType(vehicleType)) {
    return { items: [], needsInformation: ["Bu araç tipi için hazır bakım paketi bulunmuyor."] };
  }
  const hasPaccarMx = engineModelMatchesRequirement(input.engineModel, "paccar_mx");
  const presets = getMaintenanceProgramPresets(
    vehicleType,
    input.packageLevel,
    input.packageLevel === "full" && hasPaccarMx,
  ).filter((preset) =>
    preset.engineRequirement
      ? engineModelMatchesRequirement(input.engineModel, preset.engineRequirement)
      : presetDefaultEnabled(preset, vehicleType),
  );
  const needsInformation: string[] = [];
  if (input.vehicleType === "truck" && input.packageLevel === "full" && !input.engineModel?.trim()) {
    needsInformation.push("Motor özel bakımları için engine model gerekli.");
  }

  return {
    items: presets.map((preset) => ({
      preset_id: preset.id,
      title: preset.titleTr,
      vehicle_id: preset.engineRequirement ? input.vehicleId : null,
      vehicle_type: vehicleType,
      service_type: preset.serviceType,
      interval_miles: preset.intervalMiles ?? null,
      interval_days: preset.intervalDays ?? null,
      interval_engine_hours: preset.intervalEngineHours ?? null,
    })),
    needsInformation,
  };
}

export function estimateVehicleMaintenancePresetCount(
  vehicleType: string,
  packageLevel: MaintenancePackageLevel,
  engineModel: string | null,
): number {
  return buildVehicleMaintenancePresetPlan({
    vehicleId: "00000000-0000-0000-0000-000000000000",
    vehicleType,
    engineModel,
    packageLevel,
  }).items.length;
}

export function parseVehicleMaintenanceSetupInput(input: Record<string, unknown>): VehicleMaintenanceSetupInput {
  const mode = input.maintenance_setup_mode;
  const baselineMode = input.maintenance_baseline_mode;
  if (!isVehicleMaintenanceSetupMode(mode)) throw new Error("Geçerli bir bakım kurulumu seçin.");
  if (!isVehicleMaintenanceBaselineMode(baselineMode)) throw new Error("Geçerli bir takip başlangıcı seçin.");
  const sourceVehicleId = typeof input.maintenance_source_vehicle_id === "string"
    ? input.maintenance_source_vehicle_id.trim() || null
    : null;
  if (mode === "copy" && !sourceVehicleId) throw new Error("Kopyalanacak benzer aracı seçin.");
  return { mode, baselineMode, sourceVehicleId };
}
