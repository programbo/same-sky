import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "../index.css";

type FactorKey = "altitude" | "turbidity" | "humidity" | "cloud_fraction" | "ozone_factor" | "light_pollution";

type FactorSource = "live" | "fallback" | "override";

interface SkyFactorSummary {
  value: number;
  source: FactorSource;
  confidence: number;
  notes?: string[];
}

interface SkyDiagnostics {
  factors: Record<FactorKey, SkyFactorSummary>;
  providerQuality: "live" | "mixed" | "fallback";
  degraded: boolean;
  fallbackReasons: string[];
  interpolation: "hourly_linear";
  polarConditionImputed: boolean;
}

interface SkyStop {
  name: string;
  timestampMs: number;
  minutesOfDay: number;
  angleDeg: number;
  colorHex: string;
  shiftMinutes: number;
}

interface Sky24hResult {
  timestampMs: number;
  timezone: string;
  rotationDeg: number;
  rotationRad: number;
  stops: SkyStop[];
  diagnostics: SkyDiagnostics;
}

interface Coordinates {
  lat: number;
  long: number;
}

interface SkyApiResponse {
  result: Sky24hResult;
}

interface PersistedLocationApiResult {
  id: string;
  name: string;
  lat: number;
  long: number;
  nickname?: string;
  timezone?: string;
  granularity?: string;
  createdAtMs: number;
}

interface PersistedLocationsApiResponse {
  results: PersistedLocationApiResult[];
}

interface ApiErrorResponse {
  error?: {
    code?: string;
    message?: string;
  };
}

const FACTOR_LABELS: Array<{ key: FactorKey; label: string }> = [
  { key: "altitude", label: "Altitude" },
  { key: "turbidity", label: "Turbidity" },
  { key: "humidity", label: "Humidity" },
  { key: "cloud_fraction", label: "Cloud Fraction" },
  { key: "ozone_factor", label: "Ozone Factor" },
  { key: "light_pollution", label: "Light Pollution" },
];

const DEFAULT_FACTOR_ENABLED: Record<FactorKey, boolean> = {
  altitude: true,
  turbidity: true,
  humidity: true,
  cloud_fraction: true,
  ozone_factor: true,
  light_pollution: true,
};

const HIGHLIGHT_STOPS = new Set(["sunrise", "solar_noon", "sunset", "astronomical_dawn", "astronomical_dusk"]);
const WHEEL_TWEEN_MS = 650;
const DEFAULT_COORDS: Coordinates = { lat: 0, long: 0 };
const CUSTOM_LOCATION_OPTION = "custom";

function toPersistedOptionId(id: string): string {
  return `persisted:${id}`;
}

function getTimeZoneOffsetMinutes(timeZone: string, atMs: number): number | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(new Date(atMs));

    const readPart = (type: Intl.DateTimeFormatPartTypes): number => {
      const value = parts.find(part => part.type === type)?.value;
      return Number(value);
    };

    const year = readPart("year");
    const month = readPart("month");
    const day = readPart("day");
    const hour = readPart("hour");
    const minute = readPart("minute");
    const second = readPart("second");

    if (![year, month, day, hour, minute, second].every(Number.isFinite)) {
      return null;
    }

    const utcFromZoneParts = Date.UTC(year, month - 1, day, hour, minute, second);
    return Math.round((utcFromZoneParts - atMs) / 60_000);
  } catch {
    return null;
  }
}

function formatOffsetDelta(deltaMinutes: number): string {
  const sign = deltaMinutes > 0 ? "+" : "-";
  const absolute = Math.abs(deltaMinutes);
  const hours = Math.floor(absolute / 60);
  const minutes = absolute % 60;

  if (hours > 0 && minutes > 0) {
    return `${sign}${hours}h ${minutes}m`;
  }

  if (hours > 0) {
    return `${sign}${hours}h`;
  }

  return `${sign}${minutes}m`;
}

function getPersistedOffsetDeltaMinutes(location: PersistedLocationApiResult, atMs: number): number | null {
  if (!location.timezone) {
    return null;
  }

  const locationOffset = getTimeZoneOffsetMinutes(location.timezone, atMs);
  if (locationOffset === null) {
    return null;
  }

  const localOffset = -new Date(atMs).getTimezoneOffset();
  return locationOffset - localOffset;
}

