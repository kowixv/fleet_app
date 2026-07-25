import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAINTENANCE_INVOICE_MAX_BYTES,
  hasPdfMagicBytes,
  maintenanceInvoiceMaxBytes,
  parseMaintenanceInvoiceUploadResponse,
  validateMaintenanceInvoiceFileMeta,
} from "./maintenance-invoice-upload";

describe("maintenance invoice upload security", () => {
  it("rejects oversized files before their body is read", () => {
    expect(validateMaintenanceInvoiceFileMeta(
      { name: "invoice.pdf", type: "application/pdf", size: DEFAULT_MAINTENANCE_INVOICE_MAX_BYTES + 1 },
    )).toMatch(/20 MB/);
  });

  it("validates PDF magic bytes", () => {
    expect(hasPdfMagicBytes(new TextEncoder().encode("%PDF-1.7"))).toBe(true);
    expect(hasPdfMagicBytes(new TextEncoder().encode("<html>proxy"))).toBe(false);
  });

  it("uses a safe configured limit and falls back for invalid values", () => {
    expect(maintenanceInvoiceMaxBytes("1024")).toBe(1024);
    expect(maintenanceInvoiceMaxBytes("invalid")).toBe(DEFAULT_MAINTENANCE_INVOICE_MAX_BYTES);
  });

  it("handles non-JSON proxy responses without throwing", () => {
    expect(parseMaintenanceInvoiceUploadResponse("<html>Bad gateway</html>")).toEqual({
      error: "Sunucu yanıtı okunamadı. Lütfen tekrar deneyin.",
    });
    expect(parseMaintenanceInvoiceUploadResponse('{"invoiceId":"inv-1","ok":true}')).toMatchObject({
      invoiceId: "inv-1",
      ok: true,
    });
  });
});
