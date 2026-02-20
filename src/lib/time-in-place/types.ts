export interface Coordinates {
  lat: number;
  long: number;
}

export interface LocationMatch {
  name: string;
  coords: Coordinates;
  source: string;
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
