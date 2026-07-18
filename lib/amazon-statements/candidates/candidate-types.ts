import type { ExpenseInput, LoadInput, SettlementConfig, SettlementResult, SettlementType } from "@/lib/settlement/engine";
import type { SettlementUsageGroup } from "@/lib/settlement/workflow";
import type { CandidateIssue } from "./candidate-issues";

export type CandidateStatementType = Exclude<SettlementType, "external_carrier_statement">;
export type CandidateStatus = "draft" | "needs_review" | "ready" | "stale" | "converted" | "archived";
export type CandidatePayeeType = "driver" | "owner" | "investor";
export type CandidateDeductionLane = CandidatePayeeType | "none";
export type FuelInclusionPolicy = "transaction_date_in_period" | "fuel_report_period" | "manual_reviewed_selection";

export type CandidateAdjustmentType =
  | "driver_percentage"
  | "company_percentage"
  | "insurance"
  | "eld_safety"
  | "fuel"
  | "toll"
  | "parking"
  | "load_save"
  | "maintenance"
  | "miscellaneous"
  | "carryover";

export type CandidateCalculationBasis = "gross_percentage" | "fixed_amount" | "selected_source_lines";

export interface CandidateTeamMember {
  personId: string;
  basisPoints: number;
}

export interface CandidateTeamSplitRule {
  ruleId: string;
  externalDriverPersonIds: string[];
  members: CandidateTeamMember[];
}

export interface CandidateCalculationConfig {
  statementType: CandidateStatementType;
  periodStart: string;
  periodEnd: string;
  organizationId: string;
  batchId: string;
  payeeType: CandidatePayeeType;
  payeeId?: string | null;
  vehicleId?: string | null;
  teamSplitRule?: CandidateTeamSplitRule | null;
  teamRequired?: boolean;
  teamExternalPersonIds?: string[];
  calculationRuleVersion: string;
  templateVersion: string;
  languageMode?: "en" | "tr" | "en_tr";
  parserVersions?: Record<string, string>;
  settlementSettingsRevision?: string | null;
  fuelInclusionPolicy?: FuelInclusionPolicy;
  driverPayBasisPoints?: number | null;
  companyFeeBasisPoints?: number | null;
  companyFeeIsOurRevenue?: boolean;
  externalCarrierFeeBasisPoints?: number | null;
  managementCommission?: SettlementConfig["managementCommission"];
  fixedAdjustments?: CandidateAdjustmentInput[];
}

export interface CandidateAdjustmentInput {
  adjustmentType: CandidateAdjustmentType;
  label: string;
  calculationBasis: CandidateCalculationBasis;
  rateBasisPoints?: number | null;
  fixedAmount?: number | null;
  calculatedAmount?: number | null;
  deductionLane: CandidateDeductionLane;
  displayOrder: number;
  configurationSource: string;
  sourceSnapshot?: Record<string, unknown>;
  selectedFuelLineIds?: string[];
}

export interface CandidateProjectedLoad {
  id: string;
  organizationId: string;
  status: string;
  vehicleId?: string | null;
  driverId?: string | null;
  deliveryDate?: string | null;
  grossAmount: number;
  alreadyLinked?: boolean;
}

export interface CandidateProjectedExpense {
  id: string;
  organizationId: string;
  date?: string | null;
  vehicleId?: string | null;
  driverId?: string | null;
  ownerId?: string | null;
  category: string;
  amount: number;
  deductFromSettlement: boolean;
  deductFromDriver?: boolean | null;
  deductFromOwner?: boolean | null;
  deductFromInvestor?: boolean | null;
  alreadyLinked?: boolean;
}

export interface CandidateRevenueSelection {
  revenueItemId: string;
  organizationId: string;
  sourceRevision: string;
  expectedSourceRevision?: string | null;
  sourceFingerprint?: string | null;
  sourceDate?: string | null;
  periodOverrideApproved?: boolean;
  periodOverrideReason?: string | null;
  allocatedGrossAmount: number;
  allocationBasisPoints?: number | null;
  projectionStatus?: "projected" | "conflict" | "superseded" | "archived";
  projectedLoad: CandidateProjectedLoad;
  sourceSnapshot: Record<string, unknown>;
  displayOrder: number;
}

