import { describe, expect, test } from "bun:test";
import type { TimeInPlaceDependencies } from "./contracts";
import { TimeInPlaceService, isLocationSelectableForSky } from "./service";
import type { Coordinates, LocationMatch, SkyEnvironment } from "./types";

function makeMatch(overrides: Partial<LocationMatch> = {}): LocationMatch {
  return {
    id: overrides.id ?? "test:1",
    name: overrides.name ?? "Test City",
    fullName: overrides.fullName ?? "Test City, Test Region, Test Country",
    coords: overrides.coords ?? { lat: 40.7128, long: -74.006 },
    source: overrides.source ?? "test",
    granularity: overrides.granularity ?? "city",
    isLocalityClass: overrides.isLocalityClass ?? true,
    admin: overrides.admin ?? {
      country: "Test Country",
      region: "Test Region",
      locality: "Test City",
    },
    boundingBox: overrides.boundingBox,
    timezonePreview: overrides.timezonePreview,
  };
}

function buildDependencies(overrides: Partial<TimeInPlaceDependencies> = {}): TimeInPlaceDependencies {
  const defaultSkyEnvironment: SkyEnvironment = {
    timezone: "UTC",
    samples: [
      {
        timestampMs: 1_700_000_000_000,
        factors: {
          altitude: 0.2,
          turbidity: 0.4,
          humidity: 0.5,
          cloud_fraction: 0.3,
          ozone_factor: 0.45,
          light_pollution: 0.6,
        },
      },
    ],
    diagnostics: {
      factors: {
        altitude: { value: 0.2, source: "live", confidence: 0.9 },
        turbidity: { value: 0.4, source: "live", confidence: 0.8 },
        humidity: { value: 0.5, source: "live", confidence: 0.8 },
        cloud_fraction: { value: 0.3, source: "live", confidence: 0.8 },
        ozone_factor: { value: 0.45, source: "live", confidence: 0.7 },
        light_pollution: { value: 0.6, source: "live", confidence: 0.7 },
      },
      providerQuality: "live",
      degraded: false,
      fallbackReasons: [],
    },
  };

  return {
    geocodeProvider: {
      async search(query, options) {
        return [
          makeMatch({
            name: `${query} (${options?.limit ?? 0})`,
          }),
        ];
      },
      async reverse(coords) {
        return makeMatch({
          name: `Lat ${coords.lat}, Long ${coords.long}`,
          fullName: `Lat ${coords.lat}, Long ${coords.long}`,
          coords,
        });
      },
    },
    timezoneProvider: {
      async resolve() {
        return {
          timezone: "UTC",
          offsetSeconds: 0,
        };
      },
    },
    ipLocationProvider: {
      async current() {
        return makeMatch({
          name: "New York, New York, United States",
          fullName: "New York, New York, United States",
          coords: { lat: 40.7128, long: -74.006 },
          source: "test-ip",
        });
      },
    },
    skyEnvironmentProvider: {
      async resolve() {
        return defaultSkyEnvironment;
      },
    },
    now: () => 1_700_000_000_000,
    ...overrides,
  };
}

