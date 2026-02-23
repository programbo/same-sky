export type OrbitRailSide = "left" | "right"

export interface OrbitLabelLayoutInput {
  id: string
  angleDeg: number
  isSelected: boolean
  isLocal: boolean
  width?: number
  height?: number
}

export interface OrbitLabelLayout {
  id: string
  side: OrbitRailSide
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

export interface OrbitLabelLayoutResult {
  labels: OrbitLabelLayout[]
}

interface LayoutConfig {
  frameWidth: number
  frameHeight: number
  ringDiameter: number
  isMobile: boolean
}

interface WorkingNode {
  id: string
  side: OrbitRailSide
  sortAngleDeg: number
  normalX: number
  normalY: number
  anchorX: number
  anchorY: number
  width: number
  height: number
  baseDistance: number
  isSelected: boolean
  isLocal: boolean
}

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

type CornerKey = "top-left" | "top-right" | "bottom-left" | "bottom-right"

function toAngleRad(angleDeg: number): number {
  return (angleDeg * Math.PI) / 180
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function overlapWithGap(left: Rect, right: Rect, gap: number): boolean {
  return !(
    left.x + left.width + gap <= right.x ||
    right.x + right.width + gap <= left.x ||
    left.y + left.height + gap <= right.y ||
    right.y + right.height + gap <= left.y
  )
}

function sideOfNormal(normalX: number): OrbitRailSide {
  return normalX >= 0 ? "right" : "left"
}

function spokePath(startX: number, startY: number, endX: number, endY: number): string {
  return `M ${startX.toFixed(2)} ${startY.toFixed(2)} L ${endX.toFixed(2)} ${endY.toFixed(2)}`
}

function branchPath(anchorX: number, anchorY: number, edgeX: number, edgeY: number): string {
  return `M ${anchorX.toFixed(2)} ${anchorY.toFixed(2)} L ${edgeX.toFixed(2)} ${edgeY.toFixed(2)}`
}

function labelCornerRadiusPx(isMobile: boolean): number {
  return isMobile ? 14 : 16
}

function hourRingOuterRadius(ringDiameter: number, isMobile: boolean): number {
  const ringCoreRadius = (ringDiameter * 0.38) / 2
  const minWidth = isMobile ? 24 : 32
  const idealWidth = ringDiameter * (isMobile ? 0.034 : 0.041)
  const maxWidth = isMobile ? 40 : 52
  const hourContrastRingWidth = clamp(idealWidth, minWidth, maxWidth)
  return ringCoreRadius + hourContrastRingWidth
}

function projectedHalfDepth(width: number, height: number, dirX: number, dirY: number): number {
  return (Math.abs(dirX) * width + Math.abs(dirY) * height) / 2
}

function rectFromCenter(centerX: number, centerY: number, width: number, height: number): Rect {
  return {
    x: centerX - width / 2,
    y: centerY - height / 2,
    width,
    height,
  }
}

function frameOverflow(rect: Rect, frameWidth: number, frameHeight: number, padding: number): number {
  const minX = padding
  const minY = padding
  const maxX = frameWidth - padding
  const maxY = frameHeight - padding

  const overflowLeft = Math.max(0, minX - rect.x)
  const overflowTop = Math.max(0, minY - rect.y)
  const overflowRight = Math.max(0, rect.x + rect.width - maxX)
  const overflowBottom = Math.max(0, rect.y + rect.height - maxY)

  return overflowLeft + overflowTop + overflowRight + overflowBottom
}

function distanceFromPointToRect(pointX: number, pointY: number, rect: Rect): number {
  const nearestX = clamp(pointX, rect.x, rect.x + rect.width)
  const nearestY = clamp(pointY, rect.y, rect.y + rect.height)
  return Math.hypot(pointX - nearestX, pointY - nearestY)
}

function ringIntrusion(
  rect: Rect,
  centerX: number,
  centerY: number,
  forbiddenRadius: number,
): number {
  const nearestDistance = distanceFromPointToRect(centerX, centerY, rect)
  return Math.max(0, forbiddenRadius - nearestDistance)
}

function selectedMustStayAboveRingViolation(rect: Rect, centerY: number, forbiddenRadius: number): number {
  const maxBottom = centerY - forbiddenRadius
  return Math.max(0, rect.y + rect.height - maxBottom)
}

function hubFacingCorner(normalX: number, normalY: number): CornerKey {
  const epsilon = 1e-6
  const normalizedX = Math.abs(normalX) <= epsilon ? 0 : normalX
  const normalizedY = Math.abs(normalY) <= epsilon ? 0 : normalY
  const horizontal: "left" | "right" = normalizedX >= 0 ? "left" : "right"
  const vertical: "top" | "bottom" = normalizedY >= 0 ? "top" : "bottom"
  return `${vertical}-${horizontal}` as CornerKey
}

function axisFlexibleCornerCandidates(normalX: number, normalY: number): CornerKey[] {
  const candidates: CornerKey[] = []
  const primary = hubFacingCorner(normalX, normalY)
  candidates.push(primary)

  const axisLeeway = 0.38
  const horizontal: "left" | "right" = normalX >= 0 ? "left" : "right"
  const vertical: "top" | "bottom" = normalY >= 0 ? "top" : "bottom"
  const oppositeHorizontal: "left" | "right" = horizontal === "left" ? "right" : "left"
  const oppositeVertical: "top" | "bottom" = vertical === "top" ? "bottom" : "top"

  if (Math.abs(normalX) <= axisLeeway) {
    const alternateHorizontal = `${vertical}-${oppositeHorizontal}` as CornerKey
    if (!candidates.includes(alternateHorizontal)) {
      candidates.push(alternateHorizontal)
    }
  }

  if (Math.abs(normalY) <= axisLeeway) {
    const alternateVertical = `${oppositeVertical}-${horizontal}` as CornerKey
    if (!candidates.includes(alternateVertical)) {
      candidates.push(alternateVertical)
    }
  }

  if (Math.abs(normalX) <= axisLeeway && Math.abs(normalY) <= axisLeeway) {
    const oppositeDiagonal = `${oppositeVertical}-${oppositeHorizontal}` as CornerKey
    if (!candidates.includes(oppositeDiagonal)) {
      candidates.push(oppositeDiagonal)
    }
  }

  return candidates
}

function laneOffsets(maxOutward: number, maxInward: number): number[] {
  const offsets: number[] = [0]
  const maxStep = Math.max(maxOutward, maxInward)
  for (let step = 1; step <= maxStep; step += 1) {
    if (step <= maxInward) {
      offsets.push(-step)
    }
    if (step <= maxOutward) {
      offsets.push(step)
    }
  }
  return offsets
}

function cornerInset(width: number, height: number, isMobile: boolean): number {
  const rawInset = labelCornerRadiusPx(isMobile)
  return Math.max(0, Math.min(rawInset, width / 2, height / 2))
}

function rectFromSpokePoint(
  spokeX: number,
  spokeY: number,
  width: number,
  height: number,
  isSelected: boolean,
  corner: CornerKey | null,
  isMobile: boolean,
): Rect {
  if (isSelected) {
    return rectFromCenter(spokeX, spokeY, width, height)
  }

  const inset = cornerInset(width, height, isMobile)
  if (corner === null) {
    return rectFromCenter(spokeX, spokeY, width, height)
  }

  switch (corner) {
    case "top-left":
      return { x: spokeX - inset, y: spokeY - inset, width, height }
    case "top-right":
      return { x: spokeX - (width - inset), y: spokeY - inset, width, height }
    case "bottom-left":
      return { x: spokeX - inset, y: spokeY - (height - inset), width, height }
    case "bottom-right":
      return { x: spokeX - (width - inset), y: spokeY - (height - inset), width, height }
  }
}

function spokePointFromRect(
  rect: Rect,
  isSelected: boolean,
  corner: CornerKey | null,
  isMobile: boolean,
): { x: number; y: number } {
  if (isSelected) {
    return {
      x: rect.x + rect.width / 2,
      y: rect.y + rect.height / 2,
    }
  }

  const inset = cornerInset(rect.width, rect.height, isMobile)
  if (corner === null) {
    return {
      x: rect.x + rect.width / 2,
      y: rect.y + rect.height / 2,
    }
  }

  switch (corner) {
    case "top-left":
      return { x: rect.x + inset, y: rect.y + inset }
    case "top-right":
      return { x: rect.x + rect.width - inset, y: rect.y + inset }
    case "bottom-left":
      return { x: rect.x + inset, y: rect.y + rect.height - inset }
    case "bottom-right":
      return { x: rect.x + rect.width - inset, y: rect.y + rect.height - inset }
  }
}

export function computeOrbitLabelLayout(
  inputs: OrbitLabelLayoutInput[],
  config: LayoutConfig,
): OrbitLabelLayoutResult {
  if (inputs.length === 0) {
    return { labels: [] }
  }

  const minGap = 8
  const maxLane = config.isMobile ? 14 : 18
  const radialLaneStep = config.isMobile ? 22 : 26
  const spokeGap = config.isMobile ? 10 : 12
  const framePadding = config.isMobile ? 8 : 10

  const centerX = config.frameWidth / 2
  const centerY = config.frameHeight / 2
  const anchorRadius = hourRingOuterRadius(config.ringDiameter, config.isMobile)
  const ringClearancePx = config.isMobile ? 4 : 6
  const forbiddenRingRadius = anchorRadius + ringClearancePx

  const nodes: WorkingNode[] = inputs
    .map((input) => {
      const theta = toAngleRad(input.angleDeg)
      const normalX = Math.sin(theta)
      const normalY = -Math.cos(theta)
      const anchorX = centerX + normalX * anchorRadius
      const anchorY = centerY + normalY * anchorRadius
      const side = sideOfNormal(normalX)
      const fallbackHeight = config.isMobile ? 38 : 40
      const width = Math.max(0, Math.round(input.width ?? 0))
      const height = Math.round(input.height ?? fallbackHeight)
      const centerProjection = projectedHalfDepth(width, height, normalX, normalY)
      const insetProjection = cornerInset(width, height, config.isMobile)
      const baseDistance = input.isSelected ? spokeGap + centerProjection : spokeGap + insetProjection

      return {
        id: input.id,
        side,
        sortAngleDeg: input.angleDeg,
        normalX,
        normalY,
        anchorX,
        anchorY,
        width,
        height,
        baseDistance,
        isSelected: input.isSelected,
        isLocal: input.isLocal,
      }
    })
    .sort((left, right) => {
      const selectedDelta = Number(left.isSelected) - Number(right.isSelected)
      if (selectedDelta !== 0) {
        return selectedDelta
      }

      const angleDelta = left.sortAngleDeg - right.sortAngleDeg
      if (angleDelta !== 0) {
        return angleDelta
      }
      return left.id.localeCompare(right.id)
    })

  const occupied: Rect[] = []

  const labels: OrbitLabelLayout[] = []

  for (const node of nodes) {
    let bestRect = rectFromCenter(node.anchorX, node.anchorY, node.width, node.height)
    let bestSpokeX = node.anchorX
    let bestSpokeY = node.anchorY
    let bestCorner: CornerKey | null = node.isSelected ? null : hubFacingCorner(node.normalX, node.normalY)
    let bestPenalty = Number.POSITIVE_INFINITY
    let placed = false
    const cornerCandidates = node.isSelected ? [null] : axisFlexibleCornerCandidates(node.normalX, node.normalY)
    const maxInwardLane = node.isSelected ? 0 : (config.isMobile ? 2 : 3)
    const candidateLanes = laneOffsets(maxLane, maxInwardLane)

    for (const lane of candidateLanes) {
      const distance = node.baseDistance + lane * radialLaneStep
      const candidateSpokeX = node.anchorX + node.normalX * distance
      const candidateSpokeY = node.anchorY + node.normalY * distance
      for (let cornerIndex = 0; cornerIndex < cornerCandidates.length; cornerIndex += 1) {
        const corner = cornerCandidates[cornerIndex] ?? null
        const candidateRect = rectFromSpokePoint(
          candidateSpokeX,
          candidateSpokeY,
          node.width,
          node.height,
          node.isSelected,
          corner,
          config.isMobile,
        )
        const hasOverlap = occupied.some((rect) => overlapWithGap(candidateRect, rect, minGap))
        const overflow = frameOverflow(candidateRect, config.frameWidth, config.frameHeight, framePadding)
        const ringOverlap = ringIntrusion(candidateRect, centerX, centerY, forbiddenRingRadius)
        const selectedTopViolation = node.isSelected
          ? selectedMustStayAboveRingViolation(candidateRect, centerY, forbiddenRingRadius)
          : 0
        const lanePenalty =
          Math.abs(lane) * (node.isSelected ? 110 : 92) + (lane > 0 ? (node.isSelected ? 24 : 8) : 0)
        const overflowPenalty = overflow * (node.isSelected ? 10_000 : 6)
        const ringPenalty = ringOverlap * (node.isSelected ? 20_000 : 14_000)
        const selectedTopPenalty = selectedTopViolation * 22_000
        const overlapPenalty = hasOverlap ? (node.isSelected ? 2_200 : 10_000) : 0
        const penalty = lanePenalty + cornerIndex * 6 + overflowPenalty + ringPenalty + selectedTopPenalty + overlapPenalty

        if (!hasOverlap && overflow === 0 && ringOverlap === 0 && selectedTopViolation === 0) {
          bestRect = candidateRect
          bestSpokeX = candidateSpokeX
          bestSpokeY = candidateSpokeY
          bestCorner = corner
          placed = true
          break
        }

        if (penalty < bestPenalty) {
          bestPenalty = penalty
          bestRect = candidateRect
          bestSpokeX = candidateSpokeX
          bestSpokeY = candidateSpokeY
          bestCorner = corner
        }
      }

      if (placed) {
        break
      }
    }

    const edge = spokePointFromRect(bestRect, node.isSelected, bestCorner, config.isMobile)
    if (Math.abs(edge.x - bestSpokeX) > 0.1 || Math.abs(edge.y - bestSpokeY) > 0.1) {
      bestSpokeX = edge.x
      bestSpokeY = edge.y
    }

    occupied.push(bestRect)

    labels.push({
      id: node.id,
      side: node.side,
      x: bestRect.x,
      y: bestRect.y,
      width: node.width,
      height: node.height,
      anchorX: node.anchorX,
      anchorY: node.anchorY,
      spokeEndX: bestSpokeX,
      spokeEndY: bestSpokeY,
      spokePath: spokePath(node.anchorX, node.anchorY, bestSpokeX, bestSpokeY),
      branchPath: branchPath(node.anchorX, node.anchorY, bestSpokeX, bestSpokeY),
    })
  }

  return {
    labels,
  }
}

export default computeOrbitLabelLayout
