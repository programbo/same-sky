import { describe, expect, test } from "bun:test";
import type { TimeInPlaceDependencies } from "./lib/time-in-place";
import type { PersistLocationInput, PersistedLocation, PersistedLocationStoreLike } from "./lib/time-in-place";
import { createServer } from "./index";

function createDependencies(): TimeInPlaceDependencies {
  return {
    geocodeProvider: {
      async search(query, limit) {
        return [
          {
            name: `${query} (${limit})`,
            coords: { lat: 48.8566, long: 2.3522 },
            source: "test",
          },
        ];
      },
      async reverse(coords) {
        return {
          name: "San Francisco, California, United States",
          coords,
          source: "test",
        };
      },
    },
    timezoneProvider: {
      async resolve(_coords, _atMs) {
        return {
          timezone: "America/Los_Angeles",
          offsetSeconds: -28_800,
        };
      },
    },
    ipLocationProvider: {
      async current() {
        return {
          name: "Seattle, Washington, United States",
          coords: { lat: 47.6062, long: -122.3321 },
          source: "test",
        };
      },
    },
    now: () => 1_700_000_000_000,
  };
}

function createMemoryLocationStore(seed: PersistedLocation[] = []): PersistedLocationStoreLike {
  const list = [...seed];

  return {
    async list() {
      return [...list].sort((left, right) => right.createdAtMs - left.createdAtMs);
    },
    async add(input: PersistLocationInput) {
      const entry: PersistedLocation = {
        id: `saved-${list.length + 1}`,
        name: input.name,
        coords: input.coords,
        nickname: input.nickname?.trim() || undefined,
        createdAtMs: 1_700_000_000_000 + list.length,
      };
      list.push(entry);
      return entry;
    },
    async remove(id: string) {
      const index = list.findIndex(location => location.id === id);
      if (index < 0) {
        return null;
      }

      const [removed] = list.splice(index, 1);
      return removed ?? null;
    },
  };
}

async function withServer(
  dependencies: TimeInPlaceDependencies,
  locationStore: PersistedLocationStoreLike,
  run: (baseUrl: URL) => Promise<void>,
): Promise<void> {
  const server = createServer({
    port: 0,
    dependencies,
    locationStore,
  });

  try {
    await run(server.url);
  } finally {
    server.stop(true);
  }
}