export interface CandidateFuelSelection {
  transactionLineId: string;
  organizationId: string;
  sourceRevision: string;
  expectedSourceRevision?: string | null;
  sourceFingerprint?: string | null;
  transactionDate?: string | null;
  reportPeriodStart?: string | null;
  reportPeriodEnd?: string | null;
  periodOverrideApproved?: boolean;
  periodOverrideReason?: string | null;
  groupIsPlaceholder?: boolean;
  productType?: string | null;
  allocatedAmount: number;
  allocationBasisPoints?: number | null;
  projectionStatus?: "projected" | "conflict" | "superseded" | "archived";
  deductionLane: CandidateDeductionLane;
  projectedExpense: CandidateProjectedExpense;
  sourceSnapshot: Record<string, unknown>;
  displayOrder: number;
}

export interface CandidateCompilerInput {
  config: CandidateCalculationConfig;
  revenueSelections: CandidateRevenueSelection[];
  fuelSelections?: CandidateFuelSelection[];
  existingSettlementSettingsRevision?: string | null;
}

export interface CandidateAdjustmentLine {
  adjustmentType: CandidateAdjustmentType;
  label: string;
  calculationBasis: CandidateCalculationBasis;
  rateBasisPoints: number | null;
  fixedAmount: number | null;
  calculatedAmount: number;
  deductionLane: CandidateDeductionLane;
  displayOrder: number;
  configurationSource: string;
  sourceSnapshot: Record<string, unknown>;
}

export interface CandidateSourceSnapshot {
  revenue: Array<{
    revenueItemId: string;
    loadId: string;
    allocatedGrossAmount: number;
    sourceRevision: string;
    sourceFingerprint?: string | null;
    periodOverrideApproved?: boolean;
    periodOverrideReason?: string | null;
  }>;
  fuel: Array<{
    transactionLineId: string;
    expenseId: string;
    allocatedAmount: number;
    sourceRevision: string;
    sourceFingerprint?: string | null;
    periodOverrideApproved?: boolean;
    periodOverrideReason?: string | null;
  }>;
}

export interface CandidateReadiness {
  status: CandidateStatus;
  ready: boolean;
  issues: CandidateIssue[];
}

export interface TeamAllocation {
  personId: string;
  basisPoints: number;
  amount: number;
}

export interface CandidateCalculationResult {
  statementType: CandidateStatementType;
  usageGroup: SettlementUsageGroup;
  settlementConfig: SettlementConfig;
  settlementInput: {
    loads: LoadInput[];
    expenses: ExpenseInput[];
  };
  settlementResult: SettlementResult;
  adjustmentLines: CandidateAdjustmentLine[];
  teamAllocations: TeamAllocation[];
  grossAmount: number;
  percentageDeductionsAmount: number;
  fixedDeductionsAmount: number;
  fuelDeductionsAmount: number;
  otherDeductionsAmount: number;
  totalDeductionsAmount: number;
  netAmount: number;
  configurationSnapshot: Record<string, unknown>;
  sourceSnapshot: CandidateSourceSnapshot;
  calculationSnapshot: Record<string, unknown>;
  sourceRevision: string;
  previewRevision: string;
  readiness: CandidateReadiness;
}

export interface CandidateRecordForConversion {
  id: string;
  organizationId: string;
  status: CandidateStatus;
  previewRevision: string;
  convertedSettlementId?: string | null;
}

export interface SettlementConversionPayload {
  candidateId: string;
  previewRevision: string;
  settlementType: CandidateStatementType;
  usageGroup: SettlementUsageGroup;
  vehicleId: string | null;
  driverId: string | null;
  ownerId: string | null;
  weekStart: string;
  weekEnd: string;
  config: Record<string, unknown>;
  grossRevenue: number;
  totalDeductions: number;
  ourCommissionEarned: number;
  netPay: number;
  lineItems: Array<{
    key: string;
    label_en: string;
    label_tr: string;
    amount: number;
    is_our_revenue: boolean;
    sort_order: number;
  }>;
  selectedLoadIds: string[];
  selectedExpenseIds: string[];
  auditMetadata: {
    amazonStatementCandidateId: string;
    amazonStatementCandidatePreviewRevision: string;
  };
}
