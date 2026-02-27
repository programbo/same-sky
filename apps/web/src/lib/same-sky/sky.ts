import { normalizeDegrees } from "./math";
import type {
  Coordinates,
  Sky24hResult,
  SkyColorStop,
  SkyComputationOptions,
  SkyEnvironment,
  SkyFactorDiagnostics,
  SkyFactorName,
  SkySecondOrderFactors,
  SkyStopName,
} from "./types";

const MINUTES_PER_DAY = 24 * 60;
const MS_PER_MINUTE = 60 * 1000;
const MS_PER_DAY = MINUTES_PER_DAY * MS_PER_MINUTE;

const RAD = Math.PI / 180;
const J1970 = 2_440_588;
const J2000 = 2_451_545;
const OBLIQUITY = 23.4397 * RAD;

const STOP_ORDER: SkyStopName[] = [
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
];

const FACTOR_NAMES: SkyFactorName[] = [
  "altitude",
  "turbidity",
  "humidity",
  "cloud_fraction",
  "ozone_factor",
  "light_pollution",
];

const BASE_COLORS: Record<SkyStopName, string> = {
  local_midnight_start: "#05070f",
  astronomical_night: "#071022",
  astronomical_dawn: "#12264a",
  nautical_dawn: "#1f3f6f",
  civil_dawn: "#f58d62",
  sunrise: "#ffb06e",
  morning_golden_hour: "#ffd28b",
  mid_morning: "#8ec5ff",
  solar_noon: "#5ea8ff",
  mid_afternoon: "#7bb7ff",
  afternoon_golden_hour: "#ffbe74",
  sunset: "#ff8a5b",
  civil_dusk: "#8a5aa9",
  nautical_dusk: "#3d3f78",
  astronomical_dusk: "#1a2348",
  late_night: "#0b1030",
  local_midnight_end: "#05070f",
};

const DEFAULT_STOP_FRACTIONS: Record<SkyStopName, number> = {
  local_midnight_start: 0,
  astronomical_night: 0.08,
  astronomical_dawn: 0.18,
  nautical_dawn: 0.22,
  civil_dawn: 0.25,
  sunrise: 0.27,
  morning_golden_hour: 0.31,
  mid_morning: 0.38,
  solar_noon: 0.5,
  mid_afternoon: 0.62,
  afternoon_golden_hour: 0.69,
  sunset: 0.73,
  civil_dusk: 0.75,
  nautical_dusk: 0.78,
  astronomical_dusk: 0.82,
  late_night: 0.92,
  local_midnight_end: 1,
};

const FIXED_STOPS = new Set<SkyStopName>(["local_midnight_start", "solar_noon", "local_midnight_end"]);
const DAWN_STOPS = new Set<SkyStopName>([
  "astronomical_dawn",
  "nautical_dawn",
  "civil_dawn",
  "sunrise",
  "morning_golden_hour",
  "mid_morning",
]);
const DUSK_STOPS = new Set<SkyStopName>([
  "mid_afternoon",
  "afternoon_golden_hour",
  "sunset",
  "civil_dusk",
  "nautical_dusk",
  "astronomical_dusk",
  "late_night",
]);

function modulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(1, value));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function toJulian(ms: number): number {
  return ms / MS_PER_DAY - 0.5 + J1970;
}

function fromJulian(julianDay: number): number {
  return (julianDay + 0.5 - J1970) * MS_PER_DAY;
}

function toDays(ms: number): number {
  return toJulian(ms) - J2000;
}

function solarMeanAnomaly(days: number): number {
  return RAD * (357.5291 + 0.98560028 * days);
}

function eclipticLongitude(meanAnomaly: number): number {
  const equationOfCenter = RAD * (1.9148 * Math.sin(meanAnomaly) + 0.02 * Math.sin(2 * meanAnomaly) + 0.0003 * Math.sin(3 * meanAnomaly));
  const perihelion = 102.9372 * RAD;
  return meanAnomaly + equationOfCenter + perihelion + Math.PI;
}