describe("TimeInPlaceService", () => {
  test("normalizes lookup query, clamps limit, and enriches timezone preview", async () => {
    let receivedQuery = "";
    let receivedLimit = 0;

    const service = new TimeInPlaceService(
      buildDependencies({
        geocodeProvider: {
          async search(query, options): Promise<LocationMatch[]> {
            receivedQuery = query;
            receivedLimit = options?.limit ?? 0;
            return Array.from({ length: 8 }).map((_, index) =>
              makeMatch({
                id: `test:${index + 1}`,
                name: `Location ${index + 1}`,
                coords: { lat: index, long: -index },
              }),
            );
          },
          async reverse() {
            return null;
          },
        },
        timezoneProvider: {
          async resolve(_coords, _atMs) {
            return {
              timezone: "America/New_York",
              offsetSeconds: -18_000,
            };
          },
        },
      }),
    );

    const results = await service.lookupLocations("  S\u00E3o   PAULO  ", { limit: 99, includeTimezonePreview: true });

    expect(receivedQuery).toBe("sao paulo");
    expect(receivedLimit).toBe(10);
    expect(results).toHaveLength(8);
    expect(results[0]?.timezonePreview).toBe("America/New_York");
  });

  test("passes scope/locality options and filters to locality results", async () => {
    let capturedScope: LocationMatch["boundingBox"] | undefined;
    let capturedLocalityOnly = false;

    const service = new TimeInPlaceService(
      buildDependencies({
        geocodeProvider: {
          async search(_query, options): Promise<LocationMatch[]> {
            capturedScope = options?.scopeBoundingBox;
            capturedLocalityOnly = options?.localityOnly ?? false;
            return [
              makeMatch({
                id: "country",
                name: "Australia",
                granularity: "country",
                isLocalityClass: false,
              }),
              makeMatch({
                id: "city",
                name: "Wodonga",
                granularity: "city",
                isLocalityClass: true,
              }),
            ];
          },
          async reverse() {
            return null;
          },
        },
      }),
    );

    const scope = { south: -40, north: -30, west: 140, east: 150 };
    const results = await service.lookupLocations("wodonga", {
      localityOnly: true,
      scopeBoundingBox: scope,
      includeTimezonePreview: false,
    });

    expect(capturedScope).toEqual(scope);
    expect(capturedLocalityOnly).toBe(true);
    expect(results).toHaveLength(1);
    expect(results[0]?.granularity).toBe("city");
  });

  test("degrades gracefully when timezone preview lookup fails", async () => {
    const service = new TimeInPlaceService(
      buildDependencies({
        geocodeProvider: {
          async search() {
            return [makeMatch({ name: "Berlin, Berlin, Germany" })];
          },
          async reverse() {
            return null;
          },
        },
        timezoneProvider: {
          async resolve() {
            throw new Error("timezone unavailable");
          },
        },
      }),
    );

    const [result] = await service.lookupLocations("Berlin", { includeTimezonePreview: true });
    expect(result?.timezonePreview).toBeUndefined();
  });

  test("tuple locationLookup wrapper returns top five", async () => {
    const service = new TimeInPlaceService(
      buildDependencies({
        geocodeProvider: {
          async search() {
            return Array.from({ length: 7 }).map((_, index) =>
              makeMatch({
                id: `test:${index + 1}`,
                name: `Place ${index + 1}`,
                coords: { lat: index + 1, long: -(index + 1) },
              }),
            );
          },
          async reverse() {
            return null;
          },
        },
      }),
    );

    const tuples = await service.locationLookup("place");

    expect(tuples).toHaveLength(5);
    expect(tuples[0]).toEqual(["Place 1", { lat: 1, long: -1 }]);
  });

  test("uses browser coordinates and reverse geocoding for current location", async () => {
    const browserCoords: Coordinates = { lat: 37.7749, long: -122.4194 };

    const service = new TimeInPlaceService(
      buildDependencies({
        geocodeProvider: {
          async search() {
            return [];
          },
          async reverse(coords) {
            return makeMatch({
              name: "San Francisco, California, United States",
              fullName: "San Francisco, California, United States",
              coords,
            });
          },
        },
      }),
    );

    const result = await service.getCurrentLocation({ browserCoords });

    expect(result).toEqual({
      name: "San Francisco, California, United States",
      coords: browserCoords,
      source: "browser",
    });
  });

  test("falls back to ip location when browser coords are not provided", async () => {
    const service = new TimeInPlaceService(buildDependencies());
    const result = await service.getCurrentLocation();

    expect(result.source).toBe("ip");
    expect(result.name).toBe("New York, New York, United States");
  });

  test("resolves time, offset, and angle for a location", async () => {
    const timestampMs = 1_710_000_000_000;
    const coords = { lat: 40.7128, long: -74.006 };

    const service = new TimeInPlaceService(
      buildDependencies({
        now: () => timestampMs,
        timezoneProvider: {
          async resolve(_coords, atMs) {
            expect(atMs).toBe(timestampMs);
            return {
              timezone: "America/New_York",
              offsetSeconds: -18_000,
            };
          },
        },
      }),
    );

    const [returnedTimestamp, timezone] = await service.timeInLocation(coords);
    const offsetSeconds = await service.timeOffsetForLocation(coords);
    const angleDegrees = await service.angleForLocation(coords, "deg");

    expect(returnedTimestamp).toBe(timestampMs);
    expect(timezone).toBe("America/New_York");
    expect(offsetSeconds).toBe(-18_000);
    expect(angleDegrees).toBe(-75);
  });

  test("isLocationSelectableForSky only allows locality-class matches", () => {
    expect(
      isLocationSelectableForSky(
        makeMatch({
          granularity: "city",
          isLocalityClass: true,
        }),
      ),
    ).toBe(true);

    expect(
      isLocationSelectableForSky(
        makeMatch({
          granularity: "country",
          isLocalityClass: false,
        }),
      ),
    ).toBe(false);
  });

  test("computes sky colors with diagnostics and factor overrides", async () => {
    let capturedTimezone = "";
    const service = new TimeInPlaceService(
      buildDependencies({
        timezoneProvider: {
          async resolve() {
            return {
              timezone: "Europe/Berlin",
              offsetSeconds: 3600,
            };
          },
        },
        skyEnvironmentProvider: {
          async resolve(_coords, _atMs, timezone) {
            capturedTimezone = timezone;
            return {
              timezone,
              samples: [
                {
                  timestampMs: 1_700_000_000_000,
                  factors: {
                    altitude: 0.1,
                    turbidity: 0.2,
                    humidity: 0.4,
                    cloud_fraction: 0.3,
                    ozone_factor: 0.4,
                    light_pollution: 0.7,
                  },
                },
              ],
              diagnostics: {
                factors: {
                  altitude: { value: 0.1, source: "live", confidence: 0.9 },
                  turbidity: { value: 0.2, source: "live", confidence: 0.8 },
                  humidity: { value: 0.4, source: "live", confidence: 0.8 },
                  cloud_fraction: { value: 0.3, source: "live", confidence: 0.8 },
                  ozone_factor: { value: 0.4, source: "live", confidence: 0.7 },
                  light_pollution: { value: 0.7, source: "live", confidence: 0.7 },
                },
                providerQuality: "live",
                degraded: false,
                fallbackReasons: [],
              },
            };
          },
        },
      }),
    );

    const result = await service.getSkyColorForLocation(
      { lat: 52.52, long: 13.405 },
      {
        factorOverrides: {
          cloud_fraction: 0.95,
        },
      },
    );

    expect(capturedTimezone).toBe("Europe/Berlin");
    expect(result.stops).toHaveLength(17);
    expect(result.diagnostics.factors.cloud_fraction.source).toBe("override");
  });

  test("tuple sky wrappers return stops and rotation", async () => {
    const service = new TimeInPlaceService(buildDependencies());
    const [stops, rotationDeg] = await service.skyColourForLocationAndTime(
      { lat: 40.7128, long: -74.006 },
      1_710_000_000_000,
    );

    expect(stops.length).toBe(17);
    expect(Number.isFinite(rotationDeg)).toBe(true);
  });

  test("can disable second-order transforms", async () => {
    const service = new TimeInPlaceService(buildDependencies());
    const result = await service.getSkyColorForLocation(
      { lat: 40.7128, long: -74.006 },
      {
        applySecondOrder: false,
      },
    );

    expect(result.stops).toHaveLength(17);
    for (const stop of result.stops) {
      expect(stop.shiftMinutes).toBe(0);
    }
  });

  test("throws validation errors for invalid input", async () => {
    const service = new TimeInPlaceService(buildDependencies());

    await expect(service.lookupLocations("   ")).rejects.toMatchObject({
      code: "invalid_query",
      status: 400,
    });

    await expect(service.getTimeForLocation({ lat: 101, long: 0 })).rejects.toMatchObject({
      code: "invalid_coordinates",
      status: 400,
    });

    await expect(service.getSkyColorForLocation({ lat: 101, long: 0 })).rejects.toMatchObject({
      code: "invalid_coordinates",
      status: 400,
    });
  });

  test("maps provider failures to upstream errors", async () => {
    const service = new TimeInPlaceService(
      buildDependencies({
        geocodeProvider: {
          async search() {
            throw new Error("provider down");
          },
          async reverse() {
            return null;
          },
        },
      }),
    );

    await expect(service.lookupLocations("Paris")).rejects.toMatchObject({
      code: "geocode_lookup_failed",
      status: 502,
    });

    const skyService = new TimeInPlaceService(
      buildDependencies({
        skyEnvironmentProvider: {
          async resolve() {
            throw new Error("sky env unavailable");
          },
        },
      }),
    );

    await expect(skyService.getSkyColorForLocation({ lat: 48.8566, long: 2.3522 })).rejects.toMatchObject({
      code: "sky_lookup_failed",
      status: 502,
    });
  });
});
