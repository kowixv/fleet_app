import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveVehicleColor, resolveVehicleThumbnail } from "./vehicle-thumbnail";

describe("vehicle thumbnail resolver", () => {
  it("maps known aerodynamic sleeper models", () => {
    expect(resolveVehicleThumbnail({ make: "Peterbilt", model: "579", color: "Yellow", vehicleType: "truck" })).toMatchObject({
      variant: "aero_sleeper",
      bodyColor: "#eab308",
    });
    expect(resolveVehicleThumbnail({ make: "Kenworth", model: "T680", color: "Blue", vehicleType: "truck" }).variant).toBe("aero_sleeper");
    expect(resolveVehicleThumbnail({ make: "Freightliner", model: "Cascadia", color: "White", vehicleType: "truck" }).variant).toBe("aero_sleeper");
  });

  it("maps conventional, vocational, and box-truck silhouettes", () => {
    expect(resolveVehicleThumbnail({ make: "Peterbilt", model: "389", vehicleType: "truck" }).variant).toBe("conventional_sleeper");
    expect(resolveVehicleThumbnail({ make: "Kenworth", model: "T880", vehicleType: "truck" }).variant).toBe("vocational_daycab");
    expect(resolveVehicleThumbnail({ make: "Freightliner", model: "M2 106", vehicleType: "box_truck" }).variant).toBe("box_truck");
  });

  it("uses vehicle type as the authoritative box-truck fallback", () => {
    expect(resolveVehicleThumbnail({ make: "Unknown", model: "Unknown", vehicleType: "box_truck" }).variant).toBe("box_truck");
    expect(resolveVehicleThumbnail({ make: "Unknown", model: "Unknown", vehicleType: "truck" }).variant).toBe("generic_truck");
  });

  it("accepts safe named and hex colors and falls back for invalid input", () => {
    expect(resolveVehicleColor("Silver")).toBe("#a8b0ba");
    expect(resolveVehicleColor("#12ABEF")).toBe("#12abef");
    expect(resolveVehicleColor("12ABEF")).toBe("#12abef");
    expect(resolveVehicleColor("url(javascript:alert(1))")).toBe("#64748b");
  });

  it("keeps the list integration local and network-free", () => {
    const manager = readFileSync("components/VehicleResourceManager.tsx", "utf8");
    const component = readFileSync("components/VehicleThumbnail.tsx", "utf8");

    expect(manager).toContain("<VehicleThumbnail");
    expect(manager).toContain("make={row.make}");
    expect(manager).toContain("model={row.model}");
    expect(manager).toContain("color={row.truck_color}");
    expect(component).toContain("<svg");
    expect(component).not.toContain("fetch(");
    expect(component).not.toContain("<img");
    expect(component).not.toContain("http://");
    expect(component).not.toContain("https://");
  });
});