function declination(longitude: number, latitude: number): number {
  return Math.asin(Math.sin(latitude) * Math.cos(OBLIQUITY) + Math.cos(latitude) * Math.sin(OBLIQUITY) * Math.sin(longitude));
}

function julianCycle(days: number, longitudeWest: number): number {
  return Math.round(days - 0.0009 - longitudeWest / (2 * Math.PI));
}

function approxTransit(hourAngle: number, longitudeWest: number, cycle: number): number {
  return 0.0009 + (hourAngle + longitudeWest) / (2 * Math.PI) + cycle;
}

function solarTransitJulian(ds: number, meanAnomaly: number, eclipticLon: number): number {
  return J2000 + ds + 0.0053 * Math.sin(meanAnomaly) - 0.0069 * Math.sin(2 * eclipticLon);
}

function hourAngle(solarAltitude: number, latitude: number, solarDeclination: number): number | null {
  const numerator = Math.sin(solarAltitude) - Math.sin(latitude) * Math.sin(solarDeclination);
  const denominator = Math.cos(latitude) * Math.cos(solarDeclination);
  const x = numerator / denominator;
  if (x < -1 || x > 1 || !Number.isFinite(x)) {
    return null;
  }

  return Math.acos(x);
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

function addCalendarDays(year: number, month: number, day: number, deltaDays: number): { year: number; month: number; day: number } {
  const next = new Date(Date.UTC(year, month - 1, day + deltaDays));
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  };
}

interface LocalDayContext {
  dayStartMs: number;
  dayEndMs: number;
  currentMinutes: number;
}

function getLocalDayContext(atMs: number, timezone: string): LocalDayContext {
  const parts = getZonedParts(atMs, timezone);
  const dayStartMs = zonedTimeToUtcMs(
    {
      year: parts.year,
      month: parts.month,
      day: parts.day,
      hour: 0,
      minute: 0,
      second: 0,
    },
    timezone,
  );
  const next = addCalendarDays(parts.year, parts.month, parts.day, 1);
  const dayEndMs = zonedTimeToUtcMs(
    {
      year: next.year,
      month: next.month,
      day: next.day,
      hour: 0,
      minute: 0,
      second: 0,
    },
    timezone,
  );

  const currentMinutes = parts.hour * 60 + parts.minute + parts.second / 60;

  return {
    dayStartMs,
    dayEndMs,
    currentMinutes,
  };
}

interface SolarEventTimes {
  solarNoon?: number;
  sunrise?: number;
  sunset?: number;
  civilDawn?: number;
  civilDusk?: number;
  nauticalDawn?: number;
  nauticalDusk?: number;
  astronomicalDawn?: number;
  astronomicalDusk?: number;
}

function normalizeToDay(ms: number, dayStartMs: number): number {
  let normalized = ms;
  while (normalized < dayStartMs) {
    normalized += MS_PER_DAY;
  }
  while (normalized >= dayStartMs + MS_PER_DAY) {
    normalized -= MS_PER_DAY;
  }
  return normalized;
}

