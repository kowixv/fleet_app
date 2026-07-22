"use client";

import {
  colorLabel,
  isPhotoVariant,
  resolveVehicleThumbnail,
  type VehicleSvgVariant,
  type VehicleThumbnailVehicle,
  type VehicleThumbnailVariant,
} from "@/lib/vehicle-thumbnail";
import { useMemo, useState, type CSSProperties } from "react";

type Size = "list" | "preview" | "detail";

interface Props {
  vehicle?: VehicleThumbnailVehicle;
  make?: string | null;
  model?: string | null;
  color?: string | null;
  vehicleType?: string | null;
  width?: number;
  height?: number;
  priority?: boolean;
  className?: string;
  size?: Size;
}

interface SvgProps {
  bodyColor: string;
  accentColor: string;
  outlineColor: string;
}

const sizePreset: Record<Size, { width: number; height: number }> = {
  list: { width: 96, height: 60 },
  preview: { width: 150, height: 95 },
  detail: { width: 220, height: 138 },
};

export default function VehicleThumbnail({
  vehicle,
  make,
  model,
  color,
  vehicleType,
  width,
  height,
  priority = false,
  className = "",
  size = "list",
}: Props) {
  const input = useMemo<VehicleThumbnailVehicle>(() => ({
    make: make ?? vehicle?.make ?? null,
    model: model ?? vehicle?.model ?? null,
    truck_color: color ?? vehicle?.truck_color ?? vehicle?.color ?? null,
    vehicle_type: vehicleType ?? vehicle?.vehicle_type ?? vehicle?.vehicleType ?? null,
  }), [color, make, model, vehicle, vehicleType]);
  const descriptor = resolveVehicleThumbnail(input);
  const [failedVariant, setFailedVariant] = useState<VehicleThumbnailVariant | null>(null);
  const dimensions = sizePreset[size];
  const resolvedWidth = width ?? dimensions.width;
  const resolvedHeight = height ?? dimensions.height;
  const outlineColor = descriptor.colors.needsOutline ? "#64748b" : "#475569";
  const label = `${colorLabel(input.truck_color)} ${descriptor.label}`;
  const photoAsset = descriptor.photoAsset && descriptor.variant !== failedVariant ? descriptor.photoAsset : null;

  return (
    <div
      className={`relative shrink-0 overflow-hidden rounded-md border border-slate-200 bg-slate-50 ${className}`}
      style={{ width: resolvedWidth, height: resolvedHeight }}
      title={label}
      role="img"
      aria-label={label}
    >
      {photoAsset ? (
        <PhotoThumbnail
          variant={descriptor.variant}
          asset={photoAsset}
          bodyColor={descriptor.colors.bodyColor}
          luminance={descriptor.colors.luminance}
          priority={priority}
          onError={() => {
            if (process.env.NODE_ENV !== "production") {
              console.warn(`Vehicle thumbnail asset failed for ${descriptor.variant}; using SVG fallback.`);
            }
            setFailedVariant(descriptor.variant);
          }}
        />
      ) : (
        renderSilhouette(fallbackSvgVariant(descriptor.variant), {
          bodyColor: descriptor.colors.bodyColor,
          accentColor: descriptor.colors.accentColor,
          outlineColor,
        })
      )}
    </div>
  );
}

