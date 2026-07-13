export const MAINTENANCE_COST_CATEGORIES = [
  "routine_pm",
  "tires",
  "brakes_wheel_end",
  "engine",
  "aftertreatment",
  "transmission_driveline",
  "suspension_steering",
  "cooling",
  "electrical",
  "road_service_towing",
  "driver_damage",
  "warranty_recovery",
  "other",
] as const;

export type MaintenanceCostCategory = (typeof MAINTENANCE_COST_CATEGORIES)[number];
export type PlannedFilter = "all" | "planned" | "unscheduled";

export interface MaintenanceCostBreakdown {
  parts_cost?: number | null;
  labor_cost?: number | null;
  shop_fees?: number | null;
  tax_cost?: number | null;
  towing_cost?: number | null;
  road_service_cost?: number | null;
  hotel_travel_cost?: number | null;
  other_cost?: number | null;
  warranty_recovery?: number | null;
  total_cost?: number | null;
}

export interface MaintenanceCostRow extends MaintenanceCostBreakdown {
  organization_id?: string;
  source_record_id: string;
  source_type: "maintenance_record" | "expense";
  vehicle_id: string | null;
  unit_number: string | null;
  invoice_id: string | null;
  expense_id: string | null;
  invoice_hash: string | null;
  cost_date: string | null;
  shop: string | null;
  service_type: string | null;
  service_key: string | null;
  category: MaintenanceCostCategory;
  planned: boolean;
  status: string | null;
  mileage_at_service: number | null;
  downtime_days?: number | null;
}

export interface MileagePeriodSnapshot {
  vehicle_id: string;
  period_start: string;
  period_end: string;
  miles_driven: number | null;
}

export interface MaintenanceCostFilters {
  start?: string | null;
  end?: string | null;
  vehicleId?: string | null;
  category?: MaintenanceCostCategory | "all" | null;
  planned?: PlannedFilter | null;
  shop?: string | null;
  status?: string | null;
}

export interface UnitCostSummary {
  vehicle_id: string;
  unit_number: string;
  totalCost: number;
  cpmCost: number;
  milesDriven: number;
  cpm: number | null;
  insufficientMileage: boolean;
  plannedCost: number;
  unscheduledCost: number;
  tireCostPerThousand: number | null;
  roadCallsPer100k: number | null;
  downtimeDays: number;
  repeatRepairs: number;
}

export interface MaintenanceCostSummary {
  totalCost: number;
  cpmCost: number;
  fleetCpm: number | null;
  insufficientMileage: boolean;
  plannedCost: number;
  unscheduledCost: number;
  warrantyRecovery: number;
  towingRoadServiceCost: number;
  downtimeDays: number;
  tireCostPerThousand: number | null;
  roadCallsPer100k: number | null;
  repeatRepairRate30Days: number;
  byCategory: Array<{ category: MaintenanceCostCategory; totalCost: number }>;
  byShop: Array<{ shop: string; totalCost: number }>;
  unitRanking: UnitCostSummary[];
  aboveFleetAverage: UnitCostSummary[];
}

export type MaintenanceCostAlertType =
  | "high_repair"
  | "unit_cpm_above_average"
  | "repeat_repair_30_days"
  | "recurring_towing"
  | "high_unscheduled_ratio";

export interface MaintenanceCostAlert {
  type: MaintenanceCostAlertType;
  vehicle_id: string | null;
  unit_number: string | null;
  title: string;
  explanation: string;
  sourceRecordIds: string[];
  amount?: number;
}

