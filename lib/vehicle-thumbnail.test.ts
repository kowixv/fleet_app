import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  getVehicleThumbnailColors,
  getVehicleThumbnailVariant,
} from "./vehicle-thumbnail";

describe("vehicle thumbnail selection", () => {
  it("maps Peterbilt 579 to the Peterbilt semi silhouette", () => {
    expect(getVehicleThumbnailVariant({ make: " Peterbilt ", model: "579", vehicle_type: "truck" })).toBe("peterbilt_semi");
    expect(getVehicleThumbnailVariant({ make: "PETERBILT", model: "579", vehicle_type: "truck" })).toBe("peterbilt_semi");
    expect(getVehicleThumbnailVariant({ make: null, model: "Peterbilt 579", vehicle_type: "truck" })).toBe("peterbilt_semi");
    expect(getVehicleThumbnailVariant({ make: null, model: "579", vehicle_type: "truck" })).toBe("peterbilt_semi");
  });

  it("maps Kenworth T680 to the Kenworth semi silhouette", () => {
    expect(getVehicleThumbnailVariant({ make: "Kenworth", model: "T680", vehicle_type: "truck" })).toBe("kenworth_semi");
    expect(getVehicleThumbnailVariant({ make: null, model: "t680", vehicle_type: "truck" })).toBe("kenworth_semi");
  });

  it("maps Freightliner Cascadia to the Freightliner semi silhouette", () => {
    expect(getVehicleThumbnailVariant({ make: "Freightliner", model: "Cascadia", vehicle_type: "truck" })).toBe("freightliner_semi");
    expect(getVehicleThumbnailVariant({ make: null, model: "freightliner cascadia", vehicle_type: "truck" })).toBe("freightliner_semi");
  });

  it("prefers a box-truck silhouette for International box trucks", () => {
    expect(getVehicleThumbnailVariant({ make: "International", model: "4300 Box Truck", vehicle_type: "truck" })).toBe("international_box");
    expect(getVehicleThumbnailVariant({ make: "International", model: "MV", vehicle_type: "box_truck" })).toBe("international_box");
    expect(getVehicleThumbnailVariant({ make: "International", model: null, vehicle_type: "truck" })).toBe("international_box");
  });

  it("falls back safely for unknown vehicles", () => {
    expect(getVehicleThumbnailVariant({ make: null, model: null, vehicle_type: "truck" })).toBe("generic_semi");
    expect(getVehicleThumbnailVariant({ make: "Unknown", model: "Custom", vehicle_type: "box_truck" })).toBe("generic_box");
  });

  it("normalizes safe truck colors and rejects unsafe values", () => {
    expect(getVehicleThumbnailColors("blue")).toMatchObject({ bodyColor: "#2563eb" });
    expect(getVehicleThumbnailColors("dark blue")).toMatchObject({ bodyColor: "#1e3a8a", accentColor: "#cbd5e1" });
    expect(getVehicleThumbnailColors(" metallic silver ")).toMatchObject({ bodyColor: "#a8b0ba" });
    expect(getVehicleThumbnailColors("dc2626")).toMatchObject({ bodyColor: "#dc2626" });
    expect(getVehicleThumbnailColors("#15803D")).toMatchObject({ bodyColor: "#15803d" });
    expect(getVehicleThumbnailColors("url(javascript:alert(1))")).toMatchObject({ bodyColor: "#64748b" });
  });

  it("resolves each major brand to a different SVG variant", () => {
    const variants = [
      getVehicleThumbnailVariant({ make: "Peterbilt", model: "579", vehicle_type: "truck" }),
      getVehicleThumbnailVariant({ make: "Kenworth", model: "T680", vehicle_type: "truck" }),
      getVehicleThumbnailVariant({ make: "Freightliner", model: "Cascadia", vehicle_type: "truck" }),
      getVehicleThumbnailVariant({ make: "International", model: "4300 Box Truck", vehicle_type: "truck" }),
    ];

    expect(new Set(variants).size).toBe(4);
  });

  it("keeps white trucks visible against the light thumbnail background", () => {
    expect(getVehicleThumbnailColors("white")).toEqual({
      bodyColor: "#f8fafc",
      accentColor: "#94a3b8",
      needsOutline: true,
    });
  });

  it("uses distinct SVG paths for Peterbilt, Kenworth, and Freightliner semi geometry", () => {
    const source = readFileSync("components/VehicleThumbnail.tsx", "utf8");
    const peterbiltPaths = pathDataFor(source, "PeterbiltSemi");
    const kenworthPaths = pathDataFor(source, "KenworthSemi");
    const freightlinerPaths = pathDataFor(source, "FreightlinerSemi");

    expect(peterbiltPaths).not.toEqual(kenworthPaths);
    expect(peterbiltPaths).not.toEqual(freightlinerPaths);
    expect(kenworthPaths).not.toEqual(freightlinerPaths);
  });
});

function pathDataFor(source: string, componentName: string): string[] {
  const start = source.indexOf(`function ${componentName}`);
  expect(start).toBeGreaterThanOrEqual(0);
  const rest = source.slice(start);
  const nextComponent = rest.slice(1).search(/\nfunction [A-Z]/);
  const componentSource = nextComponent >= 0 ? rest.slice(0, nextComponent + 1) : rest;
  return [...componentSource.matchAll(/<path d="([^"]+)"/g)].map((match) => match[1]);
}
