import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import NumberFlow from "@number-flow/react"
import { continuous } from "number-flow/plugins"
import "../home-clock.css"
import { computeSky24h } from "../lib/time-in-place/sky"
import type {
  SkyEnvironment as SharedSkyEnvironment,
  SkySecondOrderFactors as SharedSkySecondOrderFactors,
} from "../lib/time-in-place/types"

type PersistedKind = "location" | "entity"

interface PersistedLocationApiResult {
  id: string
  name: string
  lat: number
  long: number
  nickname?: string
  timezone?: string
  granularity?: string
  kind?: PersistedKind
  entityName?: string
  countryCode?: string
  adminState?: string
  adminCity?: string
  adminSuburb?: string
  createdAtMs: number
}

interface PersistedLocationsApiResponse {
  results: PersistedLocationApiResult[]
}

interface SkyStop {
  name: string
  timestampMs: number
  minutesOfDay: number
  angleDeg: number
  colorHex: string
  shiftMinutes: number
}

interface Sky24hResult {
  timestampMs: number
  timezone: string
  rotationDeg: number
  rotationRad: number
  stops: SkyStop[]
}

interface SkyResponse {
  result: Sky24hResult
}

interface ApiErrorResponse {
  error?: {
    code?: string
    message?: string
  }
}

interface ConceptTokens {
  ringSizeDesktopVmin: number
  ringSizeMobileVmin: number
  ringSizeMaxPx: number
  bandWidthPct: number
  haloSpreadPx: number
  labelBaseRadiusPct: number
  laneStepPx: number
}

interface OrbitLabel {
  id: string
  leadingEmoji: string
  label: string
  time: string
  timezoneMeta: string
  relativeLabel: string
  angleDeg: number
  lane: number
  radialOffsetPx: number
  skyColorHex: string
  isSelected: boolean
  isLocal: boolean
}

interface ClockTimeParts {
  hour: number
  minute: number
  second: number
}

interface UtcOffsetParts {
  sign: "+" | "-"
  hours: number
  minutes: number
}

const STORAGE_SELECTED_ID = "tip_home_selected_item_id"
const MOBILE_BREAKPOINT = 740
const SKY_REFRESH_MS = 60_000
const SELECTION_TRANSITION_MS = 780
const SECONDS_PER_DAY = 24 * 60 * 60
const HOUR_MARKERS = Array.from({ length: 24 }, (_, hour) => hour)
const NIGHT_SKY_STOP_NAMES = new Set([
  "local_midnight_start",
  "astronomical_night",
  "astronomical_dusk",
  "late_night",
  "local_midnight_end",
])
const NUMBER_FLOW_PLUGINS = [continuous]
const CLIENT_BASELINE_FACTORS: SharedSkySecondOrderFactors = {
  altitude: 0,
  turbidity: 0.5,
  humidity: 0.5,
  cloud_fraction: 0.3,
  ozone_factor: 0.5,
  light_pollution: 0.5,
}

const ZENITH_TOKENS: ConceptTokens = {
  ringSizeDesktopVmin: 118,
  ringSizeMobileVmin: 122,
  ringSizeMaxPx: 1240,
  bandWidthPct: 20,
  haloSpreadPx: 190,
  labelBaseRadiusPct: 0.29,
  laneStepPx: 24,
}

function createClientBaselineEnvironment(timezone: string): SharedSkyEnvironment {
  const fallback = (value: number) => ({
    value,
    source: "fallback" as const,
    confidence: 0.4,
  })

  return {
    timezone,
    samples: [],
    diagnostics: {
      factors: {
        altitude: fallback(CLIENT_BASELINE_FACTORS.altitude),
        turbidity: fallback(CLIENT_BASELINE_FACTORS.turbidity),
        humidity: fallback(CLIENT_BASELINE_FACTORS.humidity),
        cloud_fraction: fallback(CLIENT_BASELINE_FACTORS.cloud_fraction),
        ozone_factor: fallback(CLIENT_BASELINE_FACTORS.ozone_factor),
        light_pollution: fallback(CLIENT_BASELINE_FACTORS.light_pollution),
      },
      providerQuality: "fallback",
      degraded: true,
      fallbackReasons: ["client_first_order_preview"],
    },
  }
}

function normalizeMinutesOfDay(value: number): number {
  const normalized = value % 1440
  return normalized < 0 ? normalized + 1440 : normalized
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const value = hex.trim().replace("#", "")
  const normalized = value.length === 3 ? `${value[0]}${value[0]}${value[1]}${value[1]}${value[2]}${value[2]}` : value

  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    return null
  }

  const numeric = Number.parseInt(normalized, 16)
  return {
    r: (numeric >> 16) & 0xff,
    g: (numeric >> 8) & 0xff,
    b: numeric & 0xff,
  }
}

function mixHexColors(leftHex: string, rightHex: string, ratio: number): string {
  const left = hexToRgb(leftHex)
  const right = hexToRgb(rightHex)
  if (!left || !right) {
    return leftHex || rightHex || "#5d8aae"
  }

  const t = clamp(ratio, 0, 1)
  const r = Math.round(left.r + (right.r - left.r) * t)
  const g = Math.round(left.g + (right.g - left.g) * t)
  const b = Math.round(left.b + (right.b - left.b) * t)
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`
}

function hexToRgba(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex)
  if (!rgb) {
    return hex
  }

  const boundedAlpha = clamp(alpha, 0, 1)
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${boundedAlpha})`
}