function computeSolarEvents(dayStartMs: number, coords: Coordinates): SolarEventTimes {
  const longitudeWest = -coords.long * RAD;
  const latitude = coords.lat * RAD;
  const days = toDays(dayStartMs);
  const cycle = julianCycle(days, longitudeWest);
  const ds = approxTransit(0, longitudeWest, cycle);
  const meanAnomaly = solarMeanAnomaly(ds);
  const eclipticLon = eclipticLongitude(meanAnomaly);
  const solarDeclination = declination(eclipticLon, 0);
  const solarNoon = fromJulian(solarTransitJulian(ds, meanAnomaly, eclipticLon));

  const eventForAltitude = (altitudeDeg: number, rise: boolean): number | undefined => {
    const h = altitudeDeg * RAD;
    const w = hourAngle(h, latitude, solarDeclination);
    if (w === null) {
      return undefined;
    }

    const a = approxTransit(rise ? -w : w, longitudeWest, cycle);
    return fromJulian(solarTransitJulian(a, meanAnomaly, eclipticLon));
  };

  const normalizeDawn = (value: number | undefined): number | undefined => {
    if (value === undefined) {
      return undefined;
    }

    let adjusted = normalizeToDay(value, dayStartMs);
    const noon = normalizeToDay(solarNoon, dayStartMs);
    if (adjusted > noon) {
      adjusted -= MS_PER_DAY;
    }

    return adjusted;
  };

  const normalizeDusk = (value: number | undefined): number | undefined => {
    if (value === undefined) {
      return undefined;
    }

    let adjusted = normalizeToDay(value, dayStartMs);
    const noon = normalizeToDay(solarNoon, dayStartMs);
    if (adjusted < noon) {
      adjusted += MS_PER_DAY;
    }

    return adjusted;
  };

  return {
    solarNoon: normalizeToDay(solarNoon, dayStartMs),
    sunrise: normalizeDawn(eventForAltitude(-0.833, true)),
    sunset: normalizeDusk(eventForAltitude(-0.833, false)),
    civilDawn: normalizeDawn(eventForAltitude(-6, true)),
    civilDusk: normalizeDusk(eventForAltitude(-6, false)),
    nauticalDawn: normalizeDawn(eventForAltitude(-12, true)),
    nauticalDusk: normalizeDusk(eventForAltitude(-12, false)),
    astronomicalDawn: normalizeDawn(eventForAltitude(-18, true)),
    astronomicalDusk: normalizeDusk(eventForAltitude(-18, false)),
  };
}

function toMinutesFromDayStart(ms: number, dayStartMs: number): number {
  return (ms - dayStartMs) / MS_PER_MINUTE;
}

function midpointMinutes(left: number, right: number): number {
  return (left + right) / 2;
}

interface BaselineStopsResult {
  minutesByStop: Record<SkyStopName, number>;
  polarConditionImputed: boolean;
}

function buildBaselineStopMinutes(dayStartMs: number, coords: Coordinates): BaselineStopsResult {
  const events = computeSolarEvents(dayStartMs, coords);

  const fallback = (name: SkyStopName): number => DEFAULT_STOP_FRACTIONS[name] * MINUTES_PER_DAY;

  const solarNoon = events.solarNoon !== undefined ? toMinutesFromDayStart(events.solarNoon, dayStartMs) : fallback("solar_noon");
  const sunrise = events.sunrise !== undefined ? toMinutesFromDayStart(events.sunrise, dayStartMs) : fallback("sunrise");
  const sunset = events.sunset !== undefined ? toMinutesFromDayStart(events.sunset, dayStartMs) : fallback("sunset");
  const civilDawn = events.civilDawn !== undefined ? toMinutesFromDayStart(events.civilDawn, dayStartMs) : fallback("civil_dawn");
  const civilDusk = events.civilDusk !== undefined ? toMinutesFromDayStart(events.civilDusk, dayStartMs) : fallback("civil_dusk");
  const nauticalDawn =
    events.nauticalDawn !== undefined ? toMinutesFromDayStart(events.nauticalDawn, dayStartMs) : fallback("nautical_dawn");
  const nauticalDusk =
    events.nauticalDusk !== undefined ? toMinutesFromDayStart(events.nauticalDusk, dayStartMs) : fallback("nautical_dusk");
  const astronomicalDawn =
    events.astronomicalDawn !== undefined
      ? toMinutesFromDayStart(events.astronomicalDawn, dayStartMs)
      : fallback("astronomical_dawn");
  const astronomicalDusk =
    events.astronomicalDusk !== undefined
      ? toMinutesFromDayStart(events.astronomicalDusk, dayStartMs)
      : fallback("astronomical_dusk");

  const morningGoldenHour = sunrise + 60;
  const afternoonGoldenHour = sunset - 60;

  const raw: Record<SkyStopName, number> = {
    local_midnight_start: 0,
    astronomical_night: midpointMinutes(0, astronomicalDawn),
    astronomical_dawn: astronomicalDawn,
    nautical_dawn: nauticalDawn,
    civil_dawn: civilDawn,
    sunrise,
    morning_golden_hour: morningGoldenHour,
    mid_morning: midpointMinutes(morningGoldenHour, solarNoon),
    solar_noon: solarNoon,
    mid_afternoon: midpointMinutes(solarNoon, afternoonGoldenHour),
    afternoon_golden_hour: afternoonGoldenHour,
    sunset,
    civil_dusk: civilDusk,
    nautical_dusk: nauticalDusk,
    astronomical_dusk: astronomicalDusk,
    late_night: midpointMinutes(astronomicalDusk, MINUTES_PER_DAY),
    local_midnight_end: MINUTES_PER_DAY,
  };

  let previous = -Infinity;
  const bounded: Record<SkyStopName, number> = { ...raw };
  for (const stop of STOP_ORDER) {
    const floorValue = previous + 1;
    const target = clamp(raw[stop], floorValue, MINUTES_PER_DAY);
    bounded[stop] = target;
    previous = target;
  }
  bounded.local_midnight_start = 0;
  bounded.local_midnight_end = MINUTES_PER_DAY;

  const polarConditionImputed =
    events.sunrise === undefined ||
    events.sunset === undefined ||
    events.civilDawn === undefined ||
    events.civilDusk === undefined ||
    events.nauticalDawn === undefined ||
    events.nauticalDusk === undefined ||
    events.astronomicalDawn === undefined ||
    events.astronomicalDusk === undefined;

  return {
    minutesByStop: bounded,
    polarConditionImputed,
  };
}

