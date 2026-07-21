import {
  getVehicleThumbnailColors,
  getVehicleThumbnailVariant,
  type VehicleThumbnailVehicle,
  type VehicleThumbnailVariant,
} from "@/lib/vehicle-thumbnail";

type Size = "list" | "preview";

interface Props {
  vehicle: VehicleThumbnailVehicle;
  size?: Size;
}

interface SvgProps {
  bodyColor: string;
  accentColor: string;
  outlineColor: string;
}

const sizeClass: Record<Size, string> = {
  list: "h-[50px] w-[88px]",
  preview: "h-16 w-[110px]",
};

export default function VehicleThumbnail({ vehicle, size = "list" }: Props) {
  const variant = getVehicleThumbnailVariant(vehicle);
  const colors = getVehicleThumbnailColors(vehicle.truck_color);
  const outlineColor = colors.needsOutline ? "#64748b" : "#475569";
  const label = thumbnailLabel(variant);

  return (
    <div
      className={`${sizeClass[size]} shrink-0 overflow-hidden rounded-md border border-slate-200 bg-slate-50`}
      title={label}
      aria-label={label}
    >
      {renderSilhouette(variant, { ...colors, outlineColor })}
    </div>
  );
}

function renderSilhouette(variant: VehicleThumbnailVariant, props: SvgProps) {
  switch (variant) {
    case "peterbilt_semi":
      return <PeterbiltSemi {...props} />;
    case "kenworth_semi":
      return <KenworthSemi {...props} />;
    case "freightliner_semi":
      return <FreightlinerSemi {...props} />;
    case "international_box":
    case "generic_box":
      return <BoxTruck {...props} />;
    case "generic_semi":
    default:
      return <GenericSemi {...props} />;
  }
}

function thumbnailLabel(variant: VehicleThumbnailVariant): string {
  switch (variant) {
    case "peterbilt_semi":
      return "Peterbilt-style semi truck thumbnail";
    case "kenworth_semi":
      return "Kenworth-style semi truck thumbnail";
    case "freightliner_semi":
      return "Freightliner-style semi truck thumbnail";
    case "international_box":
      return "International-style box truck thumbnail";
    case "generic_box":
      return "Box truck thumbnail";
    case "generic_semi":
    default:
      return "Generic semi truck thumbnail";
  }
}

function PeterbiltSemi({ bodyColor, accentColor, outlineColor }: SvgProps) {
  return (
    <svg viewBox="0 0 120 64" role="img" aria-label="Peterbilt-style semi truck silhouette" className="h-full w-full">
      <title>Peterbilt-style semi truck silhouette</title>
      <path d="M15 47h92l4 6H11z" fill={accentColor} />
      <path d="M19 44V25c0-8 6-14 14-15h16c8 0 13 5 15 13l3 14 39 3 3 7H19z" fill={bodyColor} stroke={outlineColor} strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M49 19c7 1 11 6 12 15h-16V19z" fill="#c7d7e8" stroke={outlineColor} strokeWidth="1" />
      <path d="M27 17h17v20H22V25c0-4 2-7 5-8z" fill={bodyColor} stroke={outlineColor} strokeWidth="1" />
      <path d="M66 36l38 3v-9c-8-3-24-5-38-5z" fill={bodyColor} stroke={outlineColor} strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M102 31h7v14h-9z" fill={accentColor} stroke={outlineColor} strokeWidth="1" />
      <path d="M105 41h5v3h-5z" fill="#fde68a" />
      <path d="M70 40h32" stroke={outlineColor} strokeWidth="1.2" strokeLinecap="round" />
      <path d="M35 18v-7h5v7" stroke={accentColor} strokeWidth="2" strokeLinecap="round" />
      <Wheel cx={30} cy={50} />
      <Wheel cx={86} cy={50} />
      <Wheel cx={101} cy={50} />
    </svg>
  );
}

function KenworthSemi({ bodyColor, accentColor, outlineColor }: SvgProps) {
  return (
    <svg viewBox="0 0 120 64" role="img" aria-label="Kenworth-style semi truck silhouette" className="h-full w-full">
      <title>Kenworth-style semi truck silhouette</title>
      <path d="M13 48h94l5 5H9z" fill={accentColor} />
      <path d="M20 45V22l8-10h30l12 16 34 2 5 15H20z" fill={bodyColor} stroke={outlineColor} strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M45 17h12l9 13H45z" fill="#c7d7e8" stroke={outlineColor} strokeWidth="1" strokeLinejoin="round" />
      <path d="M26 17h16v24H20V25z" fill={bodyColor} stroke={outlineColor} strokeWidth="1" strokeLinejoin="round" />
      <path d="M69 29h35l4 12H72z" fill={bodyColor} stroke={outlineColor} strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M101 30h8v15h-8z" fill={accentColor} stroke={outlineColor} strokeWidth="1" />
      <path d="M99 39l9-1v4h-9z" fill="#fde68a" />
      <path d="M63 36h39" stroke={outlineColor} strokeWidth="1.3" strokeLinecap="round" />
      <path d="M31 18h9" stroke={outlineColor} strokeWidth="1.2" strokeLinecap="round" />
      <Wheel cx={31} cy={50} />
      <Wheel cx={84} cy={50} />
      <Wheel cx={99} cy={50} />
    </svg>
  );
}

