import type { AngleUnit } from "./types";

const DAY_SECONDS = 24 * 60 * 60;

function modulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

export function normalizeDegrees(degrees: number): number {
  return modulo(degrees + 180, 360) - 180;
}

export function normalizeRadians(radians: number): number {
  return modulo(radians + Math.PI, 2 * Math.PI) - Math.PI;
}

export function angleForTimeOffset(seconds: number, unit: AngleUnit): number {
  const rawDegrees = (seconds / DAY_SECONDS) * 360;
  const normalizedDegrees = normalizeDegrees(rawDegrees);

  if (unit === "deg") {
    return normalizedDegrees;
  }

  return normalizeRadians((normalizedDegrees * Math.PI) / 180);
}