function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * t;
}

function mergeFactors(base: SkySecondOrderFactors, overrides?: Partial<SkySecondOrderFactors>): SkySecondOrderFactors {
  return {
    altitude: clamp01(overrides?.altitude ?? base.altitude),
    turbidity: clamp01(overrides?.turbidity ?? base.turbidity),
    humidity: clamp01(overrides?.humidity ?? base.humidity),
    cloud_fraction: clamp01(overrides?.cloud_fraction ?? base.cloud_fraction),
    ozone_factor: clamp01(overrides?.ozone_factor ?? base.ozone_factor),
    light_pollution: clamp01(overrides?.light_pollution ?? base.light_pollution),
  };
}

function interpolateFactors(samples: SkyEnvironment["samples"], targetMs: number): SkySecondOrderFactors {
  if (samples.length === 0) {
    return {
      altitude: 0,
      turbidity: 0.5,
      humidity: 0.5,
      cloud_fraction: 0.3,
      ozone_factor: 0.5,
      light_pollution: 0.5,
    };
  }

  const sorted = [...samples].sort((left, right) => left.timestampMs - right.timestampMs);
  const first = sorted[0];
  if (first && targetMs <= first.timestampMs) {
    return first.factors;
  }

  const last = sorted[sorted.length - 1];
  if (last && targetMs >= last.timestampMs) {
    return last.factors;
  }

  for (let index = 1; index < sorted.length; index += 1) {
    const left = sorted[index - 1];
    const right = sorted[index];
    if (!left || !right) {
      continue;
    }

    if (targetMs <= right.timestampMs) {
      const span = right.timestampMs - left.timestampMs;
      const ratio = span <= 0 ? 0 : clamp((targetMs - left.timestampMs) / span, 0, 1);
      return {
        altitude: clamp01(lerp(left.factors.altitude, right.factors.altitude, ratio)),
        turbidity: clamp01(lerp(left.factors.turbidity, right.factors.turbidity, ratio)),
        humidity: clamp01(lerp(left.factors.humidity, right.factors.humidity, ratio)),
        cloud_fraction: clamp01(lerp(left.factors.cloud_fraction, right.factors.cloud_fraction, ratio)),
        ozone_factor: clamp01(lerp(left.factors.ozone_factor, right.factors.ozone_factor, ratio)),
        light_pollution: clamp01(lerp(left.factors.light_pollution, right.factors.light_pollution, ratio)),
      };
    }
  }

  return last?.factors ?? first?.factors ?? {
    altitude: 0,
    turbidity: 0.5,
    humidity: 0.5,
    cloud_fraction: 0.3,
    ozone_factor: 0.5,
    light_pollution: 0.5,
  };
}

