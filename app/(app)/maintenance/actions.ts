"use server";

import { requireWriteRole } from "@/lib/auth";
import { manualMaintenanceCategory, manualServiceOption, normalizeUnitNumber, shouldUpdateMaintenancePlan, type ManualMaintenanceKind } from "@/lib/manual-maintenance";
import { createClient } from "@/lib/supabase/server";
import { todayISO } from "@/lib/tz";
import { mileageRpcErrorMessage, validateMileageInput } from "@/lib/vehicle-mileage";
import { revalidatePath } from "next/cache";

function maintenanceRevalidate() {
  revalidatePath("/maintenance");
  revalidatePath("/maintenance/units");
  revalidatePath("/maintenance/costs");
  revalidatePath("/vehicles");
  revalidatePath("/");
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

function money(value: FormDataEntryValue | null): number | null {
  const raw = typeof value === "string" ? value.trim().replace(/,/g, "") : "";
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error("Maliyet negatif olamaz.");
  return Math.round(parsed * 100) / 100;
}

function dateOnly(value: FormDataEntryValue | null, label: string): string {
  const raw = text(value);
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new Error(`${label} gerekli.`);
  return raw;
}

function partsFromForm(formData: FormData): string[] {
  return formData
    .getAll("parts_used")
    .flatMap((value) => (typeof value === "string" ? value.split(",") : []))
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 25);
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

export async function saveManualMaintenance(formData: FormData) {
  await requireWriteRole();
  try {
    const vehicleId = text(formData.get("vehicle_id"));
    const kind = text(formData.get("entry_kind")) as ManualMaintenanceKind | null;
    const serviceType = text(formData.get("service_type"));
    const performedDate = dateOnly(formData.get("performed_date"), "Yapılma tarihi");
    const mileage = validateMileageInput(text(formData.get("mileage")));
    const totalCost = money(formData.get("cost"));
    const laborCost = money(formData.get("labor_cost"));
    const partsCost = money(formData.get("parts_cost"));
    const shopFees = money(formData.get("shop_fees"));
    const taxCost = money(formData.get("tax_cost"));

    if (!vehicleId) throw new Error("Unit gerekli.");
    if (kind !== "periodic" && kind !== "repair") throw new Error("İşlem türü gerekli.");
    if (!serviceType) throw new Error("Bakım / tamir çeşidi gerekli.");
    if (!manualServiceOption(kind, serviceType)) throw new Error("Geçerli bir servis seçin.");
    if (kind !== "periodic" && kind !== "repair") throw new Error("İşlem türü gerekli.");
    if (!serviceType) throw new Error("Bakım / tamir çeşidi gerekli.");
    if (!manualServiceOption(kind, serviceType)) throw new Error("Geçerli bir servis seçin.");
    if (kind !== "periodic" && kind !== "repair") throw new Error("İşlem türü gerekli.");
    if (!serviceType) throw new Error("Bakım / tamir çeşidi gerekli.");
    if (!manualServiceOption(kind, serviceType)) throw new Error("Geçerli bir servis seçin.");
    if (!mileage.ok) throw new Error(mileage.error);

    const updatePlan = shouldUpdateMaintenancePlan(kind, serviceType, formData.get("update_plan") === "on");
    const submissionKey = text(formData.get("submission_key")) ?? crypto.randomUUID();
    const payload = {
      submission_key: submissionKey,
      vehicle_id: vehicleId,
      entry_kind: kind,
      service_type: serviceType,
      performed_date: performedDate,
      mileage: mileage.mileage,
      total_cost: totalCost,
      cost: totalCost,
      shop_name: text(formData.get("shop_name")),
      vendor: text(formData.get("shop_name")),
      parts_used: partsFromForm(formData),
      invoice_number: text(formData.get("invoice_number")),
      notes: text(formData.get("notes")),
      labor_cost: laborCost,
      parts_cost: partsCost,
      shop_fees: shopFees,
      tax_cost: taxCost,
      downtime_start: text(formData.get("downtime_start")),
      downtime_end: text(formData.get("downtime_end")),
      category: manualMaintenanceCategory(kind, serviceType),
      planned: kind === "periodic",
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

    const { data, error } = await supabase.rpc("save_manual_maintenance", { p_payload: payload });
    if (error) return { ok: false as const, error: mileageRpcErrorMessage(error.message) };
    const rpcResult = data as {
      record_id?: string;
      rule_id?: string | null;
      rule_updated?: boolean;
      rule_created?: boolean;
      missing_rule?: boolean;
      idempotent?: boolean;
    } | null;
    const [afterVehicleRes, ruleRes] = await Promise.all([
      supabase.from("vehicles").select("id, unit_number, current_mileage").eq("id", vehicleId).maybeSingle(),
      rpcResult?.rule_id
        ? supabase
            .from("maintenance_rules")
            .select("id, service_type, interval_miles, interval_days, interval_engine_hours, last_done_mileage, last_done_date, last_done_engine_hours")
            .eq("id", rpcResult.rule_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null } as any),
    ]);
    if (afterVehicleRes.error) return { ok: false as const, error: afterVehicleRes.error.message };
    if (ruleRes.error) return { ok: false as const, error: ruleRes.error.message };

    const previousMileage = beforeVehicleRes.data?.current_mileage == null ? null : Number(beforeVehicleRes.data.current_mileage);
    const currentMileage = afterVehicleRes.data?.current_mileage == null ? null : Number(afterVehicleRes.data.current_mileage);
    const summary = {
      recordCreated: true,
      idempotent: Boolean(rpcResult?.idempotent),
      title: kind === "repair" ? "Tamir kaydedildi" : mileage.mileage < Number(previousMileage ?? 0) ? "Geçmiş bakım kaydedildi" : "Bakım kaydedildi",
      unitNumber: afterVehicleRes.data?.unit_number ?? beforeVehicleRes.data?.unit_number ?? null,
      serviceType,
      kind,
      mileage: mileage.mileage,
      cost: totalCost,
      previousCurrentMileage: previousMileage,
      currentMileage,
      currentMileageChanged: previousMileage == null ? currentMileage != null : currentMileage !== previousMileage,
      currentMileageLowered: false,
      planUpdated: Boolean(rpcResult?.rule_updated),
      planCreated: Boolean(rpcResult?.rule_created),
      missingRule: Boolean(rpcResult?.missing_rule),
      historyOnly: kind === "repair" || !rpcResult?.rule_updated,
      rule: buildRuleDueSummary(ruleRes.data),
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
    const kind = text(formData.get("entry_kind")) as ManualMaintenanceKind | null;
    const serviceType = text(formData.get("service_type"));
    const performedDate = dateOnly(formData.get("performed_date"), "Yapılma tarihi");
    const mileage = validateMileageInput(text(formData.get("mileage")));
    const cost = money(formData.get("cost"));
    if (!recordId) throw new Error("Bakım kaydı gerekli.");
    if (!mileage.ok) throw new Error(mileage.error);
    if (kind !== "periodic" && kind !== "repair") throw new Error("İşlem türü gerekli.");
    if (!serviceType) throw new Error("Bakım / tamir çeşidi gerekli.");
    if (!manualServiceOption(kind, serviceType)) throw new Error("Geçerli bir servis seçin.");
    const payload = {
      record_id: recordId,
      entry_kind: kind,
      service_type: serviceType,
      category: manualMaintenanceCategory(kind, serviceType),
      performed_date: performedDate,
      mileage: mileage.mileage,
      cost,
      shop_name: text(formData.get("shop_name")),
      invoice_number: text(formData.get("invoice_number")),
      notes: text(formData.get("notes")),
      parts_used: partsFromForm(formData),
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
        serviceType,
        kind,
        mileage: mileage.mileage,
        cost,
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
