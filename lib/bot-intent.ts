/**
 * AI intent detection for the Telegram management bot.
 *
 * Turns a free-form Turkish/English message into a structured {intent, data,
 * missing} so the webhook can route it: list_* runs immediately, add/update/
 * delete/settlement go through a confirm step (see lib/bot-executor.ts).
 *
 * The model output is untrusted — we re-parse defensively (same spirit as
 * lib/parse.ts safeJson) and re-validate required fields server-side rather
 * than trusting the model's own `missing` array.
 */
import { runText } from "@/lib/ai";
import { localISODate } from "@/lib/format";

export type BotIntent =
  | "add_person"
  | "add_vehicle"
  | "add_expense"
  | "add_load"
  | "list_people"
  | "list_vehicles"
  | "list_loads"
  | "list_expenses"
  | "list_settlements"
  | "update_vehicle_mileage"
  | "update_person"
  | "delete_entity"
  | "create_settlement"
  | "unknown";

export interface IntentResult {
  intent: BotIntent;
  data: Record<string, unknown>;
  /** Required fields still missing — computed server-side, authoritative. */
  missing: string[];
}

const INTENTS: BotIntent[] = [
  "add_person", "add_vehicle", "add_expense", "add_load",
  "list_people", "list_vehicles", "list_loads", "list_expenses", "list_settlements",
  "update_vehicle_mileage", "update_person", "delete_entity", "create_settlement",
  "unknown",
];

/** Required fields per intent (authoritative; the model's `missing` is ignored). */
export const REQUIRED_FIELDS: Partial<Record<BotIntent, string[]>> = {
  add_person: ["full_name", "type"],
  add_vehicle: ["unit_number", "vehicle_type"],
  add_expense: ["category", "amount"],
  update_vehicle_mileage: ["unit_number", "mileage"],
  update_person: ["name"],
  delete_entity: ["entity_type", "name"],
  create_settlement: ["vehicle_unit"],
};

function systemPrompt(today: string): string {
  return `Sen bir trucking filo yönetim asistanısın. Kullanıcının Türkçe veya İngilizce
mesajından amacını (intent) ve verisini çıkar. SADECE tek bir JSON nesnesi döndür,
açıklama veya markdown ekleme.

Bugünün tarihi: ${today}. Tüm tarihleri YYYY-MM-DD formatında üret. "bugün", "dün",
"yarın", "bu hafta", "geçen hafta" gibi göreli ifadeleri buna göre çöz; settlement için
hafta ifadesini data.week alanına ("this_week" veya "last_week") yaz.

Yüzde değerlerini ondalık kesir olarak ver (%33 -> 0.33).

Geçerli intent değerleri:
- add_person      (data: full_name, type [company_driver|owner_operator|investor|external_carrier_driver], phone?, email?, default_pay_pct?)
- add_vehicle     (data: unit_number, vehicle_type [truck|box_truck|hotshot|trailer|other], ownership_type? [company_owned|owner_operator|investor_managed|external_carrier_statement|partner_carrier], vin?, make?, model?, year?, plate?)
- add_expense     (data: category, amount, date?, vehicle_unit?, driver_name?, notes?)
- add_load        (data: gross_amount?, pickup_date?, delivery_date?, pickup_location?, delivery_location?, load_number?)
- list_people | list_vehicles | list_loads | list_expenses | list_settlements   (data: filter?)
- update_vehicle_mileage  (data: unit_number, mileage)
- update_person   (data: name, + güncellenecek alanlar: full_name?, phone?, email?, default_pay_pct?, status?, type?)
- delete_entity   (data: entity_type [person|vehicle|expense|load], name)
- create_settlement (data: vehicle_unit, week? [this_week|last_week], week_start?, week_end?, settlement_type?)
- unknown         (anlaşılamayan mesajlar için)

Döndürülecek şema:
{ "intent": "...", "data": { ... } }`;
}

/** Extract and JSON.parse the first {...} block; null on any failure. */
function safeParse(text: string | null): Record<string, unknown> | null {
  if (!text) return null;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const raw = JSON.parse(match[0]);
    return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Which required fields are absent or blank in `data`. */
export function computeMissing(intent: BotIntent, data: Record<string, unknown>): string[] {
  const required = REQUIRED_FIELDS[intent] ?? [];
  return required.filter((f) => {
    const v = data[f];
    return v === undefined || v === null || (typeof v === "string" && v.trim() === "");
  });
}

/**
 * Detect intent + data from a message. Returns null only when the AI backend is
 * unavailable; unparseable / off-topic messages resolve to {intent:"unknown"}.
 */
export async function detectIntent(text: string): Promise<IntentResult | null> {
  const today = localISODate(new Date());
  const out = await runText(systemPrompt(today), text);
  if (out === null) return null; // FAL_KEY not configured
  const raw = safeParse(out);
  if (!raw) return { intent: "unknown", data: {}, missing: [] };

  const intent = INTENTS.includes(raw.intent as BotIntent)
    ? (raw.intent as BotIntent)
    : "unknown";
  const data =
    raw.data && typeof raw.data === "object"
      ? (raw.data as Record<string, unknown>)
      : {};
  return { intent, data, missing: computeMissing(intent, data) };
}

/**
 * Monday–Sunday range for a week phrase. "last_week"/"geçen" => previous week,
 * anything else (incl. "this_week"/undefined) => the week containing `today`.
 */
export function weekRange(
  phrase: string | undefined | null,
  today: Date = new Date(),
): { start: string; end: string } {
  const isLast = /last|geçen|gecen|önceki|onceki/i.test(String(phrase ?? ""));
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const dow = base.getDay(); // 0 Sun .. 6 Sat
  const toMonday = (dow + 6) % 7; // days since Monday
  const monday = new Date(base);
  monday.setDate(base.getDate() - toMonday - (isLast ? 7 : 0));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { start: localISODate(monday), end: localISODate(sunday) };
}
