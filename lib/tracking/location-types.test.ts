import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isWriteRole } from "@/lib/auth-roles";
import {
  FLEET_LOCATION_TYPES,
  LOCATION_MARKER_STYLES,
  buildDirectionsUrl,
  buildDriverMessage,
  getLocationMarkerStyle,
  getNearbyFleetLocations,
  validateFleetLocationInput,
  type MapFleetLocation,
} from "@/lib/tracking/location-types";

const baseLocation: MapFleetLocation = {
  id: "loc-1",
  name: "Columbus Heavy Duty Repair",
  location_type: "mechanic_shop",
  address_line: "123 Main St",
  city: "Columbus",
  state: "OH",
  postal_code: "43204",
  latitude: 39.9612,
  longitude: -82.9988,
  phone: "(614) 555-1234",
  business_hours: "Mon-Fri 8-5",
  is_24_hour: false,
  mobile_service: false,
  heavy_duty_capable: true,
  preferred_vendor: true,
  services: ["diesel", "tires"],
  internal_rating: 4.5,
};

describe("fleet location validation", () => {
  it("accepts a valid saved location", () => {
    const result = validateFleetLocationInput(baseLocation as unknown as Record<string, unknown>);
    expect(result.ok).toBe(true);
    expect(result.data?.location_type).toBe("mechanic_shop");
  });

  it("rejects invalid category, coordinates, rating, and blank name", () => {
    expect(validateFleetLocationInput({ ...baseLocation, location_type: "bad" }).ok).toBe(false);
    expect(validateFleetLocationInput({ ...baseLocation, latitude: -91 }).ok).toBe(false);
    expect(validateFleetLocationInput({ ...baseLocation, longitude: 181 }).ok).toBe(false);
    expect(validateFleetLocationInput({ ...baseLocation, internal_rating: 6 }).ok).toBe(false);
    expect(validateFleetLocationInput({ ...baseLocation, name: "   " }).ok).toBe(false);
  });

  it("rejects viewer writes at the shared role boundary", () => {
    expect(isWriteRole("viewer")).toBe(false);
    expect(isWriteRole("manager")).toBe(true);
  });
});

describe("nearby support filtering", () => {
  const unit = { latitude: 39.9612, longitude: -82.9988 };
  const locations: MapFleetLocation[] = [
    { ...baseLocation, id: "same", name: "Same Spot", latitude: unit.latitude, longitude: unit.longitude },
    { ...baseLocation, id: "near", name: "Near Shop", latitude: 40.01, longitude: -83.02, preferred_vendor: false },
    { ...baseLocation, id: "far", name: "Far Tow", location_type: "towing", latitude: 41.5, longitude: -81.7, is_24_hour: true },
    { ...baseLocation, id: "mobile", name: "Mobile Diesel", location_type: "mobile_mechanic", latitude: 39.97, longitude: -83, mobile_service: true },
  ];

  it("sorts by approximate distance and handles exact zero-distance locations", () => {
    const nearby = getNearbyFleetLocations(unit, locations, { radiusMiles: "all" });
    expect(nearby[0].id).toBe("same");
    expect(nearby[0].approx_distance_miles).toBe(0);
  });

  it("filters by radius, category, preferred, 24/7, and mobile service", () => {
    expect(getNearbyFleetLocations(unit, locations, { radiusMiles: 25 }).map((item) => item.id)).not.toContain("far");
    expect(getNearbyFleetLocations(unit, locations, { types: ["towing"], radiusMiles: "all" })).toHaveLength(1);
    expect(getNearbyFleetLocations(unit, locations, { preferredOnly: true, radiusMiles: "all" }).every((item) => item.preferred_vendor)).toBe(true);
    expect(getNearbyFleetLocations(unit, locations, { open24Only: true, radiusMiles: "all" }).map((item) => item.id)).toEqual(["far"]);
    expect(getNearbyFleetLocations(unit, locations, { mobileOnly: true, radiusMiles: "all" }).map((item) => item.id)).toEqual(["mobile"]);
  });

  it("returns an empty list when unit coordinates are missing", () => {
    expect(getNearbyFleetLocations(null, locations)).toEqual([]);
    expect(getNearbyFleetLocations({ latitude: null, longitude: -83 }, locations)).toEqual([]);
  });
});

describe("map helpers", () => {
  it("defines marker styles for every location type and safely falls back", () => {
    expect(Object.keys(LOCATION_MARKER_STYLES).sort()).toEqual([...FLEET_LOCATION_TYPES].sort());
    expect(getLocationMarkerStyle("not_real")).toEqual(LOCATION_MARKER_STYLES.other);
  });

  it("uses coordinates for directions and generated driver messages", () => {
    const directions = buildDirectionsUrl({
      originLat: 39.9,
      originLng: -83,
      destinationLat: baseLocation.latitude,
      destinationLng: baseLocation.longitude,
    });
    expect(directions).toContain("origin=39.9%2C-83");
    expect(directions).toContain("destination=39.9612%2C-82.9988");

    const message = buildDriverMessage({
      unitNumber: "14106",
      location: baseLocation,
      approxDistanceMiles: 8.7,
      directionsUrl: directions,
    });
    expect(message).toContain("Columbus Heavy Duty Repair");
    expect(message).toContain("123 Main St");
    expect(message).toContain("(614) 555-1234");
    expect(message).toContain("Approx. distance: 8.7 mi");
  });
});

describe("tracking SQL and dashboard guarantees", () => {
  it("scopes fleet location RLS by organization and writer role", () => {
    const migration = readFileSync("supabase/migrations/20260723010000_tracking_fleet_locations.sql", "utf8");
    expect(migration).toContain("organization_id = (select public.current_org_id())");
    expect(migration).toContain("and (select public.is_org_writer())");
    expect(migration).toContain("grant select, insert, update, delete on public.fleet_locations to authenticated");
  });

  it("dashboard returns active locations for the current organization only", () => {
    const route = readFileSync("app/api/tracking/dashboard/route.ts", "utf8");
    expect(route).toContain('.from("fleet_locations")');
    expect(route).toContain('.eq("organization_id", orgId)');
    expect(route).toContain('.eq("active", true)');
    expect(route).toContain("locations: locationsRes.data ?? []");
  });

  it("mutation routes include explicit organization scoping for updates", () => {
    const route = readFileSync("app/api/tracking/locations/[id]/route.ts", "utf8");
    expect(route).toContain('.eq("organization_id", actor.profile.organization_id)');
  });
});
