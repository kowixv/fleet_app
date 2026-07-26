"use server";

import { requireWriteRole } from "@/lib/auth";
import { revalidateMaintenance } from "@/lib/maintenance/cache";
import {
  engineModelMatchesRequirement,
  isMaintenancePackageLevel,
  isMaintenanceProgramVehicleType,
  maintenanceProgramPreset,
  presetIsInPackage,
  summarizeMaintenanceProgramStatuses,
  validateMaintenanceProgramIntervals,
  type MaintenancePackageLevel,
  type MaintenanceProgramVehicleType,
} from "@/lib/maintenance-program-presets";
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

export interface MaintenanceProgramInstallItemResult {
  presetId: string;
  title: string;
  vehicleId?: string;
  unitNumber?: string;
  status: "created" | "skipped" | "failed";
  message: string;
}

export interface MaintenanceProgramInstallResult {
  ok: boolean;
  created: number;
  skipped: number;
  failed: number;
  results: MaintenanceProgramInstallItemResult[];
  error?: string;
}

interface BulkItem {
  preset_id: string;
  title: string;
  vehicle_id: string | null;
  vehicle_type: MaintenanceProgramVehicleType;
  service_type: string;
  interval_miles: number | null;
  interval_days: number | null;
  interval_engine_hours: number | null;
}

function resultFromUnknown(value: unknown): MaintenanceProgramInstallItemResult[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Toplu kurulum yanıtı geçersiz.");
  }
  const payload = value as Record<string, unknown>;
  if (!Array.isArray(payload.results)) throw new Error("Toplu kurulum sonuçları eksik.");
  return payload.results.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("Toplu kurulum sonucu geçersiz.");
    }
    const row = item as Record<string, unknown>;
    const status = row.status;
    if (status !== "created" && status !== "skipped" && status !== "failed") {
      throw new Error("Toplu kurulum statusu geçersiz.");
    }
    return {
      presetId: typeof row.presetId === "string" ? row.presetId : "unknown",
      title: typeof row.title === "string" ? row.title : "Bakım",
      vehicleId: typeof row.vehicleId === "string" ? row.vehicleId : undefined,
      unitNumber: typeof row.unitNumber === "string" ? row.unitNumber : undefined,
      status,
      message: typeof row.message === "string" ? row.message : "-",
    };
  });
}

function summary(results: MaintenanceProgramInstallItemResult[], error?: string): MaintenanceProgramInstallResult {
  return { ...summarizeMaintenanceProgramStatuses(results), results, ...(error ? { ok: false, error } : {}) };
}

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
    const items: BulkItem[] = [];

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

    if (!items.length) return summary(preflight);
    const rpc = await supabase.rpc("install_maintenance_program_bulk", {
      p_payload: { items },
    });
    if (rpc.error) return summary(preflight, rpc.error.message);
    const results = [...preflight, ...resultFromUnknown(rpc.data)];
    if (results.some((item) => item.status === "created")) {
      revalidateMaintenance({ kind: "costs" });
    }
    return summary(results);
  } catch (error) {
    return summary(preflight, error instanceof Error ? error.message : "Toplu bakım kurulamadı.");
  }
}
