import type { MaintenanceInvoicePipelineStatus } from "@/lib/maintenance/domain";

export const MAINTENANCE_INVOICE_PIPELINE_LABELS: Record<
  MaintenanceInvoicePipelineStatus,
  string
> = {
  uploaded: "Yüklendi",
  queued: "Sırada",
  extracting: "PDF okunuyor",
  parsing: "Fatura ayrıştırılıyor",
  pending_review: "İnceleme bekliyor",
  completed: "Tamamlandı",
  failed: "Hatalı",
  cancelled: "İptal edildi",
};

export function maintenanceInvoicePipelineTone(status: MaintenanceInvoicePipelineStatus): string {
  if (status === "failed") return "bg-red-100 text-red-700";
  if (status === "pending_review") return "bg-amber-100 text-amber-800";
  if (status === "completed") return "bg-emerald-100 text-emerald-700";
  if (status === "cancelled") return "bg-slate-100 text-slate-600";
  return "bg-blue-100 text-blue-700";
}
