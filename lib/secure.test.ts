import { describe, it, expect } from "vitest";
import { safeEqual } from "./secure";

describe("safeEqual — constant-time secret comparison", () => {
  it("matches equal strings", () => {
    expect(safeEqual("s3cret-token", "s3cret-token")).toBe(true);
  });

  it("rejects different strings", () => {
    expect(safeEqual("s3cret-token", "wrong-token")).toBe(false);
  });

  it("rejects different lengths without throwing", () => {
    expect(safeEqual("short", "much-longer-secret")).toBe(false);
  });

  it("rejects null/empty inputs", () => {
    expect(safeEqual(null, "x")).toBe(false);
    expect(safeEqual("x", undefined)).toBe(false);
    expect(safeEqual("", "")).toBe(false);
  });
});
