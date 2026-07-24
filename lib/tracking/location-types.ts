import { haversineDistanceMiles } from "@/lib/tracking/distance";

export type FleetLocationType =
  | "yard"
  | "mechanic_shop"
  | "mobile_mechanic"
  | "tire_shop"
  | "dealer"
  | "towing"
  | "truck_parking"
  | "truck_wash"
  | "parts_store"
  | "fuel_stop"
  | "warehouse"
  | "other";

export interface FleetLocation {
  id: string;
  organization_id: string;
  name: string;
  location_type: FleetLocationType;
  address_line: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  latitude: number;
  longitude: number;
  phone: string | null;
  email: string | null;
  website: string | null;
  business_hours: string | null;
  is_24_hour: boolean;
  mobile_service: boolean;
  heavy_duty_capable: boolean;
  preferred_vendor: boolean;
  services: string[];
  internal_rating: number | null;
  notes: string | null;
  active: boolean;
}

export type FleetLocationInput = Omit<FleetLocation, "id" | "organization_id" | "active"> & {
  active?: boolean;
};

export type MapFleetLocation = Omit<FleetLocation, "organization_id" | "notes" | "active" | "email" | "website">;

export const FLEET_LOCATION_TYPES = [
  "yard",
  "mechanic_shop",
  "mobile_mechanic",
  "tire_shop",
  "dealer",
  "towing",
  "truck_parking",
  "truck_wash",
  "parts_store",
  "fuel_stop",
  "warehouse",
  "other",
] as const satisfies readonly FleetLocationType[];

export const FLEET_LOCATION_LABELS: Record<FleetLocationType, string> = {
  yard: "Yard",
  mechanic_shop: "Mechanic",
  mobile_mechanic: "Mobile Mechanic",
  tire_shop: "Tire",
  dealer: "Dealer",
  towing: "Towing",
  truck_parking: "Parking",
  truck_wash: "Truck Wash",
  parts_store: "Parts Store",
  fuel_stop: "Fuel",
  warehouse: "Warehouse",
  other: "Other",
};

export const DEFAULT_SUPPORT_TYPES: FleetLocationType[] = [
  "mechanic_shop",
  "mobile_mechanic",
  "tire_shop",
  "dealer",
  "towing",
  "yard",
];

export const LOCATION_FILTER_TYPES: FleetLocationType[] = [
  "yard",
  "mechanic_shop",
  "tire_shop",
  "dealer",
  "towing",
  "truck_parking",
  "fuel_stop",
  "other",
];

export const SERVICES_LIMIT = 20;
export const MAX_SERVICE_LENGTH = 80;
export const MAX_NOTE_LENGTH = 2000;
export const MAX_TEXT_LENGTH = 255;

export function isFleetLocationType(value: unknown): value is FleetLocationType {
  return typeof value === "string" && FLEET_LOCATION_TYPES.includes(value as FleetLocationType);
}

export function normalizeNullableText(value: unknown, maxLength = MAX_TEXT_LENGTH): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeBool(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value === "true" || value === "on" || value === "1";
  return fallback;
}

export interface ValidationResult {
  ok: boolean;
  data?: FleetLocationInput;
  errors: string[];
}

export function validateFleetLocationInput(raw: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];
  const name = normalizeNullableText(raw.name, 120);
  const latitude = finiteNumber(raw.latitude);
  const longitude = finiteNumber(raw.longitude);
  const rating = raw.internal_rating === null || raw.internal_rating === undefined || raw.internal_rating === ""
    ? null
    : finiteNumber(raw.internal_rating);
  const rawServices = Array.isArray(raw.services)
    ? raw.services
    : typeof raw.services === "string"
      ? raw.services.split(",")
      : [];
  const services = rawServices
    .map((value) => normalizeNullableText(value, MAX_SERVICE_LENGTH))
    .filter((value): value is string => Boolean(value))
    .slice(0, SERVICES_LIMIT);

  if (!name) errors.push("Name is required.");
  if (!isFleetLocationType(raw.location_type)) errors.push("Invalid location type.");
  if (latitude === null || latitude < -90 || latitude > 90) errors.push("Latitude must be between -90 and 90.");
  if (longitude === null || longitude < -180 || longitude > 180) errors.push("Longitude must be between -180 and 180.");
  if (rating !== null && (rating < 1 || rating > 5)) errors.push("Rating must be between 1 and 5.");
  if (rawServices.length > SERVICES_LIMIT) errors.push(`Services cannot exceed ${SERVICES_LIMIT} items.`);

  const phone = normalizeNullableText(raw.phone, 40);
  const email = normalizeNullableText(raw.email, 160);
  const website = normalizeSafeWebsite(raw.website);
  const notes = normalizeNullableText(raw.notes, MAX_NOTE_LENGTH);

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("Email is invalid.");
  if (raw.website && !website) errors.push("Website must be http or https.");

  if (errors.length || !name || !isFleetLocationType(raw.location_type) || latitude === null || longitude === null) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    errors: [],
    data: {
      name,
      location_type: raw.location_type,
      address_line: normalizeNullableText(raw.address_line, 180),
      city: normalizeNullableText(raw.city, 80),
      state: normalizeNullableText(raw.state, 40),
      postal_code: normalizeNullableText(raw.postal_code, 20),
      latitude,
      longitude,
      phone,
      email,
      website,
      business_hours: normalizeNullableText(raw.business_hours, 160),
      is_24_hour: normalizeBool(raw.is_24_hour),
      mobile_service: normalizeBool(raw.mobile_service),
      heavy_duty_capable: normalizeBool(raw.heavy_duty_capable, true),
      preferred_vendor: normalizeBool(raw.preferred_vendor),
      services,
      internal_rating: rating,
      notes,
    },
  };
}

