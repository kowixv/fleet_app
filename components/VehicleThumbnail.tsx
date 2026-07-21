import { resolveVehicleThumbnail } from "@/lib/vehicle-thumbnail";

interface VehicleThumbnailProps {
  make?: string | null;
  model?: string | null;
  color?: string | null;
  vehicleType?: string | null;
  width?: number;
  height?: number;
  className?: string;
}

export default function VehicleThumbnail({
  make,
  model,
  color,
  vehicleType,
  width = 88,
  height = 50,
  className = "",
}: VehicleThumbnailProps) {
  const descriptor = resolveVehicleThumbnail({ make, model, color, vehicleType });

  return (
    <svg
      role="img"
      aria-label={descriptor.label}
      viewBox="0 0 120 64"
      width={width}
      height={height}
      className={`shrink-0 rounded-md border border-slate-200 bg-slate-50 ${className}`.trim()}
    >
      <title>{descriptor.label}</title>
      <rect width="120" height="64" rx="7" fill="#f8fafc" />
      <path d="M8 49.5H112" stroke="#cbd5e1" strokeWidth="2" strokeLinecap="round" />
      <path d="M13 52H107" stroke="#e2e8f0" strokeWidth="1" strokeDasharray="4 4" />

      {descriptor.variant === "box_truck" && (
        <BoxTruck bodyColor={descriptor.bodyColor} accentColor={descriptor.accentColor} />
      )}
      {descriptor.variant === "aero_sleeper" && (
        <AeroSleeper bodyColor={descriptor.bodyColor} accentColor={descriptor.accentColor} />
      )}
      {descriptor.variant === "conventional_sleeper" && (
        <ConventionalSleeper bodyColor={descriptor.bodyColor} accentColor={descriptor.accentColor} />
      )}
      {descriptor.variant === "vocational_daycab" && (
        <VocationalDaycab bodyColor={descriptor.bodyColor} accentColor={descriptor.accentColor} />
      )}
      {descriptor.variant === "generic_truck" && (
        <GenericTruck bodyColor={descriptor.bodyColor} accentColor={descriptor.accentColor} />
      )}

      <Wheel cx={35} />
      <Wheel cx={82} />
      <Wheel cx={99} />
    </svg>
  );
}

function AeroSleeper({ bodyColor, accentColor }: PaintProps) {
  return (
    <>
      <path d="M22 46V24c0-6 4-10 10-11h23c8 0 13 4 16 11l7 16h29v8H22Z" fill={bodyColor} />
      <path d="M34 17h18c7 0 11 3 14 9l4 9H54V20H34Z" fill={accentColor} opacity="0.75" />
      <path d="M30 18h21v17H30Z" fill="#dbeafe" opacity="0.85" />
      <path d="M54 20h8c3 2 5 5 7 10H54Z" fill="#bfdbfe" />
      <path d="M77 40h30v5H77Z" fill={accentColor} />
      <rect x="22" y="42" width="84" height="6" rx="2" fill={accentColor} />
      <rect x="74" y="34" width="7" height="3" rx="1" fill="#fef3c7" />
    </>
  );
}

function ConventionalSleeper({ bodyColor, accentColor }: PaintProps) {
  return (
    <>
      <path d="M24 46V18h34v24h12l6-11h25l7 11v6H24Z" fill={bodyColor} />
      <path d="M28 22h26v14H28Z" fill="#dbeafe" />
      <path d="M75 33h23l5 8H69Z" fill={accentColor} />
      <path d="M58 40h16l-3 6H58Z" fill={accentColor} />
      <rect x="101" y="39" width="8" height="4" rx="1" fill="#fef3c7" />
      <path d="M79 30h17" stroke="#94a3b8" strokeWidth="2" />
      <rect x="24" y="43" width="84" height="5" rx="2" fill={accentColor} />
    </>
  );
}

function VocationalDaycab({ bodyColor, accentColor }: PaintProps) {
  return (
    <>
      <path d="M26 46V23h31l11 16h39v9H26Z" fill={bodyColor} />
      <path d="M31 27h21l10 12H31Z" fill="#dbeafe" />
      <path d="M67 38h39v6H67Z" fill={accentColor} />
      <path d="M79 32h24l5 6H74Z" fill={bodyColor} />
      <rect x="26" y="43" width="82" height="5" rx="2" fill={accentColor} />
      <rect x="102" y="37" width="7" height="4" rx="1" fill="#fef3c7" />
    </>
  );
}

function BoxTruck({ bodyColor, accentColor }: PaintProps) {
  return (
    <>
      <rect x="18" y="15" width="56" height="32" rx="2" fill="#f1f5f9" stroke="#cbd5e1" />
      <path d="M74 47V27h22l12 13v7H74Z" fill={bodyColor} />
      <path d="M80 30h13l9 10H80Z" fill="#dbeafe" />
      <rect x="18" y="42" width="90" height="6" rx="2" fill={accentColor} />
      <path d="M23 21h46" stroke="#e2e8f0" strokeWidth="2" />
      <path d="M23 27h46" stroke="#e2e8f0" strokeWidth="2" />
      <rect x="102" y="39" width="7" height="4" rx="1" fill="#fef3c7" />
    </>
  );
}

function GenericTruck({ bodyColor, accentColor }: PaintProps) {
  return (
    <>
      <path d="M23 46V21h39l12 18h32v9H23Z" fill={bodyColor} />
      <path d="M29 25h25l11 14H29Z" fill="#dbeafe" />
      <path d="M73 39h33v5H73Z" fill={accentColor} />
      <rect x="23" y="43" width="84" height="5" rx="2" fill={accentColor} />
      <rect x="101" y="38" width="8" height="4" rx="1" fill="#fef3c7" />
    </>
  );
}

function Wheel({ cx }: { cx: number }) {
  return (
    <>
      <circle cx={cx} cy="48" r="7" fill="#1f2937" />
      <circle cx={cx} cy="48" r="3" fill="#94a3b8" />
      <circle cx={cx} cy="48" r="1" fill="#e2e8f0" />
    </>
  );
}

interface PaintProps {
  bodyColor: string;
  accentColor: string;
}
