"use server";

import { requireWriteRole } from "@/lib/auth";
import {
  engineModelMatchesRequirement,
  findExistingProgramReminder,
  isMaintenancePackageLevel,
  isMaintenanceProgramVehicleType,
  maintenanceProgramPreset,
  presetIsInPackage,
  summarizeMaintenanceProgramStatuses,
  validateMaintenanceProgramIntervals,
  type MaintenancePackageLevel,
  type MaintenanceProgramExistingRule,
  type MaintenanceProgramVehicleType,
} from "@/lib/maintenance-program-presets";
import { isVehicleType } from "@/lib/maintenance-reminders";
import { normalizeUnitNumber, shouldUpdateMaintenancePlan, validateManualServiceName } from "@/lib/manual-maintenance";
import { createClient } from "@/lib/supabase/server";
import { todayISO } from "@/lib/tz";
import { mileageRpcErrorMessage, validateMileageInput } from "@/lib/vehicle-mileage";
import { parseMaintenanceRecordForm } from "@/lib/maintenance-record-schema";
import { maintenanceVisibleVehicleStatuses } from "@/lib/maintenance-vehicle-status";
import { revalidatePath } from "next/cache";

function maintenanceRevalidate() {
  revalidatePath("/maintenance");
  revalidatePath("/maintenance/units");
  revalidatePath("/maintenance/costs");
}

export async function updateMileage(vehicleId: string, mileage: number | string) {
  await requireWriteRole();
  if (!vehicleId) return { ok: false as const, error: "Arac gerekli." };

  const parsed = validateMileageInput(mileage);
  if (!parsed.ok) return { ok: false as const, error: parsed.error };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_vehicle_mileage", {
    p_vehicle_id: vehicleId,
    p_mileage: parsed.mileage,
    p_source: "manual",
    p_organization_id: null,
  });
  if (error) return { ok: false as const, error: mileageRpcErrorMessage(error.message) };
  maintenanceRevalidate();
  return { ok: true as const, mileage: parsed.mileage };
}

export interface ServiceDetails {
  cost?: number;
  shopName?: string;
  partName?: string;
  notes?: string;
}

function text(value: FormDataEntryValue | null): string | null {
  const raw = typeof value === "string" ? value.trim() : "";
  return raw || null;
}

interface RuleDueSummary {
  serviceType: string;
  nextDueMileage: number | null;
  nextDueDate: string | null;
  nextDueEngineHours: number | null;
}

function addDaysForAction(date: string, days: number): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isInteger(days)) return null;
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return next.toISOString().slice(0, 10);
}

function buildRuleDueSummary(rule: any | null): RuleDueSummary | null {
  if (!rule) return null;
  const lastMileage = rule.last_done_mileage == null ? null : Number(rule.last_done_mileage);
  const intervalMiles = rule.interval_miles == null ? null : Number(rule.interval_miles);
  const lastHours = rule.last_done_engine_hours == null ? null : Number(rule.last_done_engine_hours);
  const intervalHours = rule.interval_engine_hours == null ? null : Number(rule.interval_engine_hours);
  return {
    serviceType: rule.service_type,
    nextDueMileage: lastMileage != null && intervalMiles != null && intervalMiles > 0 ? lastMileage + intervalMiles : null,
    nextDueDate: rule.last_done_date && Number(rule.interval_days) > 0
      ? addDaysForAction(rule.last_done_date, Number(rule.interval_days))
      : null,
    nextDueEngineHours: lastHours != null && intervalHours != null && intervalHours > 0 ? lastHours + intervalHours : null,
  };
}

function wholeNumberOrNull(value: FormDataEntryValue | null, label: string): number | null {
  const raw = text(value);
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0 || !Number.isInteger(parsed)) {
    throw new Error(`${label} pozitif tam sayı olmalı.`);
  }
  return parsed;
}

