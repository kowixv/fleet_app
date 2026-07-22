import { VEHICLE_PHOTO_ASSETS, type VehiclePhotoAsset, type VehiclePhotoVariant } from "./vehicle-thumbnail-assets";

export type VehicleSvgVariant = "kenworth_svg" | "international_svg" | "generic_semi_svg" | "generic_box_svg";

export type VehicleThumbnailVariant = VehiclePhotoVariant | VehicleSvgVariant;

export interface VehicleThumbnailVehicle {
  make?: string | null;
  model?: string | null;
  truck_color?: string | null;
  vehicle_type?: string | null;
  color?: string | null;
  vehicleType?: string | null;
}

export interface VehicleThumbnailColors {
  bodyColor: string;
  accentColor: string;
  needsOutline: boolean;
  luminance: number;
}

export interface VehicleThumbnailDescriptor {
  variant: VehicleThumbnailVariant;
  colors: VehicleThumbnailColors;
  photoAsset: VehiclePhotoAsset | null;
  label: string;
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
const UNSAFE_COLOR_PATTERN = /(url\s*\(|var\s*\(|expression\s*\(|rgba?\s*\(|hsla?\s*\(|javascript:|currentcolor|inherit|transparent|[();<>])/i;

export function normalizeVehicleThumbnailText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

export function resolveVehicleThumbnail(vehicle: VehicleThumbnailVehicle): VehicleThumbnailDescriptor {
  const variant = getVehicleThumbnailVariant(vehicle);
  const colors = getVehicleThumbnailColors(vehicle.truck_color ?? vehicle.color);
  const photoAsset = isPhotoVariant(variant) ? VEHICLE_PHOTO_ASSETS[variant] : null;

  return {
    variant,
    colors,
    photoAsset,
    label: thumbnailLabel(variant),
  };
}

export function getVehicleThumbnailVariant(vehicle: VehicleThumbnailVehicle): VehicleThumbnailVariant {
  const make = normalizeVehicleThumbnailText(vehicle.make);
  const model = normalizeVehicleThumbnailText(vehicle.model);
  const type = normalizeVehicleThumbnailText(vehicle.vehicle_type ?? vehicle.vehicleType);
  const identity = `${make} ${model}`.trim();

  if (isAuthoritativeBoxTruck(type) || isLikelyBoxTruck(make, model, identity)) {
    return "box_truck_photo";
  }

  if (isPeterbilt(make, model, identity)) return "peterbilt_photo";
  if (isFreightliner(make, model, identity)) return "freightliner_photo";
  if (isKenworth(make, model, identity)) return "kenworth_svg";
  if (hasToken(identity, "international")) return "international_svg";

  return isGenericBoxType(type) ? "generic_box_svg" : "generic_semi_svg";
}

export function getVehicleThumbnailColors(truckColor: unknown): VehicleThumbnailColors {
  const bodyColor = normalizeTruckColor(truckColor);
  const luminance = relativeLuminance(bodyColor);
  return {
    bodyColor,
    accentColor: accentForBodyColor(bodyColor, luminance),
    needsOutline: luminance > 0.72,
    luminance,
  };
}

export function isPhotoVariant(variant: VehicleThumbnailVariant): variant is VehiclePhotoVariant {
  return variant === "peterbilt_photo" || variant === "freightliner_photo" || variant === "box_truck_photo";
}

export function thumbnailLabel(variant: VehicleThumbnailVariant): string {
  switch (variant) {
    case "peterbilt_photo":
      return "Peterbilt semi truck thumbnail";
    case "freightliner_photo":
      return "Freightliner semi truck thumbnail";
    case "box_truck_photo":
      return "Box truck thumbnail";
    case "kenworth_svg":
      return "Kenworth-style semi truck thumbnail";
    case "international_svg":
      return "International-style semi truck thumbnail";
    case "generic_box_svg":
      return "Generic box truck thumbnail";
    case "generic_semi_svg":
    default:
      return "Generic semi truck thumbnail";
  }
}

export function colorLabel(truckColor: unknown): string {
  const normalized = normalizeVehicleThumbnailText(truckColor);
  if (!normalized || UNSAFE_COLOR_PATTERN.test(normalized)) return "Gray";
  if (NAMED_COLORS[normalized]) return toTitleCase(normalized);

  const withoutHash = normalized.startsWith("#") ? normalized.slice(1) : normalized;
  if (/^[0-9a-f]{6}$/i.test(withoutHash)) return "Custom color";

  return "Gray";
}

function normalizeTruckColor(value: unknown): string {
  const normalized = normalizeVehicleThumbnailText(value);
  if (!normalized) return FALLBACK_BODY_COLOR;
  if (UNSAFE_COLOR_PATTERN.test(normalized)) return FALLBACK_BODY_COLOR;

  const withoutHash = normalized.startsWith("#") ? normalized.slice(1) : normalized;
  if (/^[0-9a-f]{6}$/i.test(withoutHash)) return `#${withoutHash.toLowerCase()}`;

  return NAMED_COLORS[normalized] ?? FALLBACK_BODY_COLOR;
}

function isAuthoritativeBoxTruck(type: string): boolean {
  return hasToken(type, "box truck");
}

function isGenericBoxType(type: string): boolean {
  return [
    "box truck",
    "straight truck",
    "cube truck",
    "cargo box",
    "van body",
    "reefer box",
  ].some((token) => hasToken(type, token));
}

function isLikelyBoxTruck(make: string, model: string, identity: string): boolean {
  if (hasToken(identity, "hino")) return true;
  if (hasToken(make, "isuzu") && (hasToken(model, "npr") || hasToken(model, "ftr"))) return true;
  if (hasToken(make, "freightliner") && (hasToken(model, "m2") || hasToken(identity, "m2 106"))) return true;
  if (hasToken(make, "international") && ["mv", "4300", "4400"].some((token) => hasToken(model, token))) return true;
  return false;
}

function isPeterbilt(make: string, model: string, identity: string): boolean {
  return hasToken(make, "peterbilt")
    || hasToken(make, "pete")
    || ["579", "567", "389", "379"].some((token) => hasToken(model || identity, token));
}

function isFreightliner(make: string, model: string, identity: string): boolean {
  return hasToken(make, "freightliner")
    || ["cascadia", "coronado", "century", "columbia"].some((token) => hasToken(model || identity, token));
}

function isKenworth(make: string, model: string, identity: string): boolean {
  return hasToken(make, "kenworth")
    || ["t680", "t880", "w900"].some((token) => hasToken(model || identity, token));
}

function hasToken(value: string, token: string): boolean {
  return new RegExp(`(^|[^a-z0-9])${escapeRegExp(token)}([^a-z0-9]|$)`, "i").test(value);
}

function accentForBodyColor(bodyColor: string, luminance: number): string {
  if (bodyColor === "#f8fafc" || luminance > 0.72) return "#94a3b8";
  if (luminance < 0.2) return "#cbd5e1";
  return "#334155";
}

function relativeLuminance(hex: string): number {
  const channels = hexToRgb(hex).map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (channels[0] ?? 0) + 0.7152 * (channels[1] ?? 0) + 0.0722 * (channels[2] ?? 0);
}

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
}

function toTitleCase(value: string): string {
  return value.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
