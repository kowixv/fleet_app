export interface StatementCompanyIdentity {
  name: string;
  secondary: string;
}

const LEGAL_NAME_BY_SCAC: Readonly<Record<string, string>> = Object.freeze({
  AVFYC: "ZYNP LLC",
});

export function resolveStatementCompanyIdentity(
  organizationName: string | null | undefined,
  carrierIdentifier: string | null | undefined,
): StatementCompanyIdentity {
  const scac = normalizeScac(carrierIdentifier);
  const legalName = scac ? LEGAL_NAME_BY_SCAC[scac] : undefined;
  const organization = clean(organizationName);

  return {
    name: legalName ?? organization ?? "Fleet",
    secondary: scac ? `SCAC: ${scac}` : "Amazon Relay statement",
  };
}

function normalizeScac(value: string | null | undefined): string | null {
  const normalized = String(value ?? "").trim().toUpperCase();
  return normalized || null;
}

function clean(value: string | null | undefined): string | null {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}
