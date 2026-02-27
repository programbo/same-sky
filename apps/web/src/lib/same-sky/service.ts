import { normalizeCacheToken } from "./cache";
import type { CurrentLocationOptions, LookupOptions, SameSkyDependencies } from "./contracts";
import { angleForTimeOffset } from "./math";
import { createDefaultDependencies } from "./providers";
import { computeSky24h } from "./sky";
import type {
  AngleUnit,
  Coordinates,
  CurrentLocationResult,
  LocationMatch,
  LocationTime,
  Sky24hResult,
  SkyColorStop,
  SkyComputationOptions,
  SkyEnvironment,
  SkyFactorName,
  SkySecondOrderFactors,
} from "./types";

const DEFAULT_LOOKUP_LIMIT = 5;
const MAX_LOOKUP_LIMIT = 10;
const DEFAULT_TIMEZONE_PREVIEW_LIMIT = 5;
const DEFAULT_SKY_FACTOR_CONFIDENCE = 0.4;
const BASELINE_SKY_FACTORS: SkySecondOrderFactors = {
  altitude: 0,
  turbidity: 0.5,
  humidity: 0.5,
  cloud_fraction: 0.3,
  ozone_factor: 0.5,
  light_pollution: 0.5,
};

function createFallbackSkyEnvironment(timezone: string, atMs: number): SkyEnvironment {
  const factorEntries = Object.entries(BASELINE_SKY_FACTORS) as Array<[SkyFactorName, number]>;
  const factors = Object.fromEntries(
    factorEntries.map(([name, value]) => [
      name,
      {
        value,
        source: "fallback",
        confidence: DEFAULT_SKY_FACTOR_CONFIDENCE,
      },
    ]),
  ) as SkyEnvironment["diagnostics"]["factors"];

  return {
    timezone,
    samples: [
      {
        timestampMs: atMs,
        factors: { ...BASELINE_SKY_FACTORS },
      },
    ],
    diagnostics: {
      factors,
      providerQuality: "fallback",
      degraded: true,
      fallbackReasons: ["second_order_disabled"],
    },
  };
}

export class SameSkyError extends Error {
  public readonly code: string;
  public readonly status: number;

