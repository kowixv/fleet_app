import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const service = readFileSync("lib/amazon-statements/server/candidate-auto-selection-service.ts", "utf8");

describe("candidate auto-selection service raw driver fallback", () => {
  it("loads raw trip driver text and uses it only when persisted tokens are absent", () => {
    expect(service).toContain('.select("id, raw_driver_text, tractor_external_id")');
    expect(service).toContain("persistedTokens.length > 0");
    expect(service).toContain("splitExactSourceLabels(stringOrNull(trip?.raw_driver_text))");
    expect(service).toContain('"exact_raw_trip_driver_text"');
  });
});
