import { serve } from "bun";
import { createHash } from "node:crypto";
import index from "./index.html";
import type { SameSkyDependencies } from "./lib/same-sky";
import { createSameSkyService, SKY_FACTOR_NAMES, SameSkyError, ValidationError, validateCoordinates } from "./lib/same-sky";
import { parseLocationGranularity, type BoundingBox, type Coordinates, type LocationGranularity } from "./lib/same-sky";
import { PERSISTED_AVATAR_SOURCES, PERSISTED_LOCATION_KINDS, type PersistedAvatarSource, type PersistedLocationKind } from "./lib/same-sky";
import { PersistedLocationStore } from "./lib/same-sky";
import type { PersistLocationInput, PersistLocationPatch, PersistedLocation, PersistedLocationStoreLike, SkySecondOrderFactors } from "./lib/same-sky";

interface CreateServerOptions {
  port?: number;
  dependencies?: Partial<SameSkyDependencies>;
  locationStore?: PersistedLocationStoreLike;
}

function errorResponse(error: unknown): Response {
  if (error instanceof SameSkyError) {
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

function parseFactorEnableOverrides(params: URLSearchParams): Partial<SkySecondOrderFactors> | undefined {
  const overrides: Partial<SkySecondOrderFactors> = {};

  for (const factorName of SKY_FACTOR_NAMES) {
    const paramName = `factorEnabled_${factorName}`;
    const raw = params.get(paramName);
    if (raw === null) {
      continue;
    }

    const normalized = raw.trim().toLowerCase();
    if (normalized === "1" || normalized === "true") {
      continue;
    }

    if (normalized === "0" || normalized === "false") {
      overrides[factorName] = 0;
      continue;
    }

    throw new ValidationError("invalid_factor_enabled", `${paramName} must be one of: 1, 0, true, false.`);
  }

  return Object.keys(overrides).length > 0 ? overrides : undefined;
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
  const kind = record.kind;
  const entityName = record.entityName;
  const countryCode = record.countryCode;
  const adminState = record.adminState;
  const adminCity = record.adminCity;
  const adminSuburb = record.adminSuburb;
  const avatarSource = record.avatarSource;
  const avatarImageUrl = record.avatarImageUrl;
  const gravatarHash = record.gravatarHash;
  const gravatarEmail = record.gravatarEmail;

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

  let parsedKind: PersistedLocationKind | undefined;
  if (kind !== undefined) {
    if (typeof kind !== "string") {
      throw new ValidationError("invalid_kind", "kind must be a string when provided.");
    }

    const normalized = kind.trim().toLowerCase();
    if (!PERSISTED_LOCATION_KINDS.includes(normalized as PersistedLocationKind)) {
      throw new ValidationError("invalid_kind", `kind must be one of: ${PERSISTED_LOCATION_KINDS.join(", ")}.`);
    }

    parsedKind = normalized as PersistedLocationKind;
  }

  if (entityName !== undefined && typeof entityName !== "string") {
    throw new ValidationError("invalid_entity_name", "entityName must be a string when provided.");
  }
  if (countryCode !== undefined && typeof countryCode !== "string") {
    throw new ValidationError("invalid_country_code", "countryCode must be a string when provided.");
  }
  if (adminState !== undefined && typeof adminState !== "string") {
    throw new ValidationError("invalid_admin_state", "adminState must be a string when provided.");
  }
  if (adminCity !== undefined && typeof adminCity !== "string") {
    throw new ValidationError("invalid_admin_city", "adminCity must be a string when provided.");
  }
  if (adminSuburb !== undefined && typeof adminSuburb !== "string") {
    throw new ValidationError("invalid_admin_suburb", "adminSuburb must be a string when provided.");
  }

  let parsedAvatarSource: PersistedAvatarSource | undefined;
  if (avatarSource !== undefined) {
    if (typeof avatarSource !== "string") {
      throw new ValidationError("invalid_avatar_source", "avatarSource must be a string when provided.");
    }

    const normalized = avatarSource.trim().toLowerCase();
    if (!PERSISTED_AVATAR_SOURCES.includes(normalized as PersistedAvatarSource)) {
      throw new ValidationError(
        "invalid_avatar_source",
        `avatarSource must be one of: ${PERSISTED_AVATAR_SOURCES.join(", ")}.`,
      );
    }

    parsedAvatarSource = normalized as PersistedAvatarSource;
  }

  if (avatarImageUrl !== undefined && typeof avatarImageUrl !== "string") {
    throw new ValidationError("invalid_avatar_image_url", "avatarImageUrl must be a string when provided.");
  }
  if (gravatarHash !== undefined && typeof gravatarHash !== "string") {
    throw new ValidationError("invalid_gravatar_hash", "gravatarHash must be a string when provided.");
  }
  if (gravatarEmail !== undefined && typeof gravatarEmail !== "string") {
    throw new ValidationError("invalid_gravatar_email", "gravatarEmail must be a string when provided.");
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

  const normalizeOptionalString = (value: unknown): string | undefined => {
    if (typeof value !== "string") {
      return undefined;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  };

  const rawHash = normalizeOptionalString(gravatarHash);
  const computedHashFromEmail = normalizeOptionalString(gravatarEmail);
  const normalizedGravatarHash = rawHash
    ? rawHash.toLowerCase()
      : computedHashFromEmail
        ? createHash("md5").update(computedHashFromEmail.toLowerCase(), "utf8").digest("hex")
        : undefined;
  const normalizedEntityName = normalizeOptionalString(entityName);

  if (parsedKind === "entity" && !normalizedEntityName) {
    throw new ValidationError("invalid_entity_name", "entityName is required when kind is entity.");
  }

  return {
    name: name.trim(),
    coords,
    nickname,
    timezone: timezone?.trim(),
    granularity: parsedGranularity,
    kind: parsedKind,
    entityName: normalizedEntityName,
    countryCode: normalizeOptionalString(countryCode)?.toUpperCase(),
    adminState: normalizeOptionalString(adminState),
    adminCity: normalizeOptionalString(adminCity),
    adminSuburb: normalizeOptionalString(adminSuburb),
    avatarSource: parsedAvatarSource,
    avatarImageUrl: normalizeOptionalString(avatarImageUrl),
    gravatarHash: normalizedGravatarHash,
  };
}

function parsePersistLocationPatch(payload: unknown): PersistLocationPatch {
  if (!payload || typeof payload !== "object") {
    throw new ValidationError("invalid_payload", "JSON body is required.");
  }

  const record = payload as Record<string, unknown>;
  const patch: PersistLocationPatch = {};

  const nickname = record.nickname;
  if (nickname !== undefined) {
    if (typeof nickname !== "string") {
      throw new ValidationError("invalid_nickname", "nickname must be a string when provided.");
    }

    patch.nickname = nickname;
  }

  if (Object.keys(patch).length === 0) {
    throw new ValidationError("invalid_payload", "At least one editable field must be provided.");
  }

  return patch;
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
  kind: PersistedLocationKind;
  entityName?: string;
  countryCode?: string;
  adminState?: string;
  adminCity?: string;
  adminSuburb?: string;
  avatarSource?: PersistedAvatarSource;
  avatarImageUrl?: string;
  gravatarHash?: string;
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
    kind: location.kind ?? "location",
    entityName: location.entityName,
    countryCode: location.countryCode,
    adminState: location.adminState,
    adminCity: location.adminCity,
    adminSuburb: location.adminSuburb,
    avatarSource: location.avatarSource,
    avatarImageUrl: location.avatarImageUrl,
    gravatarHash: location.gravatarHash,
    createdAtMs: location.createdAtMs,
  };
}

async function hydratePersistedLocation(
  location: PersistedLocation,
  service: ReturnType<typeof createSameSkyService>,
  locationStore: PersistedLocationStoreLike,
): Promise<PersistedLocation> {
  const needsTimezone = !location.timezone;
  const needsAdminMetadata = !location.countryCode || !location.adminCity || !location.adminState;
  if (!needsTimezone && !needsAdminMetadata) {
    return location;
  }

  const patch: PersistLocationPatch = {};
  if (needsTimezone) {
    const resolved = await service.getTimeForLocation(location.coords);
    patch.timezone = resolved.timezone;
  }

  if (needsAdminMetadata) {
    try {
      const results = await service.lookupLocations(location.name, {
        limit: 1,
        includeTimezonePreview: false,
      });
      const first = results[0];
      if (first) {
        patch.countryCode = first.admin.countryCode;
        patch.adminState = first.admin.state ?? first.admin.region;
        patch.adminCity = first.admin.city ?? first.admin.locality;
        patch.adminSuburb = first.admin.suburb;
        patch.granularity = location.granularity ?? first.granularity;
      }
    } catch {
      // Backfill is best-effort; keep serving location data if enrichment fails.
    }
  }

  if (Object.keys(patch).length === 0) {
    return location;
  }

  const updated = await locationStore.update(location.id, patch);
  if (updated) {
    return updated;
  }

  return {
    ...location,
    ...patch,
    kind: location.kind ?? "location",
  };
}

function roundCoord(value: number): number {
  return Number(value.toFixed(4));
}

function hasDuplicateWithoutNickname(
  input: PersistLocationInput,
  existing: PersistedLocation[],
): boolean {
  const hasNickname = Boolean(input.nickname?.trim().length);
  if (hasNickname) {
    return false;
  }

  const lat = roundCoord(input.coords.lat);
  const long = roundCoord(input.coords.long);
  return existing.some(location => roundCoord(location.coords.lat) === lat && roundCoord(location.coords.long) === long);
}

function schedulePersistedLocationBackfill(
  service: ReturnType<typeof createSameSkyService>,
  locationStore: PersistedLocationStoreLike,
): void {
  setTimeout(() => {
    void (async () => {
      try {
        const listed = await locationStore.list();
        for (const location of listed) {
          await hydratePersistedLocation(location, service, locationStore);
        }
      } catch (error) {
        console.warn("Persisted-location metadata backfill failed.", error);
      }
    })();
  }, 0);
}

export function createServer(options: CreateServerOptions = {}) {
  const service = createSameSkyService(options.dependencies);
  const locationStore = options.locationStore ?? new PersistedLocationStore();
  if (!options.locationStore) {
    schedulePersistedLocationBackfill(service, locationStore);
  }

  return serve({
    port: options.port,
    routes: {
      "/": index,
      "/ring-renderer": index,

      // Serve index.html for other unmatched frontend routes (deep links).
      "/*": index,

      "/api/status": {
        async GET() {
          return Response.json({
            app: "same-sky",
            status: "ok",
            method: "GET",
          });
        },
        async PUT() {
          return Response.json({
            app: "same-sky",
            status: "ok",
            method: "PUT",
          });
        },
      },

      "/api/status/:name": async req => {
        const name = req.params.name;
        return Response.json({
          message: `Same Sky says hello to ${name}.`,
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
          const factorOverrides = parseFactorEnableOverrides(url.searchParams);
          const result = await service.getSkyColorForLocation(coords, {
            atMs,
            applySecondOrder,
            factorOverrides,
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
            const existing = await locationStore.list();
            if (hasDuplicateWithoutNickname(input, existing)) {
              throw new ValidationError(
                "duplicate_requires_nickname",
                "A nickname is required when saving another item for the same place.",
              );
            }
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

      "/api/locations/persisted/debug-json": {
        async GET() {
          try {
            const locations = await locationStore.list();
            return Response.json({
              version: 2,
              storage: "sqlite",
              locations,
            });
          } catch (error) {
            return errorResponse(error);
          }
        },
      },

      "/api/locations/persisted/:id": {
        async PATCH(req) {
          try {
            const id = req.params.id;
            const payload = await parseJsonBody(req);
            const patch = parsePersistLocationPatch(payload);
            const updated = await locationStore.update(id, patch);
            if (!updated) {
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

            return Response.json({ result: toPersistedResponse(updated) });
          } catch (error) {
            return errorResponse(error);
          }
        },

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
