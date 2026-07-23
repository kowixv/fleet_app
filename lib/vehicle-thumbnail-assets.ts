export type VehiclePhotoVariant = "peterbilt_photo" | "freightliner_photo" | "box_truck_photo";

export interface VehiclePhotoAsset {
  baseSrc: string;
  maskSrc: string;
  previewSrc: string;
  aspectRatio: number;
  objectPosition: string;
  alt: string;
  width: number;
  height: number;
}

export const VEHICLE_PHOTO_ASSETS: Record<VehiclePhotoVariant, VehiclePhotoAsset> = {
  peterbilt_photo: {
    baseSrc: "/vehicle-thumbnails/generated/peterbilt-base.webp",
    maskSrc: "/vehicle-thumbnails/generated/peterbilt-paint-mask.png",
    previewSrc: "/vehicle-thumbnails/generated/peterbilt-preview.webp",
    aspectRatio: 1,
    objectPosition: "center",
    alt: "Peterbilt semi truck",
    width: 820,
    height: 820,
  },
  freightliner_photo: {
    baseSrc: "/vehicle-thumbnails/generated/freightliner-base.webp",
    maskSrc: "/vehicle-thumbnails/generated/freightliner-paint-mask.png",
    previewSrc: "/vehicle-thumbnails/generated/freightliner-preview.webp",
    aspectRatio: 1448 / 1086,
    objectPosition: "center",
    alt: "Freightliner semi truck",
    width: 820,
    height: 615,
  },
  box_truck_photo: {
    baseSrc: "/vehicle-thumbnails/generated/box-truck-base.webp",
    maskSrc: "/vehicle-thumbnails/generated/box-truck-paint-mask.png",
    previewSrc: "/vehicle-thumbnails/generated/box-truck-preview.webp",
    aspectRatio: 1448 / 1086,
    objectPosition: "center",
    alt: "Box truck",
    width: 820,
    height: 615,
  },
} as const;

export const GENERATED_VEHICLE_THUMBNAIL_ASSETS = Object.values(VEHICLE_PHOTO_ASSETS).flatMap((asset) => [
  asset.baseSrc,
  asset.maskSrc,
  asset.previewSrc,
]);
