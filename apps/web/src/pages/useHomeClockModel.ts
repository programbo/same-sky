import type React from "react"
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { continuous } from "@number-flow/react"
import { computeSky24h } from "../lib/same-sky/sky"
import { computeOrbitLabelLayout } from "./orbit-label-layout"
import type {
  SkyEnvironment as SharedSkyEnvironment,
  SkySecondOrderFactors as SharedSkySecondOrderFactors,
} from "../lib/same-sky/types"

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

interface ConicGradientStop {
  minute: number
  colorHex: string
  alpha: number
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
}

export interface OrbitLabel {
  id: string
  timezoneKey: string
  leadingEmoji: string
  label: string
  time: string
  shortDateTime24?: string
  timezoneMeta: string
  relativeLabel: string
  relativeOffsetMinutes: number
  localRelativeOffsetMinutes?: number
  angleDeg: number
  skyColorHex: string
  isSelected: boolean
  isLocal: boolean
}

export interface OrbitLabelGroupMember {
  id: string
  label: string
  time: string
  timezoneMeta: string
  relativeLabel: string
  leadingEmoji: string
  isSelected: boolean
}

export interface OrbitLabelGroup {
  id: string
  timezoneKey: string
  time: string
  shortDateTime24?: string
  timezoneMeta: string
  relativeLabel: string
  relativeOffsetMinutes: number
  localRelativeOffsetMinutes?: number
  angleDeg: number
  skyColorHex: string
  isSelected: boolean
  isLocal: boolean
  memberCount: number
  members: OrbitLabelGroupMember[]
}

export interface OrbitLabelLayout extends OrbitLabelGroup {
  side: "left" | "right"
  x: number
  y: number
  width: number
  height: number
  anchorX: number
  anchorY: number
  spokeEndX: number
  spokeEndY: number
  spokePath: string
  branchPath: string
}

export interface ClockTimeParts {
  hour: number
  minute: number
  second: number
}

export interface UtcOffsetParts {
  sign: "+" | "-"
  hours: number
  minutes: number
}

export interface RingFrameSnapshot {
  wheelRotationDeg: number
}

export interface OrbitFrameSnapshot {
  selectionId: string | null
  selectedLayoutId: string | null
  frozenNowMs: number
  layoutById: Map<string, OrbitLabelLayout>
  order: string[]
  orbitSizePx: number
}

export interface OrbitTransitionPlan {
  startedAtMs: number
  durationMs: number
  frozenNowMs: number
  fromSelectionId: string | null
  toSelectionId: string | null
  fromRingRotationDeg: number
  toRingRotationDeg: number
  sweepDirection: number
  fromLayoutById: Map<string, OrbitLabelLayout>
  toLayoutById: Map<string, OrbitLabelLayout>
  order: string[]
  orbitSizePx: number
}

export interface HomeClockViewModel {
  ringFrameRef: React.RefObject<HTMLDivElement | null>
  conceptVars: React.CSSProperties
  centerCopyTransitionKey: number
  selectedCopyLabel: string
  centerTimeParts: ClockTimeParts | null
  displayCenterTime: string
  centerUtcOffsetParts: UtcOffsetParts
  shouldAnimateHour: boolean
  shouldAnimateMinute: boolean
  shouldAnimateUtcHours: boolean
  shouldAnimateUtcMinutes: boolean
  ringError: string | null
  isRingTransitioning: boolean
  areHourTicksVisible: boolean
  displayedWheelGradient: string
  displayedNightMaskGradient: string
  wheelRotation: number
  selectedId: string | null
  orbitLabels: OrbitLabel[]
  orbitLabelGroups: OrbitLabelGroup[]
  orbitLabelLayout: OrbitLabelLayout[]
  ringDiameter: number
  labelOrbitSizePx: number
  setSelectedId: React.Dispatch<React.SetStateAction<string | null>>
}

const STORAGE_SELECTED_ID = "same_sky_home_selected_item_id"
const MOBILE_BREAKPOINT = 740
const SKY_REFRESH_MS = 60_000
const SELECTION_TRANSITION_MS = 780
const GRADIENT_TRANSITION_MS = 1_900
const SECONDS_PER_DAY = 24 * 60 * 60
const DEFAULT_NOON_MINUTE = 720
const DAYLIGHT_FAN_DELAY_RATIO = 0.72
export const HOUR_MARKERS = Array.from({ length: 24 }, (_, hour) => hour)
const DAYLIGHT_SKY_STOP_NAMES = new Set([
  "sunrise",
  "morning_golden_hour",
  "mid_morning",
  "solar_noon",
  "mid_afternoon",
  "afternoon_golden_hour",
  "sunset",
])
const DEFAULT_CONIC_GRADIENT_STOPS: ConicGradientStop[] = [
  { minute: 0, colorHex: "#081521", alpha: 0 },
  { minute: DEFAULT_NOON_MINUTE, colorHex: "#081521", alpha: 0 },
  { minute: 1440, colorHex: "#081521", alpha: 0 },
]
export const NUMBER_FLOW_PLUGINS = [continuous]
const CLIENT_BASELINE_FACTORS: SharedSkySecondOrderFactors = {
  altitude: 0,
  turbidity: 0.5,
  humidity: 0.5,
  cloud_fraction: 0.3,
  ozone_factor: 0.5,
  light_pollution: 0.5,
}

