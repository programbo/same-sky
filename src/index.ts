import { serve } from "bun";
import index from "./index.html";
import type { TimeInPlaceDependencies } from "./lib/time-in-place";
import { createTimeInPlaceService, TimeInPlaceError, ValidationError, validateCoordinates } from "./lib/time-in-place";
import { parseLocationGranularity, type BoundingBox, type Coordinates, type LocationGranularity } from "./lib/time-in-place";
import { PersistedLocationStore } from "./lib/time-in-place";
import type { PersistLocationInput, PersistedLocation, PersistedLocationStoreLike } from "./lib/time-in-place";

interface CreateServerOptions {
  port?: number;
  dependencies?: Partial<TimeInPlaceDependencies>;
  locationStore?: PersistedLocationStoreLike;
}

function errorResponse(error: unknown): Response {
  if (error instanceof TimeInPlaceError) {
    return Response.json(
      {
        error: {
          code: error.code,
          message: error.message,
        },
      },
      { status: error.status },
    );
  }

  console.error(error);
  return Response.json(
    {
      error: {
        code: "internal_error",
        message: "Unexpected server error.",
      },
    },
    { status: 500 },
  );
}

function parseOptionalCoordinates(params: URLSearchParams): Coordinates | undefined {
  const latRaw = params.get("lat");
  const longRaw = params.get("long");

  if (latRaw === null && longRaw === null) {
    return undefined;
  }

  if (latRaw === null || longRaw === null) {
    throw new ValidationError("invalid_coordinates", "Both lat and long are required when providing coordinates.");
  }

  const lat = Number(latRaw);
  const long = Number(longRaw);

  if (!Number.isFinite(lat) || !Number.isFinite(long)) {
    throw new ValidationError("invalid_coordinates", "Coordinates must be valid numbers.");
  }

  return { lat, long };
}

function parseRequiredCoordinates(params: URLSearchParams): Coordinates {
  const coords = parseOptionalCoordinates(params);

  if (!coords) {
    throw new ValidationError("invalid_coordinates", "lat and long query parameters are required.");
  }

  return coords;
}

function parseLookupLimit(params: URLSearchParams): number | undefined {
  const limitRaw = params.get("limit");
  if (limitRaw === null) {
    return undefined;
  }

  const limit = Number(limitRaw);
  if (!Number.isFinite(limit)) {
    throw new ValidationError("invalid_limit", "limit must be a finite number.");
  }

  return limit;
}

function parseOptionalScopeBoundingBox(params: URLSearchParams): BoundingBox | undefined {
  const southRaw = params.get("scopeSouth");
  const northRaw = params.get("scopeNorth");
  const westRaw = params.get("scopeWest");
  const eastRaw = params.get("scopeEast");

  if (southRaw === null && northRaw === null && westRaw === null && eastRaw === null) {
    return undefined;
  }

  if (southRaw === null || northRaw === null || westRaw === null || eastRaw === null) {
    throw new ValidationError(
      "invalid_scope",
      "scopeSouth, scopeNorth, scopeWest, and scopeEast are required together.",
    );
  }

  const south = Number(southRaw);
  const north = Number(northRaw);
  const west = Number(westRaw);
  const east = Number(eastRaw);

  if (![south, north, west, east].every(Number.isFinite)) {
    throw new ValidationError("invalid_scope", "Scope bounds must be finite numbers.");
  }

  if (south < -90 || south > 90 || north < -90 || north > 90) {
    throw new ValidationError("invalid_scope", "Scope latitude bounds must be within [-90, 90].");
  }

  if (west < -180 || west > 180 || east < -180 || east > 180) {
    throw new ValidationError("invalid_scope", "Scope longitude bounds must be within [-180, 180].");
  }

  if (south > north) {
    throw new ValidationError("invalid_scope", "scopeSouth must be <= scopeNorth.");
  }

  if (west > east) {
    throw new ValidationError("invalid_scope", "scopeWest must be <= scopeEast.");
  }

  return { south, north, west, east };
}

