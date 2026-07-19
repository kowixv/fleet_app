export interface StatementRouteResolutionInput {
  originCode?: string | null;
  destinationCode?: string | null;
  verifiedOrigin?: string | null;
  verifiedDestination?: string | null;
}

export interface StatementRouteResolution {
  display: string | null;
  displayReady: boolean;
  source: "verified_mapping" | "curated_fallback" | "facility_code" | "unresolved";
}

/**
 * Curated Amazon facility display names used only when the organization's
 * verified facility table has no active row. Verified database mappings always
 * take priority. Keep this list conservative: every entry must be backed by a
 * reviewed statement or operational source.
 */
export const CURATED_AMAZON_FACILITY_DISPLAY: Readonly<Record<string, string>> = Object.freeze({
  CSG1: "Moreland, GA",
  CHA2: "Charleston, TN",
  CMH3: "Monroe, OH",
  FWA6: "Fort Wayne, IN",
  HAT9: "Lithia Springs, GA",
  HGA6: "Union City, GA",
  HSV2: "Madison, AL",
  KCVG: "Hebron, KY",
  RDU1: "Garner, NC",
  RDU2: "Smithfield, NC",
  SAV4: "Pooler, GA",
  SAV7: "Pooler, GA",
  WML1: "Milton, FL",
  XAT3: "Atlanta, GA",
});

export function resolveStatementRoute(input: StatementRouteResolutionInput): StatementRouteResolution {
  const verifiedOrigin = cleanDisplay(input.verifiedOrigin);
  const verifiedDestination = cleanDisplay(input.verifiedDestination);
  if (verifiedOrigin && verifiedDestination) {
    return {
      display: `${verifiedOrigin} -> ${verifiedDestination}`,
      displayReady: true,
      source: "verified_mapping",
    };
  }

  const originCode = normalizeFacilityCode(input.originCode);
  const destinationCode = normalizeFacilityCode(input.destinationCode);
  const origin = verifiedOrigin ?? curatedFacilityDisplay(originCode);
  const destination = verifiedDestination ?? curatedFacilityDisplay(destinationCode);
  if (origin && destination) {
    return {
      display: `${origin} -> ${destination}`,
      displayReady: true,
      source: "curated_fallback",
    };
  }

  if (originCode && destinationCode) {
    return {
      display: `${originCode} -> ${destinationCode}`,
      displayReady: false,
      source: "facility_code",
    };
  }

  return {
    display: originCode ?? destinationCode,
    displayReady: false,
    source: originCode || destinationCode ? "facility_code" : "unresolved",
  };
}

export function curatedFacilityDisplay(code: string | null | undefined): string | null {
  const normalized = normalizeFacilityCode(code);
  return normalized ? CURATED_AMAZON_FACILITY_DISPLAY[normalized] ?? null : null;
}

function normalizeFacilityCode(value: string | null | undefined): string | null {
  const normalized = String(value ?? "").trim().toUpperCase();
  return normalized || null;
}

function cleanDisplay(value: string | null | undefined): string | null {
  const cleaned = String(value ?? "").trim();
  return cleaned || null;
}
