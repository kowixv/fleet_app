import type { MaintenanceInvoicePipelineStatus } from "@/lib/maintenance/domain";

export interface InvoiceRetryDecision {
  status: MaintenanceInvoicePipelineStatus;
  retryAtSeconds: number | null;
}

export function maintenanceInvoiceRetryDecision(
  retryCount: number,
  maxRetries: number,
  retryable: boolean,
): InvoiceRetryDecision {
  if (!retryable || retryCount >= maxRetries) {
    return { status: "failed", retryAtSeconds: null };
  }
  return {
    status: "queued",
    retryAtSeconds: Math.min(3600, 60 * 2 ** Math.max(0, retryCount - 1)),
  };
}

export function canCompleteMaintenanceInvoiceJob(
  status: MaintenanceInvoicePipelineStatus,
  leaseValid: boolean,
): boolean {
  return leaseValid && (status === "extracting" || status === "parsing");
}
