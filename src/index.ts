import { serve } from "bun";
import index from "./index.html";
import type { TimeInPlaceDependencies } from "./lib/time-in-place";
import { createTimeInPlaceService, TimeInPlaceError, ValidationError, validateCoordinates } from "./lib/time-in-place";
import type { Coordinates } from "./lib/time-in-place";
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

function parsePersistLocationInput(payload: unknown): PersistLocationInput {
  if (!payload || typeof payload !== "object") {
    throw new ValidationError("invalid_payload", "JSON body is required.");
  }

  const record = payload as Record<string, unknown>;
  const name = record.name;
  const lat = record.lat;
  const long = record.long;
  const nickname = record.nickname;

  if (typeof name !== "string" || !name.trim()) {
    throw new ValidationError("invalid_name", "name is required and must be a non-empty string.");
  }

  if (typeof lat !== "number" || !Number.isFinite(lat) || typeof long !== "number" || !Number.isFinite(long)) {
    throw new ValidationError("invalid_coordinates", "lat and long are required as finite numbers.");
  }

  if (nickname !== undefined && typeof nickname !== "string") {
    throw new ValidationError("invalid_nickname", "nickname must be a string when provided.");
  }

  const coords = { lat, long };
  validateCoordinates(coords);

  return {
    name: name.trim(),
    coords,
    nickname,
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
  createdAtMs: number;
} {
  return {
    id: location.id,
    name: location.name,
    lat: location.coords.lat,
    long: location.coords.long,
    nickname: location.nickname,
    createdAtMs: location.createdAtMs,
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
          const results = await service.lookupLocations(query, { limit });

          return Response.json({
            results: results.map(result => ({
              name: result.name,
              lat: result.coords.lat,
              long: result.coords.long,
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

      "/api/locations/persisted": {
        async GET() {
          try {
            const results = await locationStore.list();
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
            const result = await locationStore.add(input);
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

            return Response.json({ result: toPersistedResponse(removed) });
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
