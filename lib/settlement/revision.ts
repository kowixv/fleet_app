import { createHash } from "node:crypto";

export const STALE_SETTLEMENT_PREVIEW_MESSAGE =
  "Settlement data changed after preview. Review the updated calculation before creating it.";

function normalizeForHash(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeForHash);
  if (value && typeof value === "object") {
    const input = value as Record<string, unknown>;
    return Object.keys(input)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        const normalized = normalizeForHash(input[key]);
        acc[key] = normalized === undefined ? null : normalized;
        return acc;
      }, {});
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return Number(value.toFixed(6));
  }
  return value ?? null;
}

export function stableSettlementRevision(value: unknown): string {
  const json = JSON.stringify(normalizeForHash(value));
  return `sha256:${createHash("sha256").update(json).digest("hex")}`;
}
