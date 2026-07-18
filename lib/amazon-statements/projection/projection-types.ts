import type { AmazonRevenueItem } from "../revenue/revenue-builder";
import type { FuelCardGroup, FuelProductLine, FuelTransaction } from "../fuel/fuel-normalization";

export type ProjectionStatus = "projected" | "conflict" | "superseded" | "archived";
export type ProjectionConflictCode =
  | "revenue_projection_revision_conflict"
  | "revenue_already_projected"
  | "fuel_projection_revision_conflict"
  | "fuel_line_already_projected"
  | "projected_target_settlement_locked"
  | "unsupported_negative_expense"
  | "invalid_projection_status"
  | "projection_preview_stale"
  | "duplicate_source_fingerprint";

export interface VerifiedFacilityLocation {
  facilityCode: string;
  city: string;
  state: string;
}

export interface ResolvedProjectionReference {
  vehicleId?: string | null;
  driverId?: string | null;
  originFacility?: VerifiedFacilityLocation | null;
  destinationFacility?: VerifiedFacilityLocation | null;
}

export interface ProjectedLoadPayload {
  load_number: string | null;
  load_source: "amazon_relay";
  vehicle_id: string | null;
  driver_id: string | null;
  pickup_date: string | null;
  delivery_date: string | null;
  pickup_location: string | null;
  delivery_location: string | null;
  route: string | null;
  gross_amount: number;
  fuel_surcharge: number;
  loaded_miles: number | null;
  empty_miles: number;
  total_miles: number | null;
  status: "pending";
  notes: string | null;
}

export interface ProjectedExpensePayload {
  date: string | null;
  vehicle_id: string | null;
  driver_id: string | null;
  owner_id: null;
  category: "fuel" | "def" | "fees" | "other";
  amount: number;
  deduct_from_settlement: false;
  deduct_from_driver: false;
  deduct_from_owner: false;
  deduct_from_investor: false;
  notes: string | null;
}

export interface RevenueProjectionItem {
  revenueItemId: string;
  batchId?: string | null;
  sourceRevision: string;
  sourceFingerprint: string;
  canonicalItem: AmazonRevenueItem;
  load: ProjectedLoadPayload;
  projectionSnapshot: Record<string, unknown>;
  canonicalReady: boolean;
  projectionReady: boolean;
  settlementReady: boolean;
}

export interface FuelProjectionItem {
  transactionLineId: string;
  batchId?: string | null;
  sourceRevision: string;
  sourceFingerprint: string;
  group: FuelCardGroup;
  transaction: FuelTransaction;
  productLine: FuelProductLine;
  expense: ProjectedExpensePayload;
  projectionSnapshot: Record<string, unknown>;
  fuelSourceReady: boolean;
  expenseProjectionReady: boolean;
  settlementDeductionReady: boolean;
}

export interface ExistingProjection {
  sourceId: string;
  targetId: string;
  sourceRevision: string;
  sourceFingerprint: string;
  projectionStatus: ProjectionStatus;
  targetSettlementLocked?: boolean;
}

export interface ProjectionConflict {
  code: ProjectionConflictCode;
  sourceId: string;
  targetId?: string | null;
}

export interface ProjectionPreview<TItem> {
  previewRevision: string;
  eligibleCount: number;
  toCreate: TItem[];
  unchanged: TItem[];
  conflicts: ProjectionConflict[];
  invalid: ProjectionConflict[];
  skipped: ProjectionConflict[];
  totals: {
    toCreate: number;
    alreadyProjected: number;
    conflicted: number;
  };
}

export interface ProjectionApplyResult {
  created: number;
  unchanged: number;
  skipped: number;
  conflicts: number;
}