function sampleSkyColorAtMinute(stops: SkyStop[], minuteOfDay: number): string {
  const minute = normalizeMinutesOfDay(minuteOfDay)
  const points = stops
    .filter((stop) => Number.isFinite(stop.minutesOfDay))
    .map((stop) => ({
      minute: normalizeMinutesOfDay(stop.minutesOfDay),
      colorHex: stop.colorHex || "#5d8aae",
    }))
    .sort((left, right) => left.minute - right.minute)

  if (points.length === 0) {
    return "#5d8aae"
  }
  if (points.length === 1) {
    return points[0]!.colorHex
  }

  const nextIndex = points.findIndex((point) => point.minute >= minute)
  if (nextIndex === -1) {
    const previous = points[points.length - 1]!
    const next = { ...points[0]!, minute: points[0]!.minute + 1440 }
    const ratio = (minute - previous.minute) / (next.minute - previous.minute)
    return mixHexColors(previous.colorHex, next.colorHex, ratio)
  }

  const next = points[nextIndex]!
  const previous =
    nextIndex === 0
      ? { ...points[points.length - 1]!, minute: points[points.length - 1]!.minute - 1440 }
      : points[nextIndex - 1]!

  const span = next.minute - previous.minute
  if (span <= 0) {
    return next.colorHex
  }

  const ratio = (minute - previous.minute) / span
  return mixHexColors(previous.colorHex, next.colorHex, ratio)
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
    }).formatToParts(new Date(atMs))

    const readPart = (type: Intl.DateTimeFormatPartTypes): number => {
      const value = parts.find((part) => part.type === type)?.value
      return Number(value)
    }

    const year = readPart("year")
    const month = readPart("month")
    const day = readPart("day")
    const hour = readPart("hour")
    const minute = readPart("minute")
    const second = readPart("second")

    if (![year, month, day, hour, minute, second].every(Number.isFinite)) {
      return null
    }

    const utcFromZoneParts = Date.UTC(year, month - 1, day, hour, minute, second)
    return Math.round((utcFromZoneParts - atMs) / 60_000)
  } catch {
    return null
  }
}

function formatUtcOffset(offsetMinutes: number): string {
  const sign = offsetMinutes >= 0 ? "+" : "-"
  const absolute = Math.abs(offsetMinutes)
  const hours = Math.floor(absolute / 60)
  const minutes = absolute % 60
  if (minutes === 0) {
    return `${sign}${hours}`
  }

  return `${sign}${hours}:${String(minutes).padStart(2, "0")}`
}

function formatTimezoneMeta(timeZone: string | undefined, atMs: number): string {
  if (!timeZone) {
    return "UTC"
  }

  const offsetMinutes = getTimeZoneOffsetMinutes(timeZone, atMs)
  if (offsetMinutes === null) {
    return "UTC"
  }

  return `UTC${formatUtcOffset(offsetMinutes)}`
}

function formatRelativeOffsetLabel(deltaMinutes: number): string {
  if (deltaMinutes === 0) {
    return "same offset"
  }

  const sign = deltaMinutes > 0 ? "+" : "-"
  const absolute = Math.abs(deltaMinutes)
  const hours = Math.floor(absolute / 60)
  const minutes = absolute % 60
  if (minutes === 0) {
    return `${sign}${hours}h`
  }

  return `${sign}${hours}h ${String(minutes).padStart(2, "0")}m`
}

function formatTimeInZone(timeZone: string | undefined, atMs: number): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(new Date(atMs))
}

function parseClockTimeParts(value: string): ClockTimeParts | null {
  const match = /^(\d{2}):(\d{2}):(\d{2})$/.exec(value.trim())
  if (!match) {
    return null
  }

  const hour = Number(match[1])
  const minute = Number(match[2])
  const second = Number(match[3])
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || !Number.isFinite(second)) {
    return null
  }
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) {
    return null
  }

  return { hour, minute, second }
}

function parseClockTimeToSeconds(value: string): number | null {
  const parts = parseClockTimeParts(value)
  if (!parts) {
    return null
  }

  return parts.hour * 3600 + parts.minute * 60 + parts.second
}

