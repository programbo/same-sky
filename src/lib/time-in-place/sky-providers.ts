import { TTLCache, createCacheKey } from "./cache";
import type { SkyEnvironmentProvider } from "./contracts";
import {
  parseLocationGranularity,
  type LocationGranularity,
  type SkyEnvironment,
  type SkyFactorDiagnostics,
  type SkyFactorName,
  type SkyFactorSummary,
  type SkySecondOrderFactors,
} from "./types";

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_RETRIES = 1;
const DEFAULT_USER_AGENT = "time-in-place/0.1 (+https://example.local)";

const WEATHER_CACHE_TTL_MS = 20 * 60 * 1000;
const AIR_CACHE_TTL_MS = 30 * 60 * 1000;
const ELEVATION_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const REVERSE_CACHE_TTL_MS = 12 * 60 * 60 * 1000;

type FetchImpl = typeof fetch;

const FACTOR_NAMES: SkyFactorName[] = [
  "altitude",
  "turbidity",
  "humidity",
  "cloud_fraction",
  "ozone_factor",
  "light_pollution",
];

interface RequestOptions {
  fetchImpl: FetchImpl;
  timeoutMs: number;
  retries: number;
}

interface SkyProviderFactoryOptions {
  fetchImpl?: FetchImpl;
  now?: () => number;
  timeoutMs?: number;
  retries?: number;
  userAgent?: string;
}

class ProviderHttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ProviderHttpError";
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(1, value));
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

      return (await response.json()) as T;
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

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function getZonedParts(atMs: number, timezone: string): ZonedParts {
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

  const values: Partial<ZonedParts> = {};
  for (const part of formatter.formatToParts(new Date(atMs))) {
    if (part.type === "year" || part.type === "month" || part.type === "day" || part.type === "hour" || part.type === "minute" || part.type === "second") {
      values[part.type] = Number(part.value);
    }
  }

  return {
    year: values.year ?? 1970,
    month: values.month ?? 1,
    day: values.day ?? 1,
    hour: values.hour ?? 0,
    minute: values.minute ?? 0,
    second: values.second ?? 0,
  };
}

function getTimezoneOffsetSeconds(timezone: string, atMs: number): number {
  const local = getZonedParts(atMs, timezone);
  const localAsUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
  return Math.round((localAsUtc - atMs) / 1000);
}

function zonedTimeToUtcMs(parts: Omit<ZonedParts, "second"> & { second?: number }, timezone: string): number {
  const second = parts.second ?? 0;
  let guess = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, second);

  for (let index = 0; index < 4; index += 1) {
    const offsetSeconds = getTimezoneOffsetSeconds(timezone, guess);
    const next = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, second) - offsetSeconds * 1000;
    if (Math.abs(next - guess) <= 1000) {
      return next;
    }

    guess = next;
  }

  return guess;
}

function getLocalDateString(atMs: number, timezone: string): string {
  const parts = getZonedParts(atMs, timezone);
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function parseOpenMeteoLocalHour(value: string, timezone: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);

  if (![year, month, day, hour, minute].every(Number.isFinite)) {
    return null;
  }

  return zonedTimeToUtcMs(
    {
      year,
      month,
      day,
      hour,
      minute,
      second: 0,
    },
    timezone,
  );
}

interface OpenMeteoWeatherResponse {
  hourly?: {
    time?: string[];
    relative_humidity_2m?: Array<number | null>;
    cloud_cover?: Array<number | null>;
  };
}

interface OpenMeteoAirResponse {
  hourly?: {
    time?: string[];
    pm10?: Array<number | null>;
    ozone?: Array<number | null>;
  };
}

interface OpenTopoDataResponse {
  results?: Array<{
    elevation?: number;
  }>;
}

interface NominatimReverseResponse {
  addresstype?: string;
  type?: string;
}

export function normalizeAltitudeMeters(elevationMeters: number | null): number {
  if (elevationMeters === null || !Number.isFinite(elevationMeters)) {
    return 0.15;
  }

  return clamp01((elevationMeters + 100) / 4100);
}

