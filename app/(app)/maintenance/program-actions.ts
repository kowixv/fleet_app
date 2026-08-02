"use server";

import { requireWriteRole } from "@/lib/auth";
import { revalidateMaintenance } from "@/lib/maintenance/cache";
import {
  engineModelMatchesRequirement,
  isMaintenancePackageLevel,
  isMaintenanceProgramVehicleType,
  maintenanceProgramPreset,
  presetIsInPackage,
  validateMaintenanceProgramIntervals,
  type MaintenancePackageLevel,
  type MaintenanceProgramVehicleType,
} from "@/lib/maintenance-program-presets";
import {
  installMaintenanceProgramItems,
  summarizeMaintenanceProgramInstall,
  type MaintenanceProgramBulkItem,
  type MaintenanceProgramInstallItemResult,
  type MaintenanceProgramInstallResult,
  type MaintenanceProgramRpcClient,
} from "@/lib/maintenance/program-installation";
import { maintenanceVisibleVehicleStatuses } from "@/lib/maintenance-vehicle-status";
import { createClient } from "@/lib/supabase/server";

export interface MaintenanceProgramSelectionInput {
  presetId: string;
  intervalMiles: number | null;
  intervalDays: number | null;
  intervalEngineHours: number | null;
  vehicleIds?: string[];
}

export interface MaintenanceProgramInstallInput {
  selectedVehicleType: MaintenanceProgramVehicleType;
  selectedPackage: MaintenancePackageLevel;
  selections: MaintenanceProgramSelectionInput[];
}

export type { MaintenanceProgramInstallItemResult, MaintenanceProgramInstallResult };

export async function installMaintenanceProgramBulk(
  input: MaintenanceProgramInstallInput,
): Promise<MaintenanceProgramInstallResult> {
  const profile = await requireWriteRole();
  const preflight: MaintenanceProgramInstallItemResult[] = [];
  try {
    if (!isMaintenanceProgramVehicleType(input?.selectedVehicleType)) throw new Error("Geçerli bir araç türü seçin.");
    if (!isMaintenancePackageLevel(input?.selectedPackage)) throw new Error("Geçerli bir bakım paketi seçin.");
    if (!Array.isArray(input?.selections) || input.selections.length === 0) throw new Error("En az bir bakım seçin.");
    const selections = [...new Map(input.selections.map((item) => [item.presetId, item])).values()];
    if (selections.length > 60) throw new Error("Tek seferde en fazla 60 bakım kurulabilir.");

    const supabase = await createClient();
    const vehiclesResult = await supabase
      .from("vehicles")
      .select("id, unit_number, vehicle_type")
      .eq("organization_id", profile.organization_id)
      .eq("vehicle_type", input.selectedVehicleType)
      .in("status", maintenanceVisibleVehicleStatuses());
    if (vehiclesResult.error) throw new Error(vehiclesResult.error.message);
    const vehicles = vehiclesResult.data ?? [];
    const vehicleById = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]));
    const ids = vehicles.map((vehicle) => vehicle.id);
    const profilesResult = ids.length
      ? await supabase
          .from("vehicle_maintenance_profiles")
          .select("vehicle_id, engine_model")
          .eq("organization_id", profile.organization_id)
          .in("vehicle_id", ids)
      : { data: [], error: null };
    if (profilesResult.error) throw new Error(profilesResult.error.message);
    const engineByVehicle = new Map((profilesResult.data ?? []).map((row) => [row.vehicle_id, row.engine_model]));
    const hasReliableEngineData = vehicles.some((vehicle) => Boolean(engineByVehicle.get(vehicle.id)?.trim()));
    const items: MaintenanceProgramBulkItem[] = [];

    for (const selection of selections) {
      const preset = maintenanceProgramPreset(selection.presetId);
      if (!preset || preset.installMode !== "reminder") {
        preflight.push({ presetId: selection.presetId, title: selection.presetId, status: "failed", message: "Geçersiz veya reference-only bakım seçimi." });
        continue;
      }
      if (!presetIsInPackage(preset, input.selectedVehicleType, input.selectedPackage)) {
        preflight.push({ presetId: preset.id, title: preset.titleTr, status: "failed", message: "Bakım seçilen araç türü veya pakete uygulanamaz." });
        continue;
      }
      const intervals = {
        intervalMiles: selection.intervalMiles,
        intervalDays: selection.intervalDays,
        intervalEngineHours: selection.intervalEngineHours,
      };
      const intervalValidation = validateMaintenanceProgramIntervals(intervals);
      if (!intervalValidation.ok) {
        preflight.push({ presetId: preset.id, title: preset.titleTr, status: "failed", message: intervalValidation.error });
        continue;
      }
      if (!preset.engineRequirement) {
        items.push({
          preset_id: preset.id,
          title: preset.titleTr,
          vehicle_id: null,
          vehicle_type: input.selectedVehicleType,
          service_type: preset.serviceType,
          interval_miles: intervals.intervalMiles,
          interval_days: intervals.intervalDays,
          interval_engine_hours: intervals.intervalEngineHours,
        });
        continue;
      }

      const selectedIds = [...new Set(selection.vehicleIds ?? [])];
      if (!selectedIds.length) {
        preflight.push({ presetId: preset.id, title: preset.titleTr, status: "failed", message: "Engine-specific bakım için en az bir unit seçin." });
        continue;
      }
      for (const vehicleId of selectedIds) {
        const vehicle = vehicleById.get(vehicleId);
        if (!vehicle) {
          preflight.push({ presetId: preset.id, title: preset.titleTr, vehicleId, status: "failed", message: "Aktif ve uygun unit bulunamadı." });
          continue;
        }
        if (hasReliableEngineData && !engineModelMatchesRequirement(engineByVehicle.get(vehicleId), preset.engineRequirement)) {
          preflight.push({ presetId: preset.id, title: preset.titleTr, vehicleId, unitNumber: vehicle.unit_number, status: "failed", message: "Unit engine modeli bu preset ile eşleşmiyor." });
          continue;
        }
        items.push({
          preset_id: preset.id,
          title: preset.titleTr,
          vehicle_id: vehicleId,
          vehicle_type: input.selectedVehicleType,
          service_type: preset.serviceType,
          interval_miles: intervals.intervalMiles,
          interval_days: intervals.intervalDays,
          interval_engine_hours: intervals.intervalEngineHours,
        });
      }
    }

    const result = await installMaintenanceProgramItems(
      supabase as unknown as MaintenanceProgramRpcClient,
      items,
      preflight,
    );
    if (result.results.some((item) => item.status === "created")) {
      revalidateMaintenance({ kind: "costs" });
    }
    return result;
  } catch (error) {
    return summarizeMaintenanceProgramInstall(
      preflight,
      error instanceof Error ? error.message : "Toplu bakım kurulamadı.",
    );
  }
}