function FreightlinerSemi({ bodyColor, accentColor, outlineColor }: SvgProps) {
  return (
    <svg viewBox="0 0 120 64" role="img" aria-label="Freightliner-style semi truck silhouette" className="h-full w-full">
      <title>Freightliner-style semi truck silhouette</title>
      <path d="M13 48h91c5 0 8 2 9 5H10z" fill={accentColor} />
      <path d="M19 45V26c0-9 8-16 18-16h16c10 0 17 8 20 18l28 2c7 1 11 6 11 15H19z" fill={bodyColor} stroke={outlineColor} strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M40 17c11 1 19 7 24 17H41z" fill="#c7d7e8" stroke={outlineColor} strokeWidth="1" strokeLinejoin="round" />
      <path d="M26 18c-4 2-6 6-6 12v11h17V18z" fill={bodyColor} stroke={outlineColor} strokeWidth="1" />
      <path d="M70 29l31 2c6 1 9 5 10 11H74z" fill={bodyColor} stroke={outlineColor} strokeWidth="1.1" strokeLinejoin="round" />
      <path d="M98 33c7 1 11 4 13 10h-12z" fill={accentColor} stroke={outlineColor} strokeWidth="1" strokeLinejoin="round" />
      <path d="M100 39l10 2-1 3-10-1z" fill="#fde68a" />
      <path d="M57 40c14 2 28 2 42 1" stroke={outlineColor} strokeWidth="1.2" strokeLinecap="round" />
      <Wheel cx={31} cy={50} />
      <Wheel cx={84} cy={50} />
      <Wheel cx={99} cy={50} />
    </svg>
  );
}

function BoxTruck({ bodyColor, accentColor, outlineColor }: SvgProps) {
  return (
    <svg viewBox="0 0 120 64" role="img" aria-label="Box truck silhouette" className="h-full w-full">
      <title>Box truck silhouette</title>
      <path d="M12 48h96l4 5H9z" fill={accentColor} />
      <path d="M12 16h58v31H12z" fill="#f8fafc" stroke={outlineColor} strokeWidth="1.5" />
      <path d="M70 29h13l8 8v10H70z" fill={bodyColor} stroke={outlineColor} strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M84 31h12c7 0 12 6 12 16H91V37z" fill={bodyColor} stroke={outlineColor} strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M86 33h10l6 8H86z" fill="#c7d7e8" stroke={outlineColor} strokeWidth="1" strokeLinejoin="round" />
      <path d="M18 22h45M64 17v29" stroke="#cbd5e1" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M103 42h5v3h-5z" fill="#fde68a" />
      <Wheel cx={30} cy={50} />
      <Wheel cx={82} cy={50} />
      <Wheel cx={100} cy={50} />
    </svg>
  );
}

function GenericSemi({ bodyColor, accentColor, outlineColor }: SvgProps) {
  return (
    <svg viewBox="0 0 120 64" role="img" aria-label="Generic semi truck silhouette" className="h-full w-full">
      <title>Generic semi truck silhouette</title>
      <path d="M14 48h94l4 5H10z" fill={accentColor} />
      <path d="M19 45V25c0-7 6-13 14-13h19c7 0 13 6 15 14l36 2 6 17H19z" fill={bodyColor} stroke={outlineColor} strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M45 18h11c5 4 8 9 9 15H45z" fill="#c7d7e8" stroke={outlineColor} strokeWidth="1" strokeLinejoin="round" />
      <path d="M27 18h15v23H20V26z" fill={bodyColor} stroke={outlineColor} strokeWidth="1" strokeLinejoin="round" />
      <path d="M68 28h34l5 13H70z" fill={bodyColor} stroke={outlineColor} strokeWidth="1.1" strokeLinejoin="round" />
      <path d="M101 32h7v13h-7z" fill={accentColor} stroke={outlineColor} strokeWidth="1" />
      <path d="M103 40h5v3h-5z" fill="#fde68a" />
      <Wheel cx={31} cy={50} />
      <Wheel cx={84} cy={50} />
      <Wheel cx={99} cy={50} />
    </svg>
  );
}

function Wheel({ cx, cy }: { cx: number; cy: number }) {
  return (
    <>
      <circle cx={cx} cy={cy} r="7" fill="#1f2937" />
      <circle cx={cx} cy={cy} r="3" fill="#94a3b8" />
    </>
  );
}
