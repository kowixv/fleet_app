"use server";

import { requireWriteRole } from "@/lib/auth";
import { revalidateMaintenance } from "@/lib/maintenance/cache";
import {
  installMaintenanceProgramItems,
  summarizeMaintenanceProgramInstall,
  type MaintenanceProgramBulkItem,
  type MaintenanceProgramInstallResult,
  type MaintenanceProgramRpcClient,
} from "@/lib/maintenance/program-installation";
import { isMaintenanceProgramVehicleType } from "@/lib/maintenance-program-presets";
import { maintenanceVisibleVehicleStatuses } from "@/lib/maintenance-vehicle-status";
import { createClient } from "@/lib/supabase/server";
import {
  buildVehicleMaintenancePresetPlan,
  isVehicleMaintenanceBaselineMode,
  isVehicleMaintenanceSetupMode,
  type VehicleMaintenanceBaselineMode,
  type VehicleMaintenanceSetupInput,
  type VehicleMaintenanceSetupMode,
} from "@/lib/vehicle-maintenance-setup";
import { revalidatePath } from "next/cache";

export interface VehicleMaintenanceSetupResult extends MaintenanceProgramInstallResult {
  vehicleId: string;
  mode: VehicleMaintenanceSetupMode;
  baselineMode: VehicleMaintenanceBaselineMode;
  needsInformation: string[];
}

interface BaselineRpcPayload {
  needsInformation?: unknown;
}

function validUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function parseNeedsInformation(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const payload = value as BaselineRpcPayload;
  return Array.isArray(payload.needsInformation)
    ? payload.needsInformation.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function failedSetup(
  vehicleId: string,
  input: VehicleMaintenanceSetupInput,
  error: string,
): VehicleMaintenanceSetupResult {
  return {
    vehicleId,
    mode: input.mode,
    baselineMode: input.baselineMode,
    needsInformation: [],
    ...summarizeMaintenanceProgramInstall([], error),
  };
}

export async function installVehicleMaintenanceSetup(input: {
  vehicleId: string;
  mode: VehicleMaintenanceSetupMode;
  baselineMode: VehicleMaintenanceBaselineMode;
  sourceVehicleId?: string | null;
}): Promise<VehicleMaintenanceSetupResult> {
  const profile = await requireWriteRole();
  const normalized: VehicleMaintenanceSetupInput = {
    mode: input?.mode,
    baselineMode: input?.baselineMode,
    sourceVehicleId: input?.sourceVehicleId ?? null,
  };
  if (!validUuid(input?.vehicleId)) return failedSetup(String(input?.vehicleId ?? ""), normalized, "Geçerli bir araç gerekli.");
  if (!isVehicleMaintenanceSetupMode(normalized.mode)) return failedSetup(input.vehicleId, normalized, "Geçerli bir bakım kurulumu seçin.");
  if (!isVehicleMaintenanceBaselineMode(normalized.baselineMode)) return failedSetup(input.vehicleId, normalized, "Geçerli bir takip başlangıcı seçin.");

  const supabase = await createClient();
  const vehicleResult = await supabase
    .from("vehicles")
    .select("id, unit_number, vehicle_type, current_mileage")
    .eq("organization_id", profile.organization_id)
    .eq("id", input.vehicleId)
    .in("status", maintenanceVisibleVehicleStatuses())
    .maybeSingle();
  if (vehicleResult.error) return failedSetup(input.vehicleId, normalized, vehicleResult.error.message);
  if (!vehicleResult.data) return failedSetup(input.vehicleId, normalized, "Aktif ve organizasyona ait araç bulunamadı.");

  const target = vehicleResult.data;
  if (!isMaintenanceProgramVehicleType(target.vehicle_type) && normalized.mode !== "none") {
    return failedSetup(input.vehicleId, normalized, "Bu araç tipi için hazır bakım kurulumu desteklenmiyor.");
  }

  const maintenanceProfile = await supabase
    .from("vehicle_maintenance_profiles")
    .select("engine_model")
    .eq("organization_id", profile.organization_id)
    .eq("vehicle_id", target.id)
    .maybeSingle();
  if (maintenanceProfile.error) return failedSetup(input.vehicleId, normalized, maintenanceProfile.error.message);

  let items: MaintenanceProgramBulkItem[] = [];
  let needsInformation: string[] = [];
  if (normalized.mode === "basic" || normalized.mode === "full") {
    const plan = buildVehicleMaintenancePresetPlan({
      vehicleId: target.id,
      vehicleType: target.vehicle_type,
      engineModel: maintenanceProfile.data?.engine_model ?? null,
      packageLevel: normalized.mode,
    });
    items = plan.items;
    needsInformation = plan.needsInformation;
  } else if (normalized.mode === "copy") {
    if (!validUuid(normalized.sourceVehicleId)) {
      return failedSetup(input.vehicleId, normalized, "Kopyalanacak benzer aracı seçin.");
    }
    const sourceResult = await supabase
      .from("vehicles")
      .select("id, unit_number, vehicle_type")
      .eq("organization_id", profile.organization_id)
      .eq("id", normalized.sourceVehicleId)
      .eq("vehicle_type", target.vehicle_type)
      .in("status", maintenanceVisibleVehicleStatuses())
      .maybeSingle();
    if (sourceResult.error) return failedSetup(input.vehicleId, normalized, sourceResult.error.message);
    if (!sourceResult.data) {
      return failedSetup(input.vehicleId, normalized, "Kaynak araç aynı organizasyonda ve aynı tipte olmalı.");
    }
    const rulesResult = await supabase
      .from("maintenance_rules")
      .select("id, service_type, interval_miles, interval_days, interval_engine_hours")
      .eq("organization_id", profile.organization_id)
      .eq("vehicle_id", sourceResult.data.id)
      .eq("active", true);
    if (rulesResult.error) return failedSetup(input.vehicleId, normalized, rulesResult.error.message);
    items = (rulesResult.data ?? []).map((rule) => ({
      preset_id: `copy:${rule.id}`,
      title: rule.service_type,
      vehicle_id: target.id,
      vehicle_type: target.vehicle_type as "truck" | "box_truck",
      service_type: rule.service_type,
      interval_miles: rule.interval_miles,
      interval_days: rule.interval_days,
      interval_engine_hours: rule.interval_engine_hours,
    }));
    if (items.length === 0) needsInformation.push(`Unit ${sourceResult.data.unit_number} üzerinde kopyalanacak aktif araç-özel bakım yok.`);
  }

  let installResult = await installMaintenanceProgramItems(
    supabase as unknown as MaintenanceProgramRpcClient,
    items,
  );
  const effectiveBaselineMode = normalized.mode === "none" ? "manual" : normalized.baselineMode;
  const baseline = await supabase.rpc("initialize_vehicle_maintenance_baseline", {
    p_vehicle_id: target.id,
    p_mode: effectiveBaselineMode,
  });
  if (baseline.error) {
    installResult = summarizeMaintenanceProgramInstall(
      [
        ...installResult.results,
        {
          presetId: "tracking-baseline",
          title: "Takip başlangıcı",
          vehicleId: target.id,
          unitNumber: target.unit_number,
          status: "failed",
          message: baseline.error.message,
        },
      ],
      installResult.error,
    );
  } else if (normalized.mode !== "none") {
    needsInformation = [...new Set([...needsInformation, ...parseNeedsInformation(baseline.data)])];
  }

  revalidateMaintenance({ kind: "costs" });
  revalidatePath("/vehicles");
  return {
    ...installResult,
    vehicleId: target.id,
    mode: normalized.mode,
    baselineMode: normalized.baselineMode,
    needsInformation,
  };
}

export async function updateVehicleMaintenanceDefaults(formData: FormData): Promise<void> {
  const profile = await requireWriteRole();
  const truckPackage = formData.get("new_truck_maintenance_package");
  const boxTruckPackage = formData.get("new_box_truck_maintenance_package");
  const baselineMode = formData.get("new_vehicle_maintenance_baseline_mode");
  if (truckPackage !== "basic" && truckPackage !== "full") throw new Error("Geçerli bir Semi Truck paketi seçin.");
  if (boxTruckPackage !== "basic" && boxTruckPackage !== "full") throw new Error("Geçerli bir Box Truck paketi seçin.");
  if (!isVehicleMaintenanceBaselineMode(baselineMode)) throw new Error("Geçerli bir takip başlangıcı seçin.");

  const supabase = await createClient();
  const { error } = await supabase.from("settings").upsert({
    organization_id: profile.organization_id,
    new_vehicle_auto_maintenance_setup: formData.get("new_vehicle_auto_maintenance_setup") === "on",
    new_truck_maintenance_package: truckPackage,
    new_box_truck_maintenance_package: boxTruckPackage,
    new_vehicle_maintenance_baseline_mode: baselineMode,
    updated_at: new Date().toISOString(),
  }, { onConflict: "organization_id" });
  if (error) throw new Error(error.message);
  revalidatePath("/maintenance/settings");
  revalidatePath("/vehicles");
}
