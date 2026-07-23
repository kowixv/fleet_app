import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { hueMatchesRanges, VEHICLE_THUMBNAIL_ARTWORK_CONFIGS } from "../scripts/vehicle-thumbnail-asset-config";
import {
  GENERATED_VEHICLE_THUMBNAIL_ASSETS,
  VEHICLE_PHOTO_ASSETS,
} from "./vehicle-thumbnail-assets";
import {
  getVehicleThumbnailColors,
  getVehicleThumbnailVariant,
  resolveVehicleThumbnail,
} from "./vehicle-thumbnail";

const repoRoot = process.cwd();

describe("vehicle thumbnail selection", () => {
  it("maps Peterbilt makes and model-only records to the Peterbilt photo", () => {
    expect(getVehicleThumbnailVariant({ make: "Peterbilt", model: "579", vehicle_type: "truck" })).toBe("peterbilt_photo");
    expect(getVehicleThumbnailVariant({ make: null, model: "579", vehicle_type: "truck" })).toBe("peterbilt_photo");
    expect(getVehicleThumbnailVariant({ make: "  PETERBILT  ", model: "Model 579", vehicle_type: "truck" })).toBe("peterbilt_photo");
    expect(getVehicleThumbnailVariant({ make: "Pete", model: "579", vehicle_type: "truck" })).toBe("peterbilt_photo");
  });

  it("maps Freightliner Cascadia records to the Freightliner photo", () => {
    expect(getVehicleThumbnailVariant({ make: "Freightliner", model: "Cascadia", vehicle_type: "truck" })).toBe("freightliner_photo");
    expect(getVehicleThumbnailVariant({ make: null, model: "Cascadia", vehicle_type: "truck" })).toBe("freightliner_photo");
    expect(getVehicleThumbnailVariant({ make: "FREIGHTLINER", model: "CAS-CADIA", vehicle_type: "truck" })).toBe("freightliner_photo");
    expect(getVehicleThumbnailVariant({ make: null, model: "freightliner cascadia", vehicle_type: "truck" })).toBe("freightliner_photo");
  });

  it("prioritizes box-truck type and common box-truck model signals", () => {
    expect(getVehicleThumbnailVariant({ make: "Freightliner", model: "M2", vehicle_type: "box_truck" })).toBe("box_truck_photo");
    expect(getVehicleThumbnailVariant({ make: "International", model: "MV", vehicle_type: "box_truck" })).toBe("box_truck_photo");
    expect(getVehicleThumbnailVariant({ make: "International", model: "4300", vehicle_type: "truck" })).toBe("box_truck_photo");
    expect(getVehicleThumbnailVariant({ make: "Isuzu", model: "NPR", vehicle_type: "truck" })).toBe("box_truck_photo");
    expect(getVehicleThumbnailVariant({ make: "Unknown", model: "Custom", vehicle_type: "box_truck" })).toBe("box_truck_photo");
  });

  it("maps Kenworth highway tractors to the Kenworth photo", () => {
    const variant = getVehicleThumbnailVariant({ make: "Kenworth", model: "T680", vehicle_type: "truck" });
    expect(variant).toBe("kenworth_photo");
    expect(variant).not.toBe("peterbilt_photo");
    expect(variant).not.toBe("freightliner_photo");
    expect(getVehicleThumbnailVariant({ make: "KENWORTH", model: "T680", vehicle_type: "truck" })).toBe("kenworth_photo");
    expect(getVehicleThumbnailVariant({ make: null, model: "T680", vehicle_type: "truck" })).toBe("kenworth_photo");
    expect(getVehicleThumbnailVariant({ make: "  KENWORTH  ", model: " Model T680 ", vehicle_type: "truck" })).toBe("kenworth_photo");
    expect(getVehicleThumbnailVariant({ make: "Kenworth", model: "T880", vehicle_type: "truck" })).toBe("kenworth_photo");
    expect(getVehicleThumbnailVariant({ make: "Kenworth", model: "W900", vehicle_type: "truck" })).toBe("kenworth_photo");
  });

  it("keeps box-truck type authoritative and non-box International vehicles distinct", () => {
    expect(getVehicleThumbnailVariant({ make: "Kenworth", model: "T680", vehicle_type: "box_truck" })).toBe("box_truck_photo");
    expect(getVehicleThumbnailVariant({ make: "International", model: null, vehicle_type: "truck" })).toBe("international_svg");
    expect(getVehicleThumbnailVariant({ make: "International", model: "LT", vehicle_type: "truck" })).toBe("international_svg");
  });

  it("falls back safely for unknown semis", () => {
    expect(getVehicleThumbnailVariant({ make: null, model: null, vehicle_type: "truck" })).toBe("generic_semi_svg");
    expect(getVehicleThumbnailVariant({ make: "Unknown", model: "Custom", vehicle_type: null })).toBe("generic_semi_svg");
  });
});