  constructor(code: string, status: number, message: string, cause?: unknown) {
    super(message);
    this.name = "SameSkyError";
    this.code = code;
    this.status = status;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

export class ValidationError extends SameSkyError {
  constructor(code: string, message: string) {
    super(code, 400, message);
    this.name = "ValidationError";
  }
}

export class UpstreamError extends SameSkyError {
  constructor(code: string, message: string, cause?: unknown) {
    super(code, 502, message, cause);
    this.name = "UpstreamError";
  }
}

export function normalizeLookupQuery(query: string): string {
  return normalizeCacheToken(query);
}

export function validateCoordinates(coords: Coordinates): void {
  if (
    !Number.isFinite(coords.lat) ||
    !Number.isFinite(coords.long) ||
    coords.lat < -90 ||
    coords.lat > 90 ||
    coords.long < -180 ||
    coords.long > 180
  ) {
    throw new ValidationError("invalid_coordinates", "Coordinates must include lat in [-90, 90] and long in [-180, 180].");
  }
}

function parseLookupLimit(limit?: number): number {
  if (limit === undefined) {
    return DEFAULT_LOOKUP_LIMIT;
  }

  if (!Number.isFinite(limit)) {
    throw new ValidationError("invalid_limit", "Limit must be a finite number.");
  }

  const integer = Math.trunc(limit);
  return Math.max(1, Math.min(MAX_LOOKUP_LIMIT, integer));
}

function parseTimestamp(atMs: number): number {
  if (!Number.isFinite(atMs)) {
    throw new ValidationError("invalid_timestamp", "Timestamp must be a finite Unix epoch value in milliseconds.");
  }

  return Math.trunc(atMs);
}

function fallbackNameForCoordinates(coords: Coordinates): string {
  return `Lat ${coords.lat.toFixed(4)}, Long ${coords.long.toFixed(4)}`;
}

export function isLocationSelectableForSky(match: Pick<LocationMatch, "isLocalityClass">): boolean {
  return match.isLocalityClass;
}

export class SameSkyService {
  constructor(private readonly deps: SameSkyDependencies) {}

  private rethrowAsUpstream(code: string, message: string, error: unknown): never {
    if (error instanceof SameSkyError) {
      throw error;
    }

    throw new UpstreamError(code, message, error);
  }

  async lookupLocations(name: string, options?: LookupOptions): Promise<LocationMatch[]> {
    const query = normalizeLookupQuery(name);
    if (!query) {
      throw new ValidationError("invalid_query", "Lookup query cannot be empty.");
    }

    const limit = parseLookupLimit(options?.limit);
    const includeTimezonePreview = options?.includeTimezonePreview ?? limit <= DEFAULT_TIMEZONE_PREVIEW_LIMIT;

    try {
      const matches = await this.deps.geocodeProvider.search(query, {
        limit,
        localityOnly: options?.localityOnly,
        scopeBoundingBox: options?.scopeBoundingBox,
      });

      const trimmed = matches
        .slice(0, limit)
        .filter(match => (options?.localityOnly ? isLocationSelectableForSky(match) : true));

      if (!includeTimezonePreview) {
        return trimmed;
      }

      const previewAtMs = this.deps.now();
      const enriched = await Promise.all(
        trimmed.map(async match => {
          try {
            const resolved = await this.deps.timezoneProvider.resolve(match.coords, previewAtMs);
            return {
              ...match,
              timezonePreview: resolved.timezone,
            };
          } catch {
            return {
              ...match,
              timezonePreview: undefined,
            };
          }
        }),
      );

      return enriched;
    } catch (error) {
      this.rethrowAsUpstream("geocode_lookup_failed", "Unable to look up locations.", error);
    }
  }

  async getCurrentLocation(options?: CurrentLocationOptions): Promise<CurrentLocationResult> {
    if (options?.browserCoords) {
      validateCoordinates(options.browserCoords);

      try {
        const reverseMatch = await this.deps.geocodeProvider.reverse(options.browserCoords);
        if (reverseMatch) {
          return {
            name: reverseMatch.name,
            coords: reverseMatch.coords,
            source: "browser",
          };
        }

        return {
          name: fallbackNameForCoordinates(options.browserCoords),
          coords: options.browserCoords,
          source: "browser",
        };
      } catch (error) {
        this.rethrowAsUpstream("geocode_reverse_failed", "Unable to resolve a name for browser coordinates.", error);
      }
    }

    try {
      const ipMatch = await this.deps.ipLocationProvider.current();
      if (!ipMatch) {
        throw new UpstreamError("ip_location_unavailable", "Unable to resolve current location from IP.");
      }

      return {
        name: ipMatch.name,
        coords: ipMatch.coords,
        source: "ip",
      };
    } catch (error) {
      this.rethrowAsUpstream("ip_location_failed", "Unable to resolve current location from IP.", error);
    }
  }

  async getTimeForLocation(coords: Coordinates, atMs = this.deps.now()): Promise<LocationTime> {
    validateCoordinates(coords);
    const timestampMs = parseTimestamp(atMs);

    try {
      const resolved = await this.deps.timezoneProvider.resolve(coords, timestampMs);

      if (!resolved.timezone || !Number.isFinite(resolved.offsetSeconds)) {
        throw new Error("Timezone response was incomplete.");
      }

      return {
        timestampMs,
        timezone: resolved.timezone,
        offsetSeconds: Math.trunc(resolved.offsetSeconds),
      };
    } catch (error) {
      this.rethrowAsUpstream("timezone_lookup_failed", "Unable to resolve timezone information.", error);
    }
  }

  async getOffsetForLocation(coords: Coordinates, atMs = this.deps.now()): Promise<number> {
    const locationTime = await this.getTimeForLocation(coords, atMs);
    return locationTime.offsetSeconds;
  }

  getAngleForOffset(seconds: number, unit: AngleUnit): number {
    if (!Number.isFinite(seconds)) {
      throw new ValidationError("invalid_offset", "Offset seconds must be a finite number.");
    }

    return angleForTimeOffset(seconds, unit);
  }

  async getAngleForLocation(coords: Coordinates, unit: AngleUnit, atMs = this.deps.now()): Promise<number> {
    const offsetSeconds = await this.getOffsetForLocation(coords, atMs);
    return this.getAngleForOffset(offsetSeconds, unit);
  }

  async getSkyColorForLocation(coords: Coordinates, options?: SkyComputationOptions): Promise<Sky24hResult> {
    validateCoordinates(coords);
    const atMs = parseTimestamp(options?.atMs ?? this.deps.now());
    const applySecondOrder = options?.applySecondOrder ?? true;

    try {
      const timezone = await this.deps.timezoneProvider.resolve(coords, atMs);
      const environment = applySecondOrder
        ? await this.deps.skyEnvironmentProvider.resolve(coords, atMs, timezone.timezone)
        : createFallbackSkyEnvironment(timezone.timezone, atMs);
      return computeSky24h(coords, environment, atMs, {
        factorOverrides: options?.factorOverrides,
        applySecondOrder,
      });
    } catch (error) {
      this.rethrowAsUpstream("sky_lookup_failed", "Unable to resolve sky color information.", error);
    }
  }

  async getSkyColorForLocationAndTime(
    coords: Coordinates,
    atMs: number,
    options?: Omit<SkyComputationOptions, "atMs">,
  ): Promise<Sky24hResult> {
    return this.getSkyColorForLocation(coords, {
      ...options,
      atMs,
    });
  }

  async locationLookup(name: string): Promise<[string, Coordinates][]> {
    const matches = await this.lookupLocations(name, { limit: DEFAULT_LOOKUP_LIMIT });
    return matches.map(match => [match.name, match.coords]);
  }

  async currentLocation(): Promise<[string, Coordinates]> {
    const current = await this.getCurrentLocation();
    return [current.name, current.coords];
  }

  async timeInLocation(coords: Coordinates): Promise<[number, string]> {
    const locationTime = await this.getTimeForLocation(coords);
    return [locationTime.timestampMs, locationTime.timezone];
  }

  async angleForLocation(coords: Coordinates, radOrDeg: AngleUnit): Promise<number> {
    return this.getAngleForLocation(coords, radOrDeg);
  }

  async timeOffsetForLocation(coords: Coordinates): Promise<number> {
    return this.getOffsetForLocation(coords);
  }

  angleForTimeOffset(seconds: number, radOrDeg: AngleUnit): number {
    return this.getAngleForOffset(seconds, radOrDeg);
  }

  async skyColourForLocation(coords: Coordinates): Promise<[SkyColorStop[], number]> {
    const result = await this.getSkyColorForLocation(coords);
    return [result.stops, result.rotationDeg];
  }

  async skyColourForLocationAndTime(coords: Coordinates, atMs: number): Promise<[SkyColorStop[], number]> {
    const result = await this.getSkyColorForLocationAndTime(coords, atMs);
    return [result.stops, result.rotationDeg];
  }
}

export function createSameSkyService(dependencies?: Partial<SameSkyDependencies>): SameSkyService {
  const defaultDependencies = createDefaultDependencies();
  return new SameSkyService({
    ...defaultDependencies,
    ...dependencies,
  });
}
