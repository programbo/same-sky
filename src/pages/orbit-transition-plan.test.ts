import { describe, expect, test } from "bun:test"
import { computeOrbitLabelLayout } from "./orbit-label-layout"
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

function makeSelectedLayoutAtAngle(id: string, angleDeg: number, orbitSizePx: number): OrbitLabelLayout {
  const center = orbitSizePx / 2
  const radius = orbitSizePx * 0.26
  const theta = (angleDeg * Math.PI) / 180
  const spokeX = center + Math.cos(theta) * radius
  const spokeY = center + Math.sin(theta) * radius
  const width = 220
  const height = 52
  const x = spokeX - width / 2
  const y = spokeY - height / 2

  return {
    id,
    timezoneKey: id,
    side: "right",
    x,
    y,
    width,
    height,
    anchorX: spokeX,
    anchorY: spokeY,
    spokeEndX: spokeX,
    spokeEndY: spokeY,
    spokePath: `M ${spokeX} ${spokeY} L ${spokeX} ${spokeY}`,
    branchPath: `M ${spokeX} ${spokeY} L ${spokeX} ${spokeY}`,
    time: "12:00:00",
    timezoneMeta: "UTC+0",
    relativeLabel: "same offset",
    relativeOffsetMinutes: 0,
    angleDeg: 0,
    skyColorHex: "#88aacc",
    isSelected: true,
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
        isSelected: true,
      },
    ],
  }
}

type TestCornerKey = "top-left" | "top-right" | "bottom-left" | "bottom-right"

function spokePointForCorner(
  x: number,
  y: number,
  width: number,
  height: number,
  corner: TestCornerKey,
): { x: number; y: number } {
  const inset = 16
  switch (corner) {
    case "top-left":
      return { x: x + inset, y: y + inset }
    case "top-right":
      return { x: x + width - inset, y: y + inset }
    case "bottom-left":
      return { x: x + inset, y: y + height - inset }
    case "bottom-right":
      return { x: x + width - inset, y: y + height - inset }
  }
}

function makeCornerAttachedLayoutAtAngle(
  id: string,
  angleDeg: number,
  orbitSizePx: number,
  corner: TestCornerKey,
): OrbitLabelLayout {
  const center = orbitSizePx / 2
  const theta = (angleDeg * Math.PI) / 180
  const anchorRadius = orbitSizePx * 0.26
  const cardRadius = orbitSizePx * 0.38
  const width = 170
  const height = 54
  const cardCenterX = center + Math.cos(theta) * cardRadius
  const cardCenterY = center + Math.sin(theta) * cardRadius
  const x = cardCenterX - width / 2
  const y = cardCenterY - height / 2
  const anchorX = center + Math.cos(theta) * anchorRadius
  const anchorY = center + Math.sin(theta) * anchorRadius
  const spoke = spokePointForCorner(x, y, width, height, corner)

  return {
    id,
    timezoneKey: id,
    side: Math.cos(theta) >= 0 ? "right" : "left",
    x,
    y,
    width,
    height,
    anchorX,
    anchorY,
    spokeEndX: spoke.x,
    spokeEndY: spoke.y,
    spokePath: `M ${anchorX} ${anchorY} L ${spoke.x} ${spoke.y}`,
    branchPath: `M ${anchorX} ${anchorY} L ${spoke.x} ${spoke.y}`,
    time: "12:00:00",
    timezoneMeta: "UTC+0",
    relativeLabel: "same offset",
    relativeOffsetMinutes: 0,
    angleDeg: 0,
    skyColorHex: "#88aacc",
    isSelected: false,
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
        isSelected: false,
      },
    ],
  }
}

