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
