import { describe, expect, test } from "bun:test";
import type { TimeInPlaceDependencies } from "./contracts";
import { TimeInPlaceService } from "./service";
import type { Coordinates, LocationMatch } from "./types";

function buildDependencies(overrides: Partial<TimeInPlaceDependencies> = {}): TimeInPlaceDependencies {
  return {
    geocodeProvider: {
      async search(query, limit) {
        return [
          {
            name: `${query} (${limit})`,
            coords: { lat: 40.7128, long: -74.006 },
            source: "test",
          },
        ];
      },
      async reverse(coords) {
        return {
          name: `Lat ${coords.lat}, Long ${coords.long}`,
          coords,
          source: "test",
        };
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
        return {
          name: "New York, New York, United States",
          coords: { lat: 40.7128, long: -74.006 },
          source: "test-ip",
        };
      },
    },
    now: () => 1_700_000_000_000,
    ...overrides,
  };
}

describe("TimeInPlaceService", () => {
  test("normalizes lookup query and clamps limit", async () => {
    let receivedQuery = "";
    let receivedLimit = 0;

    const service = new TimeInPlaceService(
      buildDependencies({
        geocodeProvider: {
          async search(query, limit): Promise<LocationMatch[]> {
            receivedQuery = query;
            receivedLimit = limit;
            return Array.from({ length: 8 }).map((_, index) => ({
              name: `Location ${index + 1}`,
              coords: { lat: index, long: -index },
              source: "test",
            }));
          },
          async reverse() {
            return null;
          },
        },
      }),
    );

    const results = await service.lookupLocations("  S\u00E3o   PAULO  ", { limit: 99 });

    expect(receivedQuery).toBe("sao paulo");
    expect(receivedLimit).toBe(10);
    expect(results).toHaveLength(8);
  });

  test("tuple locationLookup wrapper returns top five", async () => {
    const service = new TimeInPlaceService(
      buildDependencies({
        geocodeProvider: {
          async search() {
            return Array.from({ length: 7 }).map((_, index) => ({
              name: `Place ${index + 1}`,
              coords: { lat: index + 1, long: -(index + 1) },
              source: "test",
            }));
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
            return {
              name: "San Francisco, California, United States",
              coords,
              source: "test",
            };
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
  });
});
