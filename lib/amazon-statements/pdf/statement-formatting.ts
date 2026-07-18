export function formatMoney(value: number): string {
  const n = Number.isFinite(value) ? value : 0;
  const body = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${n < 0 ? "-" : ""}$${body}`;
}

export function formatNumber(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "N/A";
  return value.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "N/A";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-");
    return `${m}/${d}/${y}`;
  }
  return value;
}

export function displayOrNA(value: string | number | null | undefined): string {
  const text = String(value ?? "").trim();
  return text || "N/A";
}

/** Keep generated PDFs on standard Helvetica-safe glyphs. */
export function pdfSafeText(value: string | null | undefined): string {
  const input = String(value ?? "").replace(/\u2192/g, "->").replace(/\u2190/g, "<-");
  const map: Record<string, string> = {
    "ş": "s",
    "Ş": "S",
    "ğ": "g",
    "Ğ": "G",
    "ı": "i",
    "İ": "I",
    "ö": "o",
    "Ö": "O",
    "ü": "u",
    "Ü": "U",
    "ç": "c",
    "Ç": "C",
    "–": "-",
    "—": "-",
    "’": "'",
    "“": "\"",
    "”": "\"",
  };
  return input.replace(/[şŞğĞıİöÖüÜçÇ–—’“”]/g, (c) => map[c] ?? c);
}

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
