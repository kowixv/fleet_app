import { describe, it, expect } from "vitest";
import { clean, isAllowedTable } from "./crud-allowlist";

describe("crud allowlist", () => {
  it("rejects tables not in the allowlist", () => {
    expect(isAllowedTable("profiles")).toBe(false);
    expect(isAllowedTable("settlements")).toBe(false);
    expect(() => clean("profiles", { role: "admin" })).toThrow(/not allowed/);
  });

  it("drops columns that are not allowlisted (incl. organization_id)", () => {
    const out = clean("companies", {
      name: "Acme",
      organization_id: "attacker-org", // must never pass through
      id: "spoofed-id",
      role: "owner",
      notes: "ok",
    });
    expect(out).toEqual({ name: "Acme", notes: "ok" });
    expect(out).not.toHaveProperty("organization_id");
    expect(out).not.toHaveProperty("id");
  });

  it("coerces empty string / undefined to null", () => {
    const out = clean("companies", { name: "", notes: undefined });
    expect(out).toEqual({ name: null, notes: null });
  });

  it("keeps only present keys (does not invent columns)", () => {
    const out = clean("external_carriers", { name: "X" });
    expect(out).toEqual({ name: "X" });
  });
});