export function normalizeSafeWebsite(value: unknown): string | null {
  const text = normalizeNullableText(value, 300);
  if (!text) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function formatFleetLocationAddress(location: Pick<FleetLocation, "address_line" | "city" | "state" | "postal_code">): string {
  const locality = [location.city, location.state, location.postal_code].filter(Boolean).join(", ");
  return [location.address_line, locality].filter(Boolean).join("\n");
}

export function buildDirectionsUrl(params: {
  destinationLat: number;
  destinationLng: number;
  originLat?: number | null;
  originLng?: number | null;
}): string {
  const destination = `${params.destinationLat},${params.destinationLng}`;
  const url = new URL("https://www.google.com/maps/dir/");
  url.searchParams.set("api", "1");
  url.searchParams.set("destination", destination);
  if (
    typeof params.originLat === "number" &&
    Number.isFinite(params.originLat) &&
    typeof params.originLng === "number" &&
    Number.isFinite(params.originLng)
  ) {
    url.searchParams.set("origin", `${params.originLat},${params.originLng}`);
  }
  return url.toString();
}

export function buildDriverMessage(params: {
  unitNumber: string;
  location: MapFleetLocation;
  approxDistanceMiles: number | null;
  directionsUrl: string;
}): string {
  const address = formatFleetLocationAddress(params.location).replace(/\n/g, ", ");
  return [
    `Unit ${params.unitNumber} icin onerilen servis:`,
    "",
    params.location.name,
    address,
    params.location.phone ? `Phone: ${params.location.phone}` : null,
    params.approxDistanceMiles === null
      ? null
      : `Approx. distance: ${params.approxDistanceMiles.toFixed(1)} mi`,
    "",
    "Directions:",
    params.directionsUrl,
  ].filter((line): line is string => line !== null).join("\n");
}

export interface NearbyLocation extends MapFleetLocation {
  approx_distance_miles: number;
}

export interface NearbyFilters {
  types?: readonly FleetLocationType[];
  radiusMiles?: number | "all";
  preferredOnly?: boolean;
  open24Only?: boolean;
  mobileOnly?: boolean;
  limit?: number;
}

export function getNearbyFleetLocations(
  unit: { latitude: number | null; longitude: number | null } | null,
  locations: readonly MapFleetLocation[],
  filters: NearbyFilters = {},
): NearbyLocation[] {
  if (!unit || unit.latitude === null || unit.longitude === null) return [];
  const types = new Set(filters.types ?? DEFAULT_SUPPORT_TYPES);
  const radiusMiles = filters.radiusMiles ?? 50;

  return locations
    .filter((location) => types.has(location.location_type))
    .filter((location) => !filters.preferredOnly || location.preferred_vendor)
    .filter((location) => !filters.open24Only || location.is_24_hour)
    .filter((location) => !filters.mobileOnly || location.mobile_service)
    .map((location) => ({
      ...location,
      approx_distance_miles: haversineDistanceMiles(
        unit.latitude as number,
        unit.longitude as number,
        location.latitude,
        location.longitude,
      ),
    }))
    .filter((location) => radiusMiles === "all" || location.approx_distance_miles <= radiusMiles)
    .sort((a, b) => a.approx_distance_miles - b.approx_distance_miles)
    .slice(0, filters.limit ?? 20);
}

export interface MarkerStyle {
  label: string;
  glyph: string;
  bg: string;
  fg: string;
}

export const LOCATION_MARKER_STYLES: Record<FleetLocationType, MarkerStyle> = {
  yard: { label: "Yard", glyph: "H", bg: "#2563eb", fg: "#ffffff" },
  mechanic_shop: { label: "Mechanic", glyph: "W", bg: "#dc2626", fg: "#ffffff" },
  mobile_mechanic: { label: "Mobile Mechanic", glyph: "M", bg: "#ea580c", fg: "#ffffff" },
  tire_shop: { label: "Tire", glyph: "T", bg: "#111827", fg: "#ffffff" },
  dealer: { label: "Dealer", glyph: "D", bg: "#7c3aed", fg: "#ffffff" },
  towing: { label: "Towing", glyph: "Tow", bg: "#be123c", fg: "#ffffff" },
  truck_parking: { label: "Parking", glyph: "P", bg: "#0891b2", fg: "#ffffff" },
  truck_wash: { label: "Truck Wash", glyph: "S", bg: "#0d9488", fg: "#ffffff" },
  parts_store: { label: "Parts", glyph: "P+", bg: "#ca8a04", fg: "#ffffff" },
  fuel_stop: { label: "Fuel", glyph: "F", bg: "#16a34a", fg: "#ffffff" },
  warehouse: { label: "Warehouse", glyph: "Wh", bg: "#475569", fg: "#ffffff" },
  other: { label: "Other", glyph: "Pin", bg: "#6b7280", fg: "#ffffff" },
};

export function getLocationMarkerStyle(value: unknown): MarkerStyle {
  return isFleetLocationType(value) ? LOCATION_MARKER_STYLES[value] : LOCATION_MARKER_STYLES.other;
}