const CATEGORY_KEYWORDS: Array<[MaintenanceCostCategory, RegExp]> = [
  ["routine_pm", /\b(pm|preventive|inspection|oil change|wet pm|filter)\b/i],
  ["tires", /\b(tire|tread|steer tire|drive tire)\b/i],
  ["brakes_wheel_end", /\b(brake|wheel end|hub|seal|drum|rotor|caliper)\b/i],
  ["engine", /\b(engine|overhead|turbo|injector|fuel pump)\b/i],
  ["aftertreatment", /\b(dpf|def|scr|regen|aftertreatment|nox)\b/i],
  ["transmission_driveline", /\b(transmission|clutch|driveshaft|u-joint|driveline)\b/i],
  ["suspension_steering", /\b(suspension|steering|shock|spring|tie rod|kingpin)\b/i],
  ["cooling", /\b(coolant|radiator|water pump|thermostat|hose)\b/i],
  ["electrical", /\b(electrical|battery|alternator|starter|wiring|light)\b/i],
  ["road_service_towing", /\b(tow|towing|road service|roadside)\b/i],
  ["driver_damage", /\b(driver damage|accident|collision|damage)\b/i],
  ["warranty_recovery", /\b(warranty|recovery|credit)\b/i],
];

function money(value: number | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateValue(value: string | null | undefined): number {
  if (!value) return Number.NaN;
  const parsed = Date.parse(`${value.slice(0, 10)}T00:00:00.000Z`);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export function suggestMaintenanceCostCategory(text: string | null | undefined): MaintenanceCostCategory {
  const source = text ?? "";
  return CATEGORY_KEYWORDS.find(([, pattern]) => pattern.test(source))?.[0] ?? "other";
}

export function calculateMaintenanceCostTotal(cost: MaintenanceCostBreakdown): number {
  const explicit = cost.total_cost;
  if (explicit != null && Number.isFinite(Number(explicit))) return Math.max(0, Number(explicit));
  return (
    money(cost.parts_cost) +
    money(cost.labor_cost) +
    money(cost.shop_fees) +
    money(cost.tax_cost) +
    money(cost.towing_cost) +
    money(cost.road_service_cost) +
    money(cost.hotel_travel_cost) +
    money(cost.other_cost)
  );
}

export function calculateMaintenanceCpmCost(cost: MaintenanceCostBreakdown): number {
  return (
    money(cost.parts_cost) +
    money(cost.labor_cost) +
    money(cost.shop_fees) +
    money(cost.towing_cost) +
    money(cost.road_service_cost) +
    money(cost.other_cost) -
    Math.abs(money(cost.warranty_recovery))
  );
}

export function calculateCpm(cost: number, milesDriven: number | null | undefined): number | null {
  const miles = Number(milesDriven ?? 0);
  if (!Number.isFinite(miles) || miles <= 0) return null;
  return cost / miles;
}

export function reconcileInvoiceAllocations(
  invoiceTotal: number | null | undefined,
  rows: MaintenanceCostBreakdown[],
  tolerance = 1,
): { ok: boolean; allocatedTotal: number; difference: number; message: string | null } {
  const total = money(invoiceTotal);
  const allocatedTotal = rows.reduce((sum, row) => sum + calculateMaintenanceCostTotal(row), 0);
  const difference = allocatedTotal - total;
  const ok = total <= 0 || Math.abs(difference) <= Math.max(0, tolerance);
  return {
    ok,
    allocatedTotal,
    difference,
    message: ok
      ? null
      : `Service allocations must equal invoice total within $${tolerance.toFixed(2)}. Difference: $${difference.toFixed(2)}.`,
  };
}

export function mileageByVehicle(snapshots: MileagePeriodSnapshot[]): Map<string, number> {
  const miles = new Map<string, number>();
  for (const snapshot of snapshots) {
    miles.set(snapshot.vehicle_id, (miles.get(snapshot.vehicle_id) ?? 0) + money(snapshot.miles_driven));
  }
  return miles;
}

export function filterMaintenanceCostRows(
  rows: MaintenanceCostRow[],
  filters: MaintenanceCostFilters,
): MaintenanceCostRow[] {
  const start = filters.start ? dateValue(filters.start) : Number.NEGATIVE_INFINITY;
  const end = filters.end ? dateValue(filters.end) : Number.POSITIVE_INFINITY;
  const planned = filters.planned ?? "all";
  return rows.filter((row) => {
    const rowDate = dateValue(row.cost_date);
    if (Number.isNaN(rowDate) && (filters.start || filters.end)) return false;
    return (
      (Number.isNaN(rowDate) || (rowDate >= start && rowDate <= end)) &&
      (!filters.vehicleId || row.vehicle_id === filters.vehicleId) &&
      (!filters.category || filters.category === "all" || row.category === filters.category) &&
      (planned === "all" || row.planned === (planned === "planned")) &&
      (!filters.shop || row.shop === filters.shop) &&
      (!filters.status || row.status === filters.status)
    );
  });
}

export function filterMileagePeriodSnapshots(
  snapshots: MileagePeriodSnapshot[],
  filters: Pick<MaintenanceCostFilters, "start" | "end" | "vehicleId">,
): MileagePeriodSnapshot[] {
  const start = filters.start ? dateValue(filters.start) : Number.NEGATIVE_INFINITY;
  const end = filters.end ? dateValue(filters.end) : Number.POSITIVE_INFINITY;
  return snapshots.filter((snapshot) => {
    const periodStart = dateValue(snapshot.period_start);
    const periodEnd = dateValue(snapshot.period_end);
    return (
      !Number.isNaN(periodStart) &&
      !Number.isNaN(periodEnd) &&
      periodStart >= start &&
      periodEnd <= end &&
      (!filters.vehicleId || snapshot.vehicle_id === filters.vehicleId)
    );
  });
}

function countRepeatRepairs(rows: MaintenanceCostRow[], withinDays = 30): number {
  const sorted = [...rows]
    .filter((row) => row.vehicle_id && row.service_key && row.cost_date)
    .sort((a, b) => dateValue(a.cost_date) - dateValue(b.cost_date));
  let repeats = 0;
  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const previous = [...sorted.slice(0, i)].reverse().find(
      (row) => row.vehicle_id === current.vehicle_id && row.service_key === current.service_key,
    );
    if (!previous || !current.cost_date || !previous.cost_date) continue;
    const days = (dateValue(current.cost_date) - dateValue(previous.cost_date)) / 86_400_000;
    if (days >= 0 && days <= withinDays) repeats += 1;
  }
  return repeats;
}

export function summarizeMaintenanceCosts(
  rows: MaintenanceCostRow[],
  snapshots: MileagePeriodSnapshot[],
): MaintenanceCostSummary {
  const miles = mileageByVehicle(snapshots);
  const byVehicle = new Map<string, MaintenanceCostRow[]>();
  const byCategory = new Map<MaintenanceCostCategory, number>();
  const byShop = new Map<string, number>();
  let totalCost = 0;
  let cpmCost = 0;
  let plannedCost = 0;
  let unscheduledCost = 0;
  let warrantyRecovery = 0;
  let towingRoadServiceCost = 0;
  let downtimeDays = 0;
  let roadCalls = 0;
  let tireCost = 0;

  for (const row of rows) {
    const total = calculateMaintenanceCostTotal(row);
    const cpm = calculateMaintenanceCpmCost(row);
    totalCost += total;
    cpmCost += cpm;
    if (row.planned) plannedCost += total;
    else unscheduledCost += total;
    warrantyRecovery += Math.abs(money(row.warranty_recovery));
    towingRoadServiceCost += money(row.towing_cost) + money(row.road_service_cost);
    downtimeDays += money(row.downtime_days);
    if (row.category === "road_service_towing" || money(row.towing_cost) + money(row.road_service_cost) > 0) roadCalls += 1;
    if (row.category === "tires") tireCost += total;
    byCategory.set(row.category, (byCategory.get(row.category) ?? 0) + total);
    byShop.set(row.shop || "Unknown", (byShop.get(row.shop || "Unknown") ?? 0) + total);
    if (row.vehicle_id) byVehicle.set(row.vehicle_id, [...(byVehicle.get(row.vehicle_id) ?? []), row]);
  }

  const unitRanking: UnitCostSummary[] = [...byVehicle.entries()].map(([vehicleId, unitRows]) => {
    const unitNumber = unitRows.find((row) => row.unit_number)?.unit_number ?? "-";
    const unitTotal = unitRows.reduce((sum, row) => sum + calculateMaintenanceCostTotal(row), 0);
    const unitCpmCost = unitRows.reduce((sum, row) => sum + calculateMaintenanceCpmCost(row), 0);
    const unitMiles = miles.get(vehicleId) ?? 0;
    const unitTireCost = unitRows
      .filter((row) => row.category === "tires")
      .reduce((sum, row) => sum + calculateMaintenanceCostTotal(row), 0);
    const unitRoadCalls = unitRows.filter(
      (row) => row.category === "road_service_towing" || money(row.towing_cost) + money(row.road_service_cost) > 0,
    ).length;
    return {
      vehicle_id: vehicleId,
      unit_number: unitNumber,
      totalCost: unitTotal,
      cpmCost: unitCpmCost,
      milesDriven: unitMiles,
      cpm: calculateCpm(unitCpmCost, unitMiles),
      insufficientMileage: unitMiles <= 0,
      plannedCost: unitRows.filter((row) => row.planned).reduce((sum, row) => sum + calculateMaintenanceCostTotal(row), 0),
      unscheduledCost: unitRows.filter((row) => !row.planned).reduce((sum, row) => sum + calculateMaintenanceCostTotal(row), 0),
      tireCostPerThousand: calculateCpm(unitTireCost, unitMiles) == null ? null : calculateCpm(unitTireCost, unitMiles)! * 1000,
      roadCallsPer100k: calculateCpm(unitRoadCalls, unitMiles) == null ? null : calculateCpm(unitRoadCalls, unitMiles)! * 100_000,
      downtimeDays: unitRows.reduce((sum, row) => sum + money(row.downtime_days), 0),
      repeatRepairs: countRepeatRepairs(unitRows),
    };
  }).sort((a, b) => (b.cpm ?? -1) - (a.cpm ?? -1) || b.totalCost - a.totalCost);

  const totalMiles = [...miles.values()].reduce((sum, value) => sum + value, 0);
  const fleetCpm = calculateCpm(cpmCost, totalMiles);
  const aboveFleetAverage = fleetCpm == null
    ? []
    : unitRanking.filter((unit) => unit.cpm != null && unit.cpm > fleetCpm * 1.25);

  return {
    totalCost,
    cpmCost,
    fleetCpm,
    insufficientMileage: totalMiles <= 0,
    plannedCost,
    unscheduledCost,
    warrantyRecovery,
    towingRoadServiceCost,
    downtimeDays,
    tireCostPerThousand: calculateCpm(tireCost, totalMiles) == null ? null : calculateCpm(tireCost, totalMiles)! * 1000,
    roadCallsPer100k: calculateCpm(roadCalls, totalMiles) == null ? null : calculateCpm(roadCalls, totalMiles)! * 100_000,
    repeatRepairRate30Days: rows.length === 0 ? 0 : countRepeatRepairs(rows) / rows.length,
    byCategory: [...byCategory.entries()].map(([category, categoryTotal]) => ({ category, totalCost: categoryTotal })).sort((a, b) => b.totalCost - a.totalCost),
    byShop: [...byShop.entries()].map(([shop, shopTotal]) => ({ shop, totalCost: shopTotal })).sort((a, b) => b.totalCost - a.totalCost),
    unitRanking,
    aboveFleetAverage,
  };
}

export function buildMaintenanceCostAlerts(
  rows: MaintenanceCostRow[],
  summary: MaintenanceCostSummary,
  repairWarningAmount: number,
): MaintenanceCostAlert[] {
  const alerts: MaintenanceCostAlert[] = [];
  for (const row of rows) {
    const total = calculateMaintenanceCostTotal(row);
    if (repairWarningAmount > 0 && total >= repairWarningAmount) {
      alerts.push({
        type: "high_repair",
        vehicle_id: row.vehicle_id,
        unit_number: row.unit_number,
        title: "High repair cost",
        amount: total,
        sourceRecordIds: [row.source_record_id],
        explanation: `$${total.toFixed(2)} is above the configured $${repairWarningAmount.toFixed(2)} warning amount.`,
      });
    }
  }

  for (const unit of summary.aboveFleetAverage) {
    alerts.push({
      type: "unit_cpm_above_average",
      vehicle_id: unit.vehicle_id,
      unit_number: unit.unit_number,
      title: "Unit CPM above fleet average",
      amount: unit.cpm ?? undefined,
      sourceRecordIds: rows.filter((row) => row.vehicle_id === unit.vehicle_id).map((row) => row.source_record_id),
      explanation: `Unit CPM is $${(unit.cpm ?? 0).toFixed(2)} versus fleet average $${(summary.fleetCpm ?? 0).toFixed(2)}.`,
    });
  }

  const sorted = [...rows].sort((a, b) => dateValue(a.cost_date) - dateValue(b.cost_date));
  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const previous = [...sorted.slice(0, i)].reverse().find(
      (row) => row.vehicle_id === current.vehicle_id && row.service_key === current.service_key,
    );
    if (!previous || !current.cost_date || !previous.cost_date) continue;
    const days = (dateValue(current.cost_date) - dateValue(previous.cost_date)) / 86_400_000;
    if (days >= 0 && days <= 30) {
      alerts.push({
        type: "repeat_repair_30_days",
        vehicle_id: current.vehicle_id,
        unit_number: current.unit_number,
        title: "Repeat repair within 30 days",
        sourceRecordIds: [previous.source_record_id, current.source_record_id],
        explanation: `${current.service_type ?? "Service"} appears again ${Math.round(days)} days after the previous record.`,
      });
    }
  }

  for (const unit of summary.unitRanking) {
    const unitRows = rows.filter((row) => row.vehicle_id === unit.vehicle_id);
    const towingRows = unitRows.filter((row) => row.category === "road_service_towing" || money(row.towing_cost) + money(row.road_service_cost) > 0);
    if (towingRows.length >= 2) {
      alerts.push({
        type: "recurring_towing",
        vehicle_id: unit.vehicle_id,
        unit_number: unit.unit_number,
        title: "Recurring towing / road service",
        sourceRecordIds: towingRows.map((row) => row.source_record_id),
        explanation: `${towingRows.length} towing or road-service records are present in the filtered period.`,
      });
    }
    const total = unit.plannedCost + unit.unscheduledCost;
    if (total > 0 && unit.unscheduledCost / total >= 0.75 && unit.unscheduledCost >= unit.plannedCost * 3) {
      alerts.push({
        type: "high_unscheduled_ratio",
        vehicle_id: unit.vehicle_id,
        unit_number: unit.unit_number,
        title: "High unscheduled repair ratio",
        sourceRecordIds: unitRows.map((row) => row.source_record_id),
        explanation: `Unscheduled cost is ${Math.round((unit.unscheduledCost / total) * 100)}% of maintenance cost in the filtered period.`,
      });
    }
  }

  return alerts;
}

export function maintenanceCostRowsToCsv(rows: MaintenanceCostRow[]): string {
  const headers = [
    "date",
    "unit",
    "service",
    "category",
    "planned",
    "shop",
    "mileage",
    "parts",
    "labor",
    "shop_fees",
    "towing",
    "road_service",
    "other",
    "warranty_recovery",
    "total",
    "source_type",
    "source_id",
    "invoice_id",
  ];
  const escape = (value: unknown) => {
    const text = value == null ? "" : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [
    headers.join(","),
    ...rows.map((row) => [
      row.cost_date,
      row.unit_number,
      row.service_type,
      row.category,
      row.planned ? "planned" : "unscheduled",
      row.shop,
      row.mileage_at_service,
      row.parts_cost,
      row.labor_cost,
      row.shop_fees,
      row.towing_cost,
      row.road_service_cost,
      row.other_cost,
      row.warranty_recovery,
      calculateMaintenanceCostTotal(row),
      row.source_type,
      row.source_record_id,
      row.invoice_id,
    ].map(escape).join(",")),
  ].join("\n");
}
