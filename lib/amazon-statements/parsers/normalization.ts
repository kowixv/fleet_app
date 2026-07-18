import { createHash } from "node:crypto";

export interface NormalizedMoney {
  value: number | null;
  warning?: string;
}

export interface NormalizedDate {
  value: string | null;
  warning?: string;
}

export interface CsvParseResult {
  headers: string[];
  rows: string[][];
  warnings: string[];
}

export function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function displayValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
}

export function parseMoneyStrict(value: unknown): NormalizedMoney {
  if (value === null || value === undefined || value === "") return { value: null };
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return { value: null, warning: "money_not_finite" };
    return { value: roundMoney(value) };
  }
  const raw = String(value).trim();
  if (!raw) return { value: null };
  const accountingNegative = raw.startsWith("(") && raw.endsWith(")");
  const body = accountingNegative ? raw.slice(1, -1).trim() : raw;
  const signless = body.replace(/^\+/, "");
  const moneyPattern = /^-?\$?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/;
  if (!moneyPattern.test(signless)) return { value: null, warning: "money_malformed" };
  const parsed = Number(signless.replace(/\$/g, "").replace(/,/g, ""));
  if (!Number.isFinite(parsed)) return { value: null, warning: "money_not_finite" };
  return { value: roundMoney(accountingNegative ? -parsed : parsed) };
}

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function parseDateOnly(value: unknown, options: { assumeSlashMonthDay?: boolean } = {}): NormalizedDate {
  if (value === null || value === undefined || value === "") return { value: null };
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return { value: null, warning: "date_invalid" };
    return { value: datePartsToIso(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate()) };
  }
  if (typeof value === "number") return excelSerialToDate(value);
  const raw = String(value).trim();
  if (!raw) return { value: null };
  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/);
  if (iso) return partsToDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) {
    const first = Number(slash[1]);
    const second = Number(slash[2]);
    if (options.assumeSlashMonthDay) return partsToDate(Number(slash[3]), first, second);
    if (first <= 12 && second <= 12) return { value: null, warning: "date_ambiguous" };
    return partsToDate(Number(slash[3]), first, second);
  }
  const monthName = raw.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/);
  if (monthName) {
    const month = monthNumber(monthName[1]);
    if (!month) return { value: null, warning: "date_unrecognized" };
    return partsToDate(Number(monthName[3]), month, Number(monthName[2]));
  }
  return { value: null, warning: "date_unrecognized" };
}

function excelSerialToDate(serial: number): NormalizedDate {
  if (!Number.isFinite(serial)) return { value: null, warning: "date_not_finite" };
  const wholeDays = Math.floor(serial);
  if (wholeDays < 1 || wholeDays > 60000) return { value: null, warning: "date_serial_out_of_range" };
  const utc = Date.UTC(1899, 11, 30 + wholeDays);
  const date = new Date(utc);
  return { value: datePartsToIso(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()) };
}

function partsToDate(year: number, month: number, day: number): NormalizedDate {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() + 1 !== month
    || date.getUTCDate() !== day
  ) {
    return { value: null, warning: "date_invalid" };
  }
  return { value: datePartsToIso(year, month, day) };
}

function datePartsToIso(year: number, month: number, day: number): string {
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

function monthNumber(value: string): number | null {
  const key = value.toLowerCase().slice(0, 3);
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const index = months.indexOf(key);
  return index === -1 ? null : index + 1;
}

export function parseDriverTokens(raw: unknown): { raw: string; tokens: string[]; requiresTeamRule: boolean } {
  const text = displayValue(raw);
  const tokens = text.split(";").map((part) => part.trim()).filter(Boolean);
  return { raw: text, tokens, requiresTeamRule: tokens.length > 1 };
}

export function parseCsv(text: string): CsvParseResult {
  const input = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  const warnings: string[] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    const next = input[i + 1];
    if (inQuotes) {
      if (char === "\"" && next === "\"") {
        cell += "\"";
        i += 1;
      } else if (char === "\"") {
        inQuotes = false;
      } else {
        cell += char;
      }
      continue;
    }
    if (char === "\"") {
      inQuotes = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }
  if (inQuotes) warnings.push("csv_unclosed_quote");
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  const nonEmptyRows = rows.filter((candidate) => candidate.some((value) => value.trim() !== ""));
  if (nonEmptyRows.length === 0) return { headers: [], rows: [], warnings: ["csv_empty"] };
  return { headers: nonEmptyRows[0], rows: nonEmptyRows.slice(1), warnings };
}

export function sha256Hex(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