function computeStopShiftMinutes(name: SkyStopName, factors: SkySecondOrderFactors): number {
  if (FIXED_STOPS.has(name)) {
    return 0;
  }

  const cloud = factors.cloud_fraction;
  const humidity = factors.humidity;
  const turbidity = factors.turbidity;
  const altitude = factors.altitude;
  const ozone = factors.ozone_factor;

  if (DAWN_STOPS.has(name)) {
    const shift = cloud * 10 + humidity * 3 + turbidity * 6 + ozone * 2 - altitude * 8;
    return Math.round(clamp(shift, -18, 18));
  }

  if (DUSK_STOPS.has(name)) {
    const shift = -cloud * 10 - humidity * 2 - turbidity * 6 - ozone * 2 + altitude * 8;
    return Math.round(clamp(shift, -18, 18));
  }

  return 0;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = hex.replace("#", "").trim();
  const value = normalized.length === 3
    ? `${normalized[0]}${normalized[0]}${normalized[1]}${normalized[1]}${normalized[2]}${normalized[2]}`
    : normalized;

  const parsed = Number.parseInt(value, 16);
  return {
    r: (parsed >> 16) & 0xff,
    g: (parsed >> 8) & 0xff,
    b: parsed & 0xff,
  };
}

function rgbToHex(rgb: { r: number; g: number; b: number }): string {
  const toHex = (value: number) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, "0");
  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
}

function rgbToHsl(rgb: { r: number; g: number; b: number }): { h: number; s: number; l: number } {
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let h = 0;
  const l = (max + min) / 2;
  let s = 0;

  if (delta !== 0) {
    s = delta / (1 - Math.abs(2 * l - 1));
    if (max === r) {
      h = ((g - b) / delta) % 6;
    } else if (max === g) {
      h = (b - r) / delta + 2;
    } else {
      h = (r - g) / delta + 4;
    }
  }

  return {
    h: modulo(h * 60, 360),
    s: s * 100,
    l: l * 100,
  };
}

function hslToRgb(hsl: { h: number; s: number; l: number }): { r: number; g: number; b: number } {
  const h = modulo(hsl.h, 360) / 360;
  const s = clamp(hsl.s / 100, 0, 1);
  const l = clamp(hsl.l / 100, 0, 1);

  if (s === 0) {
    const gray = Math.round(l * 255);
    return { r: gray, g: gray, b: gray };
  }

  const hueToRgb = (p: number, q: number, t: number): number => {
    let adjusted = t;
    if (adjusted < 0) {
      adjusted += 1;
    }
    if (adjusted > 1) {
      adjusted -= 1;
    }
    if (adjusted < 1 / 6) {
      return p + (q - p) * 6 * adjusted;
    }
    if (adjusted < 1 / 2) {
      return q;
    }
    if (adjusted < 2 / 3) {
      return p + (q - p) * (2 / 3 - adjusted) * 6;
    }

    return p;
  };

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;

  return {
    r: Math.round(hueToRgb(p, q, h + 1 / 3) * 255),
    g: Math.round(hueToRgb(p, q, h) * 255),
    b: Math.round(hueToRgb(p, q, h - 1 / 3) * 255),
  };
}

function transformedColor(stop: SkyStopName, factors: SkySecondOrderFactors): string {
  const base = BASE_COLORS[stop];
  const hsl = rgbToHsl(hexToRgb(base));

  const cloud = factors.cloud_fraction;
  const turbidity = factors.turbidity;
  const humidity = factors.humidity;
  const altitude = factors.altitude;
  const ozone = factors.ozone_factor;
  const lightPollution = factors.light_pollution;

  let hue = hsl.h;
  let saturation = hsl.s - cloud * 22 - turbidity * 12 + ozone * 6;
  let lightness = hsl.l - cloud * 20 - turbidity * 12 - humidity * 8 + altitude * 6 - lightPollution * 14;

  if (DUSK_STOPS.has(stop) || stop === "astronomical_night" || stop === "local_midnight_start" || stop === "local_midnight_end") {
    hue += lightPollution * 12 + turbidity * 4;
  } else {
    hue -= turbidity * 5;
  }

  saturation = clamp(saturation, 8, 98);
  lightness = clamp(lightness, 2, 96);

  return rgbToHex(hslToRgb({ h: hue, s: saturation, l: lightness }));
}

