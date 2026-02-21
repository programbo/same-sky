import { describe, expect, test } from "bun:test";
import {
  createDefaultSkyEnvironmentProvider,
  lightPollutionForGranularity,
  normalizeAltitudeMeters,
  normalizeCloudFraction,
  normalizeHumidity,
  normalizeOzone,
  normalizeTurbidity,
} from "./sky-providers";

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "content-type": "application/json",
    },
  });
}

describe("sky provider normalizers", () => {
  test("clamps all normalized factors into [0, 1]", () => {
    expect(normalizeAltitudeMeters(-10_000)).toBeGreaterThanOrEqual(0);
    expect(normalizeAltitudeMeters(10_000)).toBeLessThanOrEqual(1);
    expect(normalizeTurbidity(-1)).toBeGreaterThanOrEqual(0);
    expect(normalizeTurbidity(500)).toBeLessThanOrEqual(1);
    expect(normalizeHumidity(-5)).toBeGreaterThanOrEqual(0);
    expect(normalizeHumidity(500)).toBeLessThanOrEqual(1);
    expect(normalizeCloudFraction(-5)).toBeGreaterThanOrEqual(0);
    expect(normalizeCloudFraction(500)).toBeLessThanOrEqual(1);
    expect(normalizeOzone(-5)).toBeGreaterThanOrEqual(0);
    expect(normalizeOzone(500)).toBeLessThanOrEqual(1);
  });

  test("maps granularity to sensible light pollution levels", () => {
    expect(lightPollutionForGranularity("city")).toBeGreaterThan(lightPollutionForGranularity("village"));
    expect(lightPollutionForGranularity("unknown")).toBeGreaterThanOrEqual(0);
    expect(lightPollutionForGranularity("unknown")).toBeLessThanOrEqual(1);
  });
});

describe("createDefaultSkyEnvironmentProvider", () => {
  test("maps weather, air-quality, elevation, and reverse granularity into hourly factors", async () => {
    const fetchImpl = Object.assign(
      async (input: RequestInfo | URL) => {
        const href =
          typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        const url = new URL(href);

        if (url.hostname === "api.open-meteo.com") {
          return jsonResponse({
            hourly: {
              time: ["2026-02-20T00:00", "2026-02-20T01:00"],
              relative_humidity_2m: [70, 60],
              cloud_cover: [40, 10],
            },
          });
        }

        if (url.hostname === "air-quality-api.open-meteo.com") {
          return jsonResponse({
            hourly: {
              time: ["2026-02-20T00:00", "2026-02-20T01:00"],
              pm10: [30, 20],
              ozone: [80, 70],
            },
          });
        }

        if (url.hostname === "api.opentopodata.org") {
          return jsonResponse({
            results: [{ elevation: 250 }],
          });
        }

        if (url.hostname === "nominatim.openstreetmap.org") {
          return jsonResponse({
            addresstype: "city",
          });
        }

        return new Response("not found", { status: 404 });
      },
      {
        preconnect() {},
      },
    ) as typeof fetch;

    const provider = createDefaultSkyEnvironmentProvider({
      fetchImpl,
      now: () => Date.UTC(2026, 1, 20, 12, 0, 0),
    });

    const result = await provider.resolve(
      { lat: 48.8566, long: 2.3522 },
      Date.UTC(2026, 1, 20, 12, 0, 0),
      "UTC",
    );

    expect(result.samples.length).toBeGreaterThanOrEqual(2);
    expect(result.diagnostics.providerQuality).toBe("live");
    expect(result.diagnostics.degraded).toBe(false);
    expect(result.diagnostics.factors.altitude.value).toBeGreaterThan(0);
    expect(result.diagnostics.factors.light_pollution.value).toBeGreaterThan(0.7);
  });

  test("falls back gracefully when providers are unavailable", async () => {
    const fetchImpl = Object.assign(
      async () => {
        throw new Error("network unavailable");
      },
      {
        preconnect() {},
      },
    ) as typeof fetch;

    const provider = createDefaultSkyEnvironmentProvider({
      fetchImpl,
      now: () => Date.UTC(2026, 1, 20, 12, 0, 0),
    });

    const result = await provider.resolve(
      { lat: 37.7749, long: -122.4194 },
      Date.UTC(2026, 1, 20, 12, 0, 0),
      "UTC",
    );

    expect(result.samples.length).toBeGreaterThanOrEqual(1);
    expect(result.diagnostics.degraded).toBe(true);
    expect(result.diagnostics.fallbackReasons.length).toBeGreaterThan(0);
    expect(result.diagnostics.providerQuality).toBe("fallback");
  });

  test("uses TTL cache for repeated calls on same location and date", async () => {
    let weatherCalls = 0;
    let airCalls = 0;
    let elevationCalls = 0;
    let reverseCalls = 0;

    const fetchImpl = Object.assign(
      async (input: RequestInfo | URL) => {
        const href =
          typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        const url = new URL(href);

        if (url.hostname === "api.open-meteo.com") {
          weatherCalls += 1;
          return jsonResponse({
            hourly: {
              time: ["2026-02-20T00:00"],
              relative_humidity_2m: [65],
              cloud_cover: [20],
            },
          });
        }

        if (url.hostname === "air-quality-api.open-meteo.com") {
          airCalls += 1;
          return jsonResponse({
            hourly: {
              time: ["2026-02-20T00:00"],
              pm10: [15],
              ozone: [65],
            },
          });
        }

        if (url.hostname === "api.opentopodata.org") {
          elevationCalls += 1;
          return jsonResponse({
            results: [{ elevation: 50 }],
          });
        }

        if (url.hostname === "nominatim.openstreetmap.org") {
          reverseCalls += 1;
          return jsonResponse({
            addresstype: "suburb",
          });
        }

        return new Response("not found", { status: 404 });
      },
      {
        preconnect() {},
      },
    ) as typeof fetch;

    const now = Date.UTC(2026, 1, 20, 12, 0, 0);
    const provider = createDefaultSkyEnvironmentProvider({
      fetchImpl,
      now: () => now,
    });

    const args = [{ lat: 48.8566, long: 2.3522 }, now, "UTC"] as const;
    await provider.resolve(...args);
    await provider.resolve(...args);

    expect(weatherCalls).toBe(1);
    expect(airCalls).toBe(1);
    expect(elevationCalls).toBe(1);
    expect(reverseCalls).toBe(1);
  });
});
