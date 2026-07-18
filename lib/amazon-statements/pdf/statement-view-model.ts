export type AmazonStatementType = "company_driver" | "box_truck_driver" | "owner_operator" | "managed_investor";
export type AmazonStatementStatus = "draft" | "needs_review" | "ready" | "converted" | "void";
export type AmazonStatementLanguageMode = "en" | "tr" | "en_tr";

export interface StatementParty {
  name: string;
  secondary?: string | null;
  identifier?: string | null;
}

export interface StatementSignature {
  printedName?: string | null;
  title?: string | null;
  approvalDate?: string | null;
  signedStatus?: "pending" | "signed" | "not_required";
  signatureImagePath?: string | null;
}

export interface AmazonStatementSummaryTotals {
  grossRevenue: number;
  percentageDeductions: number;
  fixedDeductions: number;
  fuelDeductions: number;
  otherDeductions: number;
  totalDeductions: number;
  netAmount: number;
}

export interface AmazonStatementRevenueLine {
  id: string;
  sourceRevenueItemId: string;
  displayOrder: number;
  tripId?: string | null;
  loadId?: string | null;
  date?: string | null;
  routeDisplay: string | null;
  routeStatus: "verified" | "pending_review" | "not_applicable";
  weight?: string | number | null;
  distance?: number | null;
  baseAmount?: number | null;
  fuelSurchargeAmount?: number | null;
  tollAmount?: number | null;
  detentionAmount?: number | null;
  tonuAmount?: number | null;
  otherAmount?: number | null;
  grossAmount: number;
}

export interface AmazonStatementFuelLine {
  id: string;
  sourceTransactionLineId: string;
  displayOrder: number;
  date?: string | null;
  invoice?: string | null;
  merchant?: string | null;
  location?: string | null;
  product: string;
  quantity?: number | null;
  chargedPpu?: number | null;
  discountAmount?: number | null;
  amount: number;
  maskedCard?: string | null;
  continuation?: boolean;
}

export interface AmazonStatementDeductionLine {
  id: string;
  displayOrder: number;
  type: string;
  label: string;
  calculationBasis: "gross_percentage" | "fixed_amount" | "selected_source_lines" | "engine_line";
  amount: number;
  explicitZero?: boolean;
  source?: string | null;
}

export interface AmazonStatementTeamAllocationLine {
  id: string;
  displayOrder: number;
  memberName: string;
  basisPoints: number;
  amount: number;
}

export interface AmazonStatementViewModel {
  candidateId: string;
  documentId: string;
  statementType: AmazonStatementType;
  candidateStatus: AmazonStatementStatus;
  settlementStatus?: "draft" | "pending_review" | "finalized" | "paid" | "void" | null;
  ruleVersion: string;
  templateVersion: string;
  language: AmazonStatementLanguageMode;
  company: StatementParty;
  payee: StatementParty;
  vehicleDisplay: string;
  periodStart: string;
  periodEnd: string;
  invoiceMetadata?: {
    invoiceNumber?: string | null;
    invoiceDate?: string | null;
    paymentDate?: string | null;
    paymentStatus?: string | null;
  };
  summary: AmazonStatementSummaryTotals;
  revenueLines: AmazonStatementRevenueLine[];
  fuelLines: AmazonStatementFuelLine[];
  deductionLines: AmazonStatementDeductionLine[];
  teamAllocations: AmazonStatementTeamAllocationLine[];
  calculationNotes: string[];
  reconciliationIndicators: string[];
  companySignature: StatementSignature;
  payeeSignature: StatementSignature;
  generatedAt: string;
  footer: {
    templateVersion: string;
    sourceRevision?: string | null;
    previewRevision?: string | null;
  };
}
