export type VehicleThumbnailVariant =
  | "peterbilt_semi"
  | "kenworth_semi"
  | "freightliner_semi"
  | "international_box"
  | "generic_semi"
  | "generic_box";

export interface VehicleThumbnailVehicle {
  make?: string | null;
  model?: string | null;
  truck_color?: string | null;
  vehicle_type?: string | null;
}

export interface VehicleThumbnailColors {
  bodyColor: string;
  accentColor: string;
  needsOutline: boolean;
}

const NAMED_COLORS: Record<string, string> = {
  white: "#f8fafc",
  black: "#111827",
  blue: "#2563eb",
  "dark blue": "#1e3a8a",
  navy: "#1e3a8a",
  "light blue": "#60a5fa",
  yellow: "#eab308",
  red: "#dc2626",
  silver: "#a8b0ba",
  "metallic silver": "#a8b0ba",
  gray: "#6b7280",
  grey: "#6b7280",
  green: "#15803d",
  orange: "#ea580c",
  maroon: "#7f1d1d",
  purple: "#7e22ce",
  brown: "#7c4a2d",
  gold: "#d4a017",
};

const FALLBACK_BODY_COLOR = "#64748b";

export function normalizeVehicleThumbnailText(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase().replace(/\s+/g, " ") : "";
}

export function getVehicleThumbnailVariant(vehicle: VehicleThumbnailVehicle): VehicleThumbnailVariant {
  const make = normalizeVehicleThumbnailText(vehicle.make);
  const model = normalizeVehicleThumbnailText(vehicle.model);
  const type = normalizeVehicleThumbnailText(vehicle.vehicle_type).replace(/_/g, " ");
  const identity = `${make} ${model}`.trim();

  if (isBoxTruck(type, identity)) {
    return identity.includes("international") ? "international_box" : "generic_box";
  }

  if (hasToken(identity, "international")) {
    return "international_box";
  }

  if (hasToken(identity, "peterbilt") || hasToken(identity, "579") || hasToken(identity, "567")) {
    return "peterbilt_semi";
  }
  if (hasToken(identity, "kenworth") || hasToken(identity, "t680") || hasToken(identity, "t880")) {
    return "kenworth_semi";
  }
  if (hasToken(identity, "freightliner") || hasToken(identity, "cascadia")) {
    return "freightliner_semi";
  }

  return "generic_semi";
}

export function getVehicleThumbnailColors(truckColor: unknown): VehicleThumbnailColors {
  const bodyColor = normalizeTruckColor(truckColor);
  return {
    bodyColor,
    accentColor: accentForBodyColor(bodyColor),
    needsOutline: bodyColor === "#f8fafc",
  };
}

function normalizeTruckColor(value: unknown): string {
  const normalized = normalizeVehicleThumbnailText(value);
  if (!normalized) return FALLBACK_BODY_COLOR;
  if (/(url\(|var\(|rgba?\(|hsla?\(|javascript:|;|<|>)/i.test(normalized)) return FALLBACK_BODY_COLOR;

  const withoutHash = normalized.startsWith("#") ? normalized.slice(1) : normalized;
  if (/^[0-9a-f]{6}$/i.test(withoutHash)) return `#${withoutHash.toLowerCase()}`;

  return NAMED_COLORS[normalized] ?? FALLBACK_BODY_COLOR;
}

function hasToken(value: string, token: string): boolean {
  return new RegExp(`(^|[^a-z0-9])${escapeRegExp(token)}([^a-z0-9]|$)`, "i").test(value);
}

function isBoxTruck(type: string, identity: string): boolean {
  if (hasToken(type, "box truck")) return true;
  return [
    "box truck",
    "straight truck",
    "cube truck",
    "cargo box",
    "van body",
    "reefer box",
    "m2",
    "m2 106",
    "mv",
    "4300",
    "npr",
    "hino",
  ].some((token) => hasToken(identity, token));
}

function accentForBodyColor(bodyColor: string): string {
  if (bodyColor === "#111827" || bodyColor === "#1e3a8a" || bodyColor === "#7f1d1d") return "#cbd5e1";
  if (bodyColor === "#f8fafc") return "#94a3b8";
  return "#334155";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
