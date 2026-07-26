export type MaintenanceCacheScope =
  | { kind: "invoice"; id?: string }
  | { kind: "costs"; vehicleId?: string }
  | { kind: "mileage"; vehicleId: string }
  | { kind: "inspection"; vehicleId?: string }
  | { kind: "work_order"; id?: string; vehicleId?: string };

export function maintenanceInvalidationPaths(scope: MaintenanceCacheScope): string[] {
  const paths = new Set<string>();
  paths.add("/maintenance");
  if (scope.kind === "invoice") {
    paths.add("/maintenance/invoices");
    paths.add("/maintenance/history");
    paths.add("/maintenance/costs");
    if (scope.id) paths.add(`/maintenance/invoices/${scope.id}`);
  } else if (scope.kind === "costs") {
    paths.add("/maintenance/costs");
    paths.add("/maintenance/analytics");
    if (scope.vehicleId) paths.add(`/maintenance/units/${scope.vehicleId}`);
  } else if (scope.kind === "mileage") {
    paths.add("/maintenance/costs");
    paths.add(`/maintenance/units/${scope.vehicleId}`);
  } else if (scope.kind === "inspection") {
    paths.add("/maintenance/inspections");
    paths.add("/maintenance/work-orders");
    if (scope.vehicleId) paths.add(`/maintenance/units/${scope.vehicleId}`);
  } else {
    paths.add("/maintenance/work-orders");
    paths.add("/maintenance/calendar");
    if (scope.id) paths.add(`/maintenance/work-orders/${scope.id}`);
    if (scope.vehicleId) paths.add(`/maintenance/units/${scope.vehicleId}`);
  }
  return [...paths];
}
