import type { BoundingBox, Coordinates, LocationMatch } from "./types";

export interface GeocodeSearchOptions {
  limit?: number;
  scopeBoundingBox?: BoundingBox;
  localityOnly?: boolean;
}

export interface GeocodeProvider {
  search(name: string, options?: GeocodeSearchOptions): Promise<LocationMatch[]>;
  reverse(coords: Coordinates): Promise<LocationMatch | null>;
}

export interface TimezoneProvider {
  resolve(coords: Coordinates, atMs: number): Promise<{ timezone: string; offsetSeconds: number }>;
}

export interface IpLocationProvider {
  current(): Promise<LocationMatch | null>;
}

export interface TimeInPlaceDependencies {
  geocodeProvider: GeocodeProvider;
  timezoneProvider: TimezoneProvider;
  ipLocationProvider: IpLocationProvider;
  now: () => number;
}

export interface LookupOptions {
  limit?: number;
  scopeBoundingBox?: BoundingBox;
  localityOnly?: boolean;
  includeTimezonePreview?: boolean;
}

export interface CurrentLocationOptions {
  browserCoords?: Coordinates;
}