function makeLayoutFromOrbitGeometry(selectedAngleDeg: number, otherAngleDeg: number, orbitSizePx: number): OrbitLabelLayout[] {
  const layouts = computeOrbitLabelLayout(
    [
      { id: "sel", angleDeg: selectedAngleDeg, isSelected: true, isLocal: false, width: 220, height: 52 },
      { id: "other", angleDeg: otherAngleDeg, isSelected: false, isLocal: false, width: 220, height: 46 },
    ],
    {
      frameWidth: orbitSizePx,
      frameHeight: orbitSizePx,
      ringDiameter: orbitSizePx,
      isMobile: false,
    },
  ).labels

  return layouts.map((layout) => ({
    id: layout.id,
    timezoneKey: layout.id,
    side: layout.side,
    x: layout.x,
    y: layout.y,
    width: layout.width,
    height: layout.height,
    anchorX: layout.anchorX,
    anchorY: layout.anchorY,
    spokeEndX: layout.spokeEndX,
    spokeEndY: layout.spokeEndY,
    spokePath: layout.spokePath,
    branchPath: layout.branchPath,
    time: "12:00:00",
    timezoneMeta: "UTC+0",
    relativeLabel: "same offset",
    relativeOffsetMinutes: 0,
    angleDeg: 0,
    skyColorHex: "#88aacc",
    isSelected: layout.id === "sel",
    isLocal: false,
    memberCount: 1,
    members: [
      {
        id: `${layout.id}-member`,
        label: "Example",
        time: "12:00:00",
        timezoneMeta: "UTC+0",
        relativeLabel: "same offset",
        leadingEmoji: "📍",
        isSelected: layout.id === "sel",
      },
    ],
  }))
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

  test("uses spoke geometry for sweep direction instead of card top-left", () => {
    const orbitSizePx = 760
    const fromSelected = makeSelectedLayoutAtAngle("sel", -15, orbitSizePx)
    const toSelected = makeSelectedLayoutAtAngle("sel", 150, orbitSizePx)
    const fromById = new Map([[fromSelected.id, fromSelected]])
    const toById = new Map([[toSelected.id, toSelected]])

    const direction = computeSweepDirectionFromSnapshots(fromById, toById, orbitSizePx, "sel")
    expect(direction).toBe(1)
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

  test("non-selected cards follow ring sweep direction even when shortest arc is opposite", () => {
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
      fromRing: { wheelRotationDeg: 120 },
      toRing: { wheelRotationDeg: 0 },
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
    expect(Math.abs(midAngleDeg)).toBeLessThan(90)
  })

  test("corner-swapping cards can override ring sweep when both anchors are non-default", () => {
    const orbitSizePx = 320
    const center = orbitSizePx / 2
    const fromLayout = makeCornerAttachedLayoutAtAngle("other", 160, orbitSizePx, "top-left")
    const toLayout = makeCornerAttachedLayoutAtAngle("other", -160, orbitSizePx, "bottom-left")

    const plan = createOrbitTransitionPlan({
      startedAtMs: 0,
      durationMs: 780,
      frozenNowMs: 1_700_000_001_500,
      fromSelectionId: "sel-member",
      toSelectionId: "sel-member",
      fromRing: { wheelRotationDeg: 120 },
      toRing: { wheelRotationDeg: 0 },
      fromLayouts: [fromLayout],
      toLayouts: [toLayout],
      orbitSizePx,
      preferredSweepLayoutId: "other",
    })

    expect(plan.sweepDirection).toBe(-1)

    const mid = interpolateOrbitTransitionPlan(plan, 0.5)
    const midOther = mid.layout.find((layout) => layout.id === "other")
    expect(midOther).toBeDefined()

    const midCenterX = (midOther?.x ?? 0) + (midOther?.width ?? 0) / 2
    const midCenterY = (midOther?.y ?? 0) + (midOther?.height ?? 0) / 2
    const midAngle = Math.atan2(midCenterY - center, midCenterX - center)
    const midAngleDeg = (midAngle * 180) / Math.PI
    expect(Math.abs(midAngleDeg)).toBeGreaterThan(120)
  })

  test("selected spoke endpoints follow ring sweep direction when point deltas disagree with shortest arc", () => {
    const center = 160
    const radius = 100
    const pointAt = (angleDeg: number) => {
      const theta = (angleDeg * Math.PI) / 180
      return {
        x: center + Math.cos(theta) * radius,
        y: center + Math.sin(theta) * radius,
      }
    }

    const fromPosition = pointAt(-10)
    const toPosition = pointAt(10)
    const fromSpoke = pointAt(-170)
    const toSpoke = pointAt(170)

    const fromLayout: OrbitLabelLayout = {
      ...makeLayout("sel", fromPosition.x, fromPosition.y, true),
      anchorX: fromSpoke.x,
      anchorY: fromSpoke.y,
      spokeEndX: fromSpoke.x,
      spokeEndY: fromSpoke.y,
    }
    const toLayout: OrbitLabelLayout = {
      ...makeLayout("sel", toPosition.x, toPosition.y, true),
      anchorX: toSpoke.x,
      anchorY: toSpoke.y,
      spokeEndX: toSpoke.x,
      spokeEndY: toSpoke.y,
    }

    const plan = createOrbitTransitionPlan({
      startedAtMs: 0,
      durationMs: 780,
      frozenNowMs: 1_700_000_002_000,
      fromSelectionId: "sel-member",
      toSelectionId: "sel-member",
      fromRing: { wheelRotationDeg: 0 },
      toRing: { wheelRotationDeg: 20 },
      fromLayouts: [fromLayout],
      toLayouts: [toLayout],
      orbitSizePx: 320,
      preferredSweepLayoutId: "sel",
    })

    const mid = interpolateOrbitTransitionPlan(plan, 0.5)
    const midSelected = mid.layout[0]
    expect(midSelected).toBeDefined()

    const midSpokeAngle = Math.atan2((midSelected?.spokeEndY ?? 0) - center, (midSelected?.spokeEndX ?? 0) - center)
    const midSpokeAngleDeg = (midSpokeAngle * 180) / Math.PI

    expect(Math.abs(midSpokeAngleDeg)).toBeLessThan(90)
  })

  test("keeps selected spoke endpoint attached to card during large sweeps", () => {
    const orbitSizePx = 760
    const fromLayouts = makeLayoutFromOrbitGeometry(75, -180, orbitSizePx)
    const toLayouts = makeLayoutFromOrbitGeometry(-120, -180, orbitSizePx)

    const plan = createOrbitTransitionPlan({
      startedAtMs: 0,
      durationMs: 780,
      frozenNowMs: 1_700_000_003_000,
      fromSelectionId: "sel-member",
      toSelectionId: "sel-member",
      fromRing: { wheelRotationDeg: 0 },
      toRing: { wheelRotationDeg: 120 },
      fromLayouts,
      toLayouts,
      orbitSizePx,
      preferredSweepLayoutId: "sel",
    })

    const mid = interpolateOrbitTransitionPlan(plan, 0.5)
    const selected = mid.layout.find((layout) => layout.id === "sel")
    expect(selected).toBeDefined()
    if (!selected) {
      return
    }

    expect(selected.spokeEndX >= selected.x).toBe(true)
    expect(selected.spokeEndX <= selected.x + selected.width).toBe(true)
    expect(selected.spokeEndY >= selected.y).toBe(true)
    expect(selected.spokeEndY <= selected.y + selected.height).toBe(true)
  })
})
