import { isWorkOrderStatus } from "./maintenance-work-orders";

export const MAINTENANCE_BUDGET_SCOPES = [
  "annual_org",
  "monthly_org",
  "vehicle",
  "category",
  "vendor",
] as const;
export type MaintenanceBudgetScope = (typeof MAINTENANCE_BUDGET_SCOPES)[number];

export const WARRANTY_CLAIM_STATUSES = [
  "draft",
  "submitted",
  "under_review",
  "approved",
  "partially_approved",
  "denied",
  "paid",
  "closed",
] as const;
export type WarrantyClaimStatus = (typeof WARRANTY_CLAIM_STATUSES)[number];

const WARRANTY_TRANSITIONS: Record<WarrantyClaimStatus, readonly WarrantyClaimStatus[]> = {
  draft: ["submitted", "closed"],
  submitted: ["under_review", "approved", "partially_approved", "denied"],
  under_review: ["approved", "partially_approved", "denied"],
  approved: ["paid", "closed"],
  partially_approved: ["paid", "closed"],
  denied: ["closed"],
  paid: ["closed"],
  closed: [],
};

export function isWarrantyClaimStatus(value: unknown): value is WarrantyClaimStatus {
  return typeof value === "string" && WARRANTY_CLAIM_STATUSES.includes(value as WarrantyClaimStatus);
}

export function canTransitionWarrantyClaim(from: WarrantyClaimStatus, to: WarrantyClaimStatus): boolean {
  return WARRANTY_TRANSITIONS[from].includes(to);
}

export function allowedWarrantyClaimTransitions(status: WarrantyClaimStatus): readonly WarrantyClaimStatus[] {
  return WARRANTY_TRANSITIONS[status];
}

export function warrantyClaimStatusLabel(status: WarrantyClaimStatus): string {
  return {
    draft: "Taslak",
    submitted: "Gönderildi",
    under_review: "İncelemede",
    approved: "Onaylandı",
    partially_approved: "Kısmen onaylandı",
    denied: "Reddedildi",
    paid: "Tahsil edildi",
    closed: "Kapatıldı",
  }[status];
}

function text(value: FormDataEntryValue | null, max = 2_000): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized ? normalized.slice(0, max) : null;
}

function required(value: FormDataEntryValue | null, label: string, max = 300): string {
  const normalized = text(value, max);
  if (!normalized) throw new Error(`${label} gerekli.`);
  return normalized;
}

function uuid(value: FormDataEntryValue | null, label: string, optional = false): string | null {
  const normalized = text(value, 100);
  if (!normalized && optional) return null;
  if (!normalized || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)) {
    throw new Error(`${label} geçersiz.`);
  }
  return normalized;
}

