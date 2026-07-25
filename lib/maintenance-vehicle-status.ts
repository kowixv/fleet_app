export const MAINTENANCE_VISIBLE_VEHICLE_STATUSES = [
  "active",
  "in_repair",
  "yard_hometime",
] as const;

export type MaintenanceVisibleVehicleStatus = (typeof MAINTENANCE_VISIBLE_VEHICLE_STATUSES)[number];

export function isMaintenanceVisibleVehicleStatus(status: string | null | undefined): status is MaintenanceVisibleVehicleStatus {
  return MAINTENANCE_VISIBLE_VEHICLE_STATUSES.includes(status as MaintenanceVisibleVehicleStatus);
}

export function maintenanceVisibleVehicleStatuses(): string[] {
  return [...MAINTENANCE_VISIBLE_VEHICLE_STATUSES];
}
