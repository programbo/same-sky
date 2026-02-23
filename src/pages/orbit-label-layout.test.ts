import { describe, expect, test } from "bun:test"
import {
  computeOrbitLabelLayout,
  type OrbitLabelLayoutInput,
} from "./orbit-label-layout"

function parseSpokeEnd(path: string): { x: number; y: number } {
  const match = /M\s+[-\d.]+\s+[-\d.]+\s+L\s+([-\d.]+)\s+([-\d.]+)/.exec(path)
  if (!match) {
    throw new Error(`Unexpected path format: ${path}`)
  }

  return {
    x: Number(match[1]),
    y: Number(match[2]),
  }
}

function expectedCornerInsetPointsByNormal(
  rectX: number,
  rectY: number,
  rectWidth: number,
  rectHeight: number,
  normalX: number,
  normalY: number,
  cornerInset: number,
): Array<{ x: number; y: number }> {
  const inset = Math.max(0, Math.min(cornerInset, rectWidth / 2, rectHeight / 2))
  const epsilon = 1e-6
  const axisLeeway = 0.38
  const normalizedX = Math.abs(normalX) <= epsilon ? 0 : normalX
  const normalizedY = Math.abs(normalY) <= epsilon ? 0 : normalY
  const horizontal: "left" | "right" = normalizedX >= 0 ? "left" : "right"
  const vertical: "top" | "bottom" = normalizedY >= 0 ? "top" : "bottom"
  const oppositeHorizontal: "left" | "right" = horizontal === "left" ? "right" : "left"
  const oppositeVertical: "top" | "bottom" = vertical === "top" ? "bottom" : "top"

  const corners = [`${vertical}-${horizontal}` as const]
  if (Math.abs(normalizedX) <= axisLeeway) {
    corners.push(`${vertical}-${oppositeHorizontal}` as const)
  }
  if (Math.abs(normalizedY) <= axisLeeway) {
    corners.push(`${oppositeVertical}-${horizontal}` as const)
  }
  if (Math.abs(normalizedX) <= axisLeeway && Math.abs(normalizedY) <= axisLeeway) {
    corners.push(`${oppositeVertical}-${oppositeHorizontal}` as const)
  }

  const uniqueCorners = [...new Set(corners)]
  return uniqueCorners.map((corner) => {
    const useLeft = corner.endsWith("left")
    const useTop = corner.startsWith("top")
    return {
      x: useLeft ? rectX + inset : rectX + rectWidth - inset,
      y: useTop ? rectY + inset : rectY + rectHeight - inset,
    }
  })
}

function hourRingOuterRadius(ringDiameter: number, isMobile: boolean): number {
  const ringCoreRadius = (ringDiameter * 0.38) / 2
  const minWidth = isMobile ? 24 : 32
  const idealWidth = ringDiameter * (isMobile ? 0.034 : 0.041)
  const maxWidth = isMobile ? 40 : 52
  const hourContrastRingWidth = Math.min(maxWidth, Math.max(minWidth, idealWidth))
  return ringCoreRadius + hourContrastRingWidth
}

function distanceFromPointToRect(px: number, py: number, x: number, y: number, width: number, height: number): number {
  const nearestX = Math.min(x + width, Math.max(x, px))
  const nearestY = Math.min(y + height, Math.max(y, py))
  return Math.hypot(px - nearestX, py - nearestY)
}

