import type { Coordinates, LocationMatch } from "./types";

export interface GeocodeProvider {
  search(name: string, limit: number): Promise<LocationMatch[]>;
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
}

export interface CurrentLocationOptions {
  browserCoords?: Coordinates;
}
