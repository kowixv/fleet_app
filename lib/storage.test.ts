import { describe, it, expect } from "vitest";
import { isOwnedImportPath } from "./storage";

const ORG = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";

describe("isOwnedImportPath — cross-tenant guard", () => {
  it("accepts a path scoped to the caller's org", () => {
    expect(isOwnedImportPath(`${ORG}/123-456.pdf`, ORG)).toBe(true);
  });

  it("rejects another org's path (IDOR)", () => {
    expect(isOwnedImportPath(`${OTHER}/123-456.pdf`, ORG)).toBe(false);
  });

  it("rejects path traversal", () => {
    expect(isOwnedImportPath(`${ORG}/../${OTHER}/x.pdf`, ORG)).toBe(false);
  });

  it("rejects absolute paths and backslashes", () => {
    expect(isOwnedImportPath(`/${ORG}/x.pdf`, ORG)).toBe(false);
    expect(isOwnedImportPath(`${ORG}\\x.pdf`, ORG)).toBe(false);
  });

  it("rejects empty / org-only / missing inputs", () => {
    expect(isOwnedImportPath("", ORG)).toBe(false);
    expect(isOwnedImportPath(`${ORG}/`, ORG)).toBe(false);
    expect(isOwnedImportPath(null, ORG)).toBe(false);
    expect(isOwnedImportPath(`${ORG}/x.pdf`, "")).toBe(false);
  });

  it("rejects an org-prefix that is only a string prefix of another org id", () => {
    // path org "…111X" must not satisfy a different org id by accident
    expect(isOwnedImportPath(`${ORG}extra/x.pdf`, ORG)).toBe(false);
  });
});