function parseLookupLocalityOnly(params: URLSearchParams): boolean | undefined {
  const raw = params.get("localityOnly");
  if (raw === null) {
    return undefined;
  }

  const normalized = raw.trim().toLowerCase();
  if (normalized === "1" || normalized === "true") {
    return true;
  }

  if (normalized === "0" || normalized === "false") {
    return false;
  }

  throw new ValidationError("invalid_locality_only", "localityOnly must be one of: 1, 0, true, false.");
}

function parseOptionalTimestamp(params: URLSearchParams): number | undefined {
  const atRaw = params.get("at");
  if (atRaw === null) {
    return undefined;
  }

  const at = Number(atRaw);
  if (!Number.isFinite(at)) {
    throw new ValidationError("invalid_timestamp", "at must be a Unix epoch value in milliseconds.");
  }

  return at;
}

function parseSecondOrderEnabled(params: URLSearchParams): boolean {
  const raw = params.get("secondOrder");
  if (raw === null) {
    return true;
  }

  const normalized = raw.trim().toLowerCase();
  if (normalized === "1" || normalized === "true") {
    return true;
  }

  if (normalized === "0" || normalized === "false") {
    return false;
  }

  throw new ValidationError("invalid_second_order", "secondOrder must be one of: 1, 0, true, false.");
}

function parsePersistLocationInput(payload: unknown): PersistLocationInput {
  if (!payload || typeof payload !== "object") {
    throw new ValidationError("invalid_payload", "JSON body is required.");
  }

  const record = payload as Record<string, unknown>;
  const name = record.name;
  const lat = record.lat;
  const long = record.long;
  const nickname = record.nickname;
  const timezone = record.timezone;
  const granularity = record.granularity;

  if (typeof name !== "string" || !name.trim()) {
    throw new ValidationError("invalid_name", "name is required and must be a non-empty string.");
  }

  if (typeof lat !== "number" || !Number.isFinite(lat) || typeof long !== "number" || !Number.isFinite(long)) {
    throw new ValidationError("invalid_coordinates", "lat and long are required as finite numbers.");
  }

  if (nickname !== undefined && typeof nickname !== "string") {
    throw new ValidationError("invalid_nickname", "nickname must be a string when provided.");
  }

  if (timezone !== undefined && (typeof timezone !== "string" || !timezone.trim())) {
    throw new ValidationError("invalid_timezone", "timezone must be a non-empty string when provided.");
  }

  let parsedGranularity: LocationGranularity | undefined;
  if (granularity !== undefined) {
    if (typeof granularity !== "string") {
      throw new ValidationError("invalid_granularity", "granularity must be a string when provided.");
    }

    parsedGranularity = parseLocationGranularity(granularity);
  }

  const coords = { lat, long };
  validateCoordinates(coords);

  return {
    name: name.trim(),
    coords,
    nickname,
    timezone: timezone?.trim(),
    granularity: parsedGranularity,
  };
}

async function parseJsonBody(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new ValidationError("invalid_json", "Request body must be valid JSON.");
  }
}

function toPersistedResponse(location: PersistedLocation): {
  id: string;
  name: string;
  lat: number;
  long: number;
  nickname?: string;
  timezone?: string;
  granularity?: LocationGranularity;
  createdAtMs: number;
} {
  return {
    id: location.id,
    name: location.name,
    lat: location.coords.lat,
    long: location.coords.long,
    nickname: location.nickname,
    timezone: location.timezone,
    granularity: location.granularity,
    createdAtMs: location.createdAtMs,
  };
}

async function hydratePersistedLocation(
  location: PersistedLocation,
  service: ReturnType<typeof createTimeInPlaceService>,
  locationStore: PersistedLocationStoreLike,
): Promise<PersistedLocation> {
  if (location.timezone) {
    return location;
  }

  const resolved = await service.getTimeForLocation(location.coords);
  const updated = await locationStore.update(location.id, { timezone: resolved.timezone });
  if (updated) {
    return updated;
  }

  return {
    ...location,
    timezone: resolved.timezone,
  };
}

