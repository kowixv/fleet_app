import { describe, expect, it } from "vitest";
import { resolveStatementRoute } from "./statement-route-display";

describe("statement route display", () => {
  it("prefers organization verified facility mappings", () => {
    expect(resolveStatementRoute({
      originCode: "SAV4",
      destinationCode: "RDU1",
      verifiedOrigin: "Savannah, GA",
      verifiedDestination: "Raleigh, NC",
    })).toEqual({
      display: "Savannah, GA -> Raleigh, NC",
      displayReady: true,
      source: "verified_mapping",
    });
  });

  it("uses conservative reviewed city/state fallbacks for the M. Celebi statement", () => {
    expect(resolveStatementRoute({ originCode: "SAV4", destinationCode: "SAV4" })).toEqual({
      display: "Pooler, GA -> Pooler, GA",
      displayReady: true,
      source: "curated_fallback",
    });
    expect(resolveStatementRoute({ originCode: "CSG1", destinationCode: "SAV7" }).display)
      .toBe("Moreland, GA -> Pooler, GA");
    expect(resolveStatementRoute({ originCode: "WML1", destinationCode: "HSV2" }).display)
      .toBe("Milton, FL -> Madison, AL");
  });

  it("shows facility codes instead of inventing a city when no reviewed mapping exists", () => {
    expect(resolveStatementRoute({ originCode: "UNKNOWN1", destinationCode: "UNKNOWN2" })).toEqual({
      display: "UNKNOWN1 -> UNKNOWN2",
      displayReady: false,
      source: "facility_code",
    });
  });
});
