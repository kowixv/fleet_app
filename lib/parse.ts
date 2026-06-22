import { runVision, runText, dataUri } from "@/lib/ai";
import { extractText, getDocumentProxy } from "unpdf";

export interface ParsedLoad {
  load_number: string | null;
  broker_name: string | null;
  driver_name: string | null;
  pickup_date: string | null; // YYYY-MM-DD
  pickup_location: string | null;
  delivery_date: string | null;
  delivery_location: string | null;
  total_miles: number | null;
  gross_rate: number | null;
  notes: string | null;
}

const SYSTEM = `You extract trucking LOAD information from a rate confirmation, Amazon Relay
screenshot, broker confirmation, or a chat message. Return ONLY a JSON object, no commentary.`;

const INSTRUCTION = `Extract the load and return ONLY this JSON (use null when unknown):
{
  "load_number": string|null,
  "broker_name": string|null,
  "driver_name": string|null,
  "pickup_date": "YYYY-MM-DD"|null,
  "pickup_location": "City, ST"|null,
  "delivery_date": "YYYY-MM-DD"|null,
  "delivery_location": "City, ST"|null,
  "total_miles": number|null,
  "gross_rate": number|null,
  "notes": string|null
}
gross_rate = total amount paid for the load in USD (number only, no symbols).
total_miles = total trip miles if present. Prefer explicit values over guesses.`;

/** Coerce an unknown model value to a clean string field, or null. */
function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" || t.toLowerCase() === "null" ? null : t;
}

/** Coerce an unknown model value to a finite, non-negative number, or null. */
function numField(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? v : null;
  if (typeof v !== "string") return null; // reject objects/arrays/booleans
  const s = v.replace(/[^0-9.\-]/g, "");
  if (s === "" || s === "-" || s === ".") return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Coerce a model date value to YYYY-MM-DD, or null. */
function dateField(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/**
 * Parse and *validate* the model's JSON output into a ParsedLoad. The LLM output is
 * untrusted: we never insert raw types into the DB. Numbers must be finite/non-negative,
 * dates must match YYYY-MM-DD, strings are trimmed and "null"-coerced.
 */
export function safeJson(text: string | null): ParsedLoad | null {
  if (!text) return null;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(match[0]);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  return {
    load_number: str(raw.load_number),
    broker_name: str(raw.broker_name),
    driver_name: str(raw.driver_name),
    pickup_date: dateField(raw.pickup_date),
    pickup_location: str(raw.pickup_location),
    delivery_date: dateField(raw.delivery_date),
    delivery_location: str(raw.delivery_location),
    total_miles: numField(raw.total_miles),
    gross_rate: numField(raw.gross_rate),
    notes: str(raw.notes),
  };
}

/** Extract embedded text from a PDF (returns "" for scanned/imageless PDFs). */
async function pdfText(base64: string): Promise<string> {
  try {
    const bytes = Uint8Array.from(Buffer.from(base64, "base64"));
    const pdf = await getDocumentProxy(bytes);
    const { text } = await extractText(pdf, { mergePages: true });
    return (Array.isArray(text) ? text.join("\n") : text || "").trim();
  } catch {
    return "";
  }
}

/**
 * Parse a load from a Telegram message: text and/or a file (image or PDF).
 * - image  -> fal vision (openrouter/router/vision)
 * - pdf    -> extract embedded text -> fal text; null if the PDF has no text layer
 * - text   -> fal text
 */
export async function parseLoad(input: {
  text?: string;
  file?: { base64: string; mime: string };
}): Promise<ParsedLoad | null> {
  if (!process.env.FAL_KEY) return null;

  // Image: send straight to the vision model.
  if (input.file && input.file.mime !== "application/pdf") {
    const out = await runVision(
      [dataUri(input.file.base64, input.file.mime)],
      SYSTEM,
      `${INSTRUCTION}${input.text ? `\n\nMessage text:\n${input.text}` : ""}`,
    );
    return safeJson(out);
  }

  // PDF: pull the text layer, then use the text model.
  if (input.file && input.file.mime === "application/pdf") {
    const extracted = await pdfText(input.file.base64);
    const body = [extracted, input.text].filter(Boolean).join("\n\n");
    if (!body.trim()) return null; // scanned PDF with no text layer -> manual entry
    const out = await runText(SYSTEM, `${INSTRUCTION}\n\nDocument text:\n${body}`);
    return safeJson(out);
  }

  // Plain text message.
  if (input.text) {
    const out = await runText(SYSTEM, `${INSTRUCTION}\n\nMessage text:\n${input.text}`);
    return safeJson(out);
  }

  return null;
}