describe("computeOrbitLabelLayout", () => {
  test("keeps labels non-overlapping", () => {
    const labels: OrbitLabelLayoutInput[] = Array.from({ length: 8 }, (_, index) => ({
      id: `label-${index}`,
      angleDeg: 38 + index * 6,
      isSelected: false,
      isLocal: false,
      width: 124,
      height: 44,
    }))

    const result = computeOrbitLabelLayout(labels, {
      frameWidth: 920,
      frameHeight: 920,
      ringDiameter: 920,
      isMobile: false,
    })

    for (let i = 0; i < result.labels.length; i += 1) {
      const left = result.labels[i]!
      for (let j = i + 1; j < result.labels.length; j += 1) {
        const right = result.labels[j]!
        const overlapX = Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x)
        const overlapY = Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y)
        expect(overlapX > 0 && overlapY > 0).toBe(false)
      }
    }
  })

  test("keeps provided widths and does not apply a minimum width clamp", () => {
    const labels: OrbitLabelLayoutInput[] = [
      { id: "short", angleDeg: 25, isSelected: false, isLocal: false, width: 88, height: 44 },
      { id: "long", angleDeg: 35, isSelected: false, isLocal: false, width: 312, height: 44 },
    ]

    const result = computeOrbitLabelLayout(labels, {
      frameWidth: 760,
      frameHeight: 760,
      ringDiameter: 760,
      isMobile: false,
    })

    const short = result.labels.find((label) => label.id === "short")
    const long = result.labels.find((label) => label.id === "long")

    expect(short?.width).toBe(88)
    expect(long?.width).toBe(312)
    expect((short?.width ?? 0) < (long?.width ?? 0)).toBe(true)
  })

  test("anchors selected labels at center and others at nearest corner inset toward the hub", () => {
    const labels: OrbitLabelLayoutInput[] = [
      { id: "selected", angleDeg: 0, isSelected: true, isLocal: false, width: 240, height: 50 },
      { id: "east", angleDeg: 90, isSelected: false, isLocal: false, width: 220, height: 46 },
      { id: "southwest", angleDeg: 225, isSelected: false, isLocal: false, width: 200, height: 44 },
    ]
    const frame = 760

    const result = computeOrbitLabelLayout(labels, {
      frameWidth: frame,
      frameHeight: frame,
      ringDiameter: frame,
      isMobile: false,
    })

    for (const label of result.labels) {
      const end = parseSpokeEnd(label.spokePath)
      const radialX = label.anchorX - frame / 2
      const radialY = label.anchorY - frame / 2
      const radialLength = Math.hypot(radialX, radialY)
      const normalX = radialX / radialLength
      const normalY = radialY / radialLength
      const spokeX = end.x - label.anchorX
      const spokeY = end.y - label.anchorY
      const cross = normalX * spokeY - normalY * spokeX

      expect(Math.abs(cross)).toBeLessThanOrEqual(0.08)

      if (label.id === "selected") {
        const centerPointX = label.x + label.width / 2
        const centerPointY = label.y + label.height / 2
        expect(Math.abs(end.x - centerPointX)).toBeLessThanOrEqual(0.06)
        expect(Math.abs(end.y - centerPointY)).toBeLessThanOrEqual(0.06)
        continue
      }

      const expectedCandidates = expectedCornerInsetPointsByNormal(
        label.x,
        label.y,
        label.width,
        label.height,
        normalX,
        normalY,
        16,
      )
      const matchesAny = expectedCandidates.some((candidate) => {
        return Math.abs(end.x - candidate.x) <= 0.06 && Math.abs(end.y - candidate.y) <= 0.06
      })
      expect(matchesAny).toBe(true)
    }
  })

  test("uses opposite sides for opposite clock hemispheres", () => {
    const labels: OrbitLabelLayoutInput[] = [
      { id: "east", angleDeg: 90, isSelected: false, isLocal: false },
      { id: "west", angleDeg: 270, isSelected: false, isLocal: false },
    ]

    const result = computeOrbitLabelLayout(labels, {
      frameWidth: 760,
      frameHeight: 760,
      ringDiameter: 760,
      isMobile: false,
    })

    const east = result.labels.find((label) => label.id === "east")
    const west = result.labels.find((label) => label.id === "west")

    expect(east?.side).toBe("right")
    expect(west?.side).toBe("left")
  })

  test("stays within frame bounds when there is sufficient canvas area", () => {
    const labels: OrbitLabelLayoutInput[] = Array.from({ length: 10 }, (_, index) => ({
      id: `dense-${index}`,
      angleDeg: 20 + index * 30,
      isSelected: false,
      isLocal: false,
      width: 108,
      height: 40,
    }))

    const frameSize = 920
    const result = computeOrbitLabelLayout(labels, {
      frameWidth: frameSize,
      frameHeight: frameSize,
      ringDiameter: frameSize,
      isMobile: false,
    })

    for (const label of result.labels) {
      expect(label.x).toBeGreaterThanOrEqual(0)
      expect(label.y).toBeGreaterThanOrEqual(0)
      expect(label.x + label.width).toBeLessThanOrEqual(frameSize)
      expect(label.y + label.height).toBeLessThanOrEqual(frameSize)
    }
  })

  test("pushes crowded labels farther outward along the same radial normal", () => {
    const labels: OrbitLabelLayoutInput[] = Array.from({ length: 6 }, (_, index) => ({
      id: `crowded-${index}`,
      angleDeg: 90,
      isSelected: false,
      isLocal: false,
      width: 220,
      height: 46,
    }))

    const result = computeOrbitLabelLayout(labels, {
      frameWidth: 760,
      frameHeight: 760,
      ringDiameter: 760,
      isMobile: false,
    })

    const distances = result.labels
      .map((label) => {
        const end = parseSpokeEnd(label.spokePath)
        const dirX = end.x - label.anchorX
        const dirY = end.y - label.anchorY
        return Math.hypot(dirX, dirY)
      })
      .sort((left, right) => left - right)

    for (let i = 1; i < distances.length; i += 1) {
      expect(distances[i]! >= distances[i - 1]!).toBe(true)
    }
  })

  test("allows non-selected labels to take inner lanes before a selected neighbor in a crowded cluster", () => {
    const labels: OrbitLabelLayoutInput[] = [
      { id: "left", angleDeg: -6, isSelected: false, isLocal: false, width: 220, height: 46 },
      { id: "selected", angleDeg: 0, isSelected: true, isLocal: false, width: 220, height: 46 },
      { id: "right", angleDeg: 6, isSelected: false, isLocal: false, width: 220, height: 46 },
    ]

    const result = computeOrbitLabelLayout(labels, {
      frameWidth: 760,
      frameHeight: 760,
      ringDiameter: 760,
      isMobile: false,
    })

    const distanceById = new Map(
      result.labels.map((label) => {
        const end = parseSpokeEnd(label.spokePath)
        return [label.id, Math.hypot(end.x - label.anchorX, end.y - label.anchorY)] as const
      }),
    )

    const selectedDistance = distanceById.get("selected")
    const leftDistance = distanceById.get("left")
    const rightDistance = distanceById.get("right")

    expect(selectedDistance).toBeDefined()
    expect(leftDistance).toBeDefined()
    expect(rightDistance).toBeDefined()
    expect((selectedDistance ?? 0) >= Math.min(leftDistance ?? 0, rightDistance ?? 0)).toBe(true)
  })

  test("uses continuous angle ordering instead of wrapping at 0 degrees", () => {
    const labels: OrbitLabelLayoutInput[] = [
      { id: "neg-two", angleDeg: -2, isSelected: false, isLocal: false, width: 140, height: 44 },
      { id: "neg-one", angleDeg: -1, isSelected: false, isLocal: false, width: 140, height: 44 },
      { id: "pos-one", angleDeg: 1, isSelected: false, isLocal: false, width: 140, height: 44 },
      { id: "pos-two", angleDeg: 2, isSelected: false, isLocal: false, width: 140, height: 44 },
    ]

    const result = computeOrbitLabelLayout(labels, {
      frameWidth: 760,
      frameHeight: 760,
      ringDiameter: 760,
      isMobile: false,
    })

    expect(result.labels.map((label) => label.id)).toEqual(["neg-two", "neg-one", "pos-one", "pos-two"])
  })

  test("keeps the selected label on screen in a crowded top cluster", () => {
    const labels: OrbitLabelLayoutInput[] = [
      { id: "a", angleDeg: -4, isSelected: false, isLocal: false, width: 220, height: 48 },
      { id: "b", angleDeg: -2, isSelected: false, isLocal: false, width: 220, height: 48 },
      { id: "selected", angleDeg: 0, isSelected: true, isLocal: false, width: 260, height: 52 },
      { id: "c", angleDeg: 2, isSelected: false, isLocal: false, width: 220, height: 48 },
      { id: "d", angleDeg: 4, isSelected: false, isLocal: false, width: 220, height: 48 },
    ]

    const frameSize = 760
    const result = computeOrbitLabelLayout(labels, {
      frameWidth: frameSize,
      frameHeight: frameSize,
      ringDiameter: frameSize,
      isMobile: false,
    })

    const selected = result.labels.find((label) => label.id === "selected")
    expect(selected).toBeDefined()
    expect((selected?.x ?? -1) >= 0).toBe(true)
    expect((selected?.y ?? -1) >= 0).toBe(true)
    expect((selected?.x ?? 0) + (selected?.width ?? 0) <= frameSize).toBe(true)
    expect((selected?.y ?? 0) + (selected?.height ?? 0) <= frameSize).toBe(true)
  })

  test("keeps labels outside the hours ring boundary", () => {
    const frameSize = 760
    const labels: OrbitLabelLayoutInput[] = [
      { id: "selected", angleDeg: 0, isSelected: true, isLocal: false, width: 240, height: 52 },
      { id: "upper-right", angleDeg: 20, isSelected: false, isLocal: false, width: 220, height: 46 },
      { id: "upper-left", angleDeg: -20, isSelected: false, isLocal: false, width: 220, height: 46 },
      { id: "right", angleDeg: 90, isSelected: false, isLocal: false, width: 220, height: 46 },
      { id: "left", angleDeg: -90, isSelected: false, isLocal: false, width: 220, height: 46 },
    ]

    const result = computeOrbitLabelLayout(labels, {
      frameWidth: frameSize,
      frameHeight: frameSize,
      ringDiameter: frameSize,
      isMobile: false,
    })

    const center = frameSize / 2
    const forbiddenRadius = hourRingOuterRadius(frameSize, false) + 6

    for (const label of result.labels) {
      const nearest = distanceFromPointToRect(center, center, label.x, label.y, label.width, label.height)
      expect(nearest >= forbiddenRadius - 0.05).toBe(true)
    }
  })

  test("always keeps selected label above the hours ring", () => {
    const frameSize = 760
    const labels: OrbitLabelLayoutInput[] = [
      { id: "selected", angleDeg: 0, isSelected: true, isLocal: false, width: 240, height: 52 },
      { id: "left-near", angleDeg: -6, isSelected: false, isLocal: false, width: 220, height: 46 },
      { id: "right-near", angleDeg: 6, isSelected: false, isLocal: false, width: 220, height: 46 },
      { id: "left-mid", angleDeg: -18, isSelected: false, isLocal: false, width: 220, height: 46 },
      { id: "right-mid", angleDeg: 18, isSelected: false, isLocal: false, width: 220, height: 46 },
    ]

    const result = computeOrbitLabelLayout(labels, {
      frameWidth: frameSize,
      frameHeight: frameSize,
      ringDiameter: frameSize,
      isMobile: false,
    })

    const selected = result.labels.find((label) => label.id === "selected")
    expect(selected).toBeDefined()

    const centerY = frameSize / 2
    const forbiddenRadius = hourRingOuterRadius(frameSize, false) + 6
    const selectedBottom = (selected?.y ?? 0) + (selected?.height ?? 0)

    expect(selectedBottom <= centerY - forbiddenRadius + 0.05).toBe(true)
  })
})