const ZENITH_TOKENS: ConceptTokens = {
  ringSizeDesktopVmin: 114,
  ringSizeMobileVmin: 120,
  ringSizeMaxPx: 1240,
  bandWidthPct: 22,
  haloSpreadPx: 300,
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

function isNonNull<T>(value: T | null): value is T {
  return value !== null
}

function easeSelectionTransition(progress: number): number {
  const t = clamp(progress, 0, 1)
  return 1 - Math.pow(1 - t, 3)
}

function easeEpicGradientTransition(progress: number): number {
  const t = clamp(progress, 0, 1)
  if (t < 0.5) {
    return 16 * Math.pow(t, 5)
  }

  return 1 - Math.pow(-2 * t + 2, 5) / 2
}

function lerpNumber(start: number, end: number, progress: number): number {
  return start + (end - start) * progress
}

function circularMinuteDistance(fromMinute: number, toMinute: number): number {
  const from = normalizeMinutesOfDay(fromMinute)
  const to = normalizeMinutesOfDay(toMinute)
  const delta = Math.abs(from - to)
  return Math.min(delta, 1440 - delta)
}

function fanOutProgressFromNoon(progress: number, minute: number, noonMinute: number): number {
  const t = clamp(progress, 0, 1)
  const distanceRatio = clamp(circularMinuteDistance(minute, noonMinute) / DEFAULT_NOON_MINUTE, 0, 1)
  const revealStart = distanceRatio * DAYLIGHT_FAN_DELAY_RATIO
  const revealSpan = Math.max(1 - revealStart, 0.0001)
  return clamp((t - revealStart) / revealSpan, 0, 1)
}

function normalizeAngleDeltaRad(fromRad: number, toRad: number): number {
  let delta = toRad - fromRad
  while (delta > Math.PI) {
    delta -= Math.PI * 2
  }
  while (delta < -Math.PI) {
    delta += Math.PI * 2
  }
  return delta
}

type OrbitCornerKey = "top-left" | "top-right" | "bottom-left" | "bottom-right"

function directionFromOrbitPoints(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  centerX: number,
  centerY: number,
): number {
  const startRadius = Math.hypot(fromX - centerX, fromY - centerY)
  const endRadius = Math.hypot(toX - centerX, toY - centerY)
  if (startRadius < 0.001 || endRadius < 0.001) {
    return 0
  }

  const fromAngle = Math.atan2(fromY - centerY, fromX - centerX)
  const toAngle = Math.atan2(toY - centerY, toX - centerX)
  return Math.sign(normalizeAngleDeltaRad(fromAngle, toAngle))
}

function interpolateOrbitPoint(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  centerX: number,
  centerY: number,
  direction: number,
  progress: number,
): { x: number; y: number } {
  const fromX = startX - centerX
  const fromY = startY - centerY
  const toX = endX - centerX
  const toY = endY - centerY

  const fromRadius = Math.hypot(fromX, fromY)
  const toRadius = Math.hypot(toX, toY)
  if (fromRadius < 0.001 || toRadius < 0.001) {
    return {
      x: lerpNumber(startX, endX, progress),
      y: lerpNumber(startY, endY, progress),
    }
  }

  const fromAngle = Math.atan2(fromY, fromX)
  const toAngle = Math.atan2(toY, toX)
  let deltaAngle = normalizeAngleDeltaRad(fromAngle, toAngle)
  if (direction !== 0 && Math.sign(deltaAngle) !== 0 && Math.sign(deltaAngle) !== direction) {
    const directedDelta = deltaAngle + (direction > 0 ? Math.PI * 2 : -Math.PI * 2)
    // Never allow direction hints to turn a short orbit into a long-way-around sweep.
    if (Math.abs(directedDelta) <= Math.PI + 1e-6) {
      deltaAngle = directedDelta
    }
  }

  const angle = fromAngle + deltaAngle * progress
  const radius = lerpNumber(fromRadius, toRadius, progress)
  return {
    x: centerX + Math.cos(angle) * radius,
    y: centerY + Math.sin(angle) * radius,
  }
}

function isPointWithinLayoutRect(layout: OrbitLabelLayout, pointX: number, pointY: number): boolean {
  const epsilon = 0.001
  return (
    pointX >= layout.x - epsilon &&
    pointX <= layout.x + layout.width + epsilon &&
    pointY >= layout.y - epsilon &&
    pointY <= layout.y + layout.height + epsilon
  )
}

function pointRatioWithinRect(point: number, start: number, size: number): number {
  if (!Number.isFinite(size) || size <= 0.001) {
    return 0.5
  }

  return clamp((point - start) / size, 0, 1)
}

function inferLayoutCornerAttachment(layout: OrbitLabelLayout): OrbitCornerKey | null {
  if (!isPointWithinLayoutRect(layout, layout.spokeEndX, layout.spokeEndY)) {
    return null
  }

  const ratioX = pointRatioWithinRect(layout.spokeEndX, layout.x, layout.width)
  const ratioY = pointRatioWithinRect(layout.spokeEndY, layout.y, layout.height)
  const horizontal = ratioX <= 0.35 ? "left" : ratioX >= 0.65 ? "right" : null
  const vertical = ratioY <= 0.35 ? "top" : ratioY >= 0.65 ? "bottom" : null
  if (!horizontal || !vertical) {
    return null
  }

  return `${vertical}-${horizontal}` as OrbitCornerKey
}

function hubFacingCornerForAnchor(anchorX: number, anchorY: number, centerX: number, centerY: number): OrbitCornerKey {
  const horizontal = anchorX - centerX >= 0 ? "left" : "right"
  const vertical = anchorY - centerY >= 0 ? "top" : "bottom"
  return `${vertical}-${horizontal}` as OrbitCornerKey
}

function shouldAllowCornerSwitchSweepOverride(
  source: OrbitLabelLayout,
  target: OrbitLabelLayout,
  centerX: number,
  centerY: number,
): boolean {
  const sourceCorner = inferLayoutCornerAttachment(source)
  const targetCorner = inferLayoutCornerAttachment(target)
  if (!sourceCorner || !targetCorner || sourceCorner === targetCorner) {
    return false
  }

  const sourceDefaultCorner = hubFacingCornerForAnchor(source.anchorX, source.anchorY, centerX, centerY)
  const targetDefaultCorner = hubFacingCornerForAnchor(target.anchorX, target.anchorY, centerX, centerY)
  return sourceCorner !== sourceDefaultCorner && targetCorner !== targetDefaultCorner
}

function resolveLayoutSweepDirection(
  source: OrbitLabelLayout,
  target: OrbitLabelLayout,
  centerX: number,
  centerY: number,
  defaultDirection: number,
): number {
  const anchorDirection = directionFromOrbitPoints(
    source.anchorX,
    source.anchorY,
    target.anchorX,
    target.anchorY,
    centerX,
    centerY,
  )
  if (anchorDirection !== 0) {
    return anchorDirection
  }

  const sourcePoint = layoutOrbitReferencePoint(source)
  const targetPoint = layoutOrbitReferencePoint(target)
  const shortestDirection = directionFromOrbitPoints(
    sourcePoint.x,
    sourcePoint.y,
    targetPoint.x,
    targetPoint.y,
    centerX,
    centerY,
  )
  if (shortestDirection !== 0) {
    return shortestDirection
  }

  if (!shouldAllowCornerSwitchSweepOverride(source, target, centerX, centerY)) {
    return defaultDirection
  }

  const sourceCenterX = source.x + source.width / 2
  const sourceCenterY = source.y + source.height / 2
  const targetCenterX = target.x + target.width / 2
  const targetCenterY = target.y + target.height / 2
  const centerDirection = directionFromOrbitPoints(
    sourceCenterX,
    sourceCenterY,
    targetCenterX,
    targetCenterY,
    centerX,
    centerY,
  )
  return centerDirection === 0 ? defaultDirection : centerDirection
}

function buildSpokePath(startX: number, startY: number, endX: number, endY: number): string {
  return `M ${startX.toFixed(2)} ${startY.toFixed(2)} L ${endX.toFixed(2)} ${endY.toFixed(2)}`
}

function buildBranchPath(anchorX: number, anchorY: number, edgeX: number, edgeY: number): string {
  return `M ${anchorX.toFixed(2)} ${anchorY.toFixed(2)} L ${edgeX.toFixed(2)} ${edgeY.toFixed(2)}`
}

function cloneOrbitLabelLayout(layout: OrbitLabelLayout): OrbitLabelLayout {
  return {
    ...layout,
    members: layout.members.map((member) => ({ ...member })),
  }
}

function findSelectedLayoutId(layouts: OrbitLabelLayout[]): string | null {
  return layouts.find((layout) => layout.isSelected)?.id ?? null
}

function createLayoutMap(layouts: OrbitLabelLayout[]): Map<string, OrbitLabelLayout> {
  return new Map(layouts.map((layout) => [layout.id, cloneOrbitLabelLayout(layout)]))
}

function layoutOrbitReferencePoint(layout: OrbitLabelLayout): { x: number; y: number } {
  if (Number.isFinite(layout.spokeEndX) && Number.isFinite(layout.spokeEndY)) {
    return {
      x: layout.spokeEndX,
      y: layout.spokeEndY,
    }
  }

  return {
    x: layout.x + layout.width / 2,
    y: layout.y + layout.height / 2,
  }
}

export function computeSweepDirectionFromSnapshots(
  fromLayoutById: Map<string, OrbitLabelLayout>,
  toLayoutById: Map<string, OrbitLabelLayout>,
  orbitSizePx: number,
  preferredLayoutId: string | null,
): number {
  const centerX = orbitSizePx / 2
  const centerY = orbitSizePx / 2
  const candidateIds: string[] = []
  if (preferredLayoutId) {
    candidateIds.push(preferredLayoutId)
  }
  const selectedToId = [...toLayoutById.values()].find((layout) => layout.isSelected)?.id
  if (selectedToId && !candidateIds.includes(selectedToId)) {
    candidateIds.push(selectedToId)
  }
  const firstToId = toLayoutById.keys().next().value as string | undefined
  if (firstToId && !candidateIds.includes(firstToId)) {
    candidateIds.push(firstToId)
  }

  for (const id of candidateIds) {
    const from = fromLayoutById.get(id)
    const to = toLayoutById.get(id)
    if (!from || !to) {
      continue
    }

    const fromPoint = layoutOrbitReferencePoint(from)
    const toPoint = layoutOrbitReferencePoint(to)
    const fromAngle = Math.atan2(fromPoint.y - centerY, fromPoint.x - centerX)
    const toAngle = Math.atan2(toPoint.y - centerY, toPoint.x - centerX)
    const delta = normalizeAngleDeltaRad(fromAngle, toAngle)
    const direction = Math.sign(delta)
    if (direction !== 0) {
      return direction
    }
  }

  return 0
}

function computeSweepDirectionFromRingRotations(fromRingRotationDeg: number, toRingRotationDeg: number): number {
  const delta = toRingRotationDeg - fromRingRotationDeg
  if (!Number.isFinite(delta) || Math.abs(delta) < 0.000001) {
    return 0
  }

  return delta > 0 ? 1 : -1
}

export function createOrbitTransitionPlan(params: {
  startedAtMs: number
  durationMs: number
  frozenNowMs: number
  fromSelectionId: string | null
  toSelectionId: string | null
  fromRing: RingFrameSnapshot
  toRing: RingFrameSnapshot
  fromLayouts: OrbitLabelLayout[]
  toLayouts: OrbitLabelLayout[]
  orbitSizePx: number
  preferredSweepLayoutId: string | null
}): OrbitTransitionPlan {
  const fromLayoutById = createLayoutMap(params.fromLayouts)
  const toLayoutById = createLayoutMap(params.toLayouts)
  const order = params.toLayouts.map((layout) => layout.id)
  const sweepDirection = computeSweepDirectionFromRingRotations(
    params.fromRing.wheelRotationDeg,
    params.toRing.wheelRotationDeg,
  )

  return {
    startedAtMs: params.startedAtMs,
    durationMs: params.durationMs,
    frozenNowMs: params.frozenNowMs,
    fromSelectionId: params.fromSelectionId,
    toSelectionId: params.toSelectionId,
    fromRingRotationDeg: params.fromRing.wheelRotationDeg,
    toRingRotationDeg: params.toRing.wheelRotationDeg,
    sweepDirection,
    fromLayoutById,
    toLayoutById,
    order,
    orbitSizePx: params.orbitSizePx,
  }
}

export function interpolateOrbitTransitionPlan(
  plan: OrbitTransitionPlan,
  progress: number,
): {
  wheelRotationDeg: number
  layout: OrbitLabelLayout[]
} {
  const t = clamp(progress, 0, 1)
  const centerX = plan.orbitSizePx / 2
  const centerY = plan.orbitSizePx / 2

  const layout = plan.order
    .map((id) => {
      const target = plan.toLayoutById.get(id)
      if (!target) {
        return null
      }
      const source = plan.fromLayoutById.get(id)
      if (!source) {
        return cloneOrbitLabelLayout(target)
      }

      const layoutSweepDirection = resolveLayoutSweepDirection(source, target, centerX, centerY, plan.sweepDirection)
      const frameWidth = lerpNumber(source.width, target.width, t)
      const frameHeight = lerpNumber(source.height, target.height, t)
      const sourceCenterX = source.x + source.width / 2
      const sourceCenterY = source.y + source.height / 2
      const targetCenterX = target.x + target.width / 2
      const targetCenterY = target.y + target.height / 2
      const frameCenter = interpolateOrbitPoint(
        sourceCenterX,
        sourceCenterY,
        targetCenterX,
        targetCenterY,
        centerX,
        centerY,
        layoutSweepDirection,
        t,
      )
      const framePosition = {
        x: frameCenter.x - frameWidth / 2,
        y: frameCenter.y - frameHeight / 2,
      }
      const frameAnchor = interpolateOrbitPoint(
        source.anchorX,
        source.anchorY,
        target.anchorX,
        target.anchorY,
        centerX,
        centerY,
        layoutSweepDirection,
        t,
      )
      const orbitInterpolatedSpokeEnd = interpolateOrbitPoint(
        source.spokeEndX,
        source.spokeEndY,
        target.spokeEndX,
        target.spokeEndY,
        centerX,
        centerY,
        layoutSweepDirection,
        t,
      )
      const sourceSpokeAttached = isPointWithinLayoutRect(source, source.spokeEndX, source.spokeEndY)
      const targetSpokeAttached = isPointWithinLayoutRect(target, target.spokeEndX, target.spokeEndY)
      const frameSpokeEnd =
        sourceSpokeAttached && targetSpokeAttached
          ? {
              x:
                framePosition.x +
                frameWidth *
                  lerpNumber(
                    pointRatioWithinRect(source.spokeEndX, source.x, source.width),
                    pointRatioWithinRect(target.spokeEndX, target.x, target.width),
                    t,
                  ),
              y:
                framePosition.y +
                frameHeight *
                  lerpNumber(
                    pointRatioWithinRect(source.spokeEndY, source.y, source.height),
                    pointRatioWithinRect(target.spokeEndY, target.y, target.height),
                    t,
                  ),
            }
          : orbitInterpolatedSpokeEnd

      return {
        ...cloneOrbitLabelLayout(target),
        x: framePosition.x,
        y: framePosition.y,
        width: frameWidth,
        height: frameHeight,
        anchorX: frameAnchor.x,
        anchorY: frameAnchor.y,
        spokeEndX: frameSpokeEnd.x,
        spokeEndY: frameSpokeEnd.y,
        spokePath: buildSpokePath(frameAnchor.x, frameAnchor.y, frameSpokeEnd.x, frameSpokeEnd.y),
        branchPath: buildBranchPath(frameAnchor.x, frameAnchor.y, frameSpokeEnd.x, frameSpokeEnd.y),
      } satisfies OrbitLabelLayout
    })
    .filter((value): value is OrbitLabelLayout => value !== null)

  return {
    wheelRotationDeg: lerpNumber(plan.fromRingRotationDeg, plan.toRingRotationDeg, t),
    layout,
  }
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

function colorHexWithAlpha(hex: string, alpha: number): string {
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

export function formatRelativeOffsetDirectionLabel(deltaMinutes: number): string {
  if (deltaMinutes === 0) {
    return "(same offset)"
  }

  const absolute = Math.abs(deltaMinutes)
  const hours = Math.floor(absolute / 60)
  const minutes = absolute % 60
  const offset = minutes === 0 ? `${hours}h` : `${hours}h ${String(minutes).padStart(2, "0")}m`
  const direction = deltaMinutes > 0 ? "ahead" : "behind"
  return `(${offset} ${direction})`
}

export function formatDecimalOffsetHours(deltaMinutes: number): string {
  const sign = deltaMinutes >= 0 ? "+" : "-"
  const absoluteHours = Math.abs(deltaMinutes) / 60
  let formatted = absoluteHours.toFixed(2)
  if (formatted.endsWith("00")) {
    formatted = `${Math.trunc(absoluteHours)}.0`
  } else if (formatted.endsWith("0")) {
    formatted = formatted.slice(0, -1)
  }

  return `${sign}${formatted}h`
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

function formatShortDateTime24InZone(timeZone: string | undefined, atMs: number): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "2-digit",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
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

export const HOUR_TREND = createCircularTrend(24)
export const MINUTE_TREND = createCircularTrend(60)

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

function cloneConicGradientStops(stops: ConicGradientStop[]): ConicGradientStop[] {
  return stops.map((stop) => ({ ...stop }))
}

function normalizeConicGradientStops(stops: ConicGradientStop[]): ConicGradientStop[] {
  const normalized = stops
    .filter((stop) => Number.isFinite(stop.minute))
    .map((stop) => ({
      minute: clamp(stop.minute, 0, 1440),
      colorHex: stop.colorHex || "#081521",
      alpha: clamp(stop.alpha, 0, 1),
    }))
    .sort((left, right) => left.minute - right.minute)

  if (normalized.length === 0) {
    return cloneConicGradientStops(DEFAULT_CONIC_GRADIENT_STOPS)
  }

  if (normalized[0]?.minute !== 0) {
    normalized.unshift({
      minute: 0,
      colorHex: normalized[0]?.colorHex ?? "#081521",
      alpha: normalized[0]?.alpha ?? 1,
    })
  }

  if (normalized[normalized.length - 1]?.minute !== 1440) {
    normalized.push({
      minute: 1440,
      colorHex: normalized[0]?.colorHex ?? "#081521",
      alpha: normalized[0]?.alpha ?? 1,
    })
  }

  return normalized
}

function buildConicGradientStops(stops: SkyStop[]): ConicGradientStop[] {
  if (stops.length === 0) {
    return cloneConicGradientStops(DEFAULT_CONIC_GRADIENT_STOPS)
  }

  const mapped = stops
    .filter((stop) => stop.minutesOfDay >= 0 && stop.minutesOfDay <= 1440)
    .map((stop) => ({
      minute: stop.minutesOfDay,
      colorHex: stop.colorHex || "#081521",
      alpha: DAYLIGHT_SKY_STOP_NAMES.has(stop.name.trim().toLowerCase()) ? 1 : 0,
    }))

  return normalizeConicGradientStops(mapped)
}

function areConicGradientStopsEqual(left: ConicGradientStop[], right: ConicGradientStop[]): boolean {
  if (left.length !== right.length) {
    return false
  }

  for (let index = 0; index < left.length; index += 1) {
    const leftStop = left[index]
    const rightStop = right[index]
    if (!leftStop || !rightStop) {
      return false
    }
    if (Math.abs(leftStop.minute - rightStop.minute) > 0.001) {
      return false
    }
    if (leftStop.colorHex.toLowerCase() !== rightStop.colorHex.toLowerCase()) {
      return false
    }
    if (Math.abs(leftStop.alpha - rightStop.alpha) > 0.001) {
      return false
    }
  }

  return true
}

function sampleNormalizedConicGradientStopAtMinute(
  normalizedStops: ConicGradientStop[],
  minuteOfDay: number,
): ConicGradientStop {
  const minute = normalizeMinutesOfDay(minuteOfDay)
  if (normalizedStops.length === 1) {
    return {
      minute,
      colorHex: normalizedStops[0]!.colorHex,
      alpha: normalizedStops[0]!.alpha,
    }
  }

  const nextIndex = normalizedStops.findIndex((stop) => stop.minute >= minute)
  if (nextIndex === -1) {
    const previous = normalizedStops[normalizedStops.length - 1]!
    const next = { ...normalizedStops[0]!, minute: normalizedStops[0]!.minute + 1440 }
    const span = next.minute - previous.minute
    if (span <= 0) {
      return {
        minute,
        colorHex: next.colorHex,
        alpha: next.alpha,
      }
    }
    const ratio = (minute - previous.minute) / span
    return {
      minute,
      colorHex: mixHexColors(previous.colorHex, next.colorHex, ratio),
      alpha: lerpNumber(previous.alpha, next.alpha, ratio),
    }
  }

  const next = normalizedStops[nextIndex]!
  const previous =
    nextIndex === 0
      ? {
          ...normalizedStops[normalizedStops.length - 1]!,
          minute: normalizedStops[normalizedStops.length - 1]!.minute - 1440,
        }
      : normalizedStops[nextIndex - 1]!

  const span = next.minute - previous.minute
  if (span <= 0) {
    return {
      minute,
      colorHex: next.colorHex,
      alpha: next.alpha,
    }
  }

  const ratio = (minute - previous.minute) / span
  return {
    minute,
    colorHex: mixHexColors(previous.colorHex, next.colorHex, ratio),
    alpha: lerpNumber(previous.alpha, next.alpha, ratio),
  }
}

function interpolateConicGradientStops(
  fromStops: ConicGradientStop[],
  toStops: ConicGradientStop[],
  progress: number,
  noonMinute: number = DEFAULT_NOON_MINUTE,
  useDaylightFanDelay: boolean = false,
): ConicGradientStop[] {
  const t = clamp(progress, 0, 1)
  if (t <= 0) {
    return normalizeConicGradientStops(fromStops)
  }
  if (t >= 1) {
    return normalizeConicGradientStops(toStops)
  }

  const fromNormalized = normalizeConicGradientStops(fromStops)
  const toNormalized = normalizeConicGradientStops(toStops)
  const minuteByKey = new Map<string, number>()
  for (const minute of [0, 1440]) {
    minuteByKey.set(minute.toFixed(3), minute)
  }
  for (const stop of fromNormalized) {
    minuteByKey.set(stop.minute.toFixed(3), stop.minute)
  }
  for (const stop of toNormalized) {
    minuteByKey.set(stop.minute.toFixed(3), stop.minute)
  }

  const fanOriginMinute = clamp(noonMinute, 0, 1440)
  const minutes = [...minuteByKey.values()].sort((left, right) => left - right)
  return minutes.map((minute) => {
    const fromSample = sampleNormalizedConicGradientStopAtMinute(fromNormalized, minute)
    const toSample = sampleNormalizedConicGradientStopAtMinute(toNormalized, minute)
    const localProgress = useDaylightFanDelay ? fanOutProgressFromNoon(t, minute, fanOriginMinute) : t
    return {
      minute,
      colorHex: mixHexColors(fromSample.colorHex, toSample.colorHex, localProgress),
      alpha: lerpNumber(fromSample.alpha, toSample.alpha, localProgress),
    }
  })
}

function buildConicGradient(stops: ConicGradientStop[]): string {
  const normalizedStops = normalizeConicGradientStops(stops)
  const segments = normalizedStops.map((stop) => {
    const pct = Number(((stop.minute / 1440) * 100).toFixed(3))
    const color = stop.alpha < 0.999 ? colorHexWithAlpha(stop.colorHex, stop.alpha) : stop.colorHex
    return `${color} ${pct}%`
  })

  return `conic-gradient(from 0deg, ${segments.join(", ")})`
}

function buildNightMaskGradient(stops: ConicGradientStop[]): string {
  const normalizedStops = normalizeConicGradientStops(stops)
  const segments = normalizedStops.map((stop) => {
    const pct = Number(((stop.minute / 1440) * 100).toFixed(3))
    const nightAlpha = clamp(1 - stop.alpha, 0, 1)
    const level = Math.round(nightAlpha * 255)
    return `rgba(${level}, ${level}, ${level}, ${nightAlpha}) ${pct}%`
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

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false
  }

  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

function sortByLabel(left: PersistedLocationApiResult, right: PersistedLocationApiResult): number {
  return locationDisplayLabel(left).toLocaleLowerCase().localeCompare(locationDisplayLabel(right).toLocaleLowerCase())
}

function groupedLabelHeight(memberCount: number, isMobile: boolean): number {
  const safeCount = Math.max(1, memberCount)
  const base = isMobile ? 36 : 38
  const perEntity = isMobile ? 40 : 42
  return base + safeCount * perEntity
}

function createTextWidthMeasurer(): (text: string, font: string) => number {
  let canvas: HTMLCanvasElement | null = null
  let context: CanvasRenderingContext2D | null = null

  return (text: string, font: string): number => {
    const normalized = text.trim()
    if (normalized.length === 0) {
      return 0
    }

    if (typeof document !== "undefined") {
      if (!canvas) {
        canvas = document.createElement("canvas")
      }
      if (!context) {
        context = canvas.getContext("2d")
      }
      if (context) {
        context.font = font
        return context.measureText(normalized).width
      }
    }

    const pxMatch = /(\d+(?:\.\d+)?)px/.exec(font)
    const fontSizePx = pxMatch ? Number(pxMatch[1]) : 14
    return normalized.length * fontSizePx * 0.56
  }
}

const measureTextWidth = createTextWidthMeasurer()
const LABEL_FONT_FAMILY = '"Segoe UI", system-ui, -apple-system, sans-serif'
const LABEL_EMOJI_FAMILY = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif'
const BASE_REM_PX = 16

function measureGroupedLabelWidth(group: OrbitLabelGroup, isMobile: boolean): number {
  const entityNameFontPx = 0.98 * BASE_REM_PX
  const entityEmojiFontPx = 1.12 * BASE_REM_PX
  const metaFontPx = (isMobile ? 0.76 : 0.8) * BASE_REM_PX

  const rowGapPx = 0.6 * BASE_REM_PX
  const rowPadLeftPx = 0.62 * BASE_REM_PX
  const rowPadRightPx = 0.62 * BASE_REM_PX
  const iconColumnPx = 1.2 * BASE_REM_PX
  const chipPadLeftPx = 0.2 * BASE_REM_PX
  const chipPadRightPx = 0.2 * BASE_REM_PX
  const metaPadLeftPx = rowPadLeftPx + iconColumnPx + rowGapPx
  const metaPadRightPx = rowPadRightPx
  const safetyBufferPx = 18

  const entityNameFont = `300 ${entityNameFontPx.toFixed(2)}px ${LABEL_FONT_FAMILY}`
  const metaFont = `700 ${metaFontPx.toFixed(2)}px ${LABEL_FONT_FAMILY}`
  const entityEmojiFont = `400 ${entityEmojiFontPx.toFixed(2)}px ${LABEL_EMOJI_FAMILY}`

  const widestEntityRow = group.members.reduce((currentMax, member) => {
    const emojiWidth = measureTextWidth(member.leadingEmoji, entityEmojiFont)
    const effectiveIconWidth = Math.max(iconColumnPx, emojiWidth)
    const nameWidth = measureTextWidth(member.label, entityNameFont)
    const rowWidth = rowPadLeftPx + effectiveIconWidth + rowGapPx + nameWidth + rowPadRightPx
    return Math.max(currentMax, rowWidth)
  }, 0)
  const footerDateTime = group.shortDateTime24 ?? group.time
  const footerRelativeDelta = formatDecimalOffsetHours(group.relativeOffsetMinutes)
  const footerOffsetLabel = group.isSelected ? "Now" : footerRelativeDelta
  const footerText = `${footerDateTime} · ${footerOffsetLabel}`
  const metaWidth = metaPadLeftPx + measureTextWidth(footerText, metaFont) + metaPadRightPx

  return Math.ceil(chipPadLeftPx + Math.max(widestEntityRow, metaWidth) + chipPadRightPx + safetyBufferPx)
}

export function useHomeClockModel(): HomeClockViewModel {
  const [savedLocations, setSavedLocations] = useState<PersistedLocationApiResult[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [sky, setSky] = useState<Sky24hResult | null>(null)
  const [clockNowMs, setClockNowMs] = useState<number>(() => Date.now())
  const [ringError, setRingError] = useState<string | null>(null)
  const [ringDiameter, setRingDiameter] = useState<number>(0)
  const [displayedWheelGradient, setDisplayedWheelGradient] = useState<string>(() =>
    buildConicGradient(DEFAULT_CONIC_GRADIENT_STOPS),
  )
  const [displayedNightMaskGradient, setDisplayedNightMaskGradient] = useState<string>(() =>
    buildNightMaskGradient(DEFAULT_CONIC_GRADIENT_STOPS),
  )
  const [areHourTicksVisible, setAreHourTicksVisible] = useState<boolean>(() => prefersReducedMotion())
  const [gradientTransitionToken, setGradientTransitionToken] = useState<number>(0)
  const [isRingTransitioning, setIsRingTransitioning] = useState<boolean>(false)
  const [wheelBaseRotationDeg, setWheelBaseRotationDeg] = useState<number>(0)
  const [displayWheelRotation, setDisplayWheelRotation] = useState<number>(0)
  const [centerCopyTransitionKey, setCenterCopyTransitionKey] = useState<number>(0)
  const [displayOrbitLabelLayout, setDisplayOrbitLabelLayout] = useState<OrbitLabelLayout[]>([])

  const ringFrameRef = useRef<HTMLDivElement | null>(null)
  const lastSelectedIdRef = useRef<string | null>(null)
  const pendingSelectionTransitionRef = useRef<boolean>(false)
  const pendingSecondOrderMorphRef = useRef<boolean>(false)
  const lastAnimatedGradientTokenRef = useRef<number>(0)
  const displayedWheelGradientStopsRef = useRef<ConicGradientStop[]>(
    cloneConicGradientStops(DEFAULT_CONIC_GRADIENT_STOPS),
  )
  const gradientMorphRafRef = useRef<number | null>(null)
  const wheelBaseRotationRef = useRef<number | null>(null)
  const ringRotationDirectionRef = useRef<number>(0)
  const selectedOrbitAnchorRef = useRef<number | null>(null)
  const orbitTransitionRafRef = useRef<number | null>(null)
  const orbitTransitionPlanRef = useRef<OrbitTransitionPlan | null>(null)
  const isOrbitTransitioningRef = useRef<boolean>(false)
  const displayOrbitLabelLayoutRef = useRef<OrbitLabelLayout[]>([])
  const displayWheelRotationRef = useRef<number>(0)
  const previousOrbitSelectionIdRef = useRef<string | null>(selectedId)
  const pendingOrbitTransitionTargetRef = useRef<string | null>(null)

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
  const [selectedOrbitAnchorDeg, setSelectedOrbitAnchorDeg] = useState<number>(() =>
    toAngleFromTopDeg(safeSelectedOffset),
  )

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

  const wheelGradientStops = useMemo(() => buildConicGradientStops(sky?.stops ?? []), [sky])
  const gradientFanMinute = useMemo(() => {
    const solarNoonStop = sky?.stops.find((stop) => stop.name === "solar_noon" && Number.isFinite(stop.minutesOfDay))
    if (!solarNoonStop) {
      return DEFAULT_NOON_MINUTE
    }

    return clamp(solarNoonStop.minutesOfDay, 0, 1440)
  }, [sky])

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
    return sortedLocations
      .map((location): OrbitLabel | null => {
        if (!location.timezone) {
          return null
        }

        const offset = getTimeZoneOffsetMinutes(location.timezone, clockNowMs)
        if (offset === null) {
          return null
        }

        const deltaMinutes = shortestOffsetDeltaMinutes(safeSelectedOffset, offset)
        const localDeltaMinutes = offset - localOffsetMinutes
        const absoluteOffsetAngleDeg = toAngleFromTopDeg(offset)
        const minutesOfDay =
          getMinutesOfDayInZone(location.timezone, clockNowMs) ?? normalizeMinutesOfDay(Math.round(clockNowMs / 60_000))

        return {
          id: location.id,
          timezoneKey: `offset:${offset}`,
          leadingEmoji: leadingEmojiForLocation(location),
          label: locationDisplayLabel(location),
          time: formatTimeInZone(location.timezone, clockNowMs),
          shortDateTime24: formatShortDateTime24InZone(location.timezone, clockNowMs),
          timezoneMeta: formatTimezoneMeta(location.timezone, clockNowMs),
          relativeLabel: formatRelativeOffsetLabel(deltaMinutes),
          relativeOffsetMinutes: deltaMinutes,
          localRelativeOffsetMinutes: localDeltaMinutes,
          angleDeg: absoluteOffsetAngleDeg - selectedOrbitAnchorDeg,
          skyColorHex: sampleSkyColorAtMinute(sky?.stops ?? [], minutesOfDay),
          isSelected: location.id === selectedId,
          isLocal: offset === localOffsetMinutes,
        }
      })
      .filter(isNonNull)
      .sort((left, right) => left.angleDeg - right.angleDeg)
  }, [sortedLocations, clockNowMs, safeSelectedOffset, selectedOrbitAnchorDeg, selectedId, localOffsetMinutes, sky])

  const labelOrbitSizePx = useMemo(() => {
    if (!ringDiameter || !Number.isFinite(ringDiameter)) {
      return 720
    }

    return ringDiameter
  }, [ringDiameter])

  const orbitLabelGroups = useMemo(() => {
    const groups = new Map<string, OrbitLabel[]>()
    for (const label of orbitLabels) {
      const existing = groups.get(label.timezoneKey) ?? []
      existing.push(label)
      groups.set(label.timezoneKey, existing)
    }

    return [...groups.entries()]
      .map(([timezoneKey, labels]): OrbitLabelGroup | null => {
        const members = [...labels].sort((left, right) => {
          return left.label.localeCompare(right.label)
        })

        const primary = members[0]
        if (!primary) {
          return null
        }

        const memberCount = members.length

        return {
          id: `tz-${timezoneKey}`,
          timezoneKey,
          time: primary.time,
          shortDateTime24: primary.shortDateTime24,
          timezoneMeta: primary.timezoneMeta,
          relativeLabel: primary.relativeLabel,
          relativeOffsetMinutes: primary.relativeOffsetMinutes,
          localRelativeOffsetMinutes: primary.localRelativeOffsetMinutes,
          angleDeg: primary.angleDeg,
          skyColorHex: primary.skyColorHex,
          isSelected: members.some((member) => member.isSelected),
          isLocal: members.some((member) => member.isLocal),
          memberCount,
          members: members.map((member) => ({
            id: member.id,
            label: member.label,
            time: member.time,
            timezoneMeta: member.timezoneMeta,
            relativeLabel: member.relativeLabel,
            leadingEmoji: member.leadingEmoji,
            isSelected: member.isSelected,
          })),
        } satisfies OrbitLabelGroup
      })
      .filter(isNonNull)
      .sort((left, right) => left.angleDeg - right.angleDeg)
  }, [orbitLabels])

  const orbitLayoutResult = useMemo(() => {
    return computeOrbitLabelLayout(
      orbitLabelGroups.map((group) => ({
        id: group.id,
        angleDeg: group.angleDeg,
        isSelected: group.isSelected,
        isLocal: group.isLocal,
        width: measureGroupedLabelWidth(group, isMobile),
        height: groupedLabelHeight(group.memberCount, isMobile),
      })),
      {
        frameWidth: labelOrbitSizePx,
        frameHeight: labelOrbitSizePx,
        ringDiameter: labelOrbitSizePx,
        isMobile,
      },
    )
  }, [orbitLabelGroups, labelOrbitSizePx, isMobile])

  const orbitLabelGroupLookup = useMemo(() => {
    return new Map(orbitLabelGroups.map((group) => [group.id, group]))
  }, [orbitLabelGroups])

  const orbitLabelLayout = useMemo(() => {
    return orbitLayoutResult.labels
      .map((layout): OrbitLabelLayout | null => {
        const group = orbitLabelGroupLookup.get(layout.id)
        if (!group) {
          return null
        }

        return {
          ...group,
          ...layout,
        }
      })
      .filter(isNonNull)
  }, [orbitLayoutResult.labels, orbitLabelGroupLookup])

  useEffect(() => {
    displayOrbitLabelLayoutRef.current = displayOrbitLabelLayout
  }, [displayOrbitLabelLayout])

  useEffect(() => {
    displayWheelRotationRef.current = displayWheelRotation
  }, [displayWheelRotation])

  useLayoutEffect(() => {
    const previousSelectionId = previousOrbitSelectionIdRef.current
    const selectionChanged = previousSelectionId !== null && selectedId !== previousSelectionId
    previousOrbitSelectionIdRef.current = selectedId
    if (selectionChanged) {
      pendingOrbitTransitionTargetRef.current = selectedId
    }

    const pendingTargetSelectionId = pendingOrbitTransitionTargetRef.current
    if (!pendingTargetSelectionId || pendingTargetSelectionId !== selectedId) {
      return
    }

    const targetAnchor = selectedOrbitAnchorRef.current
    const anchorSettled = targetAnchor === null || Math.abs(targetAnchor - selectedOrbitAnchorDeg) < 0.001
    if (!anchorSettled) {
      return
    }
    pendingOrbitTransitionTargetRef.current = null

    if (orbitTransitionRafRef.current !== null) {
      window.cancelAnimationFrame(orbitTransitionRafRef.current)
      orbitTransitionRafRef.current = null
    }

    const frozenNowMs = Date.now()
    const sourceLayout =
      displayOrbitLabelLayoutRef.current.length > 0 ? displayOrbitLabelLayoutRef.current : orbitLabelLayout
    const toLayouts = orbitLabelLayout.map((layout) => cloneOrbitLabelLayout(layout))
    const fromRing = Number.isFinite(displayWheelRotationRef.current) ? displayWheelRotationRef.current : wheelRotation
    let toRing = wheelRotation
    if (selectedLocation) {
      try {
        const preview = computeSky24h(
          { lat: selectedLocation.lat, long: selectedLocation.long },
          createClientBaselineEnvironment(selectedTimezone),
          frozenNowMs,
          { applySecondOrder: false },
        )
        const delta = shortestAngleDeltaDeg(fromRing, preview.rotationDeg)
        toRing = fromRing + delta
      } catch {
        toRing = wheelRotation
      }
    }

    const toSelectionLayoutId = findSelectedLayoutId(toLayouts)
    const plan = createOrbitTransitionPlan({
      startedAtMs: performance.now(),
      durationMs: SELECTION_TRANSITION_MS,
      frozenNowMs,
      fromSelectionId: previousSelectionId,
      toSelectionId: selectedId,
      fromRing: { wheelRotationDeg: fromRing },
      toRing: { wheelRotationDeg: toRing },
      fromLayouts: sourceLayout,
      toLayouts,
      orbitSizePx: labelOrbitSizePx,
      preferredSweepLayoutId: toSelectionLayoutId,
    })

    orbitTransitionPlanRef.current = plan
    isOrbitTransitioningRef.current = true
    setIsRingTransitioning(true)
    setDisplayCenterTime(formatTimeInZone(selectedTimezone, frozenNowMs))
    if (timeCounterRafRef.current !== null) {
      window.cancelAnimationFrame(timeCounterRafRef.current)
      timeCounterRafRef.current = null
    }
    isTimeCounterAnimatingRef.current = false
    lastSelectionForTimeCounterRef.current = selectedId

    const commitPlan = (targetPlan: OrbitTransitionPlan) => {
      const finalLayout = targetPlan.order
        .map((id) => targetPlan.toLayoutById.get(id))
        .filter((layout): layout is OrbitLabelLayout => layout !== undefined)
        .map((layout) => cloneOrbitLabelLayout(layout))
      displayOrbitLabelLayoutRef.current = finalLayout
      displayWheelRotationRef.current = targetPlan.toRingRotationDeg
      setDisplayOrbitLabelLayout(finalLayout)
      setDisplayWheelRotation(targetPlan.toRingRotationDeg)
      orbitTransitionPlanRef.current = null
      isOrbitTransitioningRef.current = false
      setIsRingTransitioning(false)
      setDisplayCenterTime(formatTimeInZone(selectedTimezone, Date.now()))
      lastSelectionForTimeCounterRef.current = targetPlan.toSelectionId
    }

    if (prefersReducedMotion()) {
      commitPlan(plan)
      return
    }

    const tick = (frameNowMs: number) => {
      const activePlan = orbitTransitionPlanRef.current
      if (!activePlan) {
        orbitTransitionRafRef.current = null
        return
      }

      const progress = clamp((frameNowMs - activePlan.startedAtMs) / activePlan.durationMs, 0, 1)
      const easedProgress = easeSelectionTransition(progress)
      const frame = interpolateOrbitTransitionPlan(activePlan, easedProgress)
      displayOrbitLabelLayoutRef.current = frame.layout
      displayWheelRotationRef.current = frame.wheelRotationDeg
      setDisplayOrbitLabelLayout(frame.layout)
      setDisplayWheelRotation(frame.wheelRotationDeg)

      if (progress >= 1) {
        orbitTransitionRafRef.current = null
        commitPlan(activePlan)
        return
      }

      orbitTransitionRafRef.current = window.requestAnimationFrame(tick)
    }

    orbitTransitionRafRef.current = window.requestAnimationFrame(tick)
  }, [
    labelOrbitSizePx,
    orbitLabelLayout,
    selectedId,
    selectedLocation,
    selectedTimezone,
    selectedOrbitAnchorDeg,
    wheelRotation,
  ])

  useEffect(() => {
    if (
      isOrbitTransitioningRef.current ||
      orbitTransitionPlanRef.current !== null ||
      pendingOrbitTransitionTargetRef.current !== null
    ) {
      return
    }

    displayOrbitLabelLayoutRef.current = orbitLabelLayout
    displayWheelRotationRef.current = wheelRotation
    setDisplayOrbitLabelLayout(orbitLabelLayout)
    setDisplayWheelRotation(wheelRotation)
  }, [orbitLabelLayout, wheelRotation])

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
    if (areHourTicksVisible || !sky) {
      return
    }

    if (prefersReducedMotion()) {
      setAreHourTicksVisible(true)
      return
    }

    let cancelled = false
    const revealRaf = window.requestAnimationFrame(() => {
      if (!cancelled) {
        setAreHourTicksVisible(true)
      }
    })

    return () => {
      cancelled = true
      window.cancelAnimationFrame(revealRaf)
    }
  }, [sky, areHourTicksVisible])

  useEffect(() => {
    const currentStops = displayedWheelGradientStopsRef.current
    if (areConicGradientStopsEqual(currentStops, wheelGradientStops)) {
      return
    }

    if (gradientMorphRafRef.current !== null) {
      window.cancelAnimationFrame(gradientMorphRafRef.current)
      gradientMorphRafRef.current = null
    }

    const shouldAnimateFromDefaultMidnight =
      areConicGradientStopsEqual(currentStops, DEFAULT_CONIC_GRADIENT_STOPS) &&
      !areConicGradientStopsEqual(wheelGradientStops, DEFAULT_CONIC_GRADIENT_STOPS)
    const shouldAnimate =
      (gradientTransitionToken > lastAnimatedGradientTokenRef.current || shouldAnimateFromDefaultMidnight) &&
      currentStops.length > 0 &&
      !prefersReducedMotion()
    if (!shouldAnimate) {
      const normalizedTarget = normalizeConicGradientStops(wheelGradientStops)
      displayedWheelGradientStopsRef.current = cloneConicGradientStops(normalizedTarget)
      setDisplayedWheelGradient(buildConicGradient(normalizedTarget))
      setDisplayedNightMaskGradient(buildNightMaskGradient(normalizedTarget))
      return
    }

    const fromStops = cloneConicGradientStops(currentStops)
    const toStops = cloneConicGradientStops(wheelGradientStops)
    const startedAtMs = performance.now()
    const useDaylightFanDelay = shouldAnimateFromDefaultMidnight
    lastAnimatedGradientTokenRef.current = gradientTransitionToken

    const tick = (frameNowMs: number) => {
      const progress = clamp((frameNowMs - startedAtMs) / GRADIENT_TRANSITION_MS, 0, 1)
      const easedProgress = easeEpicGradientTransition(progress)
      const frameStops = interpolateConicGradientStops(
        fromStops,
        toStops,
        easedProgress,
        gradientFanMinute,
        useDaylightFanDelay,
      )
      displayedWheelGradientStopsRef.current = frameStops
      setDisplayedWheelGradient(buildConicGradient(frameStops))
      setDisplayedNightMaskGradient(buildNightMaskGradient(frameStops))

      if (progress >= 1) {
        gradientMorphRafRef.current = null
        return
      }

      gradientMorphRafRef.current = window.requestAnimationFrame(tick)
    }

    gradientMorphRafRef.current = window.requestAnimationFrame(tick)
  }, [wheelGradientStops, gradientTransitionToken, gradientFanMinute])

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
    if (isOrbitTransitioningRef.current) {
      return
    }

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
      if (gradientMorphRafRef.current !== null) {
        window.cancelAnimationFrame(gradientMorphRafRef.current)
      }
      if (timeCounterRafRef.current !== null) {
        window.cancelAnimationFrame(timeCounterRafRef.current)
      }
      if (orbitTransitionRafRef.current !== null) {
        window.cancelAnimationFrame(orbitTransitionRafRef.current)
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

  return {
    ringFrameRef,
    conceptVars,
    centerCopyTransitionKey,
    selectedCopyLabel,
    centerTimeParts,
    displayCenterTime,
    centerUtcOffsetParts,
    shouldAnimateHour,
    shouldAnimateMinute,
    shouldAnimateUtcHours,
    shouldAnimateUtcMinutes,
    ringError,
    isRingTransitioning,
    areHourTicksVisible,
    displayedWheelGradient,
    displayedNightMaskGradient,
    wheelRotation: displayWheelRotation,
    selectedId,
    orbitLabels,
    orbitLabelGroups,
    orbitLabelLayout: displayOrbitLabelLayout.length > 0 ? displayOrbitLabelLayout : orbitLabelLayout,
    ringDiameter,
    labelOrbitSizePx,
    setSelectedId,
  }
}

export default useHomeClockModel
