import { describe, it, expect } from "vitest";
import { safeJson } from "./parse";

describe("safeJson — untrusted LLM output validation", () => {
  it("returns null for empty / non-JSON text", () => {
    expect(safeJson(null)).toBeNull();
    expect(safeJson("no json here")).toBeNull();
    expect(safeJson("{ broken")).toBeNull();
  });

  it("extracts a JSON object embedded in commentary", () => {
    const out = safeJson('Here you go: {"load_number":"L1","gross_rate":1200} thanks');
    expect(out?.load_number).toBe("L1");
    expect(out?.gross_rate).toBe(1200);
  });

  it('coerces string "null" and empty strings to null', () => {
    const out = safeJson('{"load_number":"null","broker_name":"  "}');
    expect(out?.load_number).toBeNull();
    expect(out?.broker_name).toBeNull();
  });

  it("strips currency symbols and rejects non-finite/negative numbers", () => {
    expect(safeJson('{"gross_rate":"$1,250.50"}')?.gross_rate).toBe(1250.5);
    expect(safeJson('{"gross_rate":-5}')?.gross_rate).toBeNull();
    expect(safeJson('{"total_miles":"abc"}')?.total_miles).toBeNull();
  });

  it("only accepts YYYY-MM-DD dates", () => {
    expect(safeJson('{"pickup_date":"2026-01-02"}')?.pickup_date).toBe("2026-01-02");
    expect(safeJson('{"pickup_date":"01/02/2026"}')?.pickup_date).toBeNull();
  });

  it("never returns unexpected types for numbers", () => {
    const out = safeJson('{"gross_rate":{"x":1},"total_miles":[1,2]}');
    expect(out?.gross_rate).toBeNull();
    expect(out?.total_miles).toBeNull();
  });
});
