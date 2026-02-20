import { TTLCache, createCacheKey, normalizeCacheToken } from "./cache";
import type {
  GeocodeProvider,
  IpLocationProvider,
  TimeInPlaceDependencies,
  TimezoneProvider,
} from "./contracts";
import type { LocationMatch } from "./types";

const SEARCH_CACHE_TTL_MS = 15 * 60 * 1000;
const REVERSE_CACHE_TTL_MS = 15 * 60 * 1000;
const TIMEZONE_CACHE_TTL_MS = 10 * 60 * 1000;
const IP_CACHE_TTL_MS = 5 * 60 * 1000;

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_RETRIES = 1;
const DEFAULT_USER_AGENT = "time-in-place/0.1 (+https://example.local)";

type FetchImpl = typeof fetch;

class ProviderHttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ProviderHttpError";
  }
}

interface ProviderFactoryOptions {
  fetchImpl?: FetchImpl;
  now?: () => number;
  timeoutMs?: number;
  retries?: number;
  userAgent?: string;
}

interface RequestOptions {
  fetchImpl: FetchImpl;
  timeoutMs: number;
  retries: number;
}

interface NominatimAddress {
  city?: string;
  town?: string;
  village?: string;
  hamlet?: string;
  municipality?: string;
  county?: string;
  state?: string;
  region?: string;
  state_district?: string;
  province?: string;
  country?: string;
}

interface NominatimRecord {
  lat: string;
  lon: string;
  display_name?: string;
  address?: NominatimAddress;
}

interface OpenMeteoTimezoneResponse {
  timezone?: string;
}

interface IpApiResponse {
  city?: string;
  region?: string;
  country_name?: string;
  latitude?: number;
  longitude?: number;
}

function shouldRetryStatus(status: number): boolean {
  return status >= 500;
}

function canRetryError(error: unknown): boolean {
  if (error instanceof ProviderHttpError) {
    return shouldRetryStatus(error.status);
  }

  return true;
}

async function fetchJson<T>(url: string, init: RequestInit, options: RequestOptions): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= options.retries; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs);

    try {
      const response = await options.fetchImpl(url, {
        ...init,
        signal: controller.signal,
      });

      if (!response.ok) {
        const error = new ProviderHttpError(`Request failed with status ${response.status}`, response.status);
        if (attempt < options.retries && canRetryError(error)) {
          lastError = error;
          continue;
        }

        throw error;
      }

      const data = (await response.json()) as T;
      return data;
    } catch (error) {
      if (attempt < options.retries && canRetryError(error)) {
        lastError = error;
        continue;
      }

      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Request failed");
}

function parseCoordinate(value: string | number | undefined): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return parsed;
}

function firstDefined(values: Array<string | undefined>): string | undefined {
  return values.find(value => value && value.trim().length > 0);
}

function formatLocationName(displayName: string | undefined, address: NominatimAddress | undefined): string {
  if (address) {
    const city = firstDefined([
      address.city,
      address.town,
      address.village,
      address.hamlet,
      address.municipality,
      address.county,
    ]);
    const region = firstDefined([address.state, address.region, address.state_district, address.province]);
    const country = firstDefined([address.country]);

    const components = [city, region, country].filter((value): value is string => Boolean(value));
    if (components.length > 0) {
      return components.join(", ");
    }
  }

  if (displayName && displayName.trim().length > 0) {
    const parts = displayName.split(",").map(part => part.trim());
    return parts.slice(0, 3).join(", ");
  }

  return "Unknown location";
}

function nominatimToLocation(record: NominatimRecord, source: string): LocationMatch | null {
  const lat = parseCoordinate(record.lat);
  const long = parseCoordinate(record.lon);

  if (lat === null || long === null) {
    return null;
  }

  return {
    name: formatLocationName(record.display_name, record.address),
    coords: { lat, long },
    source,
  };
}

function getTimezoneOffsetSeconds(timezone: string, atMs: number): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  const parts = formatter.formatToParts(new Date(atMs));
  const values: Record<string, number> = {};

  for (const part of parts) {
    if (
      part.type === "year" ||
      part.type === "month" ||
      part.type === "day" ||
      part.type === "hour" ||
      part.type === "minute" ||
      part.type === "second"
    ) {
      values[part.type] = Number(part.value);
    }
  }

  const year = values.year ?? Number.NaN;
  const month = values.month ?? Number.NaN;
  const day = values.day ?? Number.NaN;
  const hour = values.hour ?? Number.NaN;
  const minute = values.minute ?? Number.NaN;
  const second = values.second ?? Number.NaN;

  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    !Number.isFinite(hour) ||
    !Number.isFinite(minute) ||
    !Number.isFinite(second)
  ) {
    throw new Error(`Unable to resolve timezone offset for ${timezone}`);
  }

  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  return Math.round((localAsUtc - atMs) / 1000);
}

