export type VehicleThumbnailVariant =
  | "aero_sleeper"
  | "conventional_sleeper"
  | "vocational_daycab"
  | "box_truck"
  | "generic_truck";

export interface VehicleThumbnailInput {
  make?: string | null;
  model?: string | null;
  color?: string | null;
  vehicleType?: string | null;
}

export interface VehicleThumbnailDescriptor {
  variant: VehicleThumbnailVariant;
  bodyColor: string;
  accentColor: string;
  wheelColor: string;
  label: string;
}

const NAMED_COLORS: Record<string, string> = {
  white: "#f8fafc",
  black: "#111827",
  blue: "#2563eb",
  navy: "#1e3a8a",
  yellow: "#eab308",
  red: "#dc2626",
  silver: "#a8b0ba",
  gray: "#6b7280",
  grey: "#6b7280",
  green: "#15803d",
  orange: "#ea580c",
  maroon: "#7f1d1d",
  purple: "#7e22ce",
  brown: "#7c4a2d",
  gold: "#d4a017",
};

const AERO_MODELS = [
  "579",
  "t680",
  "cascadia",
  "vnl",
  "lt",
  "anthem",
  "prostar",
  "760",
  "780",
];

const CONVENTIONAL_MODELS = [
  "389",
  "379",
  "w900",
  "9900",
  "coronado",
  "classic xl",
  "western star 4900",
];

const VOCATIONAL_MODELS = [
  "567",
  "t880",
  "49x",
  "47x",
  "114sd",
  "122sd",
  "granite",
  "hx",
];

const BOX_MODELS = [
  "m2",
  "mv",
  "4300",
  "4400",
  "business class",
  "hino",
  "isuzu",
  "ftr",
  "npr",
];

export function resolveVehicleThumbnail(input: VehicleThumbnailInput): VehicleThumbnailDescriptor {
  const make = normalize(input.make);
  const model = normalize(input.model);
  const combined = `${make} ${model}`.trim();
  const bodyColor = resolveVehicleColor(input.color);
  const variant = resolveVariant({
    combined,
    vehicleType: normalize(input.vehicleType),
  });

  const displayName = [cleanDisplay(input.make), cleanDisplay(input.model)].filter(Boolean).join(" ")
    || (variant === "box_truck" ? "Box Truck" : "Semi Truck");
  const displayColor = cleanDisplay(input.color) || "Default color";

  return {
    variant,
    bodyColor,
    accentColor: accentFor(bodyColor),
    wheelColor: "#1f2937",
    label: `${displayName}, ${displayColor}`,
  };
}

export function resolveVehicleColor(value: string | null | undefined): string {
  const normalized = normalize(value);
  if (!normalized) return "#64748b";
  if (NAMED_COLORS[normalized]) return NAMED_COLORS[normalized];
  if (/^#[0-9a-f]{6}$/i.test(normalized)) return normalized.toLowerCase();
  if (/^[0-9a-f]{6}$/i.test(normalized)) return `#${normalized.toLowerCase()}`;
  return "#64748b";
}

function resolveVariant(args: { combined: string; vehicleType: string }): VehicleThumbnailVariant {
  if (args.vehicleType === "box_truck") return "box_truck";
  if (BOX_MODELS.some((token) => args.combined.includes(token))) return "box_truck";
  if (CONVENTIONAL_MODELS.some((token) => args.combined.includes(token))) return "conventional_sleeper";
  if (VOCATIONAL_MODELS.some((token) => args.combined.includes(token))) return "vocational_daycab";
  if (AERO_MODELS.some((token) => args.combined.includes(token))) return "aero_sleeper";
  return "generic_truck";
}

function accentFor(bodyColor: string): string {
  const hex = bodyColor.slice(1);
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  const factor = (r + g + b) / 3 > 180 ? 0.72 : 1.28;
  const clamp = (channel: number) => Math.max(0, Math.min(255, Math.round(channel * factor)));
  return `#${[clamp(r), clamp(g), clamp(b)].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function normalize(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function cleanDisplay(value: string | null | undefined): string {
  return String(value ?? "").trim();
}