function mergeDiagnostics(
  diagnostics: SkyFactorDiagnostics,
  factorOverrides: Partial<SkySecondOrderFactors> | undefined,
  polarConditionImputed: boolean,
): Sky24hResult["diagnostics"] {
  const mergedFactors = { ...diagnostics.factors };
  for (const factorName of FACTOR_NAMES) {
    const overrideValue = factorOverrides?.[factorName];
    if (overrideValue === undefined) {
      continue;
    }

    mergedFactors[factorName] = {
      value: clamp01(overrideValue),
      source: "override",
      confidence: 1,
      notes: [...(mergedFactors[factorName]?.notes ?? []), "manual override"],
    };
  }

  const fallbackReasons = [...diagnostics.fallbackReasons];
  if (polarConditionImputed) {
    fallbackReasons.push("polar_conditions_imputed_events");
  }

  return {
    ...diagnostics,
    factors: mergedFactors,
    degraded: diagnostics.degraded || polarConditionImputed,
    fallbackReasons,
    interpolation: "hourly_linear",
    polarConditionImputed,
  };
}

function toStopAngle(minutesOfDay: number): number {
  return modulo((minutesOfDay / MINUTES_PER_DAY) * 360, 360);
}

export function computeSky24h(
  coords: Coordinates,
  environment: SkyEnvironment,
  atMs: number,
  options?: Pick<SkyComputationOptions, "factorOverrides" | "applySecondOrder">,
): Sky24hResult {
  const applySecondOrder = options?.applySecondOrder ?? true;
  const context = getLocalDayContext(atMs, environment.timezone);
  const baseline = buildBaselineStopMinutes(context.dayStartMs, coords);

  const stops: SkyColorStop[] = STOP_ORDER.map(stopName => {
    const baseMinutes = baseline.minutesByStop[stopName];
    const baseTimestampMs = context.dayStartMs + (stopName === "local_midnight_end" ? MS_PER_DAY : baseMinutes * MS_PER_MINUTE);

    const sampledFactors = interpolateFactors(environment.samples, baseTimestampMs);
    const factors = mergeFactors(sampledFactors, options?.factorOverrides);

    const shiftMinutes = applySecondOrder ? computeStopShiftMinutes(stopName, factors) : 0;
    const minutesOfDay =
      stopName === "local_midnight_start"
        ? 0
        : stopName === "local_midnight_end"
          ? MINUTES_PER_DAY
          : modulo(baseMinutes + shiftMinutes, MINUTES_PER_DAY);

    const timestampMs =
      stopName === "local_midnight_end"
        ? context.dayEndMs
        : context.dayStartMs + minutesOfDay * MS_PER_MINUTE;

    return {
      name: stopName,
      timestampMs,
      minutesOfDay,
      angleDeg: toStopAngle(minutesOfDay === MINUTES_PER_DAY ? 0 : minutesOfDay),
      colorHex: applySecondOrder ? transformedColor(stopName, factors) : BASE_COLORS[stopName],
      shiftMinutes,
      factors,
    };
  });

  const startStop = stops.find(stop => stop.name === "local_midnight_start");
  const endStop = stops.find(stop => stop.name === "local_midnight_end");
  const sortedMidStops = stops
    .filter(stop => stop.name !== "local_midnight_start" && stop.name !== "local_midnight_end")
    .sort((left, right) => left.minutesOfDay - right.minutesOfDay);

  const orderedStops = [
    ...(startStop ? [startStop] : []),
    ...sortedMidStops,
    ...(endStop ? [endStop] : []),
  ];

  const rotationDeg = normalizeDegrees(-(context.currentMinutes / MINUTES_PER_DAY) * 360);
  const rotationRad = (rotationDeg * Math.PI) / 180;

  return {
    timestampMs: atMs,
    timezone: environment.timezone,
    rotationDeg,
    rotationRad,
    stops: orderedStops,
    diagnostics: mergeDiagnostics(environment.diagnostics, options?.factorOverrides, baseline.polarConditionImputed),
  };
}