export async function saveMaintenanceReminder(formData: FormData) {
  await requireWriteRole();
  try {
    const ruleId = text(formData.get("rule_id"));
    const vehicleType = text(formData.get("vehicle_type"));
    const serviceType = text(formData.get("service_type"));
    const intervalMiles = wholeNumberOrNull(formData.get("interval_miles"), "Mil aralığı");
    const intervalMonths = wholeNumberOrNull(formData.get("interval_months"), "Ay aralığı");
    const intervalEngineHours = wholeNumberOrNull(formData.get("interval_engine_hours"), "Engine saat aralığı");

    if (!ruleId && !isVehicleType(vehicleType)) throw new Error("Unit türü gerekli.");
    const serviceValidation = validateManualServiceName(serviceType);
    if (!serviceValidation.ok) throw new Error(serviceValidation.error ?? "Bakım türü gerekli.");
    if (intervalMiles == null && intervalMonths == null && intervalEngineHours == null) {
      throw new Error("En az bir tekrar aralığı girin.");
    }

    const payload = {
      vehicle_type: vehicleType,
      service_type: serviceValidation.value,
      interval_miles: intervalMiles,
      interval_days: intervalMonths == null ? null : intervalMonths * 30,
      interval_engine_hours: intervalEngineHours,
      active: formData.get("active") !== "false",
    };
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("save_maintenance_reminder", {
      p_rule_id: ruleId,
      p_payload: payload,
    });
    if (error) return { ok: false as const, error: error.message };
    maintenanceRevalidate();
    revalidatePath("/maintenance/reminders");
    return { ok: true as const, ruleId: data as string };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
  }
}

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

function isDuplicateReminderError(message: string): boolean {
  return /already exists|duplicate|unique|mevcut/i.test(message);
}

function maintenanceProgramSummary(results: MaintenanceProgramInstallItemResult[]): MaintenanceProgramInstallResult {
  return { ...summarizeMaintenanceProgramStatuses(results), results };
}

