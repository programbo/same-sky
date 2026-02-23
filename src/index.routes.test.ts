import { describe, expect, test } from "bun:test";
import type { SameSkyDependencies } from "./lib/same-sky";
import type { LocationMatch, PersistLocationInput, PersistLocationPatch, PersistedLocation, PersistedLocationStoreLike } from "./lib/same-sky";
import { createServer } from "./index";

function makeMatch(overrides: Partial<LocationMatch> = {}): LocationMatch {
  return {
    id: overrides.id ?? "test:1",
    name: overrides.name ?? "Paris, Ile-de-France, France",
    fullName: overrides.fullName ?? "Paris, Ile-de-France, France",
    coords: overrides.coords ?? { lat: 48.8566, long: 2.3522 },
    source: overrides.source ?? "test",
    granularity: overrides.granularity ?? "city",
    isLocalityClass: overrides.isLocalityClass ?? true,
    admin: overrides.admin ?? {
      country: "France",
      region: "Ile-de-France",
      locality: "Paris",
    },
    boundingBox: overrides.boundingBox,
    timezonePreview: overrides.timezonePreview,
  };
}

function createDependencies(): SameSkyDependencies {
  return {
    geocodeProvider: {
      async search(query, options) {
        return [
          makeMatch({
            id: "lookup:1",
            name: `${query} (${options?.limit ?? 0})`,
            fullName: `${query} (${options?.limit ?? 0})`,
          }),
        ];
      },
      async reverse(coords) {
        return makeMatch({
          id: "reverse:1",
          name: "San Francisco, California, United States",
          fullName: "San Francisco, California, United States",
          coords,
          admin: {
            country: "United States",
            region: "California",
            locality: "San Francisco",
          },
        });
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
        return makeMatch({
          id: "ip:1",
          name: "Seattle, Washington, United States",
          fullName: "Seattle, Washington, United States",
          coords: { lat: 47.6062, long: -122.3321 },
          source: "test-ip",
          admin: {
            country: "United States",
            region: "Washington",
            locality: "Seattle",
          },
        });
      },
    },
    skyEnvironmentProvider: {
      async resolve(_coords, _atMs, timezone) {
        return {
          timezone,
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
        timezone: input.timezone,
        granularity: input.granularity,
        kind: input.kind ?? "location",
        entityName: input.entityName,
        countryCode: input.countryCode,
        adminState: input.adminState,
        adminCity: input.adminCity,
        adminSuburb: input.adminSuburb,
        avatarSource: input.avatarSource,
        avatarImageUrl: input.avatarImageUrl,
        gravatarHash: input.gravatarHash,
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
    async update(id: string, patch: PersistLocationPatch) {
      const index = list.findIndex(location => location.id === id);
      if (index < 0) {
        return null;
      }

      const existing = list[index];
      if (!existing) {
        return null;
      }

      const updated: PersistedLocation = {
        ...existing,
        nickname: patch.nickname === undefined ? existing.nickname : patch.nickname.trim() || undefined,
        timezone: patch.timezone ?? existing.timezone,
        granularity: patch.granularity ?? existing.granularity,
        kind: patch.kind ?? existing.kind,
        entityName: patch.entityName ?? existing.entityName,
        countryCode: patch.countryCode ?? existing.countryCode,
        adminState: patch.adminState ?? existing.adminState,
        adminCity: patch.adminCity ?? existing.adminCity,
        adminSuburb: patch.adminSuburb ?? existing.adminSuburb,
        avatarSource: patch.avatarSource ?? existing.avatarSource,
        avatarImageUrl: patch.avatarImageUrl ?? existing.avatarImageUrl,
        gravatarHash: patch.gravatarHash ?? existing.gravatarHash,
      };
      list[index] = updated;
      return updated;
    },
  };
}

async function withServer(
  dependencies: SameSkyDependencies,
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
  test("serves index for root path", async () => {
    await withServer(createDependencies(), createMemoryLocationStore(), async baseUrl => {
      const response = await fetch(new URL("/", baseUrl));
      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).toContain("<div id=\"root\"></div>");
    });
  });

  test("serves index for /with-css path", async () => {
    await withServer(createDependencies(), createMemoryLocationStore(), async baseUrl => {
      const response = await fetch(new URL("/with-css", baseUrl));
      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).toContain("<div id=\"root\"></div>");
    });
  });

  test("serves status route", async () => {
    await withServer(createDependencies(), createMemoryLocationStore(), async baseUrl => {
      const response = await fetch(new URL("/api/status", baseUrl));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        app: "same-sky",
        status: "ok",
        method: "GET",
      });
    });
  });

  test("lookup route returns enriched metadata, supports scope/locality params, and clamps limit", async () => {
    let capturedOptions: { limit?: number; localityOnly?: boolean; scopeBoundingBox?: { south: number; north: number; west: number; east: number } } | null = null;
    const deps = createDependencies();
    deps.geocodeProvider.search = async (query, options) => {
      capturedOptions = options ?? null;
      return [
        makeMatch({
          id: "paris:1",
          name: `${query} result`,
          fullName: "Paris, Ile-de-France, France",
          coords: { lat: 48.8566, long: 2.3522 },
          granularity: "city",
          isLocalityClass: true,
          boundingBox: { south: 48.815, north: 48.902, west: 2.224, east: 2.469 },
          timezonePreview: "Europe/Paris",
        }),
      ];
    };

    await withServer(deps, createMemoryLocationStore(), async baseUrl => {
      const response = await fetch(
        new URL(
          "/api/locations/lookup?q=Paris&limit=999&localityOnly=1&scopeSouth=48.8&scopeNorth=48.9&scopeWest=2.2&scopeEast=2.5",
          baseUrl,
        ),
      );
      expect(response.status).toBe(200);
      expect(capturedOptions).toEqual({
        limit: 10,
        localityOnly: true,
        scopeBoundingBox: {
          south: 48.8,
          north: 48.9,
          west: 2.2,
          east: 2.5,
        },
      });
      expect(await response.json()).toEqual({
        results: [
          {
            id: "paris:1",
            name: "paris result",
            fullName: "Paris, Ile-de-France, France",
            lat: 48.8566,
            long: 2.3522,
            source: "test",
            granularity: "city",
            isLocalityClass: true,
            admin: {
              country: "France",
              region: "Ile-de-France",
              locality: "Paris",
            },
            boundingBox: { south: 48.815, north: 48.902, west: 2.224, east: 2.469 },
            timezonePreview: "Europe/Paris",
          },
        ],
      });
    });
  });

  test("lookup route validates scope and query params", async () => {
    await withServer(createDependencies(), createMemoryLocationStore(), async baseUrl => {
      const emptyQuery = await fetch(new URL("/api/locations/lookup?q=   ", baseUrl));
      expect(emptyQuery.status).toBe(400);
      expect(await emptyQuery.json()).toEqual({
        error: {
          code: "invalid_query",
          message: "Lookup query cannot be empty.",
        },
      });

      const invalidScope = await fetch(new URL("/api/locations/lookup?q=paris&scopeSouth=abc", baseUrl));
      expect(invalidScope.status).toBe(400);
      expect(await invalidScope.json()).toEqual({
        error: {
          code: "invalid_scope",
          message: "scopeSouth, scopeNorth, scopeWest, and scopeEast are required together.",
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

  test("sky route returns stops, rotation, and diagnostics", async () => {
    await withServer(createDependencies(), createMemoryLocationStore(), async baseUrl => {
      const response = await fetch(
        new URL("/api/location/sky-24h?lat=37.7749&long=-122.4194&at=1710000000000", baseUrl),
      );
      expect(response.status).toBe(200);

      const payload = (await response.json()) as {
        result: {
          stops: Array<{ name: string; colorHex: string }>;
          diagnostics: {
            factors: {
              altitude: { value: number };
              turbidity: { value: number };
              humidity: { value: number };
              cloud_fraction: { value: number };
              ozone_factor: { value: number };
              light_pollution: { value: number };
            };
          };
        };
      };

      expect(payload.result.stops).toHaveLength(17);
      expect(payload.result.stops[0]?.name).toBe("local_midnight_start");
      expect(payload.result.stops[0]?.colorHex.startsWith("#")).toBe(true);
      expect(payload.result.diagnostics.factors.altitude.value).toBeGreaterThanOrEqual(0);
      expect(payload.result.diagnostics.factors.light_pollution.value).toBeGreaterThanOrEqual(0);
    });
  });

  test("sky route supports secondOrder=0", async () => {
    await withServer(createDependencies(), createMemoryLocationStore(), async baseUrl => {
      const response = await fetch(
        new URL("/api/location/sky-24h?lat=37.7749&long=-122.4194&at=1710000000000&secondOrder=0", baseUrl),
      );
      expect(response.status).toBe(200);
      const payload = (await response.json()) as {
        result: {
          stops: Array<{ shiftMinutes: number }>;
        };
      };

      for (const stop of payload.result.stops) {
        expect(stop.shiftMinutes).toBe(0);
      }
    });
  });

  test("sky route supports per-factor enabled flags", async () => {
    await withServer(createDependencies(), createMemoryLocationStore(), async baseUrl => {
      const response = await fetch(
        new URL(
          "/api/location/sky-24h?lat=37.7749&long=-122.4194&at=1710000000000&factorEnabled_altitude=0&factorEnabled_cloud_fraction=false",
          baseUrl,
        ),
      );
      expect(response.status).toBe(200);
      const payload = (await response.json()) as {
        result: {
          stops: Array<{ factors: { altitude: number; cloud_fraction: number } }>;
          diagnostics: {
            factors: {
              altitude: { value: number; source: string };
              cloud_fraction: { value: number; source: string };
            };
          };
        };
      };

      expect(payload.result.diagnostics.factors.altitude.source).toBe("override");
      expect(payload.result.diagnostics.factors.altitude.value).toBe(0);
      expect(payload.result.diagnostics.factors.cloud_fraction.source).toBe("override");
      expect(payload.result.diagnostics.factors.cloud_fraction.value).toBe(0);
      expect(payload.result.stops[0]?.factors.altitude).toBe(0);
      expect(payload.result.stops[0]?.factors.cloud_fraction).toBe(0);
    });
  });

  test("sky route validates coordinates", async () => {
    await withServer(createDependencies(), createMemoryLocationStore(), async baseUrl => {
      const response = await fetch(new URL("/api/location/sky-24h?lat=999&long=0", baseUrl));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: {
          code: "invalid_coordinates",
          message: "Coordinates must include lat in [-90, 90] and long in [-180, 180].",
        },
      });
    });
  });

  test("sky route validates secondOrder flag", async () => {
    await withServer(createDependencies(), createMemoryLocationStore(), async baseUrl => {
      const response = await fetch(new URL("/api/location/sky-24h?lat=37.7749&long=-122.4194&secondOrder=maybe", baseUrl));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: {
          code: "invalid_second_order",
          message: "secondOrder must be one of: 1, 0, true, false.",
        },
      });
    });
  });

  test("sky route validates per-factor enabled flags", async () => {
    await withServer(createDependencies(), createMemoryLocationStore(), async baseUrl => {
      const response = await fetch(new URL("/api/location/sky-24h?lat=37.7749&long=-122.4194&factorEnabled_humidity=maybe", baseUrl));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: {
          code: "invalid_factor_enabled",
          message: "factorEnabled_humidity must be one of: 1, 0, true, false.",
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

  test("persists a location via API with timezone/granularity", async () => {
    await withServer(createDependencies(), createMemoryLocationStore(), async baseUrl => {
      const response = await fetch(new URL("/api/locations/persisted", baseUrl), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Paris, Ile-de-France, France",
          lat: 48.8566,
          long: 2.3522,
          nickname: "Trip",
          timezone: "Europe/Paris",
          granularity: "city",
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
          timezone: "Europe/Paris",
          granularity: "city",
          kind: "location",
          createdAtMs: 1_700_000_000_000,
        },
      });
    });
  });

  test("persists with timezone fallback when timezone omitted", async () => {
    let timezoneResolveCount = 0;
    const deps = createDependencies();
    deps.timezoneProvider.resolve = async () => {
      timezoneResolveCount += 1;
      return {
        timezone: "America/Los_Angeles",
        offsetSeconds: -28_800,
      };
    };

    await withServer(deps, createMemoryLocationStore(), async baseUrl => {
      const response = await fetch(new URL("/api/locations/persisted", baseUrl), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "San Francisco, California, United States",
          lat: 37.7749,
          long: -122.4194,
        }),
      });

      expect(response.status).toBe(201);
      expect(timezoneResolveCount).toBe(1);
      expect(await response.json()).toEqual({
        result: {
          id: "saved-1",
          name: "San Francisco, California, United States",
          lat: 37.7749,
          long: -122.4194,
          timezone: "America/Los_Angeles",
          kind: "location",
          createdAtMs: 1_700_000_000_000,
        },
      });
    });
  });

  test("persists entity records and stores gravatar hash only", async () => {
    await withServer(createDependencies(), createMemoryLocationStore(), async baseUrl => {
      const response = await fetch(new URL("/api/locations/persisted", baseUrl), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Tokyo, Tokyo, Japan",
          lat: 35.6762,
          long: 139.6503,
          kind: "entity",
          entityName: "Alice",
          gravatarEmail: "User@example.com",
        }),
      });

      expect(response.status).toBe(201);
      expect(await response.json()).toEqual({
        result: {
          id: "saved-1",
          name: "Tokyo, Tokyo, Japan",
          lat: 35.6762,
          long: 139.6503,
          timezone: "America/Los_Angeles",
          kind: "entity",
          entityName: "Alice",
          gravatarHash: "b58996c504c5638798eb6b511e6f49af",
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

      const duplicateWithoutNickname = await fetch(new URL("/api/locations/persisted", baseUrl), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Paris, Ile-de-France, France",
          lat: 48.8566,
          long: 2.3522,
        }),
      });
      expect(duplicateWithoutNickname.status).toBe(201);

      const duplicateSecondWithoutNickname = await fetch(new URL("/api/locations/persisted", baseUrl), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Paris, Ile-de-France, France",
          lat: 48.85661,
          long: 2.35219,
        }),
      });
      expect(duplicateSecondWithoutNickname.status).toBe(400);
      expect(await duplicateSecondWithoutNickname.json()).toEqual({
        error: {
          code: "duplicate_requires_nickname",
          message: "A nickname is required when saving another item for the same place.",
        },
      });
    });
  });

  test("patches persisted location nickname", async () => {
    const store = createMemoryLocationStore([
      {
        id: "saved-a",
        name: "Tokyo, Tokyo, Japan",
        coords: { lat: 35.6762, long: 139.6503 },
        nickname: "Work",
        timezone: "Asia/Tokyo",
        granularity: "city",
        kind: "location",
        createdAtMs: 1_700_000_000_010,
      },
    ]);

    await withServer(createDependencies(), store, async baseUrl => {
      const response = await fetch(new URL("/api/locations/persisted/saved-a", baseUrl), {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          nickname: "Team Tokyo",
        }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        result: {
          id: "saved-a",
          name: "Tokyo, Tokyo, Japan",
          lat: 35.6762,
          long: 139.6503,
          nickname: "Team Tokyo",
          timezone: "Asia/Tokyo",
          granularity: "city",
          kind: "location",
          createdAtMs: 1_700_000_000_010,
        },
      });
    });
  });

  test("lists and removes persisted locations via API and includes timezone metadata", async () => {
    const store = createMemoryLocationStore([
      {
        id: "saved-a",
        name: "Tokyo, Tokyo, Japan",
        coords: { lat: 35.6762, long: 139.6503 },
        nickname: "Work",
        timezone: "Asia/Tokyo",
        granularity: "city",
        createdAtMs: 1_700_000_000_010,
      },
      {
        id: "saved-b",
        name: "London, England, United Kingdom",
        coords: { lat: 51.5072, long: -0.1276 },
        timezone: "Europe/London",
        granularity: "city",
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
            timezone: "Asia/Tokyo",
            granularity: "city",
            adminState: "Ile-de-France",
            adminCity: "Paris",
            kind: "location",
            createdAtMs: 1_700_000_000_010,
          },
          {
            id: "saved-b",
            name: "London, England, United Kingdom",
            lat: 51.5072,
            long: -0.1276,
            timezone: "Europe/London",
            granularity: "city",
            adminState: "Ile-de-France",
            adminCity: "Paris",
            kind: "location",
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
          timezone: "Asia/Tokyo",
          granularity: "city",
          adminState: "Ile-de-France",
          adminCity: "Paris",
          kind: "location",
          createdAtMs: 1_700_000_000_010,
        },
      });
    });
  });

  test("exposes a read-only persisted-location JSON debug endpoint", async () => {
    const store = createMemoryLocationStore([
      {
        id: "saved-a",
        name: "Tokyo, Tokyo, Japan",
        coords: { lat: 35.6762, long: 139.6503 },
        nickname: "Work",
        timezone: "Asia/Tokyo",
        granularity: "city",
        createdAtMs: 1_700_000_000_010,
      },
    ]);

    await withServer(createDependencies(), store, async baseUrl => {
      const response = await fetch(new URL("/api/locations/persisted/debug-json", baseUrl));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        version: 2,
        storage: "sqlite",
        locations: [
          {
            id: "saved-a",
            name: "Tokyo, Tokyo, Japan",
            coords: { lat: 35.6762, long: 139.6503 },
            nickname: "Work",
            timezone: "Asia/Tokyo",
            granularity: "city",
            createdAtMs: 1_700_000_000_010,
          },
        ],
      });
    });
  });

  test("backfills timezone on list when legacy entries are missing timezone", async () => {
    let timezoneResolveCount = 0;
    const deps = createDependencies();
    deps.timezoneProvider.resolve = async () => {
      timezoneResolveCount += 1;
      return {
        timezone: "America/New_York",
        offsetSeconds: -18_000,
      };
    };

    const store = createMemoryLocationStore([
      {
        id: "saved-a",
        name: "Legacy Entry",
        coords: { lat: 40.7128, long: -74.006 },
        createdAtMs: 1_700_000_000_000,
      },
    ]);

    await withServer(deps, store, async baseUrl => {
      const listed = await fetch(new URL("/api/locations/persisted", baseUrl));
      expect(listed.status).toBe(200);
      expect(timezoneResolveCount).toBe(1);
      expect(await listed.json()).toEqual({
        results: [
          {
            id: "saved-a",
            name: "Legacy Entry",
            lat: 40.7128,
            long: -74.006,
            timezone: "America/New_York",
            granularity: "city",
            adminState: "Ile-de-France",
            adminCity: "Paris",
            kind: "location",
            createdAtMs: 1_700_000_000_000,
          },
        ],
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
