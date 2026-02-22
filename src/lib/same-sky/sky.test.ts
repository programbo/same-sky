import { describe, expect, test } from "bun:test";
import { computeSky24h } from "./sky";
import type { SkyEnvironment, SkySecondOrderFactors } from "./types";

function buildEnvironment(timezone: string, samples: Array<{ timestampMs: number; factors: SkySecondOrderFactors }>): SkyEnvironment {
  return {
    timezone,
    samples,
    diagnostics: {
      factors: {
        altitude: { value: 0.2, source: "live", confidence: 0.9 },
        turbidity: { value: 0.3, source: "live", confidence: 0.8 },
        humidity: { value: 0.4, source: "live", confidence: 0.8 },
        cloud_fraction: { value: 0.3, source: "live", confidence: 0.8 },
        ozone_factor: { value: 0.5, source: "live", confidence: 0.7 },
        light_pollution: { value: 0.6, source: "live", confidence: 0.7 },
      },
      providerQuality: "live",
      degraded: false,
      fallbackReasons: [],
    },
  };
}

function luminance(hex: string): number {
  const normalized = hex.replace("#", "");
  const value = Number.parseInt(normalized, 16);
  const r = (value >> 16) & 0xff;
  const g = (value >> 8) & 0xff;
  const b = value & 0xff;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

describe("computeSky24h", () => {
  test("returns 17 stops and clamps override factors", () => {
    const result = computeSky24h(
      { lat: 48.8566, long: 2.3522 },
      buildEnvironment("UTC", [
        {
          timestampMs: 1_710_000_000_000,
          factors: {
            altitude: 0.2,
            turbidity: 0.3,
            humidity: 0.4,
            cloud_fraction: 0.3,
            ozone_factor: 0.5,
            light_pollution: 0.6,
          },
        },
      ]),
      1_710_000_000_000,
      {
        factorOverrides: {
          cloud_fraction: 2,
          humidity: -1,
        },
      },
    );

    expect(result.stops).toHaveLength(17);
    for (const stop of result.stops) {
      expect(stop.factors.cloud_fraction).toBeGreaterThanOrEqual(0);
      expect(stop.factors.cloud_fraction).toBeLessThanOrEqual(1);
      expect(stop.factors.humidity).toBeGreaterThanOrEqual(0);
      expect(stop.factors.humidity).toBeLessThanOrEqual(1);
    }
    expect(result.diagnostics.factors.cloud_fraction.source).toBe("override");
    expect(result.diagnostics.factors.humidity.source).toBe("override");
  });

  test("pushes dawn later and dusk earlier for heavy atmospheric load", () => {
    const clear: SkySecondOrderFactors = {
      altitude: 0,
      turbidity: 0,
      humidity: 0,
      cloud_fraction: 0,
      ozone_factor: 0,
      light_pollution: 0.3,
    };

    const heavy: SkySecondOrderFactors = {
      altitude: 0,
      turbidity: 1,
      humidity: 1,
      cloud_fraction: 1,
      ozone_factor: 1,
      light_pollution: 0.8,
    };

    const atMs = Date.UTC(2026, 5, 21, 12, 0, 0);
    const clearResult = computeSky24h(
      { lat: 37.7749, long: -122.4194 },
      buildEnvironment("UTC", [{ timestampMs: atMs, factors: clear }]),
      atMs,
    );
    const heavyResult = computeSky24h(
      { lat: 37.7749, long: -122.4194 },
      buildEnvironment("UTC", [{ timestampMs: atMs, factors: heavy }]),
      atMs,
    );

    const clearSunriseShift = clearResult.stops.find(stop => stop.name === "sunrise")?.shiftMinutes ?? 0;
    const heavySunriseShift = heavyResult.stops.find(stop => stop.name === "sunrise")?.shiftMinutes ?? 0;
    const clearSunsetShift = clearResult.stops.find(stop => stop.name === "sunset")?.shiftMinutes ?? 0;
    const heavySunsetShift = heavyResult.stops.find(stop => stop.name === "sunset")?.shiftMinutes ?? 0;

    expect(heavySunriseShift).toBeGreaterThan(clearSunriseShift);
    expect(heavySunsetShift).toBeLessThan(clearSunsetShift);
  });

  test("darkens noon color under heavy cloud and haze", () => {
    const atMs = Date.UTC(2026, 7, 5, 12, 0, 0);

    const brightResult = computeSky24h(
      { lat: 35.6762, long: 139.6503 },
      buildEnvironment("UTC", [
        {
          timestampMs: atMs,
          factors: {
            altitude: 0.7,
            turbidity: 0,
            humidity: 0.1,
            cloud_fraction: 0,
            ozone_factor: 0.4,
            light_pollution: 0.2,
          },
        },
      ]),
      atMs,
    );

    const hazyResult = computeSky24h(
      { lat: 35.6762, long: 139.6503 },
      buildEnvironment("UTC", [
        {
          timestampMs: atMs,
          factors: {
            altitude: 0.1,
            turbidity: 1,
            humidity: 1,
            cloud_fraction: 1,
            ozone_factor: 0.4,
            light_pollution: 0.9,
          },
        },
      ]),
      atMs,
    );

    const brightNoon = brightResult.stops.find(stop => stop.name === "solar_noon")?.colorHex ?? "#000000";
    const hazyNoon = hazyResult.stops.find(stop => stop.name === "solar_noon")?.colorHex ?? "#000000";

    expect(luminance(hazyNoon)).toBeLessThan(luminance(brightNoon));
  });

  test("is deterministic for the same input", () => {
    const atMs = Date.UTC(2026, 2, 10, 8, 30, 0);
    const environment = buildEnvironment("UTC", [
      {
        timestampMs: atMs - 3_600_000,
        factors: {
          altitude: 0.3,
          turbidity: 0.4,
          humidity: 0.6,
          cloud_fraction: 0.3,
          ozone_factor: 0.5,
          light_pollution: 0.7,
        },
      },
      {
        timestampMs: atMs + 3_600_000,
        factors: {
          altitude: 0.3,
          turbidity: 0.5,
          humidity: 0.5,
          cloud_fraction: 0.4,
          ozone_factor: 0.55,
          light_pollution: 0.7,
        },
      },
    ]);

    const first = computeSky24h({ lat: 51.5072, long: -0.1276 }, environment, atMs);
    const second = computeSky24h({ lat: 51.5072, long: -0.1276 }, environment, atMs);

    expect(second).toEqual(first);
  });

  test("imputes polar conditions but still returns a full stop ring", () => {
    const atMs = Date.UTC(2026, 0, 15, 12, 0, 0);
    const result = computeSky24h(
      { lat: 78.2232, long: 15.6469 },
      buildEnvironment("UTC", [
        {
          timestampMs: atMs,
          factors: {
            altitude: 0.1,
            turbidity: 0.4,
            humidity: 0.5,
            cloud_fraction: 0.5,
            ozone_factor: 0.5,
            light_pollution: 0.4,
          },
        },
      ]),
      atMs,
    );

    expect(result.stops).toHaveLength(17);
    expect(result.diagnostics.polarConditionImputed).toBe(true);
    expect(result.diagnostics.fallbackReasons).toContain("polar_conditions_imputed_events");

    for (let index = 1; index < result.stops.length; index += 1) {
      expect(result.stops[index]!.minutesOfDay).toBeGreaterThanOrEqual(result.stops[index - 1]!.minutesOfDay);
    }
  });
});