export async function installMaintenanceProgram(input: MaintenanceProgramInstallInput): Promise<MaintenanceProgramInstallResult> {
  const profile = await requireWriteRole();
  const results: MaintenanceProgramInstallItemResult[] = [];

  try {
    if (!isMaintenanceProgramVehicleType(input?.selectedVehicleType)) throw new Error("Geçerli bir araç türü seçin.");
    if (!isMaintenancePackageLevel(input?.selectedPackage)) throw new Error("Geçerli bir bakım paketi seçin.");
    if (!Array.isArray(input?.selections) || input.selections.length === 0) throw new Error("En az bir bakım seçin.");

    const selections = [...new Map(input.selections.map((selection) => [selection.presetId, selection])).values()];
    if (selections.length > 60) throw new Error("Tek seferde en fazla 60 bakım kurulabilir.");

    const supabase = await createClient();
    const [{ data: activeVehicles, error: vehiclesError }, { data: existingData, error: existingError }] = await Promise.all([
      supabase
        .from("vehicles")
        .select("id, unit_number, vehicle_type, status")
        .eq("organization_id", profile.organization_id)
        .eq("vehicle_type", input.selectedVehicleType)
        .in("status", maintenanceVisibleVehicleStatuses()),
      supabase
        .from("maintenance_rules")
        .select("id, vehicle_id, vehicle_type, service_type, interval_miles, interval_days, interval_engine_hours, active")
        .eq("organization_id", profile.organization_id)
        .eq("active", true),
    ]);
    if (vehiclesError) throw new Error(vehiclesError.message);
    if (existingError) throw new Error(existingError.message);

    const vehicles = (activeVehicles ?? []) as Array<{ id: string; unit_number: string; vehicle_type: string; status: string }>;
    const vehicleById = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]));
    const vehicleIds = vehicles.map((vehicle) => vehicle.id);
    const profilesResult = vehicleIds.length > 0
      ? await supabase
          .from("vehicle_maintenance_profiles")
          .select("vehicle_id, engine_model")
          .eq("organization_id", profile.organization_id)
          .in("vehicle_id", vehicleIds)
      : { data: [], error: null };
    if (profilesResult.error) throw new Error(profilesResult.error.message);
    const engineModelByVehicle = new Map(
      ((profilesResult.data ?? []) as Array<{ vehicle_id: string; engine_model: string | null }>).map((row) => [row.vehicle_id, row.engine_model]),
    );
    const hasReliableEngineData = vehicles.some((vehicle) => Boolean(engineModelByVehicle.get(vehicle.id)?.trim()));
    const existingRules = (existingData ?? []) as MaintenanceProgramExistingRule[];

    for (const selection of selections) {
      const preset = maintenanceProgramPreset(selection.presetId);
      if (!preset || preset.installMode !== "reminder") {
        results.push({ presetId: selection.presetId, title: selection.presetId, status: "failed", message: "Geçersiz veya reference-only bakım seçimi." });
        continue;
      }
      if (!presetIsInPackage(preset, input.selectedVehicleType, input.selectedPackage)) {
        results.push({ presetId: preset.id, title: preset.titleTr, status: "failed", message: "Bakım seçilen araç türü veya pakete uygulanamaz." });
        continue;
      }

      const intervals = {
        intervalMiles: selection.intervalMiles,
        intervalDays: selection.intervalDays,
        intervalEngineHours: selection.intervalEngineHours,
      };
      const intervalValidation = validateMaintenanceProgramIntervals(intervals);
      if (!intervalValidation.ok) {
        results.push({ presetId: preset.id, title: preset.titleTr, status: "failed", message: intervalValidation.error });
        continue;
      }
      const payload = {
        service_type: preset.serviceType,
        interval_miles: intervals.intervalMiles,
        interval_days: intervals.intervalDays,
        interval_engine_hours: intervals.intervalEngineHours,
        active: true,
      };

      if (!preset.engineRequirement) {
        const existing = findExistingProgramReminder(preset, existingRules, input.selectedVehicleType);
        if (existing) {
          results.push({ presetId: preset.id, title: preset.titleTr, status: "skipped", message: "Zaten mevcut." });
          continue;
        }
        const { data, error } = await supabase.rpc("save_maintenance_reminder", {
          p_rule_id: null,
          p_payload: { ...payload, vehicle_type: input.selectedVehicleType },
        });
        if (error) {
          results.push({
            presetId: preset.id,
            title: preset.titleTr,
            status: isDuplicateReminderError(error.message) ? "skipped" : "failed",
            message: isDuplicateReminderError(error.message) ? "Zaten mevcut." : error.message,
          });
          continue;
        }
        existingRules.push({ id: String(data), vehicle_id: null, vehicle_type: input.selectedVehicleType, service_type: preset.serviceType, interval_miles: intervals.intervalMiles, interval_days: intervals.intervalDays, interval_engine_hours: intervals.intervalEngineHours, active: true });
        results.push({ presetId: preset.id, title: preset.titleTr, status: "created", message: "Oluşturuldu." });
        continue;
      }

      const selectedVehicleIds = [...new Set(selection.vehicleIds ?? [])];
      if (selectedVehicleIds.length === 0) {
        results.push({ presetId: preset.id, title: preset.titleTr, status: "failed", message: "Engine-specific bakım için en az bir unit seçin." });
        continue;
      }

      for (const vehicleId of selectedVehicleIds) {
        const vehicle = vehicleById.get(vehicleId);
        if (!vehicle) {
          results.push({ presetId: preset.id, title: preset.titleTr, vehicleId, status: "failed", message: "Aktif ve uygun unit bulunamadı." });
          continue;
        }
        const engineModel = engineModelByVehicle.get(vehicleId);
        if (hasReliableEngineData && !engineModelMatchesRequirement(engineModel, preset.engineRequirement)) {
          results.push({ presetId: preset.id, title: preset.titleTr, vehicleId, unitNumber: vehicle.unit_number, status: "failed", message: "Unit engine modeli bu preset ile eşleşmiyor." });
          continue;
        }
        const existing = findExistingProgramReminder(preset, existingRules, input.selectedVehicleType, vehicleId);
        if (existing) {
          results.push({ presetId: preset.id, title: preset.titleTr, vehicleId, unitNumber: vehicle.unit_number, status: "skipped", message: "Zaten mevcut." });
          continue;
        }
        const { data, error } = await supabase.rpc("save_vehicle_maintenance_reminder", {
          p_vehicle_id: vehicleId,
          p_payload: payload,
        });
        if (error) {
          results.push({
            presetId: preset.id,
            title: preset.titleTr,
            vehicleId,
            unitNumber: vehicle.unit_number,
            status: isDuplicateReminderError(error.message) ? "skipped" : "failed",
            message: isDuplicateReminderError(error.message) ? "Zaten mevcut." : error.message,
          });
          continue;
        }
        const rpcResult = data as { rule_id?: string; created?: boolean } | null;
        const status = rpcResult?.created === false ? "skipped" as const : "created" as const;
        if (rpcResult?.rule_id) {
          existingRules.push({ id: rpcResult.rule_id, vehicle_id: vehicleId, vehicle_type: null, service_type: preset.serviceType, interval_miles: intervals.intervalMiles, interval_days: intervals.intervalDays, interval_engine_hours: intervals.intervalEngineHours, active: true });
        }
        results.push({ presetId: preset.id, title: preset.titleTr, vehicleId, unitNumber: vehicle.unit_number, status, message: status === "created" ? "Oluşturuldu." : "Zaten mevcut." });
      }
    }

    const summary = maintenanceProgramSummary(results);
    if (summary.created > 0) {
      maintenanceRevalidate();
      revalidatePath("/maintenance/reminders");
    }
    return summary;
  } catch (error) {
    return { ...maintenanceProgramSummary(results), ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function setMaintenanceReminderActive(ruleId: string, active: boolean) {
  await requireWriteRole();
  if (!ruleId) return { ok: false as const, error: "Hatırlatıcı gerekli." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_maintenance_reminder_active", {
    p_rule_id: ruleId,
    p_active: active,
  });
  if (error) return { ok: false as const, error: error.message };
  maintenanceRevalidate();
  revalidatePath("/maintenance/reminders");
  return { ok: true as const };
}

export async function saveManualMaintenance(formData: FormData) {
  await requireWriteRole();
  try {
    const vehicleId = text(formData.get("vehicle_id"));
    if (!vehicleId) throw new Error("Unit gerekli.");
    const record = parseMaintenanceRecordForm(formData);
    const kind = record.entry_kind;
    const serviceName = record.service_type;
    const updatePlan = shouldUpdateMaintenancePlan(kind, serviceName, formData.get("update_plan") === "on");
    const submissionKey = text(formData.get("submission_key")) ?? crypto.randomUUID();
    const payload = {
      ...record,
      submission_key: submissionKey,
      vehicle_id: vehicleId,
      update_plan: updatePlan,
      create_missing_rule: false,
    };

    const supabase = await createClient();
    const beforeVehicleRes = await supabase
      .from("vehicles")
      .select("id, unit_number, current_mileage")
      .eq("id", vehicleId)
      .maybeSingle();
    if (beforeVehicleRes.error) return { ok: false as const, error: beforeVehicleRes.error.message };

    const { data, error } = await supabase.rpc("save_manual_maintenance_v2", { p_payload: payload });
    if (error) return { ok: false as const, error: mileageRpcErrorMessage(error.message) };
    const rpcResult = data as {
      record_id?: string;
      rule_id?: string | null;
      rule_updated?: boolean;
      rule_created?: boolean;
      missing_rule?: boolean;
      idempotent?: boolean;
      rule_scope?: string | null;
    } | null;
    const [afterVehicleRes, ruleRes, stateRes] = await Promise.all([
      supabase.from("vehicles").select("id, unit_number, current_mileage").eq("id", vehicleId).maybeSingle(),
      rpcResult?.rule_id
        ? supabase
            .from("maintenance_rules")
            .select("id, vehicle_type, service_type, interval_miles, interval_days, interval_engine_hours, last_done_mileage, last_done_date, last_done_engine_hours")
            .eq("id", rpcResult.rule_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null } as any),
      rpcResult?.rule_id && rpcResult.rule_scope === "vehicle_type"
        ? supabase
            .from("maintenance_rule_vehicle_states")
            .select("last_done_mileage, last_done_date, last_done_engine_hours")
            .eq("rule_id", rpcResult.rule_id)
            .eq("vehicle_id", vehicleId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null } as any),
    ]);
    if (afterVehicleRes.error) return { ok: false as const, error: afterVehicleRes.error.message };
    if (ruleRes.error) return { ok: false as const, error: ruleRes.error.message };
    if (stateRes.error) return { ok: false as const, error: stateRes.error.message };

    const previousMileage = beforeVehicleRes.data?.current_mileage == null ? null : Number(beforeVehicleRes.data.current_mileage);
    const currentMileage = afterVehicleRes.data?.current_mileage == null ? null : Number(afterVehicleRes.data.current_mileage);
    const summary = {
      recordCreated: true,
      idempotent: Boolean(rpcResult?.idempotent),
      title: kind === "repair" ? "Tamir kaydedildi" : record.mileage < Number(previousMileage ?? 0) ? "Geçmiş bakım kaydedildi" : "Bakım kaydedildi",
      unitNumber: afterVehicleRes.data?.unit_number ?? beforeVehicleRes.data?.unit_number ?? null,
      serviceType: serviceName,
      kind,
      mileage: record.mileage,
      cost: record.total_cost,
      previousCurrentMileage: previousMileage,
      currentMileage,
      currentMileageChanged: previousMileage == null ? currentMileage != null : currentMileage !== previousMileage,
      currentMileageLowered: false,
      planUpdated: Boolean(rpcResult?.rule_updated),
      planCreated: Boolean(rpcResult?.rule_created),
      missingRule: Boolean(rpcResult?.missing_rule),
      historyOnly: !rpcResult?.rule_updated,
      rule: buildRuleDueSummary(stateRes.data ? { ...ruleRes.data, ...stateRes.data } : ruleRes.data),
    };
    maintenanceRevalidate();
    revalidatePath(`/maintenance/units/${vehicleId}`);
    revalidatePath("/maintenance/history");
    return { ok: true as const, result: rpcResult, summary };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function quickCreateMaintenanceVehicle(formData: FormData) {
  const profile = await requireWriteRole();
  const unitNumber = text(formData.get("unit_number"));
  const mileage = validateMileageInput(text(formData.get("current_mileage")));
  if (!unitNumber) return { ok: false as const, error: "Unit Number gerekli." };
  if (!mileage.ok) return { ok: false as const, error: mileage.error };

  const supabase = await createClient();
  const canonical = normalizeUnitNumber(unitNumber);
  const existingRes = await supabase
    .from("vehicles")
    .select("id, unit_number")
    .eq("organization_id", profile.organization_id);
  if (existingRes.error) return { ok: false as const, error: existingRes.error.message };
  const existing = (existingRes.data ?? []).find((vehicle) => normalizeUnitNumber(String(vehicle.unit_number ?? "")) === canonical);
  if (existing) {
    return { ok: true as const, result: { vehicle_id: existing.id as string, created: false } };
  }

  const { data, error } = await supabase
    .from("vehicles")
    .insert({
      organization_id: profile.organization_id,
      unit_number: canonical || unitNumber,
      vehicle_type: "truck",
      ownership_type: "company_owned",
      status: "active",
      vin: text(formData.get("vin")),
    })
    .select("id")
    .single();
  if (error) return { ok: false as const, error: mileageRpcErrorMessage(error.message) };

  const { error: mileageError } = await supabase.rpc("set_vehicle_mileage", {
    p_vehicle_id: data.id,
    p_mileage: mileage.mileage,
    p_source: "quick_vehicle_create",
    p_organization_id: null,
  });
  if (mileageError) return { ok: false as const, error: mileageRpcErrorMessage(mileageError.message) };
  maintenanceRevalidate();
  return { ok: true as const, result: { vehicle_id: data.id as string, created: true } };
}

export async function deleteManualMaintenanceRecord(recordId: string) {
  await requireWriteRole();
  if (!recordId) return { ok: false as const, error: "Bakım kaydı gerekli." };
  const supabase = await createClient();
  const beforeRes = await supabase
    .from("maintenance_records")
    .select("id, vehicle_id, rule_id, service_type, performed_date, mileage, cost, total_cost, vehicles!maintenance_records_vehicle_id_fkey(unit_number, current_mileage)")
    .eq("id", recordId)
    .maybeSingle();
  if (beforeRes.error) return { ok: false as const, error: beforeRes.error.message };
  const { data, error } = await supabase.rpc("delete_manual_maintenance_record", { p_record_id: recordId });
  if (error) return { ok: false as const, error: error.message };
  const before = beforeRes.data as any;
  const ruleRes = before?.rule_id
    ? await supabase
        .from("maintenance_rules")
        .select("id, service_type, interval_miles, interval_days, interval_engine_hours, last_done_mileage, last_done_date, last_done_engine_hours")
        .eq("id", before.rule_id)
        .maybeSingle()
    : { data: null, error: null };
  if (ruleRes.error) return { ok: false as const, error: ruleRes.error.message };
  maintenanceRevalidate();
  revalidatePath("/maintenance/history");
  return {
    ok: true as const,
    result: data,
    summary: {
      recordDeleted: true,
      unitNumber: before?.vehicles?.unit_number ?? null,
      serviceType: before?.service_type ?? null,
      performedDate: before?.performed_date ?? null,
      mileage: before?.mileage == null ? null : Number(before.mileage),
      cost: before?.total_cost ?? before?.cost ?? null,
      planRecalculated: Boolean((data as any)?.rule_recalculated),
      currentMileagePreserved: true,
      rule: buildRuleDueSummary(ruleRes.data),
    },
  };
}

export async function editManualMaintenanceRecord(formData: FormData) {
  await requireWriteRole();
  try {
    const recordId = text(formData.get("record_id"));
    if (!recordId) throw new Error("Bakım kaydı gerekli.");
    const record = parseMaintenanceRecordForm(formData, { allowCategoryFromForm: true });
    const kind = record.entry_kind;
    const serviceName = record.service_type;
    const payload = {
      ...record,
      record_id: recordId,
    };
    const supabase = await createClient();
    const beforeRes = await supabase
      .from("maintenance_records")
      .select("id, vehicle_id, rule_id, service_type, planned, vehicles!maintenance_records_vehicle_id_fkey(unit_number, current_mileage)")
      .eq("id", recordId)
      .maybeSingle();
    if (beforeRes.error) return { ok: false as const, error: beforeRes.error.message };
    const { data, error } = await supabase.rpc("edit_manual_maintenance_record", { p_payload: payload });
    if (error) return { ok: false as const, error: mileageRpcErrorMessage(error.message) };
    const rpcResult = data as {
      record_id?: string;
      old_rule_recalculated?: boolean;
      new_rule_recalculated?: boolean;
      rule_recalculated?: boolean;
      new_rule_id?: string | null;
    } | null;
    const ruleId = rpcResult?.new_rule_id ?? (beforeRes.data as any)?.rule_id ?? null;
    const ruleRes = ruleId
      ? await supabase
          .from("maintenance_rules")
          .select("id, service_type, interval_miles, interval_days, interval_engine_hours, last_done_mileage, last_done_date, last_done_engine_hours")
          .eq("id", ruleId)
          .maybeSingle()
      : { data: null, error: null };
    if (ruleRes.error) return { ok: false as const, error: ruleRes.error.message };
    maintenanceRevalidate();
    revalidatePath("/maintenance/history");
    return {
      ok: true as const,
      result: data,
      summary: {
        recordUpdated: true,
        unitNumber: (beforeRes.data as any)?.vehicles?.unit_number ?? null,
        previousServiceType: (beforeRes.data as any)?.service_type ?? null,
        serviceType: serviceName,
        kind,
        mileage: record.mileage,
        cost: record.total_cost,
        currentMileagePreservedOrAdvanced: true,
        planRecalculated: Boolean(rpcResult?.old_rule_recalculated || rpcResult?.new_rule_recalculated || rpcResult?.rule_recalculated),
        rule: buildRuleDueSummary(ruleRes.data),
      },
    };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Atomic and idempotent: DB re-reads the authoritative vehicle mileage. */
export async function markServiced(ruleId: string, details: ServiceDetails = {}) {
  await requireWriteRole();
  const cost = Number(details.cost ?? 0);
  if (!ruleId) return { ok: false as const, error: "Bakim kurali gerekli." };
  if (!Number.isFinite(cost) || cost < 0) {
    return { ok: false as const, error: "Maliyet negatif olamaz." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("mark_maintenance_serviced", {
    p_rule_id: ruleId,
    p_performed_date: todayISO(),
    p_cost: cost,
    p_shop_name: details.shopName?.trim() || null,
    p_part_name: details.partName?.trim() || null,
    p_notes: details.notes?.trim() || null,
  });
  if (error) return { ok: false as const, error: error.message };
  maintenanceRevalidate();
  return { ok: true as const, recordId: data as string };
}
