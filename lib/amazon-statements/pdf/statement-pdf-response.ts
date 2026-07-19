import { NextResponse } from "next/server";

type DbRow = Record<string, unknown>;

export function statementPdfResponse(
  pdf: Uint8Array | Buffer,
  candidate: DbRow,
  candidateStatus: string,
  detailMode: "canonical-details" | "snapshot-fallback",
) {
  const filename = safeFilename(`amazon-statement-${String(candidate.id).slice(0, 8)}-${candidateStatus}.pdf`);
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "private, no-store",
      "X-Statement-Detail-Mode": detailMode,
    },
  });
}

function safeFilename(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-");
}
