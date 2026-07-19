import { describe, expect, it } from "vitest";
import { resolveStatementCompanyIdentity } from "./statement-company-identity";

describe("statement company identity", () => {
  it("uses the legal carrier name for the AVFYC Amazon account", () => {
    expect(resolveStatementCompanyIdentity("My Fleet", "avfyc")).toEqual({
      name: "ZYNP LLC",
      secondary: "SCAC: AVFYC",
    });
  });

  it("keeps another organization's configured name when no legal SCAC override exists", () => {
    expect(resolveStatementCompanyIdentity("Example Carrier LLC", "EXMP")).toEqual({
      name: "Example Carrier LLC",
      secondary: "SCAC: EXMP",
    });
  });
});