export function createServer(options: CreateServerOptions = {}) {
  const service = createTimeInPlaceService(options.dependencies);
  const locationStore = options.locationStore ?? new PersistedLocationStore();

  return serve({
    port: options.port,
    routes: {
      // Serve index.html for all unmatched routes.
      "/*": index,

      "/api/hello": {
        async GET() {
          return Response.json({
            message: "Hello, world!",
            method: "GET",
          });
        },
        async PUT() {
          return Response.json({
            message: "Hello, world!",
            method: "PUT",
          });
        },
      },

      "/api/hello/:name": async req => {
        const name = req.params.name;
        return Response.json({
          message: `Hello, ${name}!`,
        });
      },

      "/api/locations/lookup": async req => {
        try {
          const url = new URL(req.url);
          const query = url.searchParams.get("q") ?? "";
          const limit = parseLookupLimit(url.searchParams);
          const scopeBoundingBox = parseOptionalScopeBoundingBox(url.searchParams);
          const localityOnly = parseLookupLocalityOnly(url.searchParams);
          const results = await service.lookupLocations(query, {
            limit,
            scopeBoundingBox,
            localityOnly,
          });

          return Response.json({
            results: results.map(result => ({
              id: result.id,
              name: result.name,
              fullName: result.fullName,
              lat: result.coords.lat,
              long: result.coords.long,
              source: result.source,
              granularity: result.granularity,
              isLocalityClass: result.isLocalityClass,
              admin: result.admin,
              boundingBox: result.boundingBox,
              timezonePreview: result.timezonePreview,
            })),
          });
        } catch (error) {
          return errorResponse(error);
        }
      },

      "/api/location/current": async req => {
        try {
          const url = new URL(req.url);
          const browserCoords = parseOptionalCoordinates(url.searchParams);
          const result = await service.getCurrentLocation(browserCoords ? { browserCoords } : undefined);

          return Response.json({
            result: {
              name: result.name,
              lat: result.coords.lat,
              long: result.coords.long,
              source: result.source,
            },
          });
        } catch (error) {
          return errorResponse(error);
        }
      },

      "/api/location/time": async req => {
        try {
          const url = new URL(req.url);
          const coords = parseRequiredCoordinates(url.searchParams);
          const atMs = parseOptionalTimestamp(url.searchParams);
          const result = await service.getTimeForLocation(coords, atMs);

          return Response.json({ result });
        } catch (error) {
          return errorResponse(error);
        }
      },

      "/api/location/sky-24h": async req => {
        try {
          const url = new URL(req.url);
          const coords = parseRequiredCoordinates(url.searchParams);
          const atMs = parseOptionalTimestamp(url.searchParams);
          const applySecondOrder = parseSecondOrderEnabled(url.searchParams);
          const result = await service.getSkyColorForLocation(coords, {
            atMs,
            applySecondOrder,
          });

          return Response.json({ result });
        } catch (error) {
          return errorResponse(error);
        }
      },

      "/api/locations/persisted": {
        async GET() {
          try {
            const listed = await locationStore.list();
            const results = await Promise.all(
              listed.map(location => hydratePersistedLocation(location, service, locationStore)),
            );
            return Response.json({
              results: results.map(toPersistedResponse),
            });
          } catch (error) {
            return errorResponse(error);
          }
        },

        async POST(req) {
          try {
            const payload = await parseJsonBody(req);
            const input = parsePersistLocationInput(payload);
            const timezone = input.timezone ?? (await service.getTimeForLocation(input.coords)).timezone;
            const result = await locationStore.add({
              ...input,
              timezone,
            });
            return Response.json({ result: toPersistedResponse(result) }, { status: 201 });
          } catch (error) {
            return errorResponse(error);
          }
        },
      },

      "/api/locations/persisted/:id": {
        async DELETE(req) {
          try {
            const id = req.params.id;
            const removed = await locationStore.remove(id);
            if (!removed) {
              return Response.json(
                {
                  error: {
                    code: "persisted_location_not_found",
                    message: `No persisted location found for id: ${id}`,
                  },
                },
                { status: 404 },
              );
            }

            const normalized = removed.timezone
              ? removed
              : {
                  ...removed,
                  timezone: (await service.getTimeForLocation(removed.coords)).timezone,
                };

            return Response.json({ result: toPersistedResponse(normalized) });
          } catch (error) {
            return errorResponse(error);
          }
        },
      },
    },

    development: process.env.NODE_ENV !== "production" && {
      hmr: true,
      console: true,
    },
  });
}

if (import.meta.main) {
  const server = createServer();
  console.log(`Server running at ${server.url}`);
}
