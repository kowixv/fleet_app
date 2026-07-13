import { createHash } from "node:crypto";
import { extractText, getDocumentProxy, renderPageAsImage } from "unpdf";
import { runText, runVision } from "@/lib/ai";

export interface ParsedInvoiceService {
  service_type: string;
  part_name: string | null;
  parts_used: string[];
  performed_date: string | null;
  mileage: number | null;
  cost: number | null;
  notes: string | null;
}

export interface NormalizedMaintenanceService {
  service_type: string;
  parts_used: string[];
  performed_date: string | null;
  mileage: number | null;
  cost: number | null;
  notes: string | null;
  default_action: "plan" | "history";
}

export type MaintenanceImportMode = "plan" | "history" | "skip";

export interface MaintenanceImportRecord {
  vehicle_id: string;
  service_type: string;
  part_name: null;
  parts_used: string[];
  performed_date: string | null;
  mileage: number | null;
  cost: number | null;
  shop_name: string | null;
  notes: string | null;
  next_due_mileage: number | null;
  next_due_date: string | null;
  resolution: "overwrite" | "history";
}

export interface ParsedMaintenanceInvoice {
  invoice_number: string | null;
  invoice_date: string | null;
  shop_name: string | null;
  unit_number: string | null;
  vehicle_id_text: string | null;
  mileage: number | null;
  services: ParsedInvoiceService[];
}

export interface MaintenanceInvoiceParserMeta {
  source: "text" | "vision";
  confidence: number;
  warnings: string[];
}

const SYSTEM = `You extract fleet truck maintenance invoice data. Return ONLY one JSON object.
Do not invent values. A single invoice can contain multiple distinct services; return each service separately.`;

const INSTRUCTION = `Return exactly this shape, using null when unknown:
{
  "invoice_number": string|null,
  "invoice_date": "YYYY-MM-DD"|null,
  "shop_name": string|null,
  "unit_number": string|null,
  "vehicle_id_text": string|null,
  "mileage": number|null,
  "services": [
    {
      "service_type": string,
      "part_name": string|null,
      "parts_used": string[],
      "performed_date": "YYYY-MM-DD"|null,
      "mileage": number|null,
      "cost": number|null,
      "notes": string|null
    }
  ]
}
Rules:
- Split materially different operations into separate services.
- Group related labor and parts into one service. Do not return every part or invoice line as a separate service.
- Use concise stable service names, e.g. Oil Change, PM Service, Annual Inspection, DPF Cleaning.
- parts_used contains replaced/installed part names and part numbers.
- Use the invoice-level date/mileage for a service when the line has no separate value.
- Numbers must contain no symbols or commas.`;

const canvasPackageName = "@napi-rs/canvas";

function stringField(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed && trimmed.toLowerCase() !== "null" ? trimmed : null;
}

function dateField(value: unknown): string | null {
  const valueString = stringField(value);
  return valueString && /^\d{4}-\d{2}-\d{2}$/.test(valueString) ? valueString : null;
}

function numberField(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[^0-9.-]/g, "");
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function stringList(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[,;\n]/) : [];
  const cleaned: string[] = [];
  for (const item of raw) {
    const text = stringField(item);
    if (text && !cleaned.some((existing) => existing.toLowerCase() === text.toLowerCase())) {
      cleaned.push(text);
    }
  }
  return cleaned;
}

