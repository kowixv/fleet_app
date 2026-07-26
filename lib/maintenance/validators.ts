import {
  MAINTENANCE_INVOICE_PIPELINE_STATUSES,
  type MaintenanceAnalytics,
  type MaintenanceAnalyticsUnit,
  type MaintenanceInvoiceJob,
  type MaintenanceInvoicePipelineStatus,
} from "@/lib/maintenance/domain";
import type { MaintenanceCostCategory } from "@/lib/maintenance-cost";
import type { MaintenanceCostRow } from "@/lib/maintenance-cost";

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} geçersiz.`);
  }
  return value as Record<string, unknown>;
}

function number(value: unknown, fallback = 0): number {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableNumber(value: unknown): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function string(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function boolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function unit(value: unknown): MaintenanceAnalyticsUnit {
  const row = object(value, "Unit maliyet özeti");
  return {
    vehicle_id: string(row.vehicle_id),
    unit_number: string(row.unit_number, "-"),
    totalCost: number(row.totalCost),
    cpmCost: number(row.cpmCost),
    milesDriven: number(row.milesDriven),
    cpm: nullableNumber(row.cpm),
    insufficientMileage: boolean(row.insufficientMileage, number(row.milesDriven) <= 0),
    plannedCost: number(row.plannedCost),
    unscheduledCost: number(row.unscheduledCost),
    tireCostPerThousand: nullableNumber(row.tireCostPerThousand),
    roadCallsPer100k: nullableNumber(row.roadCallsPer100k),
    downtimeDays: number(row.downtimeDays),
    repeatRepairs: number(row.repeatRepairs),
    mileageSource: nullableString(row.mileageSource),
    mileageEstimated: boolean(row.mileageEstimated),
  };
}

export function parseMaintenanceAnalytics(value: unknown): MaintenanceAnalytics {
  const row = object(value, "Bakım maliyet analizi");
  const unitRanking = array(row.unitRanking).map(unit);
  const fleetCpm = nullableNumber(row.fleetCpm);
  const mileageSources: Record<string, number> = {};
  const rawSources = row.mileageSources;
  if (rawSources && typeof rawSources === "object" && !Array.isArray(rawSources)) {
    for (const [key, count] of Object.entries(rawSources)) {
      mileageSources[key] = number(count);
    }
  }

  return {
    totalCount: number(row.totalCount),
    dataComplete: boolean(row.dataComplete, true),
    partialDataWarning: nullableString(row.partialDataWarning),
    totalCost: number(row.totalCost),
    cpmCost: number(row.cpmCost),
    fleetCpm,
    insufficientMileage: boolean(row.insufficientMileage),
    milesDriven: number(row.milesDriven),
    mileageEstimatedVehicleCount: number(row.mileageEstimatedVehicleCount),
    mileageUnavailableVehicleCount: number(row.mileageUnavailableVehicleCount),
    mileageSources,
    plannedCost: number(row.plannedCost),
    unscheduledCost: number(row.unscheduledCost),
    warrantyRecovery: number(row.warrantyRecovery),
    towingRoadServiceCost: number(row.towingRoadServiceCost),
    downtimeDays: number(row.downtimeDays),
    tireCostPerThousand: nullableNumber(row.tireCostPerThousand),
    roadCallsPer100k: nullableNumber(row.roadCallsPer100k),
    repeatRepairRate30Days: number(row.repeatRepairRate30Days),
    totalBreakdownImpact: number(row.totalBreakdownImpact),
    directMaintenanceCost: number(row.directMaintenanceCost),
    travelHotelImpact: number(row.travelHotelImpact),
    estimatedLostContribution: number(row.estimatedLostContribution),
    totalEstimatedOperationalImpact: number(row.totalEstimatedOperationalImpact),
    byCategory: array(row.byCategory).map((item) => {
      const category = object(item, "Kategori özeti");
      return {
        category: string(category.category, "other") as MaintenanceCostCategory,
        totalCost: number(category.totalCost),
      };
    }),
    byShop: array(row.byShop).map((item) => {
      const shop = object(item, "Shop özeti");
      return { shop: string(shop.shop, "Unknown"), totalCost: number(shop.totalCost) };
    }),
    shopOptions: array(row.shopOptions)
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0),
    unitRanking,
    aboveFleetAverage: fleetCpm == null
      ? []
      : unitRanking.filter((item) => item.cpm != null && item.cpm > fleetCpm * 1.25),
  };
}

export function isMaintenanceInvoicePipelineStatus(
  value: unknown,
): value is MaintenanceInvoicePipelineStatus {
  return typeof value === "string"
    && (MAINTENANCE_INVOICE_PIPELINE_STATUSES as readonly string[]).includes(value);
}

export function parseMaintenanceInvoiceJobs(value: unknown): MaintenanceInvoiceJob[] {
  return array(value).map((item) => {
    const row = object(item, "Invoice job");
    const job: MaintenanceInvoiceJob = {
      id: string(row.id),
      organization_id: string(row.organization_id),
      storage_path: string(row.storage_path),
      file_name: string(row.file_name),
      lease_token: string(row.lease_token),
      retry_count: number(row.retry_count),
    };
    if (!job.id || !job.organization_id || !job.storage_path || !job.lease_token) {
      throw new Error("Invoice job alanları eksik.");
    }
    return job;
  });
}

export function parseMaintenanceCostRows(value: unknown): MaintenanceCostRow[] {
  return array(value).map((item) => {
    const row = object(item, "Bakım maliyet kaydı");
    const sourceType = row.source_type;
    if (sourceType !== "maintenance_record" && sourceType !== "expense") {
      throw new Error("Bakım maliyet kaynağı geçersiz.");
    }
    return {
      organization_id: nullableString(row.organization_id) ?? undefined,
      source_record_id: string(row.source_record_id),
      source_type: sourceType,
      vehicle_id: nullableString(row.vehicle_id),
      unit_number: nullableString(row.unit_number),
      invoice_id: nullableString(row.invoice_id),
      expense_id: nullableString(row.expense_id),
      invoice_hash: nullableString(row.invoice_hash),
      cost_date: nullableString(row.cost_date),
      shop: nullableString(row.shop),
      service_type: nullableString(row.service_type),
      service_key: nullableString(row.service_key),
      category: string(row.category, "other"),
      cause: nullableString(row.cause),
      breakdown_occurred: boolean(row.breakdown_occurred),
      warranty_claim: boolean(row.warranty_claim),
      warranty_status: nullableString(row.warranty_status),
      planned: boolean(row.planned),
      status: nullableString(row.status),
      mileage_at_service: nullableNumber(row.mileage_at_service),
      parts_cost: nullableNumber(row.parts_cost),
      labor_cost: nullableNumber(row.labor_cost),
      shop_fees: nullableNumber(row.shop_fees),
      tax_cost: nullableNumber(row.tax_cost),
      towing_cost: nullableNumber(row.towing_cost),
      road_service_cost: nullableNumber(row.road_service_cost),
      hotel_travel_cost: nullableNumber(row.hotel_travel_cost),
      diagnostic_cost: nullableNumber(row.diagnostic_cost),
      freight_shipping_cost: nullableNumber(row.freight_shipping_cost),
      core_charge_cost: nullableNumber(row.core_charge_cost),
      environmental_fee_cost: nullableNumber(row.environmental_fee_cost),
      machine_shop_cost: nullableNumber(row.machine_shop_cost),
      sublet_cost: nullableNumber(row.sublet_cost),
      other_cost: nullableNumber(row.other_cost),
      warranty_recovery: nullableNumber(row.warranty_recovery),
      refund_credit: nullableNumber(row.refund_credit),
      total_cost: nullableNumber(row.total_cost),
      downtime_days: nullableNumber(row.downtime_days),
    };
  });
}

export function parseMaintenanceRpcPayload(
  value: unknown,
  label: string,
  arrayKeys: string[] = [],
): Record<string, unknown> {
  const payload = object(value, label);
  const encoded = JSON.stringify(payload);
  if (encoded.length > 1_000_000) throw new Error(`${label} çok büyük.`);
  for (const key of arrayKeys) {
    const items = payload[key];
    if (!Array.isArray(items)) throw new Error(`${label}: ${key} listesi gerekli.`);
    if (items.length > 250) throw new Error(`${label}: ${key} en fazla 250 kayıt içerebilir.`);
    for (const item of items) object(item, `${label}: ${key} kaydı`);
  }
  return payload;
}
