export const DEFAULT_MAINTENANCE_INVOICE_MAX_BYTES = 20 * 1024 * 1024;

export interface MaintenanceInvoiceUploadResponse {
  ok?: boolean;
  invoiceId?: string;
  error?: string;
  status?: string;
  duplicate?: boolean;
}

export function maintenanceInvoiceMaxBytes(raw: string | undefined): number {
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0
    ? parsed
    : DEFAULT_MAINTENANCE_INVOICE_MAX_BYTES;
}

export function validateMaintenanceInvoiceFileMeta(
  file: Pick<File, "name" | "type" | "size">,
  maxBytes = DEFAULT_MAINTENANCE_INVOICE_MAX_BYTES,
): string | null {
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    return "Sadece PDF kabul edilir.";
  }
  if (file.size === 0) return "PDF boş.";
  if (file.size > maxBytes) {
    return `PDF ${(maxBytes / 1024 / 1024).toLocaleString("en-US")} MB'dan büyük olamaz.`;
  }
  return null;
}

export function hasPdfMagicBytes(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 5
    && bytes[0] === 0x25
    && bytes[1] === 0x50
    && bytes[2] === 0x44
    && bytes[3] === 0x46
    && bytes[4] === 0x2d;
}

export function parseMaintenanceInvoiceUploadResponse(text: string): MaintenanceInvoiceUploadResponse {
  try {
    const parsed: unknown = JSON.parse(text || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { error: "Sunucu geçersiz bir yanıt döndürdü." };
    }
    const row = parsed as Record<string, unknown>;
    return {
      ok: typeof row.ok === "boolean" ? row.ok : undefined,
      invoiceId: typeof row.invoiceId === "string" ? row.invoiceId : undefined,
      error: typeof row.error === "string" ? row.error : undefined,
      status: typeof row.status === "string" ? row.status : undefined,
      duplicate: typeof row.duplicate === "boolean" ? row.duplicate : undefined,
    };
  } catch {
    return { error: "Sunucu yanıtı okunamadı. Lütfen tekrar deneyin." };
  }
}
