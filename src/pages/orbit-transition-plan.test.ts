import { describe, expect, test } from "bun:test"
import type { OrbitLabelLayout } from "./useHomeClockModel"
import {
  computeSweepDirectionFromSnapshots,
  createOrbitTransitionPlan,
  interpolateOrbitTransitionPlan,
} from "./useHomeClockModel"

function makeLayout(id: string, x: number, y: number, selected = false): OrbitLabelLayout {
  const width = 120
  const height = 48
  const anchorX = x + 8
  const anchorY = y + 8
  const spokeEndX = x + 20
  const spokeEndY = y + 20
  return {
    id,
    timezoneKey: id,
    side: "right",
    x,
    y,
    width,
    height,
    anchorX,
    anchorY,
    spokeEndX,
    spokeEndY,
    spokePath: `M ${anchorX} ${anchorY} L ${spokeEndX} ${spokeEndY}`,
    branchPath: `M ${anchorX} ${anchorY} L ${spokeEndX} ${spokeEndY}`,
    time: "12:00:00",
    timezoneMeta: "UTC+0",
    relativeLabel: "same offset",
    relativeOffsetMinutes: 0,
    angleDeg: 0,
    skyColorHex: "#88aacc",
    isSelected: selected,
    isLocal: false,
    memberCount: 1,
    members: [
      {
        id: `${id}-member`,
        label: "Example",
        time: "12:00:00",
        timezoneMeta: "UTC+0",
        relativeLabel: "same offset",
        leadingEmoji: "📍",
        isSelected: selected,
      },
    ],
  }
}

