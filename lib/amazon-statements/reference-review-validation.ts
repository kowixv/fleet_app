export type ReferenceReviewCategory = "driver" | "vehicle" | "facility" | "fuel_assignment" | "team_split";

export interface ReferenceReviewValidationResult {
  ok: boolean;
  errors: Record<string, string>;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const US_STATE = /^[A-Z]{2}$/;
const COUNTRY = /^[A-Z]{2}$/;

export function validateReferenceReason(reason: string): string | null {
  const trimmed = reason.trim();
  if (trimmed.length < 3) return "Review reason is required.";
  if (trimmed.length > 500) return "Review reason must be 500 characters or fewer.";
  return null;
}

export function validateEffectiveDates(effectiveFrom: string, effectiveTo?: string | null): string | null {
  if (!ISO_DATE.test(effectiveFrom)) return "Effective-from must be an ISO date.";
  if (effectiveTo && !ISO_DATE.test(effectiveTo)) return "Effective-to must be an ISO date.";
  if (effectiveTo && effectiveTo <= effectiveFrom) return "Effective-to must be after effective-from.";
  return null;
}

export function validateFacilityFields(input: {
  city: string;
  state: string;
  countryCode: string;
  postalCode?: string | null;
  timezone?: string | null;
}): ReferenceReviewValidationResult {
  const errors: Record<string, string> = {};
  if (!input.city.trim()) errors.city = "City is required.";
  if (!US_STATE.test(input.state.trim().toUpperCase())) errors.state = "State must be a two-letter code.";
  if (!COUNTRY.test(input.countryCode.trim().toUpperCase())) errors.countryCode = "Country must be a two-letter code.";
  if ((input.postalCode ?? "").length > 20) errors.postalCode = "Postal code is too long.";
  if ((input.timezone ?? "").length > 64) errors.timezone = "Timezone is too long.";
  return { ok: Object.keys(errors).length === 0, errors };
}

export function validateTeamSplitBasisPoints(values: number[]): string | null {
  if (values.length < 2) return "At least two team members are required.";
  if (values.some((value) => !Number.isInteger(value))) return "Team shares must use integer basis points.";
  if (values.some((value) => value <= 0)) return "Team shares must be greater than zero.";
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total !== 10000) return "Team shares must total exactly 10000 basis points.";
  return null;
}

export function validateUniqueSelections(values: string[]): string | null {
  const present = values.filter(Boolean);
  if (present.length !== new Set(present).size) return "Duplicate selections are not allowed.";
  return null;
}
