import path from "node:path";

export interface ProtectedMaskSample {
  label: string;
  xRatio: number;
  yRatio: number;
  maxMaskValue: number;
}

export interface MaskExclusionRect {
  label: string;
  leftRatio: number;
  topRatio: number;
  widthRatio: number;
  heightRatio: number;
}

export interface VehicleArtworkConfig {
  key: "peterbilt" | "freightliner" | "box-truck";
  sourcePath: string;
  outputBasePath: string;
  outputMaskPath: string;
  outputPreviewPath: string;
  resizeWidth: number;
  minWidth: number;
  minHeight: number;
  maxWidth: number;
  maxHeight: number;
  hueRange: [number, number];
  minimumSaturation: number;
  minimumValue: number;
  maskBlurRadius: number;
  maskExpandPixels: number;
  minCoverage: number;
  maxCoverage: number;
  excludeRects?: MaskExclusionRect[];
  protectedSamples: ProtectedMaskSample[];
}

const publicRoot = path.join(process.cwd(), "public");
const sourceRoot = path.join(publicRoot, "vehicle-thumbnails", "source");
const generatedRoot = path.join(publicRoot, "vehicle-thumbnails", "generated");

export const VEHICLE_THUMBNAIL_ARTWORK_CONFIGS: VehicleArtworkConfig[] = [
  {
    key: "peterbilt",
    sourcePath: path.join(sourceRoot, "peterbilt.png"),
    outputBasePath: path.join(generatedRoot, "peterbilt-base.webp"),
    outputMaskPath: path.join(generatedRoot, "peterbilt-paint-mask.png"),
    outputPreviewPath: path.join(generatedRoot, "peterbilt-preview.webp"),
    resizeWidth: 820,
    minWidth: 900,
    minHeight: 900,
    maxWidth: 2400,
    maxHeight: 2400,
    hueRange: [185, 252],
    minimumSaturation: 0.18,
    minimumValue: 0.08,
    maskBlurRadius: 0.8,
    maskExpandPixels: 1,
    minCoverage: 0.18,
    maxCoverage: 0.62,
    excludeRects: [
      { label: "front grille and badges", leftRatio: 0.08, topRatio: 0.42, widthRatio: 0.25, heightRatio: 0.24 },
    ],
    protectedSamples: [
      { label: "white background", xRatio: 0.06, yRatio: 0.06, maxMaskValue: 8 },
      { label: "red grille badge", xRatio: 0.18, yRatio: 0.52, maxMaskValue: 24 },
      { label: "front tire", xRatio: 0.47, yRatio: 0.79, maxMaskValue: 24 },
    ],
  },
  {
    key: "freightliner",
    sourcePath: path.join(sourceRoot, "freightliner.png"),
    outputBasePath: path.join(generatedRoot, "freightliner-base.webp"),
    outputMaskPath: path.join(generatedRoot, "freightliner-paint-mask.png"),
    outputPreviewPath: path.join(generatedRoot, "freightliner-preview.webp"),
    resizeWidth: 820,
    minWidth: 1000,
    minHeight: 700,
    maxWidth: 2600,
    maxHeight: 2200,
    hueRange: [185, 252],
    minimumSaturation: 0.17,
    minimumValue: 0.07,
    maskBlurRadius: 0.75,
    maskExpandPixels: 1,
    minCoverage: 0.16,
    maxCoverage: 0.58,
    excludeRects: [
      { label: "front grille and logo", leftRatio: 0.07, topRatio: 0.36, widthRatio: 0.25, heightRatio: 0.29 },
      { label: "chrome fuel tanks", leftRatio: 0.57, topRatio: 0.62, widthRatio: 0.19, heightRatio: 0.2 },
    ],
    protectedSamples: [
      { label: "white background", xRatio: 0.06, yRatio: 0.06, maxMaskValue: 8 },
      { label: "front grille logo area", xRatio: 0.19, yRatio: 0.55, maxMaskValue: 36 },
      { label: "rear tire", xRatio: 0.83, yRatio: 0.79, maxMaskValue: 24 },
    ],
  },
  {
    key: "box-truck",
    sourcePath: path.join(sourceRoot, "box-truck.png"),
    outputBasePath: path.join(generatedRoot, "box-truck-base.webp"),
    outputMaskPath: path.join(generatedRoot, "box-truck-paint-mask.png"),
    outputPreviewPath: path.join(generatedRoot, "box-truck-preview.webp"),
    resizeWidth: 820,
    minWidth: 1000,
    minHeight: 700,
    maxWidth: 2600,
    maxHeight: 2200,
    hueRange: [185, 255],
    minimumSaturation: 0.18,
    minimumValue: 0.08,
    maskBlurRadius: 0.8,
    maskExpandPixels: 1,
    minCoverage: 0.08,
    maxCoverage: 0.46,
    protectedSamples: [
      { label: "white cargo box", xRatio: 0.65, yRatio: 0.28, maxMaskValue: 12 },
      { label: "white background", xRatio: 0.06, yRatio: 0.06, maxMaskValue: 8 },
      { label: "rear tire", xRatio: 0.82, yRatio: 0.80, maxMaskValue: 24 },
    ],
  },
] as const;