describe("orbit transition planning", () => {
  test("creates deterministic plans for the same frozen input", () => {
    const fromLayouts = [makeLayout("a", 200, 100, true), makeLayout("b", 80, 210)]
    const toLayouts = [makeLayout("a", 160, 40, true), makeLayout("b", 60, 180)]

    const create = () =>
      createOrbitTransitionPlan({
        startedAtMs: 1000,
        durationMs: 780,
        frozenNowMs: 1_700_000_000_000,
        fromSelectionId: "a-member",
        toSelectionId: "a-member",
        fromRing: { wheelRotationDeg: 12 },
        toRing: { wheelRotationDeg: 48 },
        fromLayouts,
        toLayouts,
        orbitSizePx: 320,
        preferredSweepLayoutId: "a",
      })

    const left = create()
    const right = create()

    expect(left.durationMs).toBe(right.durationMs)
    expect(left.frozenNowMs).toBe(right.frozenNowMs)
    expect(left.sweepDirection).toBe(right.sweepDirection)
    expect(left.order).toEqual(right.order)
    expect(left.toRingRotationDeg).toBe(right.toRingRotationDeg)
  })

  test("chooses shortest sweep direction from rendered geometry", () => {
    const fromLayouts = [makeLayout("sel", 220, 100, true)]
    const toLayouts = [makeLayout("sel", 100, 0, true)]
    const fromById = new Map(fromLayouts.map((layout) => [layout.id, layout]))
    const toById = new Map(toLayouts.map((layout) => [layout.id, layout]))

    const direction = computeSweepDirectionFromSnapshots(fromById, toById, 320, "sel")
    expect(direction).toBe(-1)
  })

  test("interpolates start/mid/end frames without NaN", () => {
    const fromLayouts = [makeLayout("sel", 220, 100, true)]
    const toLayouts = [makeLayout("sel", 100, 220, true)]

    const plan = createOrbitTransitionPlan({
      startedAtMs: 0,
      durationMs: 780,
      frozenNowMs: 1_700_000_000_000,
      fromSelectionId: "sel-member",
      toSelectionId: "sel-member",
      fromRing: { wheelRotationDeg: 0 },
      toRing: { wheelRotationDeg: 120 },
      fromLayouts,
      toLayouts,
      orbitSizePx: 320,
      preferredSweepLayoutId: "sel",
    })

    const atStart = interpolateOrbitTransitionPlan(plan, 0)
    const atMid = interpolateOrbitTransitionPlan(plan, 0.5)
    const atEnd = interpolateOrbitTransitionPlan(plan, 1)

    expect(atStart.layout[0]?.x).toBeCloseTo(220, 5)
    expect(atStart.layout[0]?.y).toBeCloseTo(100, 5)
    expect(Number.isFinite(atMid.layout[0]?.x ?? Number.NaN)).toBe(true)
    expect(Number.isFinite(atMid.layout[0]?.y ?? Number.NaN)).toBe(true)
    expect(atEnd.layout[0]?.x).toBeCloseTo(100, 5)
    expect(atEnd.layout[0]?.y).toBeCloseTo(220, 5)
    expect(atEnd.wheelRotationDeg).toBeCloseTo(120, 5)
  })

  test("retargeting uses current interpolated frame as new start snapshot", () => {
    const fromLayouts = [makeLayout("sel", 220, 100, true)]
    const firstTarget = [makeLayout("sel", 100, 220, true)]
    const secondTarget = [makeLayout("sel", 40, 100, true)]

    const firstPlan = createOrbitTransitionPlan({
      startedAtMs: 0,
      durationMs: 780,
      frozenNowMs: 1_700_000_000_000,
      fromSelectionId: "sel-member",
      toSelectionId: "sel-member",
      fromRing: { wheelRotationDeg: 0 },
      toRing: { wheelRotationDeg: 90 },
      fromLayouts,
      toLayouts: firstTarget,
      orbitSizePx: 320,
      preferredSweepLayoutId: "sel",
    })
    const midFrame = interpolateOrbitTransitionPlan(firstPlan, 0.5)

    const secondPlan = createOrbitTransitionPlan({
      startedAtMs: 100,
      durationMs: 780,
      frozenNowMs: 1_700_000_000_500,
      fromSelectionId: "sel-member",
      toSelectionId: "sel-member",
      fromRing: { wheelRotationDeg: midFrame.wheelRotationDeg },
      toRing: { wheelRotationDeg: 160 },
      fromLayouts: midFrame.layout,
      toLayouts: secondTarget,
      orbitSizePx: 320,
      preferredSweepLayoutId: "sel",
    })
    const retargetStart = interpolateOrbitTransitionPlan(secondPlan, 0)

    expect(retargetStart.layout[0]?.x).toBeCloseTo(midFrame.layout[0]?.x ?? 0, 5)
    expect(retargetStart.layout[0]?.y).toBeCloseTo(midFrame.layout[0]?.y ?? 0, 5)
    expect(retargetStart.wheelRotationDeg).toBeCloseTo(midFrame.wheelRotationDeg, 5)
  })

  test("non-selected cards use shortest arc even when plan sweep is opposite", () => {
    const center = 160
    const radius = 100
    const pointAt = (angleDeg: number) => {
      const theta = (angleDeg * Math.PI) / 180
      return {
        x: center + Math.cos(theta) * radius,
        y: center + Math.sin(theta) * radius,
      }
    }

    const fromSelected = makeLayout("sel", 220, 100, true)
    const toSelected = makeLayout("sel", 120, 220, true)
    const fromOtherPoint = pointAt(170)
    const toOtherPoint = pointAt(-170)
    const fromOther = makeLayout("other", fromOtherPoint.x, fromOtherPoint.y, false)
    const toOther = makeLayout("other", toOtherPoint.x, toOtherPoint.y, false)

    const plan = createOrbitTransitionPlan({
      startedAtMs: 0,
      durationMs: 780,
      frozenNowMs: 1_700_000_001_000,
      fromSelectionId: "sel-member",
      toSelectionId: "sel-member",
      fromRing: { wheelRotationDeg: 0 },
      toRing: { wheelRotationDeg: 120 },
      fromLayouts: [fromSelected, fromOther],
      toLayouts: [toSelected, toOther],
      orbitSizePx: 320,
      preferredSweepLayoutId: "sel",
    })

    const mid = interpolateOrbitTransitionPlan(plan, 0.5)
    const midOther = mid.layout.find((layout) => layout.id === "other")
    expect(midOther).toBeDefined()

    const midAngle = Math.atan2((midOther?.y ?? 0) - center, (midOther?.x ?? 0) - center)
    const midAngleDeg = (midAngle * 180) / Math.PI
    expect(Math.abs(midAngleDeg)).toBeGreaterThan(170)
  })
})