function PhotoThumbnail({
  variant,
  asset,
  bodyColor,
  luminance,
  priority,
  onError,
}: {
  variant: VehicleThumbnailVariant;
  asset: NonNullable<ReturnType<typeof resolveVehicleThumbnail>["photoAsset"]>;
  bodyColor: string;
  luminance: number;
  priority: boolean;
  onError: () => void;
}) {
  const maskStyle: CSSProperties = {
    WebkitMaskImage: `url(${asset.maskSrc})`,
    maskImage: `url(${asset.maskSrc})`,
    WebkitMaskRepeat: "no-repeat",
    maskRepeat: "no-repeat",
    WebkitMaskSize: "contain",
    maskSize: "contain",
    WebkitMaskPosition: asset.objectPosition,
    maskPosition: asset.objectPosition,
  };
  const toneBlendMode = luminance > 0.72 ? "screen" : "multiply";
  const toneOpacity = luminance > 0.72 ? 0.26 : luminance < 0.18 ? 0.3 : 0.12;

  return (
    <>
      <img
        src={asset.baseSrc}
        alt=""
        aria-hidden="true"
        className="absolute inset-0 h-full w-full object-contain"
        style={{ objectPosition: asset.objectPosition }}
        loading={priority ? "eager" : "lazy"}
        decoding="async"
        onError={onError}
        data-vehicle-thumbnail-variant={isPhotoVariant(variant) ? variant : undefined}
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 h-full w-full object-contain"
        style={{
          ...maskStyle,
          backgroundColor: bodyColor,
          mixBlendMode: "color",
        }}
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 h-full w-full object-contain"
        style={{
          ...maskStyle,
          backgroundColor: bodyColor,
          mixBlendMode: toneBlendMode,
          opacity: toneOpacity,
        }}
      />
    </>
  );
}

function renderSilhouette(variant: VehicleSvgVariant, props: SvgProps) {
  switch (variant) {
    case "kenworth_svg":
      return <KenworthSemi {...props} />;
    case "international_svg":
      return <InternationalSemi {...props} />;
    case "generic_box_svg":
      return <BoxTruck {...props} />;
    case "generic_semi_svg":
    default:
      return <GenericSemi {...props} />;
  }
}

function fallbackSvgVariant(variant: VehicleThumbnailVariant): VehicleSvgVariant {
  switch (variant) {
    case "box_truck_photo":
      return "generic_box_svg";
    case "kenworth_svg":
    case "international_svg":
    case "generic_box_svg":
    case "generic_semi_svg":
      return variant;
    case "peterbilt_photo":
    case "freightliner_photo":
    default:
      return "generic_semi_svg";
  }
}

function KenworthSemi({ bodyColor, accentColor, outlineColor }: SvgProps) {
  return (
    <svg viewBox="0 0 120 64" aria-hidden="true" className="h-full w-full">
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

function InternationalSemi({ bodyColor, accentColor, outlineColor }: SvgProps) {
  return (
    <svg viewBox="0 0 120 64" aria-hidden="true" className="h-full w-full">
      <path d="M12 48h94l5 5H9z" fill={accentColor} />
      <path d="M19 45V19c0-4 3-7 7-7h26c6 0 11 4 14 11l7 17 32 2 4 3H19z" fill={bodyColor} stroke={outlineColor} strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M44 18h11c5 4 8 9 10 17H44z" fill="#c7d7e8" stroke={outlineColor} strokeWidth="1" />
      <path d="M26 17h15v25H20V23c0-3 3-6 6-6z" fill={bodyColor} stroke={outlineColor} strokeWidth="1" />
      <path d="M70 31h31l6 10H75z" fill={bodyColor} stroke={outlineColor} strokeWidth="1.1" strokeLinejoin="round" />
      <path d="M100 33h8v12h-8z" fill={accentColor} stroke={outlineColor} strokeWidth="1" />
      <path d="M102 40h6v3h-6z" fill="#fde68a" />
      <path d="M59 40h42" stroke={outlineColor} strokeWidth="1.2" strokeLinecap="round" />
      <path d="M31 13h17" stroke={accentColor} strokeWidth="2" strokeLinecap="round" />
      <Wheel cx={31} cy={50} />
      <Wheel cx={84} cy={50} />
      <Wheel cx={99} cy={50} />
    </svg>
  );
}

function BoxTruck({ bodyColor, accentColor, outlineColor }: SvgProps) {
  return (
    <svg viewBox="0 0 120 64" aria-hidden="true" className="h-full w-full">
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
    <svg viewBox="0 0 120 64" aria-hidden="true" className="h-full w-full">
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