export function safeMaintenanceInvoiceJson(text: string | null): ParsedMaintenanceInvoice | null {
  if (!text) return null;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(match[0]);
  } catch {
    return null;
  }

  const invoiceDate = dateField(raw.invoice_date);
  const invoiceMileage = numberField(raw.mileage);
  const serviceRows = Array.isArray(raw.services) ? raw.services : [];
  const services: ParsedInvoiceService[] = [];

  for (const serviceRaw of serviceRows) {
    if (!serviceRaw || typeof serviceRaw !== "object" || Array.isArray(serviceRaw)) continue;
    const service = serviceRaw as Record<string, unknown>;
    const serviceType = stringField(service.service_type);
    if (!serviceType) continue;
    services.push({
      service_type: serviceType,
      part_name: stringField(service.part_name),
      parts_used: stringList(service.parts_used),
      performed_date: dateField(service.performed_date) ?? invoiceDate,
      mileage: numberField(service.mileage) ?? invoiceMileage,
      cost: numberField(service.cost),
      notes: stringField(service.notes),
    });
  }

  if (services.length === 0) return null;
  return {
    invoice_number: stringField(raw.invoice_number),
    invoice_date: invoiceDate,
    shop_name: stringField(raw.shop_name),
    unit_number: stringField(raw.unit_number),
    vehicle_id_text: stringField(raw.vehicle_id_text),
    mileage: invoiceMileage,
    services,
  };
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizedKey(value: string): string {
  return cleanText(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function uniquePush(values: string[], value: string | null | undefined) {
  const cleaned = value ? cleanText(value) : "";
  if (cleaned && !values.some((existing) => existing.toLowerCase() === cleaned.toLowerCase())) {
    values.push(cleaned);
  }
}

function canonicalService(service: ParsedInvoiceService): { serviceType: string; parts: string[] } {
  const haystack = normalizedKey(
    [service.service_type, service.part_name, ...service.parts_used, service.notes].filter(Boolean).join(" "),
  );
  const parts: string[] = [];
  for (const part of service.parts_used) uniquePush(parts, part);
  uniquePush(parts, service.part_name);

  if (/\b(full )?(chassis )?(inspection|inspect)\b/.test(haystack)) {
    return { serviceType: "Full Inspection", parts: [] };
  }
  if (/\b(electrical|wiring|wire harness|light circuit|battery cable|alternator|starter)\b/.test(haystack)) {
    return { serviceType: "Electrical System Repair", parts };
  }
  if (/\bhalo\b/.test(haystack)) {
    return { serviceType: "Halo Installation", parts };
  }
  if (/\b(suspension|tender spring|shock absorber|shock absorbers|strut|leaf spring|air spring)\b/.test(haystack)) {
    if (/\btender spring\b/.test(haystack)) uniquePush(parts, "tender spring");
    if (/\bshock absorbers?\b/.test(haystack)) uniquePush(parts, haystack.includes("shock absorbers") ? "shock absorbers" : "shock absorber");
    return { serviceType: "Suspension Repair", parts };
  }
  if (/\b(engine air filter|air filter engine)\b/.test(haystack)) {
    return { serviceType: "Engine Air Filter Replacement", parts: [] };
  }
  if (/\b(cabin air filter|cab air filter|air filter cabin)\b/.test(haystack)) {
    return { serviceType: "Cabin Air Filter Replacement", parts: [] };
  }
  if (/\b(tripac|tri pac|apu)\b/.test(haystack)) {
    return { serviceType: "TriPac/APU Repair", parts };
  }
  if (/\b(dpf|diesel particulate).*\b(regen|regeneration|regenerate)\b|\b(regen|regeneration).*\bdpf\b/.test(haystack)) {
    return { serviceType: "DPF Regeneration", parts: [] };
  }
  if (/\b(coolant|antifreeze)\b/.test(haystack)) {
    return { serviceType: "Coolant Service", parts };
  }

  return { serviceType: cleanText(service.service_type), parts };
}

function defaultAction(serviceType: string): "plan" | "history" {
  return /\b(repair|installation|inspection|regeneration|coolant|refill)\b/i.test(serviceType) ? "history" : "plan";
}

export function normalizeMaintenanceInvoiceServices(
  services: ParsedInvoiceService[],
): NormalizedMaintenanceService[] {
  const grouped = new Map<string, NormalizedMaintenanceService>();

  for (const service of services) {
    const canonical = canonicalService(service);
    const key = normalizedKey(canonical.serviceType);
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, {
        service_type: canonical.serviceType,
        parts_used: [...canonical.parts],
        performed_date: service.performed_date,
        mileage: service.mileage,
        cost: service.cost,
        notes: service.notes,
        default_action: defaultAction(canonical.serviceType),
      });
      continue;
    }

    for (const part of canonical.parts) uniquePush(existing.parts_used, part);
    existing.performed_date ??= service.performed_date;
    existing.mileage ??= service.mileage;
    existing.cost = (existing.cost ?? 0) + (service.cost ?? 0);
    if (existing.cost === 0 && service.cost == null) existing.cost = null;
    if (service.notes) {
      const notes = existing.notes ? existing.notes.split(" | ") : [];
      uniquePush(notes, service.notes);
      existing.notes = notes.join(" | ");
    }
  }

  return [...grouped.values()];
}

