import { useCallback, useEffect, useMemo, useState } from "react";
import "./index.css";

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

interface ApiErrorResponse {
  error?: {
    code?: string;
    message?: string;
  };
}

interface LocationPreset extends Coordinates {
  id: string;
  label: string;
}

const PRESETS: LocationPreset[] = [
  { id: "sf", label: "San Francisco", lat: 37.7749, long: -122.4194 },
  { id: "reykjavik", label: "Reykjavik", lat: 64.1466, long: -21.9426 },
  { id: "singapore", label: "Singapore", lat: 1.3521, long: 103.8198 },
  { id: "ushuaia", label: "Ushuaia", lat: -54.8019, long: -68.303 },
];

const FACTOR_LABELS: Array<{ key: FactorKey; label: string }> = [
  { key: "altitude", label: "Altitude" },
  { key: "turbidity", label: "Turbidity" },
  { key: "humidity", label: "Humidity" },
  { key: "cloud_fraction", label: "Cloud Fraction" },
  { key: "ozone_factor", label: "Ozone Factor" },
  { key: "light_pollution", label: "Light Pollution" },
];

const HIGHLIGHT_STOPS = new Set(["sunrise", "solar_noon", "sunset", "astronomical_dawn", "astronomical_dusk"]);

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

function buildConicGradient(stops: SkyStop[], rotationDeg = 0): string {
  if (stops.length === 0) {
    return `conic-gradient(from ${rotationDeg}deg, #08121b, #0e273a, #08121b)`;
  }

  const rawPoints = stops
    .filter(stop => stop.minutesOfDay >= 0 && stop.minutesOfDay <= 1440)
    .map(stop => ({
      color: stop.colorHex,
      minute: Number(stop.minutesOfDay.toFixed(3)),
    }))
    .sort((left, right) => left.minute - right.minute);

  if (rawPoints.length === 0) {
    return `conic-gradient(from ${rotationDeg}deg, #08121b, #0e273a, #08121b)`;
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
    return `conic-gradient(from ${rotationDeg}deg, #08121b, #0e273a, #08121b)`;
  }

  if (points[0].minute > 0) {
    const firstColor = points[0].color;
    points.unshift({ color: firstColor, minute: 0 });
  }

  const cleanedPoints = points.filter(point => point.minute < 1440);
  if (cleanedPoints.length === 0) {
    return `conic-gradient(from ${rotationDeg}deg, #08121b, #0e273a, #08121b)`;
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

  return `conic-gradient(from ${rotationDeg}deg, ${segments.join(", ")})`;
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

export function App() {
  const [coords, setCoords] = useState<Coordinates>({ lat: PRESETS[0]!.lat, long: PRESETS[0]!.long });
  const [selectedPreset, setSelectedPreset] = useState<string>(PRESETS[0]!.id);
  const [dateTimeLocal, setDateTimeLocal] = useState<string>(() => toDatetimeLocalInputValue(Date.now()));
  const [secondOrderEnabled, setSecondOrderEnabled] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Sky24hResult | null>(null);

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

      const response = await fetch(url);
      const payload = (await response.json()) as SkyApiResponse | ApiErrorResponse;
      if (!response.ok) {
        const apiError = payload as ApiErrorResponse;
        throw new Error(apiError.error?.message ?? `Request failed (${response.status})`);
      }

      const data = payload as SkyApiResponse;
      setResult(data.result);
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : String(requestError);
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [coords.lat, coords.long, dateTimeLocal, secondOrderEnabled]);

  useEffect(() => {
    void fetchSky();
  }, [fetchSky]);

  const wheelGradient = useMemo(
    () => buildConicGradient(result?.stops ?? [], result?.rotationDeg ?? 0),
    [result],
  );

  const highlightedStops = useMemo(() => {
    if (!result) {
      return [] as SkyStop[];
    }

    return result.stops.filter(stop => HIGHLIGHT_STOPS.has(stop.name));
  }, [result]);

  const diagnostics = result?.diagnostics;

  const handlePresetChange = (presetId: string) => {
    setSelectedPreset(presetId);
    const preset = PRESETS.find(item => item.id === presetId);
    if (!preset) {
      return;
    }

    setCoords({ lat: preset.lat, long: preset.long });
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
        setSelectedPreset("custom");
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
          <label>
            Location preset
            <select value={selectedPreset} onChange={event => handlePresetChange(event.target.value)}>
              {PRESETS.map(preset => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
              <option value="custom">Custom coordinates</option>
            </select>
          </label>

          <label>
            Latitude
            <input
              type="number"
              step="0.0001"
              value={coords.lat}
              onChange={event => setCoords(current => ({ ...current, lat: clampCoordinate(Number(event.target.value), -90, 90) }))}
            />
          </label>

          <label>
            Longitude
            <input
              type="number"
              step="0.0001"
              value={coords.long}
              onChange={event => setCoords(current => ({ ...current, long: clampCoordinate(Number(event.target.value), -180, 180) }))}
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
            }}
          />
          <div className="sky-wheel-inner">
            <p className="inner-label">Current top alignment</p>
            <p className="inner-rotation">{result ? `${result.rotationDeg.toFixed(1)} deg` : "-"}</p>
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

            return (
              <article key={item.key} className="factor-card">
                <div className="factor-top-row">
                  <p>{item.label}</p>
                  <span>{Math.round(value * 100)}%</span>
                </div>
                <div className="factor-track">
                  <div className="factor-fill" style={{ width: `${Math.round(value * 100)}%` }} />
                </div>
                <small>
                  {(factor?.source ?? "-")}
                  {factor ? ` | confidence ${Math.round(factor.confidence * 100)}%` : ""}
                </small>
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

export default App;
