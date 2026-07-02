import { describe, it, expect } from "vitest";
import { resolvePosition, MAX_RELIABLE_ACCURACY_M } from "./position-filter";

// Reno, NV ≈ (39.53, -119.81); Denver, CO ≈ (39.74, -104.99) — roughly 800+ miles apart.
const RENO = { latitude: 39.53, longitude: -119.81 };
const DENVER = { latitude: 39.74, longitude: -104.99 };

describe("resolvePosition", () => {
  it("accepts the incoming fix when there is no previous position", () => {
    const result = resolvePosition(null, { ...RENO, accuracy: 5000, timestamp: "2026-07-01T12:00:00Z" });
    expect(result).toEqual({ latitude: RENO.latitude, longitude: RENO.longitude, rejected: false });
  });

  it("accepts a good-accuracy fix even with a large jump", () => {
    const prev = { ...RENO, last_update_at: "2026-07-01T12:00:00Z" };
    const result = resolvePosition(prev, {
      ...DENVER,
      accuracy: MAX_RELIABLE_ACCURACY_M, // exactly at the reliable threshold
      timestamp: "2026-07-01T22:00:00Z", // 10h later — plausible for that distance
    });
    expect(result.rejected).toBe(false);
    expect(result.latitude).toBe(DENVER.latitude);
    expect(result.longitude).toBe(DENVER.longitude);
  });

  it("accepts a poor-accuracy fix when the jump is small (GPS jitter)", () => {
    const prev = { ...RENO, last_update_at: "2026-07-01T12:00:00Z" };
    const result = resolvePosition(prev, {
      latitude: RENO.latitude + 0.001, // ~110m — small jitter
      longitude: RENO.longitude,
      accuracy: 500,
      timestamp: "2026-07-01T12:00:05Z",
    });
    expect(result.rejected).toBe(false);
  });

  it("rejects a poor-accuracy fix that implies an impossible jump, keeping the last known position", () => {
    const prev = { ...RENO, last_update_at: "2026-07-01T12:00:00Z" };
    const result = resolvePosition(prev, {
      ...DENVER,
      accuracy: 5000, // unreliable — cell/Wi-Fi fallback fix
      timestamp: "2026-07-01T12:00:05Z", // only 5s later — ~800mi is impossible
    });
    expect(result).toEqual({ latitude: RENO.latitude, longitude: RENO.longitude, rejected: true });
  });

  it("rejects an implausible jump even when timestamps are out of order", () => {
    const prev = { ...RENO, last_update_at: "2026-07-01T12:00:10Z" };
    const result = resolvePosition(prev, {
      ...DENVER,
      accuracy: 5000,
      timestamp: "2026-07-01T12:00:00Z", // earlier than prev — abs() must still catch this
    });
    expect(result.rejected).toBe(true);
  });

  it("accepts a poor-accuracy fix when the implied speed is plausible", () => {
    const prev = { ...RENO, last_update_at: "2026-07-01T12:00:00Z" };
    const result = resolvePosition(prev, {
      latitude: RENO.latitude + 0.02, // ~1.4 miles — plausible in 5 minutes
      longitude: RENO.longitude,
      accuracy: 200,
      timestamp: "2026-07-01T12:05:00Z",
    });
    expect(result.rejected).toBe(false);
  });
});
