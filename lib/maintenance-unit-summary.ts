import { computePM, type PMResult, type PMThresholds } from "@/lib/maintenance";
import { isMaintenanceVisibleVehicleStatus } from "@/lib/maintenance-vehicle-status";

export type UnitMaintenanceStatus =
  | "overdue"
  | "due_now"
  | "setup_required"
  | "due_soon"
  | "ok"
  | "no_plan";

export type UnitOperationalFilter =
  | "all"
  | "active"
  | "in_repair"
  | "yard_hometime"
  | "archived";

export type UnitAttentionFilter =
  | "all"
  | "overdue"
  | "due_now"
  | "setup_required"
  | "due_soon"
  | "critical"
  | "ok";

export interface MaintenanceVehicleSummarySource {
  id: string;
  unit_number: string;
  vehicle_type: string;
  current_mileage: number | null;
  status: string | null;
  vin: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  truck_color: string | null;
}

export interface MaintenanceEffectiveRuleSource {
  id: string;
  effective_vehicle_id?: string;
  vehicle_id: string | null;
  service_type: string;
  interval_miles: number | null;
  interval_days: number | null;
  interval_engine_hours: number | null;
  last_done_mileage: number | null;
  last_done_date: string | null;
  last_done_engine_hours: number | null;
}

export interface MaintenanceProfileSummarySource {
  vehicle_id: string;
  engine_hours: number | null;
}

export interface MaintenanceFindingSummarySource {
  vehicle_id: string;
  severity: string;
}

export interface MaintenanceDispatchHoldSummarySource {
  vehicle_id: string;
}

export interface MaintenanceRecordSummarySource {
  vehicle_id: string;
  performed_date: string | null;
  service_type: string | null;
  cost: number | null;
  total_cost: number | null;
}

export interface MaintenanceUnitSummary {
  id: string;
  unitNumber: string;
  vehicleType: string;
  currentMileage: number | null;
  engineHours: number | null;
  operationalStatus: string;
  vin: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  truckColor: string | null;
  maintenanceStatus: UnitMaintenanceStatus;
  overdueCount: number;
  dueNowCount: number;
  dueSoonCount: number;
  setupRequiredCount: number;
  criticalFindingCount: number;
  doNotDispatchCount: number;
  dispatchHoldCount: number;
  hasActivePlan: boolean;
  lastServiceDate: string | null;
  lastServiceType: string | null;
  lastServiceCost: number | null;
}

export interface BuildMaintenanceUnitSummariesInput {
  vehicles: MaintenanceVehicleSummarySource[];
  effectiveRules: MaintenanceEffectiveRuleSource[];
  profiles: MaintenanceProfileSummarySource[];
  findings: MaintenanceFindingSummarySource[];
  dispatchHolds: MaintenanceDispatchHoldSummarySource[];
  records: MaintenanceRecordSummarySource[];
  thresholds: PMThresholds;
  today: string;
}

function classifyMaintenance(results: PMResult[]): UnitMaintenanceStatus {
  if (results.length === 0) return "no_plan";
  if (results.some((result) => result.status === "overdue")) return "overdue";
  if (results.some((result) => result.status === "due_now")) return "due_now";
  if (results.some((result) => result.needsSetup)) return "setup_required";
  if (results.some((result) => result.status === "due_soon" || result.status === "warning")) {
    return "due_soon";
  }
  return "ok";
}

export function buildMaintenanceUnitSummaries(
  input: BuildMaintenanceUnitSummariesInput,
): MaintenanceUnitSummary[] {
  const rulesByVehicle = new Map<string, MaintenanceEffectiveRuleSource[]>();
  for (const rule of input.effectiveRules) {
    const vehicleId = rule.effective_vehicle_id ?? rule.vehicle_id;
    if (!vehicleId) continue;
    rulesByVehicle.set(vehicleId, [...(rulesByVehicle.get(vehicleId) ?? []), rule]);
  }

  const profilesByVehicle = new Map(
    input.profiles.map((profile) => [
      profile.vehicle_id,
      profile.engine_hours == null ? null : Number(profile.engine_hours),
    ]),
  );
  const findingsByVehicle = new Map<string, { critical: number; doNotDispatch: number }>();
  for (const finding of input.findings) {
    const counts = findingsByVehicle.get(finding.vehicle_id) ?? {
      critical: 0,
      doNotDispatch: 0,
    };
    if (finding.severity === "do_not_dispatch") counts.doNotDispatch += 1;
    else if (finding.severity === "critical") counts.critical += 1;
    findingsByVehicle.set(finding.vehicle_id, counts);
  }
  const dispatchHoldsByVehicle = new Map<string, number>();
  for (const hold of input.dispatchHolds) {
    dispatchHoldsByVehicle.set(
      hold.vehicle_id,
      (dispatchHoldsByVehicle.get(hold.vehicle_id) ?? 0) + 1,
    );
  }
  const lastRecordByVehicle = new Map<string, MaintenanceRecordSummarySource>();
  for (const record of input.records) {
    if (!lastRecordByVehicle.has(record.vehicle_id)) {
      lastRecordByVehicle.set(record.vehicle_id, record);
    }
  }

  return input.vehicles.map((vehicle) => {
    const engineHours = profilesByVehicle.get(vehicle.id) ?? null;
    const pmResults = (rulesByVehicle.get(vehicle.id) ?? []).map((rule) =>
      computePM(
        rule,
        Number(vehicle.current_mileage ?? 0),
        input.thresholds,
        input.today,
        engineHours,
      ),
    );
    const findingCounts = findingsByVehicle.get(vehicle.id) ?? {
      critical: 0,
      doNotDispatch: 0,
    };
    const lastRecord = lastRecordByVehicle.get(vehicle.id);
    const rawLastServiceCost = lastRecord?.total_cost ?? lastRecord?.cost;
    const lastServiceCost =
      rawLastServiceCost == null ? null : Number(rawLastServiceCost);

    return {
      id: vehicle.id,
      unitNumber: vehicle.unit_number,
      vehicleType: vehicle.vehicle_type,
      currentMileage: vehicle.current_mileage == null ? null : Number(vehicle.current_mileage),
      engineHours,
      operationalStatus: vehicle.status ?? "active",
      vin: vehicle.vin,
      year: vehicle.year == null ? null : Number(vehicle.year),
      make: vehicle.make,
      model: vehicle.model,
      truckColor: vehicle.truck_color,
      maintenanceStatus: classifyMaintenance(pmResults),
      overdueCount: pmResults.filter((result) => result.status === "overdue").length,
      dueNowCount: pmResults.filter((result) => result.status === "due_now").length,
      dueSoonCount: pmResults.filter(
        (result) => result.status === "due_soon" || result.status === "warning",
      ).length,
      setupRequiredCount: pmResults.filter((result) => result.needsSetup).length,
      criticalFindingCount: findingCounts.critical,
      doNotDispatchCount: findingCounts.doNotDispatch,
      dispatchHoldCount: dispatchHoldsByVehicle.get(vehicle.id) ?? 0,
      hasActivePlan: pmResults.length > 0,
      lastServiceDate: lastRecord?.performed_date ?? null,
      lastServiceType: lastRecord?.service_type ?? null,
      lastServiceCost,
    };
  });
}