describe("vehicle thumbnail color normalization", () => {
  it("supports named, multiword, and hex colors", () => {
    expect(getVehicleThumbnailColors("blue")).toMatchObject({ bodyColor: "#2563eb" });
    expect(getVehicleThumbnailColors("red")).toMatchObject({ bodyColor: "#dc2626" });
    expect(getVehicleThumbnailColors("yellow")).toMatchObject({ bodyColor: "#eab308" });
    expect(getVehicleThumbnailColors("white")).toMatchObject({ bodyColor: "#f8fafc", needsOutline: true });
    expect(getVehicleThumbnailColors("black")).toMatchObject({ bodyColor: "#111827" });
    expect(getVehicleThumbnailColors("silver")).toMatchObject({ bodyColor: "#a8b0ba" });
    expect(getVehicleThumbnailColors("dark-blue")).toMatchObject({ bodyColor: "#1e3a8a" });
    expect(getVehicleThumbnailColors("light_blue")).toMatchObject({ bodyColor: "#60a5fa" });
    expect(getVehicleThumbnailColors(" metallic   silver ")).toMatchObject({ bodyColor: "#a8b0ba" });
    expect(getVehicleThumbnailColors("#12ABEF")).toMatchObject({ bodyColor: "#12abef" });
    expect(getVehicleThumbnailColors("12ABEF")).toMatchObject({ bodyColor: "#12abef" });
  });

  it("rejects unsafe or unsupported CSS values", () => {
    expect(getVehicleThumbnailColors("url(javascript:alert(1))")).toMatchObject({ bodyColor: "#64748b" });
    expect(getVehicleThumbnailColors("var(--truck-color)")).toMatchObject({ bodyColor: "#64748b" });
    expect(getVehicleThumbnailColors("rgb(1,2,3)")).toMatchObject({ bodyColor: "#64748b" });
    expect(getVehicleThumbnailColors("transparent")).toMatchObject({ bodyColor: "#64748b" });
    expect(getVehicleThumbnailColors("currentColor")).toMatchObject({ bodyColor: "#64748b" });
    expect(getVehicleThumbnailColors("expression(alert(1))")).toMatchObject({ bodyColor: "#64748b" });
  });

  it("includes the resolved color and asset descriptor", () => {
    expect(resolveVehicleThumbnail({ make: "Peterbilt", model: "579", truck_color: "red" })).toMatchObject({
      variant: "peterbilt_photo",
      colors: { bodyColor: "#dc2626" },
      photoAsset: VEHICLE_PHOTO_ASSETS.peterbilt_photo,
    });
    expect(resolveVehicleThumbnail({ make: "Kenworth", model: "T680", truck_color: "blue" })).toMatchObject({
      variant: "kenworth_photo",
      colors: { bodyColor: "#2563eb" },
      photoAsset: VEHICLE_PHOTO_ASSETS.kenworth_photo,
    });
  });
});