export function buildMaintenanceImportRecord({
  service,
  mode,
  vehicleId,
  vehicleCurrentMileage,
  invoiceMileage,
  invoiceShopName,
  performedDate,
  nextDue = { next_due_mileage: null, next_due_date: null },
}: {
  service: NormalizedMaintenanceService;
  mode: MaintenanceImportMode;
  vehicleId: string;
  vehicleCurrentMileage: number | null;
  invoiceMileage: number | null;
  invoiceShopName: string | null;
  performedDate: string | null;
  nextDue?: { next_due_mileage: number | null; next_due_date: string | null };
}): { record: MaintenanceImportRecord | null; zeroMileageRuleWarning: boolean } {
  if (mode === "skip") return { record: null, zeroMileageRuleWarning: false };

  const mileage = service.mileage ?? invoiceMileage ?? vehicleCurrentMileage;
  const shouldPlan = mode === "plan" && (nextDue.next_due_mileage != null || nextDue.next_due_date != null);
  const zeroMileageRuleWarning = shouldPlan && nextDue.next_due_mileage != null && Number(vehicleCurrentMileage ?? 0) === 0;

  return {
    zeroMileageRuleWarning,
    record: {
      vehicle_id: vehicleId,
      service_type: service.service_type.trim(),
      part_name: null,
      parts_used: service.parts_used,
      performed_date: performedDate,
      mileage: mileage == null ? null : Number(mileage),
      cost: service.cost,
      shop_name: invoiceShopName,
      notes: service.notes,
      next_due_mileage: shouldPlan ? nextDue.next_due_mileage : null,
      next_due_date: shouldPlan ? nextDue.next_due_date : null,
      resolution: shouldPlan ? "overwrite" : "history",
    },
  };
}

export function maintenanceInvoiceHash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function extractPdf(bytes: Uint8Array): Promise<{ text: string; pageCount: number; pdf: Awaited<ReturnType<typeof getDocumentProxy>> }> {
  const pdf = await getDocumentProxy(bytes);
  const result = await extractText(pdf, { mergePages: true });
  const text = (Array.isArray(result.text) ? result.text.join("\n") : result.text || "").trim();
  return { text, pageCount: pdf.numPages, pdf };
}

async function renderPdfForOcr(
  pdf: Awaited<ReturnType<typeof getDocumentProxy>>,
  pageCount: number,
): Promise<string[]> {
  const urls: string[] = [];
  const maxPages = Math.min(pageCount, 8);
  for (let page = 1; page <= maxPages; page++) {
    const image = await renderPageAsImage(pdf, page, {
      scale: 1.5,
      canvas: async () => (await import(canvasPackageName)) as never,
    });
    urls.push(`data:image/png;base64,${Buffer.from(image).toString("base64")}`);
  }
  return urls;
}

export async function parseMaintenanceInvoice(bytes: Uint8Array): Promise<{
  parsed: ParsedMaintenanceInvoice;
  rawText: string;
  parser: MaintenanceInvoiceParserMeta;
}> {
  if (!process.env.FAL_KEY) throw new Error("FAL_KEY is missing.");
  const { text, pageCount, pdf } = await extractPdf(bytes);

  let output: string | null;
  let source: MaintenanceInvoiceParserMeta["source"] = "text";
  if (text.length >= 40) {
    output = await runText(SYSTEM, `${INSTRUCTION}\n\nInvoice text:\n${text}`);
  } else {
    source = "vision";
    const pageImages = await renderPdfForOcr(pdf, pageCount);
    if (pageImages.length === 0) throw new Error("PDF could not be rendered.");
    output = await runVision(pageImages, SYSTEM, INSTRUCTION);
  }

  const parsed = safeMaintenanceInvoiceJson(output);
  if (!parsed) throw new Error("Invoice could not be parsed into maintenance services.");
  const warnings: string[] = [];
  if (!parsed.unit_number && !parsed.vehicle_id_text) warnings.push("Unit tespit edilemedi.");
  if (parsed.mileage == null) warnings.push("Invoice mileage tespit edilemedi.");
  if (source === "vision") warnings.push("Taranmış PDF vision fallback ile okundu; sonuçları dikkatle kontrol edin.");
  return {
    parsed,
    rawText: text,
    parser: {
      source,
      confidence: Math.max(0.55, Math.min(0.95, source === "text" ? 0.75 + Math.min(text.length, 2_000) / 10_000 : 0.66)),
      warnings,
    },
  };
}