function formatPersistedOptionLabel(location: PersistedLocationApiResult, atMs: number): string {
  const nickname = location.nickname?.trim();
  const label = nickname || "Unnamed location";
  const deltaMinutes = getPersistedOffsetDeltaMinutes(location, atMs);
  if (deltaMinutes === 0) {
    return label;
  }

  if (deltaMinutes === null) {
    return label;
  }

  return `${label} (${formatOffsetDelta(deltaMinutes)})`;
}

function toDatetimeLocalInputValue(atMs: number): string {
  const date = new Date(atMs);
  const pad = (value: number) => String(value).padStart(2, "0");
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hour = pad(date.getHours());
  const minute = pad(date.getMinutes());
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function clampCoordinate(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.max(min, Math.min(max, value));
}

interface RGBColor {
  r: number;
  g: number;
  b: number;
}

function hexToRgb(hex: string): RGBColor {
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

function rgbToHex(rgb: RGBColor): string {
  const toHex = (value: number) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");
  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
}

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (
    (2 * p1) +
    (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t3
  );
}

function buildConicGradient(stops: SkyStop[]): string {
  if (stops.length === 0) {
    return "conic-gradient(from 0deg, #08121b, #0e273a, #08121b)";
  }

  const rawPoints = stops
    .filter(stop => stop.minutesOfDay >= 0 && stop.minutesOfDay <= 1440)
    .map(stop => ({
      color: stop.colorHex,
      minute: Number(stop.minutesOfDay.toFixed(3)),
    }))
    .sort((left, right) => left.minute - right.minute);

  if (rawPoints.length === 0) {
    return "conic-gradient(from 0deg, #08121b, #0e273a, #08121b)";
  }

  const points: Array<{ color: string; minute: number }> = [];
  for (const point of rawPoints) {
    const previous = points[points.length - 1];
    if (previous && Math.abs(previous.minute - point.minute) < 0.001) {
      const prevRgb = hexToRgb(previous.color);
      const nextRgb = hexToRgb(point.color);
      previous.color = rgbToHex({
        r: (prevRgb.r + nextRgb.r) / 2,
        g: (prevRgb.g + nextRgb.g) / 2,
        b: (prevRgb.b + nextRgb.b) / 2,
      });
    } else {
      points.push({ ...point });
    }
  }

  if (!points[0]) {
    return "conic-gradient(from 0deg, #08121b, #0e273a, #08121b)";
  }

  if (points[0].minute > 0) {
    const firstColor = points[0].color;
    points.unshift({ color: firstColor, minute: 0 });
  }

  const cleanedPoints = points.filter(point => point.minute < 1440);
  if (cleanedPoints.length === 0) {
    return "conic-gradient(from 0deg, #08121b, #0e273a, #08121b)";
  }

  const sampleColorAtMinute = (minute: number): string => {
    const normalizedMinute = ((minute % 1440) + 1440) % 1440;
    let leftIndex = 0;

    for (let index = 0; index < cleanedPoints.length; index += 1) {
      const current = cleanedPoints[index]!;
      const next = cleanedPoints[(index + 1) % cleanedPoints.length]!;
      const currentMinute = current.minute;
      const nextMinute = index === cleanedPoints.length - 1 ? next.minute + 1440 : next.minute;
      const testMinute = index === cleanedPoints.length - 1 && normalizedMinute < currentMinute
        ? normalizedMinute + 1440
        : normalizedMinute;

      if (testMinute >= currentMinute && testMinute <= nextMinute) {
        leftIndex = index;
        break;
      }
    }

    const i0 = (leftIndex - 1 + cleanedPoints.length) % cleanedPoints.length;
    const i1 = leftIndex;
    const i2 = (leftIndex + 1) % cleanedPoints.length;
    const i3 = (leftIndex + 2) % cleanedPoints.length;

    const p0 = cleanedPoints[i0]!;
    const p1 = cleanedPoints[i1]!;
    const p2 = cleanedPoints[i2]!;
    const p3 = cleanedPoints[i3]!;

    const m1 = p1.minute;
    const m2Base = i1 === cleanedPoints.length - 1 ? p2.minute + 1440 : p2.minute;
    const m = i1 === cleanedPoints.length - 1 && normalizedMinute < m1 ? normalizedMinute + 1440 : normalizedMinute;
    const span = Math.max(1, m2Base - m1);
    const t = Math.max(0, Math.min(1, (m - m1) / span));

    const c0 = hexToRgb(p0.color);
    const c1 = hexToRgb(p1.color);
    const c2 = hexToRgb(p2.color);
    const c3 = hexToRgb(p3.color);

    return rgbToHex({
      r: catmullRom(c0.r, c1.r, c2.r, c3.r, t),
      g: catmullRom(c0.g, c1.g, c2.g, c3.g, t),
      b: catmullRom(c0.b, c1.b, c2.b, c3.b, t),
    });
  };

  const SAMPLE_STEP_MINUTES = 2;
  const segments: string[] = [];

  for (let minute = 0; minute <= 1440; minute += SAMPLE_STEP_MINUTES) {
    const color = sampleColorAtMinute(minute);
    const pct = Number(((minute / 1440) * 100).toFixed(3));
    segments.push(`${color} ${pct}%`);
  }

  if (!segments[segments.length - 1]?.endsWith("100%")) {
    segments.push(`${sampleColorAtMinute(0)} 100%`);
  }

  return `conic-gradient(from 0deg, ${segments.join(", ")})`;
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

function normalizeDegrees(degrees: number): number {
  return ((degrees + 180) % 360 + 360) % 360 - 180;
}

function shortestAngleDelta(from: number, to: number): number {
  return normalizeDegrees(to - from);
}

function easeInOutCubic(t: number): number {
  if (t < 0.5) {
    return 4 * t * t * t;
  }

  return 1 - ((-2 * t + 2) ** 3) / 2;
}

function lerpCircular(from: number, to: number, modulus: number, t: number): number {
  const diff = ((to - from + modulus / 2) % modulus + modulus) % modulus - modulus / 2;
  return ((from + diff * t) % modulus + modulus) % modulus;
}

function interpolateSkyStop(from: SkyStop, to: SkyStop, t: number): SkyStop {
  const isMidnightStart = to.name === "local_midnight_start";
  const isMidnightEnd = to.name === "local_midnight_end";

  const minutesOfDay = isMidnightStart
    ? 0
    : isMidnightEnd
      ? 1440
      : lerpCircular(from.minutesOfDay, to.minutesOfDay, 1440, t);

  return {
    ...to,
    timestampMs: Math.round(lerp(from.timestampMs, to.timestampMs, t)),
    minutesOfDay,
    angleDeg: (minutesOfDay / 1440) * 360,
    colorHex: rgbToHex({
      r: lerp(hexToRgb(from.colorHex).r, hexToRgb(to.colorHex).r, t),
      g: lerp(hexToRgb(from.colorHex).g, hexToRgb(to.colorHex).g, t),
      b: lerp(hexToRgb(from.colorHex).b, hexToRgb(to.colorHex).b, t),
    }),
    shiftMinutes: Math.round(lerp(from.shiftMinutes, to.shiftMinutes, t)),
  };
}

function interpolateSkyResult(from: Sky24hResult, to: Sky24hResult, t: number): Sky24hResult {
  const stopByName = new Map(from.stops.map(stop => [stop.name, stop] as const));
  const interpolatedStops = to.stops.map(stop => {
    const source = stopByName.get(stop.name);
    return source ? interpolateSkyStop(source, stop, t) : stop;
  });

  const rotationDeg = normalizeDegrees(from.rotationDeg + shortestAngleDelta(from.rotationDeg, to.rotationDeg) * t);
  const rotationRad = (rotationDeg * Math.PI) / 180;

  return {
    ...to,
    timestampMs: Math.round(lerp(from.timestampMs, to.timestampMs, t)),
    rotationDeg,
    rotationRad,
    stops: interpolatedStops,
  };
}

function formatStopTime(timestampMs: number, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(timestampMs));
}

function formatDeltaFromNow(targetMs: number, nowMs: number): string {
  const diffMinutes = Math.round((targetMs - nowMs) / 60_000);
  if (diffMinutes === 0) {
    return "now";
  }

  const sign = diffMinutes >= 0 ? "+" : "-";
  const absoluteMinutes = Math.abs(diffMinutes);
  const hours = Math.floor(absoluteMinutes / 60);
  const minutes = absoluteMinutes % 60;

  if (hours === 0) {
    return `${sign}${minutes}m`;
  }

  if (minutes === 0) {
    return `${sign}${hours}h`;
  }

  return `${sign}${hours}h ${minutes}m`;
}

function formatStopName(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, letter => letter.toUpperCase());
}

export function RingRendererPage() {
  const [coords, setCoords] = useState<Coordinates>(DEFAULT_COORDS);
  const [selectedPreset, setSelectedPreset] = useState<string>(CUSTOM_LOCATION_OPTION);
  const [persistedLocations, setPersistedLocations] = useState<PersistedLocationApiResult[]>([]);
  const [dateTimeLocal, setDateTimeLocal] = useState<string>(() => toDatetimeLocalInputValue(Date.now()));
  const [secondOrderEnabled, setSecondOrderEnabled] = useState<boolean>(true);
  const [factorEnabled, setFactorEnabled] = useState<Record<FactorKey, boolean>>(() => ({ ...DEFAULT_FACTOR_ENABLED }));
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Sky24hResult | null>(null);
  const [animatedRingResult, setAnimatedRingResult] = useState<Sky24hResult | null>(null);
  const initializedFromPersistedRef = useRef<boolean>(false);
  const animatedRingRef = useRef<Sky24hResult | null>(null);
  const tweenFrameRef = useRef<number | null>(null);

  useEffect(() => {
    animatedRingRef.current = animatedRingResult;
  }, [animatedRingResult]);

  useEffect(() => {
    return () => {
      if (tweenFrameRef.current !== null) {
        cancelAnimationFrame(tweenFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const fetchPersistedLocations = async () => {
      try {
        const response = await fetch(new URL("/api/locations/persisted", window.location.origin));
        if (!response.ok) {
          return;
        }

        const payload = (await response.json()) as PersistedLocationsApiResponse;
        if (!cancelled) {
          setPersistedLocations(Array.isArray(payload.results) ? payload.results : []);
        }
      } catch {
        // Preserve existing UX even when persisted-location API is unavailable.
      }
    };

    void fetchPersistedLocations();

    return () => {
      cancelled = true;
    };
  }, []);

  const optionLabelAtMs = useMemo(() => {
    const parsed = Date.parse(dateTimeLocal);
    return Number.isFinite(parsed) ? parsed : Date.now();
  }, [dateTimeLocal]);

  const selectableLocations = useMemo(() => {
    return persistedLocations.map(location => ({
      id: toPersistedOptionId(location.id),
      lat: location.lat,
      long: location.long,
    }));
  }, [persistedLocations]);

  const sortedPersistedLocations = useMemo(() => {
    const nicknameOf = (location: PersistedLocationApiResult) => location.nickname?.trim() || "Unnamed location";

    return [...persistedLocations].sort((left, right) => {
      const leftDelta = getPersistedOffsetDeltaMinutes(left, optionLabelAtMs);
      const rightDelta = getPersistedOffsetDeltaMinutes(right, optionLabelAtMs);

      if (leftDelta === null && rightDelta !== null) {
        return 1;
      }

      if (leftDelta !== null && rightDelta === null) {
        return -1;
      }

      if (leftDelta !== null && rightDelta !== null && leftDelta !== rightDelta) {
        return leftDelta - rightDelta;
      }

      return nicknameOf(left).localeCompare(nicknameOf(right), undefined, { sensitivity: "base" });
    });
  }, [persistedLocations, optionLabelAtMs]);

  useEffect(() => {
    if (initializedFromPersistedRef.current || sortedPersistedLocations.length === 0) {
      return;
    }

    const first = sortedPersistedLocations[0];
    if (!first) {
      return;
    }

    initializedFromPersistedRef.current = true;
    setSelectedPreset(toPersistedOptionId(first.id));
    setCoords({ lat: first.lat, long: first.long });
  }, [sortedPersistedLocations]);

  const fetchSky = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const atMs = Date.parse(dateTimeLocal);
      const url = new URL("/api/location/sky-24h", window.location.origin);
      url.searchParams.set("lat", String(coords.lat));
      url.searchParams.set("long", String(coords.long));
      if (Number.isFinite(atMs)) {
        url.searchParams.set("at", String(atMs));
      }
      url.searchParams.set("secondOrder", secondOrderEnabled ? "1" : "0");
      for (const item of FACTOR_LABELS) {
        url.searchParams.set(`factorEnabled_${item.key}`, factorEnabled[item.key] ? "1" : "0");
      }

      const response = await fetch(url);
      const payload = (await response.json()) as SkyApiResponse | ApiErrorResponse;
      if (!response.ok) {
        const apiError = payload as ApiErrorResponse;
        throw new Error(apiError.error?.message ?? `Request failed (${response.status})`);
      }

      const data = payload as SkyApiResponse;
      setResult(data.result);
      if (!animatedRingRef.current) {
        setAnimatedRingResult(data.result);
      } else {
        const from = animatedRingRef.current;
        const to = data.result;
        const startMs = performance.now();

        if (tweenFrameRef.current !== null) {
          cancelAnimationFrame(tweenFrameRef.current);
        }

        const tick = (nowMs: number) => {
          const rawProgress = Math.max(0, Math.min(1, (nowMs - startMs) / WHEEL_TWEEN_MS));
          const eased = easeInOutCubic(rawProgress);
          setAnimatedRingResult(interpolateSkyResult(from, to, eased));

          if (rawProgress < 1) {
            tweenFrameRef.current = requestAnimationFrame(tick);
          } else {
            tweenFrameRef.current = null;
            setAnimatedRingResult(to);
          }
        };

        tweenFrameRef.current = requestAnimationFrame(tick);
      }
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : String(requestError);
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [coords.lat, coords.long, dateTimeLocal, factorEnabled, secondOrderEnabled]);

  useEffect(() => {
    void fetchSky();
  }, [fetchSky]);

  const baseWheelResult = animatedRingResult ?? result;
  const wheelGradient = useMemo(
    () => buildConicGradient(baseWheelResult?.stops ?? []),
    [baseWheelResult],
  );
  const wheelRotationDeg = baseWheelResult?.rotationDeg ?? result?.rotationDeg ?? 0;

  const highlightedStops = useMemo(() => {
    if (!result) {
      return [] as SkyStop[];
    }

    return result.stops.filter(stop => HIGHLIGHT_STOPS.has(stop.name));
  }, [result]);

  const diagnostics = result?.diagnostics;

  const handlePresetChange = (optionId: string) => {
    setSelectedPreset(optionId);
    if (optionId === CUSTOM_LOCATION_OPTION) {
      return;
    }

    const selected = selectableLocations.find(item => item.id === optionId);
    if (!selected) {
      return;
    }

    setCoords({ lat: selected.lat, long: selected.long });
  };

  const useCurrentLocation = () => {
    if (!navigator.geolocation) {
      setError("Geolocation is unavailable in this browser.");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      position => {
        setCoords({
          lat: clampCoordinate(position.coords.latitude, -90, 90),
          long: clampCoordinate(position.coords.longitude, -180, 180),
        });
        setSelectedPreset(CUSTOM_LOCATION_OPTION);
      },
      geolocationError => {
        setError(`Geolocation failed: ${geolocationError.message}`);
      },
      { timeout: 10_000, maximumAge: 5 * 60 * 1000 },
    );
  };

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <p className="eyebrow">Sky Colour Demo</p>
        <h1>24-Hour Ring Renderer</h1>
        <p className="intro">
          This demo calls <code>/api/location/sky-24h</code> and paints the ring directly from named stop colors.
        </p>

        <div className="control-grid">
          <label className="location-select-field">
            Saved location
            <select className="location-select" value={selectedPreset} onChange={event => handlePresetChange(event.target.value)}>
              {sortedPersistedLocations.length > 0 ? (
                <optgroup label="Persisted">
                  {sortedPersistedLocations.map(location => (
                    <option key={location.id} value={toPersistedOptionId(location.id)}>
                      {formatPersistedOptionLabel(location, optionLabelAtMs)}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              <option value={CUSTOM_LOCATION_OPTION}>Custom coordinates</option>
            </select>
          </label>

          <label>
            Latitude
            <input
              type="number"
              step="0.0001"
              value={coords.lat}
              onChange={event => {
                setSelectedPreset(CUSTOM_LOCATION_OPTION);
                setCoords(current => ({ ...current, lat: clampCoordinate(Number(event.target.value), -90, 90) }));
              }}
            />
          </label>

          <label>
            Longitude
            <input
              type="number"
              step="0.0001"
              value={coords.long}
              onChange={event => {
                setSelectedPreset(CUSTOM_LOCATION_OPTION);
                setCoords(current => ({ ...current, long: clampCoordinate(Number(event.target.value), -180, 180) }));
              }}
            />
          </label>

          <label>
            Local date/time
            <input type="datetime-local" value={dateTimeLocal} onChange={event => setDateTimeLocal(event.target.value)} />
          </label>
        </div>

        <div className="actions-row">
          <button type="button" onClick={fetchSky} disabled={loading}>
            {loading ? "Rendering..." : "Render Gradient"}
          </button>
          <button type="button" className="ghost" onClick={useCurrentLocation} disabled={loading}>
            Use my location
          </button>
          <label className="toggle-chip">
            <input
              type="checkbox"
              checked={secondOrderEnabled}
              onChange={event => setSecondOrderEnabled(event.target.checked)}
            />
            <span>Second-order factors</span>
          </label>
        </div>

        {error ? <p className="error-banner">{error}</p> : null}
      </section>

      <section className="ring-stage">
        <div className="sky-wheel-frame">
          <div
            className="sky-wheel"
            style={{
              backgroundImage: wheelGradient,
              transform: `rotate(${wheelRotationDeg}deg)`,
            }}
          />
          <div className="sky-wheel-inner">
            <p className="inner-label">Current top alignment</p>
            <p className="inner-rotation">{baseWheelResult ? `${baseWheelResult.rotationDeg.toFixed(1)} deg` : "-"}</p>
            <p className="inner-timezone">{result?.timezone ?? "Loading timezone..."}</p>
          </div>
          <div className="top-indicator" />
        </div>

        <div className="stop-strip">
          {highlightedStops.map(stop => (
            <article key={stop.name} className="stop-chip">
              <span className="chip-swatch" style={{ backgroundColor: stop.colorHex }} />
              <div>
                <p>{formatStopName(stop.name)}</p>
                {result ? (
                  <small>
                    {formatStopTime(stop.timestampMs, result.timezone)}
                    {" "}
                    ({formatDeltaFromNow(stop.timestampMs, result.timestampMs)})
                  </small>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="diagnostics-panel">
        <header>
          <h2>Second-order diagnostics</h2>
          <p>
            Source quality: <strong>{diagnostics?.providerQuality ?? "-"}</strong>
            {diagnostics?.degraded ? " (degraded)" : ""}
          </p>
        </header>

        <div className="factor-grid">
          {FACTOR_LABELS.map(item => {
            const factor = diagnostics?.factors[item.key];
            const value = factor?.value ?? 0;
            const percentage = Math.round(value * 100);
            const enabled = factorEnabled[item.key];

            return (
              <article key={item.key} className={`factor-card${enabled ? "" : " is-disabled"}`}>
                <div className="factor-top-row">
                  <label className="factor-toggle">
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={event => {
                        const checked = event.target.checked;
                        setFactorEnabled(current => ({
                          ...current,
                          [item.key]: checked,
                        }));
                      }}
                      disabled={loading || !secondOrderEnabled}
                    />
                    <span>{item.label}</span>
                  </label>
                  <span>{percentage}%</span>
                </div>
                <div className="factor-track">
                  <div className="factor-fill" style={{ width: `${percentage}%` }} />
                </div>
                <small>Data source: {factor?.source ?? "-"}</small>
                <small>Data: {factor ? `${value.toFixed(3)} (${percentage}%)` : "-"}</small>
                <small>Confidence: {factor ? `${Math.round(factor.confidence * 100)}%` : "-"}</small>
              </article>
            );
          })}
        </div>

        <div className="fallback-box">
          <p>Fallback reasons</p>
          {diagnostics && diagnostics.fallbackReasons.length > 0 ? (
            <ul>
              {diagnostics.fallbackReasons.map(reason => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          ) : (
            <p className="none">none</p>
          )}
        </div>
      </section>
    </main>
  );
}

export default RingRendererPage;