function formatClockTimeFromSeconds(totalSeconds: number): string {
  const normalized = ((Math.round(totalSeconds) % SECONDS_PER_DAY) + SECONDS_PER_DAY) % SECONDS_PER_DAY
  const hour = Math.floor(normalized / 3600)
  const minute = Math.floor((normalized % 3600) / 60)
  const second = normalized % 60
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`
}

function shortestCircularDelta(fromValue: number, toValue: number, modulus: number): number {
  const rawDelta = toValue - fromValue
  return ((((rawDelta + modulus / 2) % modulus) + modulus) % modulus) - modulus / 2
}

function normalizeCircularValue(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus
}

function createCircularTrend(modulus: number): (oldValue: number, value: number) => number {
  return (oldValue: number, value: number) => {
    const normalizedOld = ((Math.round(oldValue) % modulus) + modulus) % modulus
    const normalizedNew = ((Math.round(value) % modulus) + modulus) % modulus
    const forwardSteps = (normalizedNew - normalizedOld + modulus) % modulus
    const backwardSteps = (normalizedOld - normalizedNew + modulus) % modulus

    if (forwardSteps === backwardSteps) {
      return Math.sign(value - oldValue)
    }
    if (forwardSteps === 0 && backwardSteps === 0) {
      return 0
    }

    return forwardSteps < backwardSteps ? 1 : -1
  }
}

function splitUtcOffsetParts(offsetMinutes: number): UtcOffsetParts {
  const sign: "+" | "-" = offsetMinutes >= 0 ? "+" : "-"
  const absolute = Math.abs(offsetMinutes)

  return {
    sign,
    hours: Math.floor(absolute / 60),
    minutes: absolute % 60,
  }
}

const HOUR_TREND = createCircularTrend(24)
const MINUTE_TREND = createCircularTrend(60)

function getMinutesOfDayInZone(timeZone: string | undefined, atMs: number): number | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(new Date(atMs))

    const hour = Number(parts.find((part) => part.type === "hour")?.value)
    const minute = Number(parts.find((part) => part.type === "minute")?.value)
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
      return null
    }

    return Math.max(0, Math.min(1439, hour * 60 + minute))
  } catch {
    return null
  }
}

function shortestOffsetDeltaMinutes(fromOffsetMinutes: number, toOffsetMinutes: number): number {
  const rawDelta = toOffsetMinutes - fromOffsetMinutes
  return ((((rawDelta + 720) % 1440) + 1440) % 1440) - 720
}

function buildConicGradient(stops: SkyStop[]): string {
  if (stops.length === 0) {
    return "conic-gradient(from 0deg, #081521, #102f42, #081521)"
  }

  const points = stops
    .filter((stop) => stop.minutesOfDay >= 0 && stop.minutesOfDay <= 1440)
    .map((stop) => {
      const baseColor = stop.colorHex || "#081521"
      return {
        minute: Math.max(0, Math.min(1440, stop.minutesOfDay)),
        colorHex: NIGHT_SKY_STOP_NAMES.has(stop.name) ? hexToRgba(baseColor, 0.46) : baseColor,
      }
    })
    .sort((left, right) => left.minute - right.minute)

  if (points.length === 0) {
    return "conic-gradient(from 0deg, #081521, #102f42, #081521)"
  }

  if (points[0]?.minute !== 0) {
    points.unshift({
      minute: 0,
      colorHex: points[0]?.colorHex ?? "#081521",
    })
  }

  if (points[points.length - 1]?.minute !== 1440) {
    points.push({
      minute: 1440,
      colorHex: points[0]?.colorHex ?? "#081521",
    })
  }

  const segments = points.map((point) => {
    const pct = Number(((point.minute / 1440) * 100).toFixed(3))
    return `${point.colorHex} ${pct}%`
  })

  return `conic-gradient(from 0deg, ${segments.join(", ")})`
}

function locationDisplayLabel(location: PersistedLocationApiResult): string {
  if ((location.kind ?? "location") === "entity") {
    return location.entityName?.trim() || location.nickname?.trim() || location.name
  }

  return location.nickname?.trim() || location.adminCity?.trim() || location.name
}

function countryCodeToFlag(code: string | undefined): string | null {
  if (!code || code.length !== 2) {
    return null
  }

  const upper = code.toUpperCase()
  const chars = [...upper].map((char) => 127397 + char.charCodeAt(0))
  return String.fromCodePoint(...chars)
}

function leadingEmojiForLocation(location: PersistedLocationApiResult): string {
  const flag = countryCodeToFlag(location.countryCode)
  if (flag) {
    return flag
  }

  return (location.kind ?? "location") === "entity" ? "🧑" : "📍"
}

function toAngleFromTopDeg(deltaMinutes: number): number {
  return ((deltaMinutes / 1440) * 360 + 360) % 360
}

function shortestAngleDeltaDeg(fromDeg: number, toDeg: number): number {
  const normalizedFrom = ((fromDeg % 360) + 360) % 360
  const delta = toDeg - normalizedFrom
  return ((delta + 540) % 360) - 180
}

function laneSequence(count: number): number[] {
  if (count <= 0) {
    return []
  }

  const lanes = [0]
  for (let step = 1; lanes.length < count; step += 1) {
    lanes.push(step)
    if (lanes.length < count) {
      lanes.push(-step)
    }
  }

  return lanes
}

function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window === "undefined") {
      return false
    }

    return window.innerWidth <= MOBILE_BREAKPOINT
  })

  useEffect(() => {
    const onResize = () => {
      setIsMobile(window.innerWidth <= MOBILE_BREAKPOINT)
    }

    window.addEventListener("resize", onResize)
    return () => {
      window.removeEventListener("resize", onResize)
    }
  }, [])

  return isMobile
}

function sortByLabel(left: PersistedLocationApiResult, right: PersistedLocationApiResult): number {
  return locationDisplayLabel(left).toLocaleLowerCase().localeCompare(locationDisplayLabel(right).toLocaleLowerCase())
}

export function HomeClockPage() {
  const [savedLocations, setSavedLocations] = useState<PersistedLocationApiResult[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [sky, setSky] = useState<Sky24hResult | null>(null)
  const [clockNowMs, setClockNowMs] = useState<number>(() => Date.now())
  const [ringError, setRingError] = useState<string | null>(null)
  const [ringDiameter, setRingDiameter] = useState<number>(0)
  const [displayedWheelGradient, setDisplayedWheelGradient] = useState<string>(() => buildConicGradient([]))
  const [previousWheelGradient, setPreviousWheelGradient] = useState<string | null>(null)
  const [isGradientTransitioning, setIsGradientTransitioning] = useState<boolean>(false)
  const [ringMotionToken, setRingMotionToken] = useState<number>(0)
  const [gradientTransitionToken, setGradientTransitionToken] = useState<number>(0)
  const [isRingTransitioning, setIsRingTransitioning] = useState<boolean>(false)
  const [wheelBaseRotationDeg, setWheelBaseRotationDeg] = useState<number>(0)
  const [centerCopyTransitionKey, setCenterCopyTransitionKey] = useState<number>(0)

  const ringFrameRef = useRef<HTMLDivElement | null>(null)
  const lastSelectedIdRef = useRef<string | null>(null)
  const pendingSelectionTransitionRef = useRef<boolean>(false)
  const pendingSecondOrderMorphRef = useRef<boolean>(false)
  const lastAnimatedGradientTokenRef = useRef<number>(0)
  const gradientFadeTimerRef = useRef<number | null>(null)
  const gradientFadeRafRef = useRef<number | null>(null)
  const ringTransitionTimerRef = useRef<number | null>(null)
  const wheelBaseRotationRef = useRef<number | null>(null)
  const ringRotationDirectionRef = useRef<number>(0)
  const selectedOrbitAnchorRef = useRef<number | null>(null)

  const isMobile = useIsMobile()
  const conceptTokens = ZENITH_TOKENS
  const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const localOffsetMinutes = -new Date(clockNowMs).getTimezoneOffset()

  const sortedLocations = useMemo(() => {
    return [...savedLocations].sort((left, right) => {
      const leftOffset = left.timezone ? getTimeZoneOffsetMinutes(left.timezone, clockNowMs) : null
      const rightOffset = right.timezone ? getTimeZoneOffsetMinutes(right.timezone, clockNowMs) : null

      if (leftOffset === null && rightOffset !== null) {
        return 1
      }
      if (leftOffset !== null && rightOffset === null) {
        return -1
      }
      if (leftOffset !== null && rightOffset !== null && leftOffset !== rightOffset) {
        return Math.abs(leftOffset - localOffsetMinutes) - Math.abs(rightOffset - localOffsetMinutes)
      }

      return sortByLabel(left, right)
    })
  }, [savedLocations, clockNowMs, localOffsetMinutes])

  const selectedLocation = useMemo(() => {
    if (!selectedId) {
      return null
    }

    return savedLocations.find((location) => location.id === selectedId) ?? null
  }, [savedLocations, selectedId])

  const selectedTimezone = selectedLocation?.timezone ?? browserTimezone
  const selectedOffset = selectedTimezone ? getTimeZoneOffsetMinutes(selectedTimezone, clockNowMs) : localOffsetMinutes
  const safeSelectedOffset = selectedOffset ?? localOffsetMinutes
  const [selectedOrbitAnchorDeg, setSelectedOrbitAnchorDeg] = useState<number>(() => toAngleFromTopDeg(safeSelectedOffset))

  const selectedCopyLabel = selectedLocation ? locationDisplayLabel(selectedLocation) : "your location"
  const centerTime = formatTimeInZone(selectedTimezone, clockNowMs)
  const [displayCenterTime, setDisplayCenterTime] = useState<string>(centerTime)
  const centerTimeParts = useMemo(() => parseClockTimeParts(displayCenterTime), [displayCenterTime])
  const centerUtcOffsetParts = useMemo(() => splitUtcOffsetParts(safeSelectedOffset), [safeSelectedOffset])
  const previousCenterTimePartsRef = useRef<ClockTimeParts | null>(centerTimeParts)
  const previousCenterUtcOffsetPartsRef = useRef<UtcOffsetParts>(centerUtcOffsetParts)
  const shouldAnimateHour =
    centerTimeParts !== null &&
    previousCenterTimePartsRef.current !== null &&
    centerTimeParts.hour !== previousCenterTimePartsRef.current.hour
  const shouldAnimateMinute =
    centerTimeParts !== null &&
    previousCenterTimePartsRef.current !== null &&
    centerTimeParts.minute !== previousCenterTimePartsRef.current.minute
  const shouldAnimateUtcHours = centerUtcOffsetParts.hours !== previousCenterUtcOffsetPartsRef.current.hours
  const shouldAnimateUtcMinutes = centerUtcOffsetParts.minutes !== previousCenterUtcOffsetPartsRef.current.minutes
  const displayCenterTimeRef = useRef<string>(displayCenterTime)
  const latestCenterTimeRef = useRef<string>(centerTime)
  const lastSelectionForTimeCounterRef = useRef<string | null>(selectedId)
  const timeCounterRafRef = useRef<number | null>(null)
  const isTimeCounterAnimatingRef = useRef<boolean>(false)

  const wheelGradient = useMemo(() => buildConicGradient(sky?.stops ?? []), [sky])

  useLayoutEffect(() => {
    if (!sky) {
      wheelBaseRotationRef.current = null
      ringRotationDirectionRef.current = 0
      setWheelBaseRotationDeg(0)
      return
    }

    const previousBase = wheelBaseRotationRef.current
    const ringDeltaDeg = previousBase === null ? 0 : shortestAngleDeltaDeg(previousBase, sky.rotationDeg)
    const nextBase = previousBase === null ? sky.rotationDeg : previousBase + ringDeltaDeg

    ringRotationDirectionRef.current = ringDeltaDeg
    wheelBaseRotationRef.current = nextBase
    setWheelBaseRotationDeg(nextBase)
  }, [sky])

  useLayoutEffect(() => {
    const nextAnchor = toAngleFromTopDeg(safeSelectedOffset)
    const previousAnchor = selectedOrbitAnchorRef.current

    if (previousAnchor === null) {
      selectedOrbitAnchorRef.current = nextAnchor
      setSelectedOrbitAnchorDeg(nextAnchor)
      return
    }

    let anchorDelta = shortestAngleDeltaDeg(previousAnchor, nextAnchor)
    const ringDirection = Math.sign(ringRotationDirectionRef.current)
    const anchorDirection = Math.sign(anchorDelta)
    if (ringDirection !== 0 && anchorDirection !== 0 && ringDirection !== anchorDirection) {
      anchorDelta += ringDirection > 0 ? 360 : -360
    }

    const nextContinuousAnchor = previousAnchor + anchorDelta
    selectedOrbitAnchorRef.current = nextContinuousAnchor
    setSelectedOrbitAnchorDeg(nextContinuousAnchor)
  }, [safeSelectedOffset])

  const wheelRotation = useMemo(() => {
    if (!sky) {
      return 0
    }

    const elapsed = clockNowMs - sky.timestampMs
    const driftDeg = (elapsed / 86_400_000) * 360
    return wheelBaseRotationDeg + driftDeg
  }, [sky, clockNowMs, wheelBaseRotationDeg])

  const orbitLabels = useMemo(() => {
    const base = sortedLocations
      .map((location) => {
        if (!location.timezone) {
          return null
        }

        const offset = getTimeZoneOffsetMinutes(location.timezone, clockNowMs)
        if (offset === null) {
          return null
        }

        const deltaMinutes = shortestOffsetDeltaMinutes(safeSelectedOffset, offset)
        const absoluteOffsetAngleDeg = toAngleFromTopDeg(offset)
        const minutesOfDay =
          getMinutesOfDayInZone(location.timezone, clockNowMs) ?? normalizeMinutesOfDay(Math.round(clockNowMs / 60_000))

        return {
          id: location.id,
          leadingEmoji: leadingEmojiForLocation(location),
          label: locationDisplayLabel(location),
          time: formatTimeInZone(location.timezone, clockNowMs),
          timezoneMeta: formatTimezoneMeta(location.timezone, clockNowMs),
          relativeLabel: formatRelativeOffsetLabel(deltaMinutes),
          angleDeg: absoluteOffsetAngleDeg - selectedOrbitAnchorDeg,
          skyColorHex: sampleSkyColorAtMinute(sky?.stops ?? [], minutesOfDay),
          isSelected: location.id === selectedId,
          isLocal: offset === localOffsetMinutes,
        }
      })
      .filter((value): value is Omit<OrbitLabel, "lane" | "radialOffsetPx"> => value !== null)

    const bucketSizeDeg = isMobile ? 14 : 10
    const buckets = new Map<number, typeof base>()

    for (const entry of base) {
      const bucketKey = Math.round(entry.angleDeg / bucketSizeDeg)
      const list = buckets.get(bucketKey) ?? []
      list.push(entry)
      buckets.set(bucketKey, list)
    }

    const labels: OrbitLabel[] = []
    for (const list of buckets.values()) {
      list.sort((left, right) => {
        if (left.isSelected !== right.isSelected) {
          return left.isSelected ? -1 : 1
        }

        if (left.isLocal !== right.isLocal) {
          return left.isLocal ? -1 : 1
        }

        return left.label.localeCompare(right.label)
      })

      const lanes = laneSequence(list.length)
      list.forEach((entry, index) => {
        const lane = lanes[index] ?? 0
        labels.push({
          ...entry,
          lane,
          radialOffsetPx: lane * conceptTokens.laneStepPx,
        })
      })
    }

    return labels.sort((left, right) => {
      if (left.isSelected !== right.isSelected) {
        return left.isSelected ? 1 : -1
      }

      return left.angleDeg - right.angleDeg
    })
  }, [
    sortedLocations,
    clockNowMs,
    safeSelectedOffset,
    selectedOrbitAnchorDeg,
    selectedId,
    localOffsetMinutes,
    sky,
    isMobile,
    conceptTokens.laneStepPx,
  ])

  const labelBaseRadiusPx = useMemo(() => {
    if (!ringDiameter || !Number.isFinite(ringDiameter)) {
      return 260
    }

    return ringDiameter * conceptTokens.labelBaseRadiusPct
  }, [ringDiameter, conceptTokens.labelBaseRadiusPct])

  useEffect(() => {
    const lastSelectedId = lastSelectedIdRef.current
    if (lastSelectedId === null) {
      lastSelectedIdRef.current = selectedId
      return
    }

    if (selectedId !== lastSelectedId) {
      pendingSelectionTransitionRef.current = true
      pendingSecondOrderMorphRef.current = false
      setCenterCopyTransitionKey((key) => key + 1)
    }

    lastSelectedIdRef.current = selectedId
  }, [selectedId])

  useEffect(() => {
    if (wheelGradient === displayedWheelGradient) {
      return
    }

    const shouldAnimate =
      gradientTransitionToken > lastAnimatedGradientTokenRef.current && displayedWheelGradient.length > 0
    if (!shouldAnimate) {
      setDisplayedWheelGradient(wheelGradient)
      setPreviousWheelGradient(null)
      setIsGradientTransitioning(false)
      return
    }

    if (gradientFadeTimerRef.current !== null) {
      window.clearTimeout(gradientFadeTimerRef.current)
      gradientFadeTimerRef.current = null
    }
    if (gradientFadeRafRef.current !== null) {
      window.cancelAnimationFrame(gradientFadeRafRef.current)
      gradientFadeRafRef.current = null
    }

    setPreviousWheelGradient(displayedWheelGradient)
    setDisplayedWheelGradient(wheelGradient)
    setIsGradientTransitioning(false)

    gradientFadeRafRef.current = window.requestAnimationFrame(() => {
      setIsGradientTransitioning(true)
      gradientFadeRafRef.current = null
    })

    gradientFadeTimerRef.current = window.setTimeout(() => {
      setPreviousWheelGradient(null)
      setIsGradientTransitioning(false)
      gradientFadeTimerRef.current = null
    }, SELECTION_TRANSITION_MS)

    lastAnimatedGradientTokenRef.current = gradientTransitionToken
  }, [wheelGradient, displayedWheelGradient, gradientTransitionToken])

  useEffect(() => {
    if (ringMotionToken === 0) {
      return
    }

    setIsRingTransitioning(true)
    if (ringTransitionTimerRef.current !== null) {
      window.clearTimeout(ringTransitionTimerRef.current)
    }

    ringTransitionTimerRef.current = window.setTimeout(() => {
      setIsRingTransitioning(false)
      ringTransitionTimerRef.current = null
    }, SELECTION_TRANSITION_MS)
  }, [ringMotionToken])

  const loadSavedLocations = useCallback(async () => {
    try {
      const response = await fetch(new URL("/api/locations/persisted", window.location.origin))
      const payload = (await response.json()) as PersistedLocationsApiResponse | ApiErrorResponse
      if (!response.ok) {
        throw new Error((payload as ApiErrorResponse).error?.message ?? "Unable to fetch saved locations.")
      }

      const data = payload as PersistedLocationsApiResponse
      setSavedLocations(Array.isArray(data.results) ? data.results : [])
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setRingError(message)
    }
  }, [])

  useEffect(() => {
    void loadSavedLocations()
  }, [loadSavedLocations])

  useEffect(() => {
    const timer = setInterval(() => {
      setClockNowMs(Date.now())
    }, 250)

    return () => {
      clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    displayCenterTimeRef.current = displayCenterTime
  }, [displayCenterTime])

  useEffect(() => {
    latestCenterTimeRef.current = centerTime
  }, [centerTime])

  useEffect(() => {
    previousCenterTimePartsRef.current = centerTimeParts
    previousCenterUtcOffsetPartsRef.current = centerUtcOffsetParts
  }, [centerTimeParts, centerUtcOffsetParts])

  useEffect(() => {
    const previousSelectedId = lastSelectionForTimeCounterRef.current
    const selectionChanged = previousSelectedId !== null && selectedId !== previousSelectedId
    lastSelectionForTimeCounterRef.current = selectedId

    if (!selectionChanged) {
      if (!isTimeCounterAnimatingRef.current) {
        setDisplayCenterTime(centerTime)
      }
      return
    }

    const startParts = parseClockTimeParts(displayCenterTimeRef.current)
    const targetParts = parseClockTimeParts(centerTime)
    if (!startParts || !targetParts) {
      setDisplayCenterTime(centerTime)
      return
    }

    const targetSecond = targetParts.second
    const targetMinute = targetParts.minute
    const targetHour = targetParts.hour
    const shouldAnimateMinutes = startParts.minute !== targetMinute

    if (timeCounterRafRef.current !== null) {
      window.cancelAnimationFrame(timeCounterRafRef.current)
      timeCounterRafRef.current = null
    }

    const hourDelta = shortestCircularDelta(startParts.hour, targetHour, 24)
    const minuteDelta = shouldAnimateMinutes ? shortestCircularDelta(startParts.minute, targetMinute, 60) : 0
    if (hourDelta === 0 && minuteDelta === 0) {
      setDisplayCenterTime(centerTime)
      return
    }

    isTimeCounterAnimatingRef.current = true
    const startedAtMs = performance.now()
    const durationMs = Math.min(2_400, Math.max(500, Math.max(Math.abs(hourDelta) * 170, Math.abs(minuteDelta) * 22)))

    const tick = (frameNowMs: number) => {
      const progress = clamp((frameNowMs - startedAtMs) / durationMs, 0, 1)
      const nextHour = normalizeCircularValue(startParts.hour + Math.round(hourDelta * progress), 24)
      const nextMinute = shouldAnimateMinutes
        ? normalizeCircularValue(startParts.minute + Math.round(minuteDelta * progress), 60)
        : targetMinute
      const nextTime = formatClockTimeFromSeconds(nextHour * 3600 + nextMinute * 60 + targetSecond)

      if (nextTime !== displayCenterTimeRef.current) {
        setDisplayCenterTime(nextTime)
      }

      if (progress >= 1) {
        isTimeCounterAnimatingRef.current = false
        timeCounterRafRef.current = null
        setDisplayCenterTime(latestCenterTimeRef.current)
        return
      }

      timeCounterRafRef.current = window.requestAnimationFrame(tick)
    }

    timeCounterRafRef.current = window.requestAnimationFrame(tick)
  }, [selectedId, centerTime])

  useEffect(() => {
    const ringElement = ringFrameRef.current
    if (!ringElement) {
      return
    }

    const updateDiameter = (width: number) => {
      if (Number.isFinite(width) && width > 0) {
        setRingDiameter(width)
      }
    }

    updateDiameter(ringElement.getBoundingClientRect().width)

    const observer = new ResizeObserver((entries) => {
      updateDiameter(entries[0]?.contentRect.width ?? 0)
    })
    observer.observe(ringElement)

    return () => {
      observer.disconnect()
    }
  }, [])

  useEffect(() => {
    const savedId = window.localStorage.getItem(STORAGE_SELECTED_ID)
    if (!savedId) {
      return
    }

    setSelectedId(savedId)
  }, [])

  useEffect(() => {
    if (selectedId && savedLocations.some((location) => location.id === selectedId)) {
      return
    }

    const fallback = sortedLocations[0]?.id ?? null
    setSelectedId(fallback)
  }, [selectedId, savedLocations, sortedLocations])

  useEffect(() => {
    if (!selectedId) {
      window.localStorage.removeItem(STORAGE_SELECTED_ID)
      return
    }

    window.localStorage.setItem(STORAGE_SELECTED_ID, selectedId)
  }, [selectedId])

  useEffect(() => {
    if (!selectedLocation) {
      pendingSecondOrderMorphRef.current = false
      setSky(null)
      return
    }

    let cancelled = false
    const previewAtMs = Date.now()
    const previewTimezone = selectedLocation.timezone ?? browserTimezone

    try {
      const preview = computeSky24h(
        {
          lat: selectedLocation.lat,
          long: selectedLocation.long,
        },
        createClientBaselineEnvironment(previewTimezone),
        previewAtMs,
        {
          applySecondOrder: false,
        },
      )

      if (!cancelled) {
        setSky(preview)
        if (pendingSelectionTransitionRef.current) {
          pendingSelectionTransitionRef.current = false
          setRingMotionToken((token) => token + 1)
          setGradientTransitionToken((token) => token + 1)
        }
        setRingError(null)
      }
    } catch {
      // Keep the existing sky state if local preview computation fails.
    }

    pendingSecondOrderMorphRef.current = true

    const fetchSky = async ({ atMs, morphOnResolve = false }: { atMs?: number; morphOnResolve?: boolean } = {}) => {
      try {
        const url = new URL("/api/location/sky-24h", window.location.origin)
        url.searchParams.set("lat", String(selectedLocation.lat))
        url.searchParams.set("long", String(selectedLocation.long))
        url.searchParams.set("secondOrder", "0")
        if (atMs !== undefined) {
          url.searchParams.set("at", String(atMs))
        }

        const response = await fetch(url)
        const payload = (await response.json()) as SkyResponse | ApiErrorResponse
        if (!response.ok) {
          throw new Error((payload as ApiErrorResponse).error?.message ?? "Unable to render sky ring.")
        }

        if (!cancelled) {
          setSky((payload as SkyResponse).result)
          if (pendingSelectionTransitionRef.current) {
            pendingSelectionTransitionRef.current = false
            setRingMotionToken((token) => token + 1)
            setGradientTransitionToken((token) => token + 1)
          }
          if (morphOnResolve && pendingSecondOrderMorphRef.current) {
            pendingSecondOrderMorphRef.current = false
            setGradientTransitionToken((token) => token + 1)
          }
          setRingError(null)
        }
      } catch (error) {
        if (cancelled) {
          return
        }

        const message = error instanceof Error ? error.message : String(error)
        setRingError(message)
      }
    }

    void fetchSky({ atMs: previewAtMs, morphOnResolve: true })
    const timer = setInterval(() => {
      void fetchSky({ morphOnResolve: pendingSecondOrderMorphRef.current })
    }, SKY_REFRESH_MS)

    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [selectedLocation, browserTimezone])

  useEffect(() => {
    return () => {
      if (gradientFadeTimerRef.current !== null) {
        window.clearTimeout(gradientFadeTimerRef.current)
      }
      if (gradientFadeRafRef.current !== null) {
        window.cancelAnimationFrame(gradientFadeRafRef.current)
      }
      if (ringTransitionTimerRef.current !== null) {
        window.clearTimeout(ringTransitionTimerRef.current)
      }
      if (timeCounterRafRef.current !== null) {
        window.cancelAnimationFrame(timeCounterRafRef.current)
      }
    }
  }, [])

  const conceptVars = {
    "--ring-size-desktop": `${conceptTokens.ringSizeDesktopVmin}vmin`,
    "--ring-size-mobile": `${conceptTokens.ringSizeMobileVmin}vmin`,
    "--ring-size-max": `${conceptTokens.ringSizeMaxPx}px`,
    "--ring-band-width": `${conceptTokens.bandWidthPct}%`,
    "--ring-halo-spread": `${conceptTokens.haloSpreadPx}px`,
  } as React.CSSProperties

  return (
    <main className="home-shell home-shell--zenith">
      <section className="home-ring-stage" aria-label="Sky ring 24 hour view">
        <div className="home-ring-frame" ref={ringFrameRef} style={conceptVars}>
          <div
            className={`home-sky-ring home-sky-ring-glow ${isRingTransitioning ? "is-switching" : ""}`}
            style={{ transform: `rotate(${wheelRotation}deg) scale(1.03)` }}
            aria-hidden="true"
          >
            {previousWheelGradient ? (
              <div
                className={`home-sky-ring-layer is-previous ${isGradientTransitioning ? "is-fading-out" : ""}`}
                style={{ backgroundImage: previousWheelGradient }}
                aria-hidden="true"
              />
            ) : null}
            <div
              className="home-sky-ring-layer is-current"
              style={{ backgroundImage: displayedWheelGradient }}
              aria-hidden="true"
            />
          </div>

          <div
            className={`home-sky-ring ${isRingTransitioning ? "is-switching" : ""}`}
            style={{ transform: `rotate(${wheelRotation}deg)` }}
          >
            <div className="home-sky-ring-stars" aria-hidden="true" />
            {previousWheelGradient ? (
              <div
                className={`home-sky-ring-layer is-previous ${isGradientTransitioning ? "is-fading-out" : ""}`}
                style={{ backgroundImage: previousWheelGradient }}
                aria-hidden="true"
              />
            ) : null}
            <div
              className="home-sky-ring-layer is-current"
              style={{ backgroundImage: displayedWheelGradient }}
              aria-hidden="true"
            />
          </div>

          <div className="home-center-readout">
            <div key={centerCopyTransitionKey} className="home-center-copy">
              <p className="home-center-label">{selectedCopyLabel}</p>
              <p className="home-center-time">
                {centerTimeParts ? (
                  <>
                    <NumberFlow
                      className="home-center-time-flow"
                      value={centerTimeParts.hour}
                      animated={shouldAnimateHour}
                      plugins={NUMBER_FLOW_PLUGINS}
                      trend={HOUR_TREND}
                      format={{ minimumIntegerDigits: 2, useGrouping: false }}
                    />
                    <span className="home-center-time-separator">:</span>
                    <NumberFlow
                      className="home-center-time-flow"
                      value={centerTimeParts.minute}
                      animated={shouldAnimateMinute}
                      plugins={NUMBER_FLOW_PLUGINS}
                      trend={MINUTE_TREND}
                      digits={{ 1: { max: 5 } }}
                      format={{ minimumIntegerDigits: 2, useGrouping: false }}
                    />
                  </>
                ) : (
                  displayCenterTime.slice(0, 5)
                )}
              </p>
              <p className="home-center-meta-label">UTC offset</p>
              <p className="home-center-meta">
                <span>UTC{centerUtcOffsetParts.sign}</span>
                <NumberFlow
                  className="home-center-meta-flow"
                  value={centerUtcOffsetParts.hours}
                  animated={shouldAnimateUtcHours}
                  plugins={NUMBER_FLOW_PLUGINS}
                  format={{ minimumIntegerDigits: 1, useGrouping: false }}
                />
                {centerUtcOffsetParts.minutes > 0 ? (
                  <>
                    <span>:</span>
                    <NumberFlow
                      className="home-center-meta-flow"
                      value={centerUtcOffsetParts.minutes}
                      animated={shouldAnimateUtcMinutes}
                      plugins={NUMBER_FLOW_PLUGINS}
                      trend={MINUTE_TREND}
                      digits={{ 1: { max: 5 } }}
                      format={{ minimumIntegerDigits: 2, useGrouping: false }}
                    />
                  </>
                ) : null}
              </p>
            </div>
            {ringError ? (
              <p className="home-ring-error" role="alert">
                {ringError}
              </p>
            ) : null}
          </div>

          <div
            className={`home-hour-layer ${isRingTransitioning ? "is-switching" : ""}`}
            style={
              {
                transform: `rotate(${wheelRotation}deg)`,
                "--hour-layer-rotation": `${wheelRotation}deg`,
              } as React.CSSProperties
            }
            aria-hidden="true"
          >
            {HOUR_MARKERS.map((hour) => {
              const angleDeg = (hour / 24) * 360
              const uprightCompensationDeg = angleDeg + wheelRotation
              return (
                <span
                  key={hour}
                  className={`home-hour-tick ${hour % 3 === 0 ? "is-major" : "is-minor"}`}
                  style={{
                    transform: `translate(-50%, -50%) rotate(${angleDeg}deg) translateY(calc(-1 * var(--hour-tick-radius))) rotate(${-uprightCompensationDeg}deg)`,
                  }}
                >
                  {String(hour).padStart(2, "0")}
                </span>
              )
            })}
          </div>

          <div className="home-label-orbit" role="listbox" aria-label="Saved locations by 24 hour offset">
            {orbitLabels.map((label) => {
              const baseRadius = ringDiameter > 0 ? ringDiameter * 0.25 : 115
              const radiusPx = Math.max(baseRadius, labelBaseRadiusPx + label.radialOffsetPx)
              const orbitAngleDeg = label.angleDeg
              return (
                <button
                  type="button"
                  key={label.id}
                  role="option"
                  aria-selected={label.isSelected}
                  className={`home-orbit-label ${isRingTransitioning ? "is-switching" : ""} ${
                    label.isSelected ? "is-selected" : ""
                  } ${label.isLocal ? "is-local" : ""}`}
                  onClick={() => setSelectedId(label.id)}
                  style={{
                    transform: `translate(-50%, -50%) rotate(${orbitAngleDeg}deg) translateY(-${radiusPx}px) rotate(${-orbitAngleDeg}deg)`,
                    zIndex: label.isSelected ? 18 : 8,
                  }}
                  title={`${label.label} · ${label.time} · ${label.timezoneMeta} · ${label.relativeLabel}`}
                >
                  <span
                    className="home-orbit-chip"
                    style={{ "--orbit-accent": label.skyColorHex } as React.CSSProperties}
                  >
                    <span className="home-orbit-emoji" aria-hidden="true">
                      <span className="home-orbit-emoji-glyph">{label.leadingEmoji}</span>
                    </span>
                    <strong>{label.label}</strong>
                    <em>
                      {label.time} · {label.relativeLabel}
                    </em>
                  </span>
                </button>
              )
            })}
          </div>

          {orbitLabels.length === 0 ? (
            <p className="home-empty-note">No saved locations yet. The ring follows your current timezone.</p>
          ) : null}
        </div>
      </section>
    </main>
  )
}

export default HomeClockPage
