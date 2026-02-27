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
const CORNER_AXIS_LEEWAY = 0.25

interface CandidatePlacement {
  rect: Rect
  spokeX: number
  spokeY: number
  corner: CornerKey | null
  lane: number
  cornerIndex: number
  lanePenalty: number
  overflow: number
  selectedOverflow: number
  ringOverlap: number
  selectedTopViolation: number
}

interface BeamState {
  placements: CandidatePlacement[]
  occupied: Rect[]
  selectedTopViolation: number
  selectedOverflow: number
  ringOverlap: number
  hardOverlapCount: number
  softOverlapCount: number
  overflow: number
  hardOverlapArea: number
  lanePenalty: number
  tieBreaker: string
}

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

function rectOverlapArea(left: Rect, right: Rect): number {
  const overlapX = Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x)
  if (overlapX <= 0) {
    return 0
  }
  const overlapY = Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y)
  if (overlapY <= 0) {
    return 0
  }
  return overlapX * overlapY
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
  return isMobile ? 13 : 16
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

  const horizontal: "left" | "right" = normalX >= 0 ? "left" : "right"
  const vertical: "top" | "bottom" = normalY >= 0 ? "top" : "bottom"
  const oppositeHorizontal: "left" | "right" = horizontal === "left" ? "right" : "left"
  const oppositeVertical: "top" | "bottom" = vertical === "top" ? "bottom" : "top"

  if (Math.abs(normalX) <= CORNER_AXIS_LEEWAY) {
    const alternateHorizontal = `${vertical}-${oppositeHorizontal}` as CornerKey
    if (!candidates.includes(alternateHorizontal)) {
      candidates.push(alternateHorizontal)
    }
  }

  if (Math.abs(normalY) <= CORNER_AXIS_LEEWAY) {
    const alternateVertical = `${oppositeVertical}-${horizontal}` as CornerKey
    if (!candidates.includes(alternateVertical)) {
      candidates.push(alternateVertical)
    }
  }

  if (Math.abs(normalX) <= CORNER_AXIS_LEEWAY && Math.abs(normalY) <= CORNER_AXIS_LEEWAY) {
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

function compareCandidate(left: CandidatePlacement, right: CandidatePlacement): number {
  if (left.selectedTopViolation !== right.selectedTopViolation) {
    return left.selectedTopViolation - right.selectedTopViolation
  }
  if (left.selectedOverflow !== right.selectedOverflow) {
    return left.selectedOverflow - right.selectedOverflow
  }
  if (left.ringOverlap !== right.ringOverlap) {
    return left.ringOverlap - right.ringOverlap
  }
  if (left.overflow !== right.overflow) {
    return left.overflow - right.overflow
  }
  const absLaneDelta = Math.abs(left.lane) - Math.abs(right.lane)
  if (absLaneDelta !== 0) {
    return absLaneDelta
  }
  if (left.lane !== right.lane) {
    return left.lane - right.lane
  }
  if (left.cornerIndex !== right.cornerIndex) {
    return left.cornerIndex - right.cornerIndex
  }
  if (left.spokeY !== right.spokeY) {
    return left.spokeY - right.spokeY
  }
  return left.spokeX - right.spokeX
}

function compareBeamState(left: BeamState, right: BeamState): number {
  if (left.selectedTopViolation !== right.selectedTopViolation) {
    return left.selectedTopViolation - right.selectedTopViolation
  }
  if (left.selectedOverflow !== right.selectedOverflow) {
    return left.selectedOverflow - right.selectedOverflow
  }
  if (left.ringOverlap !== right.ringOverlap) {
    return left.ringOverlap - right.ringOverlap
  }
  if (left.overflow !== right.overflow) {
    return left.overflow - right.overflow
  }
  if (left.hardOverlapCount !== right.hardOverlapCount) {
    return left.hardOverlapCount - right.hardOverlapCount
  }
  if (left.softOverlapCount !== right.softOverlapCount) {
    return left.softOverlapCount - right.softOverlapCount
  }
  if (left.hardOverlapArea !== right.hardOverlapArea) {
    return left.hardOverlapArea - right.hardOverlapArea
  }
  if (left.lanePenalty !== right.lanePenalty) {
    return left.lanePenalty - right.lanePenalty
  }
  return left.tieBreaker.localeCompare(right.tieBreaker)
}

export function computeOrbitLabelLayout(
  inputs: OrbitLabelLayoutInput[],
  config: LayoutConfig,
): OrbitLabelLayoutResult {
  if (inputs.length === 0) {
    return { labels: [] }
  }

  const minGap = 8
  const maxLane = config.isMobile ? 18 : 22
  const radialLaneStep = config.isMobile ? 26 : 30
  const spokeGap = config.isMobile ? 10 : 12
  const selectedSpokeGap = config.isMobile ? 8 : 10
  const framePadding = 0
  const constraintEpsilon = 0.05

  const centerX = config.frameWidth / 2
  const centerY = config.frameHeight / 2
  const anchorRadius = hourRingOuterRadius(config.ringDiameter, config.isMobile)
  const ringClearancePx = config.isMobile ? 7 : 9
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
      const baseDistance = input.isSelected
        ? selectedSpokeGap + centerProjection
        : spokeGap + insetProjection

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
  const beamWidth = config.isMobile ? 34 : 48
  const maxCandidatesPerNode = config.isMobile ? 120 : 180

  let beam: BeamState[] = [
    {
      placements: [],
      occupied: [],
      selectedTopViolation: 0,
      selectedOverflow: 0,
      ringOverlap: 0,
      hardOverlapCount: 0,
      softOverlapCount: 0,
      overflow: 0,
      hardOverlapArea: 0,
      lanePenalty: 0,
      tieBreaker: "",
    },
  ]

  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]
    if (!node) {
      continue
    }

    const cornerCandidates = node.isSelected ? [null] : axisFlexibleCornerCandidates(node.normalX, node.normalY)
    const maxInwardLane = node.isSelected ? 0 : (config.isMobile ? 2 : 3)
    const candidateLanes = laneOffsets(maxLane, maxInwardLane)
    const localCandidates: CandidatePlacement[] = []

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

        const overflow = frameOverflow(candidateRect, config.frameWidth, config.frameHeight, framePadding)
        const ringOverlap = ringIntrusion(candidateRect, centerX, centerY, forbiddenRingRadius)
        const selectedTopViolation = node.isSelected
          ? selectedMustStayAboveRingViolation(candidateRect, centerY, forbiddenRingRadius)
          : 0
        const selectedOverflow = node.isSelected ? overflow : 0
        const lanePenalty = Math.abs(lane) * (node.isSelected ? 110 : 92) + (lane > 0 ? (node.isSelected ? 24 : 8) : 0)

        localCandidates.push({
          rect: candidateRect,
          spokeX: candidateSpokeX,
          spokeY: candidateSpokeY,
          corner,
          lane,
          cornerIndex,
          lanePenalty,
          overflow,
          selectedOverflow,
          ringOverlap,
          selectedTopViolation,
        })
      }
    }

    const constrainedCandidates = localCandidates.filter((candidate) => {
      return (
        candidate.selectedTopViolation <= constraintEpsilon &&
        candidate.ringOverlap <= constraintEpsilon &&
        candidate.overflow <= constraintEpsilon
      )
    })
    const candidatePool = constrainedCandidates.length > 0 ? constrainedCandidates : localCandidates

    candidatePool.sort(compareCandidate)
    const boundedCandidates = candidatePool.slice(0, maxCandidatesPerNode)
    const nextBeam: BeamState[] = []

    for (const state of beam) {
      for (const candidate of boundedCandidates) {
        let hardOverlapCount = state.hardOverlapCount
        let softOverlapCount = state.softOverlapCount
        let hardOverlapArea = state.hardOverlapArea

        for (const rect of state.occupied) {
          const overlapArea = rectOverlapArea(candidate.rect, rect)
          if (overlapArea > 0) {
            hardOverlapCount += 1
            hardOverlapArea += overlapArea
          }
          if (overlapWithGap(candidate.rect, rect, minGap)) {
            softOverlapCount += 1
          }
        }

        const tieLane = candidate.lane.toString(36)
        const tieCorner = candidate.cornerIndex.toString(36)
        const tieX = Math.round(candidate.rect.x).toString(36)
        const tieY = Math.round(candidate.rect.y).toString(36)

        nextBeam.push({
          placements: [...state.placements, candidate],
          occupied: [...state.occupied, candidate.rect],
          selectedTopViolation: state.selectedTopViolation + candidate.selectedTopViolation,
          selectedOverflow: state.selectedOverflow + candidate.selectedOverflow,
          ringOverlap: state.ringOverlap + candidate.ringOverlap,
          hardOverlapCount,
          softOverlapCount,
          overflow: state.overflow + candidate.overflow,
          hardOverlapArea,
          lanePenalty: state.lanePenalty + candidate.lanePenalty + candidate.cornerIndex * 6,
          tieBreaker: `${state.tieBreaker}|${tieLane}:${tieCorner}:${tieX}:${tieY}`,
        })
      }
    }

    nextBeam.sort(compareBeamState)
    beam = nextBeam.slice(0, beamWidth)
  }

  const bestState = beam[0]
  const bestPlacements = bestState?.placements ?? []

  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]
    const placement = bestPlacements[index]
    if (!node || !placement) {
      continue
    }

    let bestRect = placement.rect
    let bestSpokeX = placement.spokeX
    let bestSpokeY = placement.spokeY
    const bestCorner = placement.corner

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