function createNominatimProvider(options: RequestOptions & { userAgent: string; now: () => number }): GeocodeProvider {
  const searchCache = new TTLCache<LocationMatch[]>(options.now);
  const reverseCache = new TTLCache<LocationMatch | null>(options.now);

  return {
    async search(name, limit) {
      const normalizedQuery = normalizeCacheToken(name);
      const safeLimit = Math.max(1, Math.min(10, Math.trunc(limit)));
      const cacheKey = createCacheKey(["nominatim", "search", normalizedQuery, safeLimit]);
      const cached = searchCache.get(cacheKey);
      if (cached) {
        return cached;
      }

      const url = new URL("https://nominatim.openstreetmap.org/search");
      url.searchParams.set("format", "jsonv2");
      url.searchParams.set("addressdetails", "1");
      url.searchParams.set("limit", String(safeLimit));
      url.searchParams.set("q", normalizedQuery);

      const response = await fetchJson<NominatimRecord[]>(
        url.toString(),
        {
          headers: {
            accept: "application/json",
            "user-agent": options.userAgent,
          },
        },
        options,
      );

      const matches = response.map(record => nominatimToLocation(record, "nominatim")).filter((value): value is LocationMatch => value !== null);
      searchCache.set(cacheKey, matches, SEARCH_CACHE_TTL_MS);
      return matches;
    },

    async reverse(coords) {
      const cacheKey = createCacheKey([
        "nominatim",
        "reverse",
        coords.lat.toFixed(6),
        coords.long.toFixed(6),
      ]);
      const cached = reverseCache.get(cacheKey);
      if (cached !== undefined) {
        return cached;
      }

      const url = new URL("https://nominatim.openstreetmap.org/reverse");
      url.searchParams.set("format", "jsonv2");
      url.searchParams.set("addressdetails", "1");
      url.searchParams.set("lat", String(coords.lat));
      url.searchParams.set("lon", String(coords.long));

      const response = await fetchJson<NominatimRecord>(
        url.toString(),
        {
          headers: {
            accept: "application/json",
            "user-agent": options.userAgent,
          },
        },
        options,
      );

      const result = nominatimToLocation(response, "nominatim");
      reverseCache.set(cacheKey, result, REVERSE_CACHE_TTL_MS);
      return result;
    },
  };
}

function createOpenMeteoTimezoneProvider(options: RequestOptions & { now: () => number }): TimezoneProvider {
  const timezoneCache = new TTLCache<string>(options.now);

  return {
    async resolve(coords, atMs) {
      const cacheKey = createCacheKey([
        "open-meteo",
        "timezone",
        coords.lat.toFixed(5),
        coords.long.toFixed(5),
      ]);

      let timezone = timezoneCache.get(cacheKey);
      if (!timezone) {
        const url = new URL("https://api.open-meteo.com/v1/forecast");
        url.searchParams.set("latitude", String(coords.lat));
        url.searchParams.set("longitude", String(coords.long));
        url.searchParams.set("current", "temperature_2m");
        url.searchParams.set("timezone", "auto");

        const response = await fetchJson<OpenMeteoTimezoneResponse>(url.toString(), {}, options);
        timezone = response.timezone;
        if (!timezone) {
          throw new Error("Timezone field was missing from timezone provider response");
        }

        timezoneCache.set(cacheKey, timezone, TIMEZONE_CACHE_TTL_MS);
      }

      return {
        timezone,
        offsetSeconds: getTimezoneOffsetSeconds(timezone, atMs),
      };
    },
  };
}

function createIpApiLocationProvider(options: RequestOptions & { now: () => number }): IpLocationProvider {
  const ipCache = new TTLCache<LocationMatch | null>(options.now);

  return {
    async current() {
      const cacheKey = createCacheKey(["ipapi", "current"]);
      const cached = ipCache.get(cacheKey);
      if (cached !== undefined) {
        return cached;
      }

      const response = await fetchJson<IpApiResponse>("https://ipapi.co/json/", {}, options);
      const lat = parseCoordinate(response.latitude);
      const long = parseCoordinate(response.longitude);

      if (lat === null || long === null) {
        ipCache.set(cacheKey, null, IP_CACHE_TTL_MS);
        return null;
      }

      const parts = [response.city, response.region, response.country_name].filter(
        (value): value is string => Boolean(value && value.trim().length > 0),
      );
      const result: LocationMatch = {
        name: parts.length > 0 ? parts.join(", ") : "Unknown location",
        coords: { lat, long },
        source: "ipapi",
      };

      ipCache.set(cacheKey, result, IP_CACHE_TTL_MS);
      return result;
    },
  };
}

export function createDefaultDependencies(options: ProviderFactoryOptions = {}): TimeInPlaceDependencies {
  const now = options.now ?? Date.now;
  const requestOptions: RequestOptions = {
    fetchImpl: options.fetchImpl ?? fetch,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    retries: options.retries ?? DEFAULT_RETRIES,
  };

  return {
    geocodeProvider: createNominatimProvider({
      ...requestOptions,
      now,
      userAgent: options.userAgent ?? DEFAULT_USER_AGENT,
    }),
    timezoneProvider: createOpenMeteoTimezoneProvider({
      ...requestOptions,
      now,
    }),
    ipLocationProvider: createIpApiLocationProvider({
      ...requestOptions,
      now,
    }),
    now,
  };
}