export function normalizeMaintenanceUnitSearch(value: string): string {
  return value.trim().toLocaleLowerCase("en-US").replace(/\s+/g, "");
}

export function maintenanceUnitMatchesSearch(
  unit: MaintenanceUnitSummary,
  query: string,
): boolean {
  const normalizedQuery = normalizeMaintenanceUnitSearch(query);
  if (!normalizedQuery) return true;
  const haystack = normalizeMaintenanceUnitSearch(
    [unit.unitNumber, unit.vin, unit.make, unit.model].filter(Boolean).join(" "),
  );
  return haystack.includes(normalizedQuery);
}

export function maintenanceUnitPriority(unit: MaintenanceUnitSummary): number {
  if (unit.dispatchHoldCount > 0 || unit.doNotDispatchCount > 0) return 0;
  if (unit.criticalFindingCount > 0) return 1;
  if (unit.maintenanceStatus === "overdue") return 2;
  if (unit.maintenanceStatus === "due_now") return 3;
  if (unit.maintenanceStatus === "setup_required") return 4;
  if (unit.maintenanceStatus === "due_soon") return 5;
  if (unit.operationalStatus === "in_repair") return 6;
  if (unit.operationalStatus === "yard_hometime") return 7;
  return 8;
}

export function sortMaintenanceUnits(
  units: MaintenanceUnitSummary[],
): MaintenanceUnitSummary[] {
  return [...units].sort(
    (a, b) =>
      maintenanceUnitPriority(a) - maintenanceUnitPriority(b) ||
      a.unitNumber.localeCompare(b.unitNumber, undefined, {
        numeric: true,
        sensitivity: "base",
      }),
  );
}

export function filterMaintenanceUnits(
  units: MaintenanceUnitSummary[],
  filters: {
    query?: string;
    operationalStatus?: UnitOperationalFilter;
    attentionStatus?: UnitAttentionFilter;
    includeArchived?: boolean;
  },
): MaintenanceUnitSummary[] {
  const query = filters.query ?? "";
  const operationalStatus = filters.operationalStatus ?? "all";
  const attentionStatus = filters.attentionStatus ?? "all";
  return sortMaintenanceUnits(
    units.filter((unit) => {
      const archived = !isMaintenanceVisibleVehicleStatus(unit.operationalStatus);
      if (!filters.includeArchived && archived) return false;
      if (!maintenanceUnitMatchesSearch(unit, query)) return false;
      if (
        operationalStatus !== "all" &&
        (operationalStatus === "archived"
          ? !archived
          : unit.operationalStatus !== operationalStatus)
      ) {
        return false;
      }
      if (attentionStatus === "overdue" && unit.maintenanceStatus !== "overdue") return false;
      if (attentionStatus === "due_now" && unit.maintenanceStatus !== "due_now") return false;
      if (
        attentionStatus === "setup_required" &&
        unit.maintenanceStatus !== "setup_required"
      ) {
        return false;
      }
      if (attentionStatus === "due_soon" && unit.maintenanceStatus !== "due_soon") return false;
      if (
        attentionStatus === "critical" &&
        unit.criticalFindingCount + unit.doNotDispatchCount + unit.dispatchHoldCount === 0
      ) {
        return false;
      }
      if (attentionStatus === "ok" && unit.maintenanceStatus !== "ok") return false;
      return true;
    }),
  );
}

export function maintenanceUnitHref(
  vehicleId: string,
  tab?: "plans" | "history" | "inspections" | "costs" | "mileage",
): string {
  return `/maintenance/units/${vehicleId}${tab ? `?tab=${tab}` : ""}`;
}