describe("vehicle thumbnail asset manifest", () => {
  it("contains the Kenworth photo manifest entry with local static paths", () => {
    expect(VEHICLE_PHOTO_ASSETS.kenworth_photo.baseSrc).toBe("/vehicle-thumbnails/generated/kenworth-base.webp");
    expect(VEHICLE_PHOTO_ASSETS.kenworth_photo.maskSrc).toBe("/vehicle-thumbnails/generated/kenworth-paint-mask.png");
    expect(VEHICLE_PHOTO_ASSETS.kenworth_photo.previewSrc).toBe("/vehicle-thumbnails/generated/kenworth-preview.webp");
    for (const assetPath of Object.values(VEHICLE_PHOTO_ASSETS.kenworth_photo).filter((value): value is string => typeof value === "string")) {
      if (!assetPath.startsWith("/")) continue;
      expect(assetPath).not.toMatch(/^https?:\/\//i);
      expect(assetPath).not.toContain("kenworth t680");
      expect(assetPath).not.toContain("..");
    }
  });

  it("uses only local static manifest paths", () => {
    for (const assetPath of GENERATED_VEHICLE_THUMBNAIL_ASSETS) {
      expect(assetPath.startsWith("/vehicle-thumbnails/generated/")).toBe(true);
      expect(assetPath).not.toMatch(/^https?:\/\//i);
      expect(assetPath).not.toContain("..");
    }
  });

  it("has source images present for deterministic asset generation", () => {
    for (const config of VEHICLE_THUMBNAIL_ARTWORK_CONFIGS) {
      expect(existsSync(config.sourcePath)).toBe(true);
      expect(statSync(config.sourcePath).size).toBeGreaterThan(100_000);
    }
    expect(existsSync(path.join(repoRoot, "public", "vehicle-thumbnails", "source", "kenworth.svg"))).toBe(true);
  });
});

describe("vehicle thumbnail paint hue matching", () => {
  it("matches red wraparound hues for Kenworth and excludes non-red hues", () => {
    const kenworth = VEHICLE_THUMBNAIL_ARTWORK_CONFIGS.find((config) => config.key === "kenworth");
    expect(kenworth).toBeTruthy();
    expect(hueMatchesRanges(350, kenworth!.hueRanges)).toBe(true);
    expect(hueMatchesRanges(5, kenworth!.hueRanges)).toBe(true);
    expect(hueMatchesRanges(180, kenworth!.hueRanges)).toBe(false);
  });

  it("keeps existing blue asset hue detection intact", () => {
    const peterbilt = VEHICLE_THUMBNAIL_ARTWORK_CONFIGS.find((config) => config.key === "peterbilt");
    expect(peterbilt).toBeTruthy();
    expect(hueMatchesRanges(212, peterbilt!.hueRanges)).toBe(true);
    expect(hueMatchesRanges(5, peterbilt!.hueRanges)).toBe(false);
  });
});

describe("vehicle thumbnail UI integration", () => {
  it("passes make, model, color, and vehicleType in the Vehicles list and editor preview", () => {
    const source = readFileSync(path.join(repoRoot, "components", "VehicleResourceManager.tsx"), "utf8");
    expect(source).toContain("make={row.make}");
    expect(source).toContain("model={row.model}");
    expect(source).toContain("color={row.truck_color}");
    expect(source).toContain("vehicleType={row.vehicle_type}");
    expect(source).toContain("make={previewVehicle.make}");
    expect(source).toContain("model={previewVehicle.model}");
    expect(source).toContain("color={previewVehicle.truck_color}");
    expect(source).toContain("vehicleType={previewVehicle.vehicle_type}");
  });

  it("passes make, model, color, and vehicleType in the maintenance detail page", () => {
    const source = readFileSync(path.join(repoRoot, "app", "(app)", "maintenance", "units", "[vehicleId]", "page.tsx"), "utf8");
    expect(source).toContain("make={vehicle.make}");
    expect(source).toContain("model={vehicle.model}");
    expect(source).toContain("color={vehicle.truck_color}");
    expect(source).toContain("vehicleType={vehicle.vehicle_type}");
    expect(source).toContain("make, model, truck_color");
  });
});

describe("generated vehicle thumbnail assets", () => {
  it("writes expected base, mask, and preview files", () => {
    for (const assetPath of GENERATED_VEHICLE_THUMBNAIL_ASSETS) {
      const absolutePath = path.join(repoRoot, "public", assetPath.replace(/^\//, ""));
      expect(existsSync(absolutePath), assetPath).toBe(true);
      expect(statSync(absolutePath).size, assetPath).toBeGreaterThan(500);
    }
  });

  it("keeps generated file sizes suitable for compact table thumbnails", () => {
    for (const assetPath of GENERATED_VEHICLE_THUMBNAIL_ASSETS) {
      const absolutePath = path.join(repoRoot, "public", assetPath.replace(/^\//, ""));
      const size = statSync(absolutePath).size;
      expect(size, assetPath).toBeLessThan(assetPath.endsWith(".webp") ? 260_000 : 160_000);
    }
  });

  it("keeps generated dimensions inside configured limits", async () => {
    for (const config of VEHICLE_THUMBNAIL_ARTWORK_CONFIGS) {
      const baseMetadata = await sharp(config.outputBasePath).metadata();
      const maskMetadata = await sharp(config.outputMaskPath).metadata();
      expect(baseMetadata.width).toBe(config.resizeWidth);
      expect(maskMetadata.width).toBe(baseMetadata.width);
      expect(maskMetadata.height).toBe(baseMetadata.height);
      expect(baseMetadata.width ?? 0).toBeLessThanOrEqual(900);
      expect(baseMetadata.height ?? 0).toBeLessThanOrEqual(900);
    }
  });

  it("generates masks that are neither empty nor full-frame and protect key samples", async () => {
    for (const config of VEHICLE_THUMBNAIL_ARTWORK_CONFIGS) {
      const { data, info } = await sharp(config.outputMaskPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      let active = 0;
      for (let index = 0; index < info.width * info.height; index += 1) {
        if ((data[index * info.channels + 3] ?? 0) > 16) active += 1;
      }
      const coverage = active / (info.width * info.height);
      expect(coverage, `${config.key} mask coverage`).toBeGreaterThan(config.minCoverage * 0.9);
      expect(coverage, `${config.key} mask coverage`).toBeLessThan(config.maxCoverage);

      for (const sample of config.protectedSamples) {
        const x = Math.min(info.width - 1, Math.max(0, Math.round(sample.xRatio * info.width)));
        const y = Math.min(info.height - 1, Math.max(0, Math.round(sample.yRatio * info.height)));
        const maskValue = data[(y * info.width + x) * info.channels + 3] ?? 0;
        expect(maskValue, `${config.key} ${sample.label}`).toBeLessThanOrEqual(sample.maxMaskValue);
      }
    }
  });
});