export function normalizeTurbidity(pm10: number | null): number {
  if (pm10 === null || !Number.isFinite(pm10)) {
    return 0.5;
  }

  return clamp01(pm10 / 80);
}

export function normalizeHumidity(relativeHumidity: number | null): number {
  if (relativeHumidity === null || !Number.isFinite(relativeHumidity)) {
    return 0.5;
  }

  return clamp01(relativeHumidity / 100);
}

export function normalizeCloudFraction(cloudCover: number | null): number {
  if (cloudCover === null || !Number.isFinite(cloudCover)) {
    return 0.3;
  }

  return clamp01(cloudCover / 100);
}

export function normalizeOzone(ozone: number | null): number {
  if (ozone === null || !Number.isFinite(ozone)) {
    return 0.5;
  }

  return clamp01((ozone - 40) / 120);
}

export function lightPollutionForGranularity(granularity: LocationGranularity): number {
  switch (granularity) {
    case "city":
    case "city_district":
      return 0.82;
    case "suburb":
    case "neighbourhood":
      return 0.74;
    case "town":
    case "municipality":
      return 0.68;
    case "village":
      return 0.55;
    case "hamlet":
      return 0.45;
    case "county":
    case "region":
      return 0.5;
    case "state":
      return 0.48;
    case "country":
      return 0.42;
    case "unknown":
    default:
      return 0.5;
  }
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function makeFactorSummary(value: number, source: SkyFactorSummary["source"], confidence: number, notes?: string[]): SkyFactorSummary {
  return {
    value: clamp01(value),
    source,
    confidence: clamp01(confidence),
    notes,
  };
}

function buildDiagnostics(
  factorValues: Record<SkyFactorName, number>,
  liveFactors: Set<SkyFactorName>,
  fallbackReasons: string[],
): SkyFactorDiagnostics {
  const factors: Record<SkyFactorName, SkyFactorSummary> = {
    altitude: makeFactorSummary(factorValues.altitude, liveFactors.has("altitude") ? "live" : "fallback", liveFactors.has("altitude") ? 0.9 : 0.4),
    turbidity: makeFactorSummary(factorValues.turbidity, liveFactors.has("turbidity") ? "live" : "fallback", liveFactors.has("turbidity") ? 0.75 : 0.35),
    humidity: makeFactorSummary(factorValues.humidity, liveFactors.has("humidity") ? "live" : "fallback", liveFactors.has("humidity") ? 0.85 : 0.45),
    cloud_fraction: makeFactorSummary(factorValues.cloud_fraction, liveFactors.has("cloud_fraction") ? "live" : "fallback", liveFactors.has("cloud_fraction") ? 0.85 : 0.45),
    ozone_factor: makeFactorSummary(factorValues.ozone_factor, liveFactors.has("ozone_factor") ? "live" : "fallback", liveFactors.has("ozone_factor") ? 0.7 : 0.35),
    light_pollution: makeFactorSummary(factorValues.light_pollution, liveFactors.has("light_pollution") ? "live" : "fallback", liveFactors.has("light_pollution") ? 0.65 : 0.4),
  };

  const liveCount = FACTOR_NAMES.filter(name => liveFactors.has(name)).length;
  const providerQuality =
    liveCount === FACTOR_NAMES.length ? "live" : liveCount === 0 ? "fallback" : "mixed";

  return {
    factors,
    providerQuality,
    degraded: fallbackReasons.length > 0,
    fallbackReasons,
  };
}

export function createDefaultSkyEnvironmentProvider(options: SkyProviderFactoryOptions = {}): SkyEnvironmentProvider {
  const now = options.now ?? Date.now;
  const requestOptions: RequestOptions = {
    fetchImpl: options.fetchImpl ?? fetch,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    retries: options.retries ?? DEFAULT_RETRIES,
  };
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;

  const weatherCache = new TTLCache<OpenMeteoWeatherResponse>(now);
  const airCache = new TTLCache<OpenMeteoAirResponse>(now);
  const elevationCache = new TTLCache<number | null>(now);
  const reverseCache = new TTLCache<LocationGranularity>(now);

  return {
    async resolve(coords, atMs, timezone): Promise<SkyEnvironment> {
      const localDate = getLocalDateString(atMs, timezone);
      const fallbackReasons: string[] = [];

      const weatherKey = createCacheKey(["sky", "weather", coords.lat.toFixed(5), coords.long.toFixed(5), timezone, localDate]);
      const airKey = createCacheKey(["sky", "air", coords.lat.toFixed(5), coords.long.toFixed(5), timezone, localDate]);
      const elevationKey = createCacheKey(["sky", "elevation", coords.lat.toFixed(4), coords.long.toFixed(4)]);
      const reverseKey = createCacheKey(["sky", "reverse", coords.lat.toFixed(4), coords.long.toFixed(4)]);

      let weather = weatherCache.get(weatherKey);
      if (!weather) {
        try {
          const url = new URL("https://api.open-meteo.com/v1/forecast");
          url.searchParams.set("latitude", String(coords.lat));
          url.searchParams.set("longitude", String(coords.long));
          url.searchParams.set("hourly", "relative_humidity_2m,cloud_cover");
          url.searchParams.set("start_date", localDate);
          url.searchParams.set("end_date", localDate);
          url.searchParams.set("timezone", timezone);

          weather = await fetchJson<OpenMeteoWeatherResponse>(url.toString(), {}, requestOptions);
          weatherCache.set(weatherKey, weather, WEATHER_CACHE_TTL_MS);
        } catch {
          fallbackReasons.push("weather_provider_unavailable");
        }
      }

      let air = airCache.get(airKey);
      if (!air) {
        try {
          const url = new URL("https://air-quality-api.open-meteo.com/v1/air-quality");
          url.searchParams.set("latitude", String(coords.lat));
          url.searchParams.set("longitude", String(coords.long));
          url.searchParams.set("hourly", "pm10,ozone");
          url.searchParams.set("start_date", localDate);
          url.searchParams.set("end_date", localDate);
          url.searchParams.set("timezone", timezone);

          air = await fetchJson<OpenMeteoAirResponse>(url.toString(), {}, requestOptions);
          airCache.set(airKey, air, AIR_CACHE_TTL_MS);
        } catch {
          fallbackReasons.push("air_quality_provider_unavailable");
        }
      }

      let altitudeMeters = elevationCache.get(elevationKey);
      if (altitudeMeters === undefined) {
        try {
          const url = new URL("https://api.opentopodata.org/v1/mapzen");
          url.searchParams.set("locations", `${coords.lat},${coords.long}`);

          const response = await fetchJson<OpenTopoDataResponse>(
            url.toString(),
            {
              headers: {
                accept: "application/json",
              },
            },
            requestOptions,
          );

          altitudeMeters = response.results?.[0]?.elevation ?? null;
          elevationCache.set(elevationKey, altitudeMeters, ELEVATION_CACHE_TTL_MS);
        } catch {
          altitudeMeters = null;
          fallbackReasons.push("elevation_provider_unavailable");
          elevationCache.set(elevationKey, altitudeMeters, ELEVATION_CACHE_TTL_MS);
        }
      }

      let granularity = reverseCache.get(reverseKey);
      if (!granularity) {
        try {
          const url = new URL("https://nominatim.openstreetmap.org/reverse");
          url.searchParams.set("format", "jsonv2");
          url.searchParams.set("addressdetails", "1");
          url.searchParams.set("lat", String(coords.lat));
          url.searchParams.set("lon", String(coords.long));

          const reverse = await fetchJson<NominatimReverseResponse>(
            url.toString(),
            {
              headers: {
                accept: "application/json",
                "user-agent": userAgent,
              },
            },
            requestOptions,
          );

          granularity = parseLocationGranularity(reverse.addresstype ?? reverse.type);
          reverseCache.set(reverseKey, granularity, REVERSE_CACHE_TTL_MS);
        } catch {
          granularity = "unknown";
          fallbackReasons.push("reverse_geocode_unavailable");
          reverseCache.set(reverseKey, granularity, REVERSE_CACHE_TTL_MS);
        }
      }

      const timeSet = new Set<number>();
      const weatherByTime = new Map<number, { humidity: number | null; cloud: number | null }>();
      const airByTime = new Map<number, { pm10: number | null; ozone: number | null }>();

      const weatherTimes = weather?.hourly?.time ?? [];
      const weatherHumidity = weather?.hourly?.relative_humidity_2m ?? [];
      const weatherCloud = weather?.hourly?.cloud_cover ?? [];
      for (let index = 0; index < weatherTimes.length; index += 1) {
        const time = weatherTimes[index];
        if (!time) {
          continue;
        }

        const timestampMs = parseOpenMeteoLocalHour(time, timezone);
        if (timestampMs === null) {
          continue;
        }

        timeSet.add(timestampMs);
        weatherByTime.set(timestampMs, {
          humidity: weatherHumidity[index] ?? null,
          cloud: weatherCloud[index] ?? null,
        });
      }

      const airTimes = air?.hourly?.time ?? [];
      const airPm10 = air?.hourly?.pm10 ?? [];
      const airOzone = air?.hourly?.ozone ?? [];
      for (let index = 0; index < airTimes.length; index += 1) {
        const time = airTimes[index];
        if (!time) {
          continue;
        }

        const timestampMs = parseOpenMeteoLocalHour(time, timezone);
        if (timestampMs === null) {
          continue;
        }

        timeSet.add(timestampMs);
        airByTime.set(timestampMs, {
          pm10: airPm10[index] ?? null,
          ozone: airOzone[index] ?? null,
        });
      }

      if (timeSet.size === 0) {
        timeSet.add(atMs);
        fallbackReasons.push("hourly_data_missing");
      }

      const altitude = normalizeAltitudeMeters(altitudeMeters ?? null);
      const lightPollution = lightPollutionForGranularity(granularity ?? "unknown");

      const samples = Array.from(timeSet)
        .sort((left, right) => left - right)
        .map(timestampMs => {
          const weatherPoint = weatherByTime.get(timestampMs);
          const airPoint = airByTime.get(timestampMs);

          const factors: SkySecondOrderFactors = {
            altitude,
            turbidity: normalizeTurbidity(airPoint?.pm10 ?? null),
            humidity: normalizeHumidity(weatherPoint?.humidity ?? null),
            cloud_fraction: normalizeCloudFraction(weatherPoint?.cloud ?? null),
            ozone_factor: normalizeOzone(airPoint?.ozone ?? null),
            light_pollution: lightPollution,
          };

          return {
            timestampMs,
            factors,
          };
        });

      const liveFactors = new Set<SkyFactorName>();
      if (altitudeMeters !== null && Number.isFinite(altitudeMeters)) {
        liveFactors.add("altitude");
      }
      if (weatherByTime.size > 0) {
        liveFactors.add("humidity");
        liveFactors.add("cloud_fraction");
      }
      if (airByTime.size > 0) {
        liveFactors.add("turbidity");
        liveFactors.add("ozone_factor");
      }
      if (granularity && granularity !== "unknown") {
        liveFactors.add("light_pollution");
      }

      const factorValues: Record<SkyFactorName, number> = {
        altitude: average(samples.map(sample => sample.factors.altitude)),
        turbidity: average(samples.map(sample => sample.factors.turbidity)),
        humidity: average(samples.map(sample => sample.factors.humidity)),
        cloud_fraction: average(samples.map(sample => sample.factors.cloud_fraction)),
        ozone_factor: average(samples.map(sample => sample.factors.ozone_factor)),
        light_pollution: average(samples.map(sample => sample.factors.light_pollution)),
      };

      const diagnostics = buildDiagnostics(factorValues, liveFactors, fallbackReasons);

      return {
        timezone,
        samples,
        diagnostics,
      };
    },
  };
}
