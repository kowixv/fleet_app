import type { MaintenanceCostSummary, UnitCostSummary } from "@/lib/maintenance-cost";

export type MaintenanceResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string };

export interface MaintenanceAnalyticsUnit extends UnitCostSummary {
  mileageSource: string | null;
  mileageEstimated: boolean;
}

export interface MaintenanceAnalytics extends Omit<MaintenanceCostSummary, "unitRanking" | "aboveFleetAverage"> {
  totalCount: number;
  dataComplete: boolean;
  partialDataWarning: string | null;
  milesDriven: number;
  mileageEstimatedVehicleCount: number;
  mileageUnavailableVehicleCount: number;
  mileageSources: Record<string, number>;
  shopOptions: string[];
  unitRanking: MaintenanceAnalyticsUnit[];
  aboveFleetAverage: MaintenanceAnalyticsUnit[];
}

export const MAINTENANCE_INVOICE_PIPELINE_STATUSES = [
  "uploaded",
  "queued",
  "extracting",
  "parsing",
  "pending_review",
  "completed",
  "failed",
  "cancelled",
] as const;

export type MaintenanceInvoicePipelineStatus =
  (typeof MAINTENANCE_INVOICE_PIPELINE_STATUSES)[number];

export interface MaintenanceInvoiceJob {
  id: string;
  organization_id: string;
  storage_path: string;
  file_name: string;
  lease_token: string;
  retry_count: number;
}

export interface MaintenancePageInfo {
  totalCount: number;
  nextCursor: string | null;
  pageSize: number;
}
