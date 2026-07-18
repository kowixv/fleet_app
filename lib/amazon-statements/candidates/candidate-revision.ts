import { stableSettlementRevision } from "@/lib/settlement/revision";

export function candidateRevision(value: unknown): string {
  return stableSettlementRevision(value);
}

export function candidateSourceRevision(parts: unknown[]): string {
  return candidateRevision({ source: "amazon-statement-candidate", parts });
}
