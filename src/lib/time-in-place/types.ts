export interface Coordinates {
  lat: number;
  long: number;
}

export interface BoundingBox {
  south: number;
  north: number;
  west: number;
  east: number;
}

export const LOCATION_GRANULARITIES = [
  "country",
  "state",
  "region",
  "county",
  "municipality",
  "city",
  "town",
  "village",
  "suburb",
  "hamlet",
  "city_district",
  "neighbourhood",
  "unknown",
] as const;

export type LocationGranularity = (typeof LOCATION_GRANULARITIES)[number];

export const LOCALITY_GRANULARITIES: ReadonlySet<LocationGranularity> = new Set<LocationGranularity>([
  "city",
  "town",
  "village",
  "suburb",
  "hamlet",
  "municipality",
  "city_district",
]);

export interface LocationAdmin {
  country?: string;
  region?: string;
  locality?: string;
}

const LOCATION_GRANULARITY_SET = new Set<string>(LOCATION_GRANULARITIES);

function normalizeGranularityToken(value: string): string {
  return value.trim().toLowerCase().replaceAll("-", "_").replaceAll(" ", "_");
}

export function parseLocationGranularity(value: string | undefined): LocationGranularity {
  if (!value) {
    return "unknown";
  }

  const normalized = normalizeGranularityToken(value);
  if (normalized === "province" || normalized === "state_district") {
    return "state";
  }

  if (normalized === "district") {
    return "region";
  }

  if (normalized === "neighborhood") {
    return "neighbourhood";
  }

  if (LOCATION_GRANULARITY_SET.has(normalized)) {
    return normalized as LocationGranularity;
  }

  return "unknown";
}

export function isLocalityGranularity(granularity: LocationGranularity): boolean {
  return LOCALITY_GRANULARITIES.has(granularity);
}

export interface LocationMatch {
  id: string;
  name: string;
  fullName: string;
  coords: Coordinates;
  source: string;
  granularity: LocationGranularity;
  isLocalityClass: boolean;
  admin: LocationAdmin;
  boundingBox?: BoundingBox;
  timezonePreview?: string;
}

export interface LocationTime {
  timestampMs: number;
  timezone: string;
  offsetSeconds: number;
}

export type AngleUnit = "rad" | "deg";
export type CurrentLocationSource = "browser" | "ip";

export interface CurrentLocationResult {
  name: string;
  coords: Coordinates;
  source: CurrentLocationSource;
}

export const SKY_STOP_NAMES = [
  "local_midnight_start",
  "astronomical_night",
  "astronomical_dawn",
  "nautical_dawn",
  "civil_dawn",
  "sunrise",
  "morning_golden_hour",
  "mid_morning",
  "solar_noon",
  "mid_afternoon",
  "afternoon_golden_hour",
  "sunset",
  "civil_dusk",
  "nautical_dusk",
  "astronomical_dusk",
  "late_night",
  "local_midnight_end",
] as const;

export type SkyStopName = (typeof SKY_STOP_NAMES)[number];

export const SKY_FACTOR_NAMES = [
  "altitude",
  "turbidity",
  "humidity",
  "cloud_fraction",
  "ozone_factor",
  "light_pollution",
] as const;

export type SkyFactorName = (typeof SKY_FACTOR_NAMES)[number];

export interface SkySecondOrderFactors {
  altitude: number;
  turbidity: number;
  humidity: number;
  cloud_fraction: number;
  ozone_factor: number;
  light_pollution: number;
}

export interface SkyFactorSummary {
  value: number;
  source: "live" | "fallback" | "override";
  confidence: number;
  notes?: string[];
}

export interface SkyFactorDiagnostics {
  factors: Record<SkyFactorName, SkyFactorSummary>;
  providerQuality: "live" | "mixed" | "fallback";
  degraded: boolean;
  fallbackReasons: string[];
}

export interface SkyFactorSample {
  timestampMs: number;
  factors: SkySecondOrderFactors;
}

export interface SkyEnvironment {
  timezone: string;
  samples: SkyFactorSample[];
  diagnostics: SkyFactorDiagnostics;
}

export interface SkyColorStop {
  name: SkyStopName;
  timestampMs: number;
  minutesOfDay: number;
  angleDeg: number;
  colorHex: string;
  shiftMinutes: number;
  factors: SkySecondOrderFactors;
}

export interface Sky24hResult {
  timestampMs: number;
  timezone: string;
  rotationDeg: number;
  rotationRad: number;
  stops: SkyColorStop[];
  diagnostics: SkyFactorDiagnostics & {
    interpolation: "hourly_linear";
    polarConditionImputed: boolean;
  };
}

export interface SkyComputationOptions {
  atMs?: number;
  factorOverrides?: Partial<SkySecondOrderFactors>;
  applySecondOrder?: boolean;
}