describe("route handlers", () => {
  test("keeps existing hello route working", async () => {
    await withServer(createDependencies(), createMemoryLocationStore(), async baseUrl => {
      const response = await fetch(new URL("/api/hello", baseUrl));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        message: "Hello, world!",
        method: "GET",
      });
    });
  });

  test("lookup route returns results and clamps limit", async () => {
    let capturedLimit = 0;
    const deps = createDependencies();
    deps.geocodeProvider.search = async (query, limit) => {
      capturedLimit = limit;
      return [
        {
          name: `${query} result`,
          coords: { lat: 48.8566, long: 2.3522 },
          source: "test",
        },
      ];
    };

    await withServer(deps, createMemoryLocationStore(), async baseUrl => {
      const response = await fetch(new URL("/api/locations/lookup?q=Paris&limit=999", baseUrl));
      expect(response.status).toBe(200);
      expect(capturedLimit).toBe(10);
      expect(await response.json()).toEqual({
        results: [
          {
            name: "paris result",
            lat: 48.8566,
            long: 2.3522,
          },
        ],
      });
    });
  });

  test("lookup route validates query", async () => {
    await withServer(createDependencies(), createMemoryLocationStore(), async baseUrl => {
      const response = await fetch(new URL("/api/locations/lookup?q=   ", baseUrl));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: {
          code: "invalid_query",
          message: "Lookup query cannot be empty.",
        },
      });
    });
  });

  test("current location uses browser coordinates when provided", async () => {
    await withServer(createDependencies(), createMemoryLocationStore(), async baseUrl => {
      const response = await fetch(new URL("/api/location/current?lat=37.7749&long=-122.4194", baseUrl));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        result: {
          name: "San Francisco, California, United States",
          lat: 37.7749,
          long: -122.4194,
          source: "browser",
        },
      });
    });
  });

  test("current location falls back to ip lookup", async () => {
    await withServer(createDependencies(), createMemoryLocationStore(), async baseUrl => {
      const response = await fetch(new URL("/api/location/current", baseUrl));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        result: {
          name: "Seattle, Washington, United States",
          lat: 47.6062,
          long: -122.3321,
          source: "ip",
        },
      });
    });
  });

  test("current location rejects incomplete coordinates", async () => {
    await withServer(createDependencies(), createMemoryLocationStore(), async baseUrl => {
      const response = await fetch(new URL("/api/location/current?lat=40.0", baseUrl));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: {
          code: "invalid_coordinates",
          message: "Both lat and long are required when providing coordinates.",
        },
      });
    });
  });

  test("time route returns timezone payload", async () => {
    let capturedAt: number | undefined;
    const deps = createDependencies();
    deps.timezoneProvider.resolve = async (_coords, atMs) => {
      capturedAt = atMs;
      return {
        timezone: "America/Los_Angeles",
        offsetSeconds: -28_800,
      };
    };

    await withServer(deps, createMemoryLocationStore(), async baseUrl => {
      const response = await fetch(
        new URL("/api/location/time?lat=37.7749&long=-122.4194&at=1710000000000", baseUrl),
      );

      expect(response.status).toBe(200);
      expect(capturedAt).toBe(1_710_000_000_000);
      expect(await response.json()).toEqual({
        result: {
          timestampMs: 1_710_000_000_000,
          timezone: "America/Los_Angeles",
          offsetSeconds: -28_800,
        },
      });
    });
  });

  test("time route requires coordinates", async () => {
    await withServer(createDependencies(), createMemoryLocationStore(), async baseUrl => {
      const response = await fetch(new URL("/api/location/time", baseUrl));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: {
          code: "invalid_coordinates",
          message: "lat and long query parameters are required.",
        },
      });
    });
  });

  test("maps provider failures to 502", async () => {
    const deps = createDependencies();
    deps.geocodeProvider.search = async () => {
      throw new Error("provider unavailable");
    };

    await withServer(deps, createMemoryLocationStore(), async baseUrl => {
      const response = await fetch(new URL("/api/locations/lookup?q=Paris", baseUrl));
      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({
        error: {
          code: "geocode_lookup_failed",
          message: "Unable to look up locations.",
        },
      });
    });
  });

  test("persists a location via API with optional nickname", async () => {
    await withServer(createDependencies(), createMemoryLocationStore(), async baseUrl => {
      const response = await fetch(new URL("/api/locations/persisted", baseUrl), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Paris, Ile-de-France, France",
          lat: 48.8566,
          long: 2.3522,
          nickname: "Trip",
        }),
      });

      expect(response.status).toBe(201);
      expect(await response.json()).toEqual({
        result: {
          id: "saved-1",
          name: "Paris, Ile-de-France, France",
          lat: 48.8566,
          long: 2.3522,
          nickname: "Trip",
          createdAtMs: 1_700_000_000_000,
        },
      });
    });
  });

  test("rejects malformed persisted-location payloads", async () => {
    await withServer(createDependencies(), createMemoryLocationStore(), async baseUrl => {
      const malformed = await fetch(new URL("/api/locations/persisted", baseUrl), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{ bad",
      });

      expect(malformed.status).toBe(400);
      expect(await malformed.json()).toEqual({
        error: {
          code: "invalid_json",
          message: "Request body must be valid JSON.",
        },
      });

      const invalidCoords = await fetch(new URL("/api/locations/persisted", baseUrl), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Invalid, Test, World",
          lat: 200,
          long: 2,
        }),
      });

      expect(invalidCoords.status).toBe(400);
      expect(await invalidCoords.json()).toEqual({
        error: {
          code: "invalid_coordinates",
          message: "Coordinates must include lat in [-90, 90] and long in [-180, 180].",
        },
      });
    });
  });

  test("lists and removes persisted locations via API", async () => {
    const store = createMemoryLocationStore([
      {
        id: "saved-a",
        name: "Tokyo, Tokyo, Japan",
        coords: { lat: 35.6762, long: 139.6503 },
        nickname: "Work",
        createdAtMs: 1_700_000_000_010,
      },
      {
        id: "saved-b",
        name: "London, England, United Kingdom",
        coords: { lat: 51.5072, long: -0.1276 },
        createdAtMs: 1_700_000_000_000,
      },
    ]);

    await withServer(createDependencies(), store, async baseUrl => {
      const listed = await fetch(new URL("/api/locations/persisted", baseUrl));
      expect(listed.status).toBe(200);
      expect(await listed.json()).toEqual({
        results: [
          {
            id: "saved-a",
            name: "Tokyo, Tokyo, Japan",
            lat: 35.6762,
            long: 139.6503,
            nickname: "Work",
            createdAtMs: 1_700_000_000_010,
          },
          {
            id: "saved-b",
            name: "London, England, United Kingdom",
            lat: 51.5072,
            long: -0.1276,
            createdAtMs: 1_700_000_000_000,
          },
        ],
      });

      const removed = await fetch(new URL("/api/locations/persisted/saved-a", baseUrl), { method: "DELETE" });
      expect(removed.status).toBe(200);
      expect(await removed.json()).toEqual({
        result: {
          id: "saved-a",
          name: "Tokyo, Tokyo, Japan",
          lat: 35.6762,
          long: 139.6503,
          nickname: "Work",
          createdAtMs: 1_700_000_000_010,
        },
      });
    });
  });

  test("returns 404 when deleting unknown persisted location", async () => {
    await withServer(createDependencies(), createMemoryLocationStore(), async baseUrl => {
      const response = await fetch(new URL("/api/locations/persisted/missing", baseUrl), { method: "DELETE" });
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({
        error: {
          code: "persisted_location_not_found",
          message: "No persisted location found for id: missing",
        },
      });
    });
  });
});
