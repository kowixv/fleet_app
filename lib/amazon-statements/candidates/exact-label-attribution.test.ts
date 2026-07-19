import { describe, expect, it } from "vitest";
import {
  compactExactLabel,
  exactLabelTargetIds,
  initialSurnameTargetIds,
  splitExactSourceLabels,
} from "./exact-label-attribution";

describe("exact source-label attribution", () => {
  it("matches punctuation and spacing variants without fuzzy matching", () => {
    expect(compactExactLabel("M.CELEBI")).toBe("MCELEBI");
    expect(compactExactLabel("M. CELEBI")).toBe("MCELEBI");
    expect(exactLabelTargetIds("M.CELEBI", [
      { id: "person-1", label: "M. CELEBI" },
      { id: "person-2", label: "M. CELIK" },
    ])).toEqual(["person-1"]);
  });

  it("matches exact unit labels", () => {
    expect(exactLabelTargetIds("1501", [
      { id: "vehicle-1501", label: "1501" },
      { id: "vehicle-1502", label: "1502" },
    ])).toEqual(["vehicle-1501"]);
  });

  it("returns every duplicate exact target so callers mark it ambiguous", () => {
    expect(exactLabelTargetIds("M CELEBI", [
      { id: "person-1", label: "M. CELEBI" },
      { id: "person-2", label: "M CELEBI" },
    ])).toEqual(["person-1", "person-2"]);
  });

  it("does not use partial or approximate names", () => {
    expect(exactLabelTargetIds("CELEBI", [
      { id: "person-1", label: "M. CELEBI" },
    ])).toEqual([]);
  });

  it("uses raw trip driver text when normalized token rows are absent", () => {
    expect(splitExactSourceLabels("M.CELEBI")).toEqual(["M.CELEBI"]);
    expect(splitExactSourceLabels("M.CELEBI / C.MANESS")).toEqual(["M.CELEBI", "C.MANESS"]);
    expect(splitExactSourceLabels("M.CELEBI & C.MANESS")).toEqual(["M.CELEBI", "C.MANESS"]);
  });

  it("matches a full source name to a unique initial and surname person label", () => {
    const targets = [
      { id: "person-1", label: "M. CELEBI" },
      { id: "person-2", label: "A. CHORIEV" },
    ];
    expect(initialSurnameTargetIds("Mustafa Celebi", targets)).toEqual(["person-1"]);
    expect(exactLabelTargetIds("Mustafa Celebi", targets)).toEqual(["person-1"]);
  });

  it("returns duplicate initial and surname targets so callers keep them ambiguous", () => {
    expect(initialSurnameTargetIds("Mustafa Celebi", [
      { id: "person-1", label: "M. CELEBI" },
      { id: "person-2", label: "Mert Celebi" },
    ])).toEqual(["person-1", "person-2"]);
  });

  it("does not match a different surname or a surname-only label", () => {
    expect(initialSurnameTargetIds("Mustafa Celebi", [
      { id: "person-1", label: "M. CELIK" },
      { id: "person-2", label: "CELEBI" },
    ])).toEqual([]);
  });
});