function money(value: FormDataEntryValue | null, label: string, requiredValue = false): number | null {
  const normalized = text(value);
  if (!normalized) {
    if (requiredValue) throw new Error(`${label} gerekli.`);
    return null;
  }
  const parsed = Number(normalized.replace(/,/g, ""));
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${label} negatif olamaz.`);
  return Math.round(parsed * 100) / 100;
}

function date(value: FormDataEntryValue | null, label: string): string | null {
  const normalized = text(value, 10);
  if (!normalized) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized) || Number.isNaN(Date.parse(`${normalized}T00:00:00Z`))) {
    throw new Error(`${label} geçersiz.`);
  }
  return normalized;
}

export interface MaintenanceBudgetPayload {
  fiscal_year: number;
  month: number | null;
  scope: MaintenanceBudgetScope;
  vehicle_id: string | null;
  category: string | null;
  vendor: string | null;
  budget_amount: number;
  notes: string | null;
}

export function parseMaintenanceBudgetForm(formData: FormData): MaintenanceBudgetPayload {
  const year = Number(text(formData.get("fiscal_year"), 4));
  const rawMonth = text(formData.get("month"), 2);
  const month = rawMonth ? Number(rawMonth) : null;
  const scope = text(formData.get("scope"), 30);
  if (!Number.isInteger(year) || year < 2000 || year > 2200) throw new Error("Bütçe yılı geçersiz.");
  if (month != null && (!Number.isInteger(month) || month < 1 || month > 12)) throw new Error("Bütçe ayı geçersiz.");
  if (!scope || !MAINTENANCE_BUDGET_SCOPES.includes(scope as MaintenanceBudgetScope)) throw new Error("Bütçe kapsamı geçersiz.");
  const typedScope = scope as MaintenanceBudgetScope;
  const vehicleId = uuid(formData.get("vehicle_id"), "Unit", true);
  const category = text(formData.get("category"), 100);
  const vendor = text(formData.get("vendor"), 300);
  if (typedScope === "annual_org" && month != null) throw new Error("Yıllık organizasyon bütçesinde ay seçilemez.");
  if (typedScope === "monthly_org" && month == null) throw new Error("Aylık organizasyon bütçesinde ay gerekli.");
  if (typedScope === "vehicle" && !vehicleId) throw new Error("Unit bütçesi için unit gerekli.");
  if (typedScope === "category" && !category) throw new Error("Kategori bütçesi için kategori gerekli.");
  if (typedScope === "vendor" && !vendor) throw new Error("Vendor bütçesi için vendor gerekli.");
  return {
    fiscal_year: year,
    month,
    scope: typedScope,
    vehicle_id: typedScope === "vehicle" ? vehicleId : null,
    category: typedScope === "category" ? category : null,
    vendor: typedScope === "vendor" ? vendor : null,
    budget_amount: money(formData.get("budget_amount"), "Bütçe", true) ?? 0,
    notes: text(formData.get("notes"), 2_000),
  };
}

export interface WarrantyClaimPayload {
  work_order_id: string | null;
  maintenance_record_id: string | null;
  vehicle_id: string;
  vendor_manufacturer: string;
  claim_number: string | null;
  submitted_date: string | null;
  submitted_amount: number | null;
  approved_amount: number | null;
  received_amount: number | null;
  expected_recovery_date: string | null;
  denial_reason: string | null;
  notes: string | null;
}

export function parseWarrantyClaimForm(formData: FormData): WarrantyClaimPayload {
  const workOrderId = uuid(formData.get("work_order_id"), "Work order", true);
  const maintenanceRecordId = uuid(formData.get("maintenance_record_id"), "Bakım kaydı", true);
  if (!workOrderId && !maintenanceRecordId) throw new Error("Work order veya bakım kaydı bağlantısı gerekli.");
  const submittedAmount = money(formData.get("submitted_amount"), "Talep tutarı");
  const approvedAmount = money(formData.get("approved_amount"), "Onaylanan tutar");
  const receivedAmount = money(formData.get("received_amount"), "Tahsil edilen tutar");
  if (approvedAmount != null && submittedAmount != null && approvedAmount > submittedAmount) {
    throw new Error("Onaylanan tutar talep tutarını aşamaz.");
  }
  if (receivedAmount != null && approvedAmount != null && receivedAmount > approvedAmount) {
    throw new Error("Tahsil edilen tutar onaylanan tutarı aşamaz.");
  }
  return {
    work_order_id: workOrderId,
    maintenance_record_id: maintenanceRecordId,
    vehicle_id: uuid(formData.get("vehicle_id"), "Unit") as string,
    vendor_manufacturer: required(formData.get("vendor_manufacturer"), "Vendor / manufacturer"),
    claim_number: text(formData.get("claim_number"), 200),
    submitted_date: date(formData.get("submitted_date"), "Gönderim tarihi"),
    submitted_amount: submittedAmount,
    approved_amount: approvedAmount,
    received_amount: receivedAmount,
    expected_recovery_date: date(formData.get("expected_recovery_date"), "Beklenen recovery tarihi"),
    denial_reason: text(formData.get("denial_reason"), 2_000),
    notes: text(formData.get("notes"), 5_000),
  };
}

export interface BudgetPerformanceInput {
  budget: number;
  actual: number;
  committed: number;
  elapsedFraction: number;
  periodComplete?: boolean;
}

export interface BudgetPerformance {
  budget: number;
  actual: number;
  committed: number;
  forecast: number;
  variance: number;
  percentageUsed: number | null;
}

export function calculateBudgetPerformance(input: BudgetPerformanceInput): BudgetPerformance {
  const budget = Math.max(0, input.budget);
  const actual = Math.max(0, input.actual);
  const committed = Math.max(0, input.committed);
  const elapsed = Math.min(1, Math.max(0, input.elapsedFraction));
  const runRate = input.periodComplete || elapsed <= 0 ? actual : actual / elapsed;
  const forecast = Math.max(actual + committed, runRate + committed);
  return {
    budget,
    actual,
    committed,
    forecast,
    variance: budget - forecast,
    percentageUsed: budget > 0 ? (actual + committed) / budget : null,
  };
}

export interface OperationalImpactInput {
  directMaintenanceCost: number;
  hotelTravelCost: number;
  towingRoadServiceCost: number;
  downtimeDays: number;
  averageDailyContribution: number;
}

export interface OperationalImpact {
  directMaintenanceCost: number;
  travelHotelImpact: number;
  towingRoadServiceImpact: number;
  estimatedLostContribution: number;
  totalEstimatedOperationalImpact: number;
}

export function calculateOperationalImpact(input: OperationalImpactInput): OperationalImpact {
  const directMaintenanceCost = Math.max(0, input.directMaintenanceCost);
  const travelHotelImpact = Math.max(0, input.hotelTravelCost);
  const towingRoadServiceImpact = Math.max(0, input.towingRoadServiceCost);
  const estimatedLostContribution = Math.max(0, input.downtimeDays) * Math.max(0, input.averageDailyContribution);
  return {
    directMaintenanceCost,
    travelHotelImpact,
    towingRoadServiceImpact,
    estimatedLostContribution,
    totalEstimatedOperationalImpact:
      directMaintenanceCost + travelHotelImpact + towingRoadServiceImpact + estimatedLostContribution,
  };
}

export interface RepairReplaceThresholds {
  cost12m: number;
  cpm: number;
  downtimeDays12m: number;
  vehicleAgeYears: number;
}

export interface RepairReplaceMetrics {
  maintenanceCost12m: number;
  cpm12m: number | null;
  downtimeDays12m: number;
  vehicleAgeYears: number | null;
  repeatRepairs12m: number;
  openEstimatedRepairs: number;
}

export function evaluateRepairReplace(metrics: RepairReplaceMetrics, thresholds: RepairReplaceThresholds) {
  const signals = [
    metrics.maintenanceCost12m >= Math.max(0, thresholds.cost12m),
    metrics.cpm12m != null && metrics.cpm12m >= Math.max(0, thresholds.cpm),
    metrics.downtimeDays12m >= Math.max(0, thresholds.downtimeDays12m),
    metrics.vehicleAgeYears != null && metrics.vehicleAgeYears >= Math.max(0, thresholds.vehicleAgeYears),
  ];
  const triggeredSignals = signals.filter(Boolean).length;
  return {
    triggeredSignals,
    advisory: triggeredSignals >= 2 ? "replacement_review" as const : "continue_monitoring" as const,
  };
}

export function committedWorkOrderCost(row: {
  status: unknown;
  approval_state: unknown;
  approved_cost_limit: number | null;
  estimated_cost: number | null;
}): number {
  if (!isWorkOrderStatus(row.status) || ["completed", "invoiced", "closed", "cancelled"].includes(row.status)) return 0;
  if (row.approval_state !== "approved" && row.approval_state !== "not_required") return 0;
  return Math.max(0, Number(row.approved_cost_limit ?? row.estimated_cost ?? 0));
}

export interface BudgetPerformanceRow {
  id: string;
  fiscal_year: number;
  month: number | null;
  scope: MaintenanceBudgetScope;
  vehicle_id: string | null;
  category: string | null;
  vendor: string | null;
  budget_amount: number;
  notes: string | null;
  actual: number;
  committed: number;
}

export interface VendorScorecardRow {
  vendor: string;
  total_spend: number;
  average_repair_cost: number;
  repeat_repair_rate: number;
  average_downtime_days: number;
  estimate_to_final_variance: number;
  warranty_recovery: number;
  road_calls_after_repair: number;
  open_work_orders: number;
}

export interface VehicleDecisionRow {
  vehicle_id: string;
  unit_number: string;
  current_mileage: number | null;
  vehicle_age_years: number | null;
  maintenance_cost_3m: number;
  maintenance_cost_6m: number;
  maintenance_cost_12m: number;
  miles_12m: number;
  cpm_12m: number | null;
  downtime_days_12m: number;
  repeat_repairs_12m: number;
  open_estimated_repairs: number;
  direct_maintenance_cost: number;
  travel_hotel_impact: number;
  towing_road_service_impact: number;
  estimated_lost_contribution: number;
  total_estimated_operational_impact: number;
}

export interface DecisionAnalytics {
  settings: {
    average_daily_contribution: number;
    replacement_cost_12m_threshold: number;
    replacement_cpm_threshold: number;
    replacement_downtime_days_threshold: number;
    replacement_vehicle_age_years_threshold: number;
  };
  vendors: VendorScorecardRow[];
  vehicles: VehicleDecisionRow[];
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Analitik yanıtı geçersiz.");
  return value as Record<string, unknown>;
}

function numberValue(value: unknown, nullable = false): number | null {
  if (nullable && value == null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error("Analitik sayısal alanı geçersiz.");
  return parsed;
}

function stringValue(value: unknown, nullable = false): string | null {
  if (nullable && value == null) return null;
  if (typeof value !== "string") throw new Error("Analitik metin alanı geçersiz.");
  return value;
}

export function parseBudgetPerformanceRows(value: unknown): BudgetPerformanceRow[] {
  if (!Array.isArray(value)) throw new Error("Bütçe performans yanıtı geçersiz.");
  return value.map((item) => {
    const row = object(item);
    const scope = stringValue(row.scope);
    if (!scope || !MAINTENANCE_BUDGET_SCOPES.includes(scope as MaintenanceBudgetScope)) throw new Error("Bütçe kapsamı geçersiz.");
    return {
      id: stringValue(row.id) as string,
      fiscal_year: numberValue(row.fiscal_year) as number,
      month: numberValue(row.month, true),
      scope: scope as MaintenanceBudgetScope,
      vehicle_id: stringValue(row.vehicle_id, true),
      category: stringValue(row.category, true),
      vendor: stringValue(row.vendor, true),
      budget_amount: numberValue(row.budget_amount) as number,
      notes: stringValue(row.notes, true),
      actual: numberValue(row.actual) as number,
      committed: numberValue(row.committed) as number,
    };
  });
}

export function parseDecisionAnalytics(value: unknown): DecisionAnalytics {
  const root = object(value);
  const settings = object(root.settings);
  const vendors = Array.isArray(root.vendors) ? root.vendors : [];
  const vehicles = Array.isArray(root.vehicles) ? root.vehicles : [];
  return {
    settings: {
      average_daily_contribution: numberValue(settings.average_daily_contribution) as number,
      replacement_cost_12m_threshold: numberValue(settings.replacement_cost_12m_threshold) as number,
      replacement_cpm_threshold: numberValue(settings.replacement_cpm_threshold) as number,
      replacement_downtime_days_threshold: numberValue(settings.replacement_downtime_days_threshold) as number,
      replacement_vehicle_age_years_threshold: numberValue(settings.replacement_vehicle_age_years_threshold) as number,
    },
    vendors: vendors.map((item) => {
      const row = object(item);
      return {
        vendor: stringValue(row.vendor) as string,
        total_spend: numberValue(row.total_spend) as number,
        average_repair_cost: numberValue(row.average_repair_cost) as number,
        repeat_repair_rate: numberValue(row.repeat_repair_rate) as number,
        average_downtime_days: numberValue(row.average_downtime_days) as number,
        estimate_to_final_variance: numberValue(row.estimate_to_final_variance) as number,
        warranty_recovery: numberValue(row.warranty_recovery) as number,
        road_calls_after_repair: numberValue(row.road_calls_after_repair) as number,
        open_work_orders: numberValue(row.open_work_orders) as number,
      };
    }),
    vehicles: vehicles.map((item) => {
      const row = object(item);
      return {
        vehicle_id: stringValue(row.vehicle_id) as string,
        unit_number: stringValue(row.unit_number) as string,
        current_mileage: numberValue(row.current_mileage, true),
        vehicle_age_years: numberValue(row.vehicle_age_years, true),
        maintenance_cost_3m: numberValue(row.maintenance_cost_3m) as number,
        maintenance_cost_6m: numberValue(row.maintenance_cost_6m) as number,
        maintenance_cost_12m: numberValue(row.maintenance_cost_12m) as number,
        miles_12m: numberValue(row.miles_12m) as number,
        cpm_12m: numberValue(row.cpm_12m, true),
        downtime_days_12m: numberValue(row.downtime_days_12m) as number,
        repeat_repairs_12m: numberValue(row.repeat_repairs_12m) as number,
        open_estimated_repairs: numberValue(row.open_estimated_repairs) as number,
        direct_maintenance_cost: numberValue(row.direct_maintenance_cost) as number,
        travel_hotel_impact: numberValue(row.travel_hotel_impact) as number,
        towing_road_service_impact: numberValue(row.towing_road_service_impact) as number,
        estimated_lost_contribution: numberValue(row.estimated_lost_contribution) as number,
        total_estimated_operational_impact: numberValue(row.total_estimated_operational_impact) as number,
      };
    }),
  };
}

export function budgetElapsedFraction(year: number, month: number | null, now = new Date()): { elapsed: number; complete: boolean } {
  const periodStart = new Date(Date.UTC(year, month == null ? 0 : month - 1, 1));
  const periodEnd = month == null
    ? new Date(Date.UTC(year + 1, 0, 1))
    : new Date(Date.UTC(year, month, 1));
  if (now >= periodEnd) return { elapsed: 1, complete: true };
  if (now <= periodStart) return { elapsed: 0, complete: false };
  return { elapsed: (now.getTime() - periodStart.getTime()) / (periodEnd.getTime() - periodStart.getTime()), complete: false };
}

export function maintenanceBudgetScopeLabel(scope: MaintenanceBudgetScope): string {
  return {
    annual_org: "Yıllık organizasyon",
    monthly_org: "Aylık organizasyon",
    vehicle: "Unit",
    category: "Kategori",
    vendor: "Vendor / shop",
  }[scope];
}
