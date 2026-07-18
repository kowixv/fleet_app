import { roundMoney, sha256Hex, stableJson } from "../parsers/normalization";

export function projectionRevision(value: unknown): string {
  return sha256Hex(stableJson(value));
}

export function projectionSourceFingerprint(parts: unknown[]): string {
  return sha256Hex(stableJson(parts));
}

export function sumProjectionMoney(values: number[]): number {
  return roundMoney(values.reduce((sum, value) => sum + value, 0));
}
