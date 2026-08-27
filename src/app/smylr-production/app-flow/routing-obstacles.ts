import type { AppScreenFlowEdgeKind } from './model'
import {
  anchor,
  APP_FLOW_EDGE_ENDPOINT_CLEARANCE,
  bottom,
  CHANNEL_MARGIN,
  channelBand,
  channelSide,
  EXTERNAL_CHANNEL_SPACING,
  PORT_SPACING,
  rangesOverlap,
  right,
  routePoints,
  routeSegments,
  simplifyPoints,
  type AppFlowAnchorSide,
  type AppFlowRouteBounds,
  type AppFlowRouteNode,
  type AppFlowRoutePoint,
  type RouteDraft,
  type RouteSegment
} from './routing-model'

type ExteriorBoundary = {
  bottom: number
  left: number
  right: number
  top: number
}

type ExteriorRouteCandidate = {
  key: string
  points: AppFlowRoutePoint[]
  sourceSide: AppFlowAnchorSide
  targetSide: AppFlowAnchorSide
}

type PerimeterDirection = 'counterclockwise' | 'clockwise'

function inflatedBounds(bounds: AppFlowRouteBounds): AppFlowRouteBounds {
  return {
    height: bounds.height + APP_FLOW_EDGE_ENDPOINT_CLEARANCE * 2,
    width: bounds.width + APP_FLOW_EDGE_ENDPOINT_CLEARANCE * 2,
    x: bounds.x - APP_FLOW_EDGE_ENDPOINT_CLEARANCE,
    y: bounds.y - APP_FLOW_EDGE_ENDPOINT_CLEARANCE
  }
}

function segmentIntersectsBounds(segment: RouteSegment, bounds: AppFlowRouteBounds) {
  const horizontal = segment.start.y === segment.end.y
  if (horizontal) {
    const start = Math.min(segment.start.x, segment.end.x)
    const end = Math.max(segment.start.x, segment.end.x)
    return (
      segment.start.y > bounds.y &&
      segment.start.y < bottom(bounds) &&
      rangesOverlap(start, end, bounds.x, right(bounds))
    )
  }
  const start = Math.min(segment.start.y, segment.end.y)
  const end = Math.max(segment.start.y, segment.end.y)
  return (
    segment.start.x > bounds.x &&
    segment.start.x < right(bounds) &&
    rangesOverlap(start, end, bounds.y, bottom(bounds))
  )
}

function routeIsClear(draft: RouteDraft, points: AppFlowRoutePoint[], nodes: AppFlowRouteNode[]) {
  return routeSegments(points).every((segment, index, segments) =>
    nodes.every(({ bounds, node }) => {
      if (index === 0 && node.id === draft.source.node.id) return true
      if (index === segments.length - 1 && node.id === draft.target.node.id) return true
      return !segmentIntersectsBounds(segment, inflatedBounds(bounds))
    })
  )
}

function channelCandidates(draft: RouteDraft, preferred: number, nodes: AppFlowRouteNode[]) {
  const band = draft.channelBand
  if (!band) return [preferred]
  const candidates = new Set<number>([preferred])
  if (band.openEnded) {
    candidates.add(band.min + EXTERNAL_CHANNEL_SPACING)
  } else {
    candidates.add(band.min + CHANNEL_MARGIN)
    candidates.add(band.max - CHANNEL_MARGIN)
  }
  for (const { bounds, node } of nodes) {
    if (node.id === draft.source.node.id || node.id === draft.target.node.id) continue
    candidates.add(bounds.y - APP_FLOW_EDGE_ENDPOINT_CLEARANCE)
    candidates.add(bottom(bounds) + APP_FLOW_EDGE_ENDPOINT_CLEARANCE)
  }
  return [...candidates]
    .filter(
      (candidate) =>
        Number.isFinite(candidate) &&
        candidate >= band.min &&
        (band.openEnded || candidate <= band.max)
    )
    .sort(
      (left, rightCandidate) =>
        Math.abs(left - preferred) - Math.abs(rightCandidate - preferred) || left - rightCandidate
    )
}

function chooseClearChannel(draft: RouteDraft, preferred: number, nodes: AppFlowRouteNode[]) {
  for (const candidate of channelCandidates(draft, preferred, nodes)) {
    const points = routePoints(draft, candidate)
    if (routeIsClear(draft, points, nodes)) return candidate
  }
  return null
}

function segmentsCross(left: RouteSegment, rightSegment: RouteSegment) {
  const leftHorizontal = left.start.y === left.end.y
  const rightHorizontal = rightSegment.start.y === rightSegment.end.y
  if (leftHorizontal === rightHorizontal) {
    const leftTrack = leftHorizontal ? left.start.y : left.start.x
    const rightTrack = rightHorizontal ? rightSegment.start.y : rightSegment.start.x
    if (leftTrack !== rightTrack) return false
    const leftStart = leftHorizontal ? left.start.x : left.start.y
    const leftEnd = leftHorizontal ? left.end.x : left.end.y
    const rightStart = rightHorizontal ? rightSegment.start.x : rightSegment.start.y
    const rightEnd = rightHorizontal ? rightSegment.end.x : rightSegment.end.y
    return (
      Math.min(Math.max(leftStart, leftEnd), Math.max(rightStart, rightEnd)) >
      Math.max(Math.min(leftStart, leftEnd), Math.min(rightStart, rightEnd))
    )
  }
  const horizontal = leftHorizontal ? left : rightSegment
  const vertical = leftHorizontal ? rightSegment : left
  const horizontalMin = Math.min(horizontal.start.x, horizontal.end.x)
  const horizontalMax = Math.max(horizontal.start.x, horizontal.end.x)
  const verticalMin = Math.min(vertical.start.y, vertical.end.y)
  const verticalMax = Math.max(vertical.start.y, vertical.end.y)
  return (
    vertical.start.x > horizontalMin &&
    vertical.start.x < horizontalMax &&
    horizontal.start.y > verticalMin &&
    horizontal.start.y < verticalMax
  )
}

function routesCross(left: AppFlowRoutePoint[], rightRoute: AppFlowRoutePoint[]) {
  return routeSegments(left).some((leftSegment) =>
    routeSegments(rightRoute).some((rightSegment) => segmentsCross(leftSegment, rightSegment))
  )
}

function crossingPair(routes: Map<string, AppFlowRoutePoint[]>) {
  const entries = [...routes.entries()]
  for (const [leftIndex, left] of entries.entries()) {
    for (const rightEntry of entries.slice(leftIndex + 1)) {
      if (
        routeSegments(left[1]).some((leftSegment) =>
          routeSegments(rightEntry[1]).some((rightSegment) =>
            segmentsCross(leftSegment, rightSegment)
          )
        )
      ) {
        return [left[0], rightEntry[0]] as const
      }
    }
  }
  return null
}

const PERIMETER_SIDES = ['top', 'right', 'bottom', 'left'] as const

function boundedPortOffset(node: AppFlowRouteNode, side: AppFlowAnchorSide, offset: number) {
  const dimension = side === 'top' || side === 'bottom' ? node.bounds.width : node.bounds.height
  const limit = Math.max(0, dimension / 2 - APP_FLOW_EDGE_ENDPOINT_CLEARANCE * 2)
  return Math.max(-limit, Math.min(limit, offset))
}

function exteriorBoundary(nodes: AppFlowRouteNode[], index: number): ExteriorBoundary {
  const padding = APP_FLOW_EDGE_ENDPOINT_CLEARANCE + (index + 1) * EXTERNAL_CHANNEL_SPACING
  return {
    bottom: Math.max(...nodes.map(({ bounds }) => bottom(bounds))) + padding,
    left: Math.min(...nodes.map(({ bounds }) => bounds.x)) - padding,
    right: Math.max(...nodes.map(({ bounds }) => right(bounds))) + padding,
    top: Math.min(...nodes.map(({ bounds }) => bounds.y)) - padding
  }
}

function exteriorPoint(
  point: AppFlowRoutePoint,
  side: AppFlowAnchorSide,
  boundary: ExteriorBoundary
): AppFlowRoutePoint {
  if (side === 'top') return { x: point.x, y: boundary.top }
  if (side === 'right') return { x: boundary.right, y: point.y }
  if (side === 'bottom') return { x: point.x, y: boundary.bottom }
  return { x: boundary.left, y: point.y }
}

function perimeterCorner(
  side: AppFlowAnchorSide,
  direction: PerimeterDirection,
  boundary: ExteriorBoundary
): AppFlowRoutePoint {
  if (direction === 'clockwise') {
    if (side === 'top') return { x: boundary.right, y: boundary.top }
    if (side === 'right') return { x: boundary.right, y: boundary.bottom }
    if (side === 'bottom') return { x: boundary.left, y: boundary.bottom }
    return { x: boundary.left, y: boundary.top }
  }
  if (side === 'top') return { x: boundary.left, y: boundary.top }
  if (side === 'left') return { x: boundary.left, y: boundary.bottom }
  if (side === 'bottom') return { x: boundary.right, y: boundary.bottom }
  return { x: boundary.right, y: boundary.top }
}

function perimeterPath(
  start: AppFlowRoutePoint,
  sourceSide: AppFlowAnchorSide,
  end: AppFlowRoutePoint,
  targetSide: AppFlowAnchorSide,
  direction: PerimeterDirection,
  boundary: ExteriorBoundary
) {
  if (sourceSide === targetSide) return [start, end]
  const points = [start]
  const step = direction === 'clockwise' ? 1 : -1
  let index = PERIMETER_SIDES.indexOf(sourceSide)
  const targetIndex = PERIMETER_SIDES.indexOf(targetSide)
  while (index !== targetIndex) {
    const side = PERIMETER_SIDES.at(index)
    if (!side) break
    points.push(perimeterCorner(side, direction, boundary))
    index = (index + step + PERIMETER_SIDES.length) % PERIMETER_SIDES.length
  }
  points.push(end)
  return points
}

function routeLength(points: AppFlowRoutePoint[]) {
  return routeSegments(points).reduce(
    (total, { end, start }) => total + Math.abs(end.x - start.x) + Math.abs(end.y - start.y),
    0
  )
}

function exteriorCandidates(draft: RouteDraft, nodes: AppFlowRouteNode[], index: number) {
  const boundary = exteriorBoundary(nodes, index)
  const offset = -(index + 1) * PORT_SPACING
  const candidates: ExteriorRouteCandidate[] = []
  for (const sourceSide of PERIMETER_SIDES) {
    for (const targetSide of PERIMETER_SIDES) {
      for (const direction of ['clockwise', 'counterclockwise'] as const) {
        if (sourceSide === targetSide && direction === 'counterclockwise') continue
        const start = anchor(
          draft.source,
          sourceSide,
          boundedPortOffset(draft.source, sourceSide, draft.sourceOffset + offset)
        )
        const end = anchor(
          draft.target,
          targetSide,
          boundedPortOffset(draft.target, targetSide, draft.targetOffset + offset)
        )
        const sourceExterior = exteriorPoint(start, sourceSide, boundary)
        const targetExterior = exteriorPoint(end, targetSide, boundary)
        const points = simplifyPoints([
          start,
          ...perimeterPath(
            sourceExterior,
            sourceSide,
            targetExterior,
            targetSide,
            direction,
            boundary
          ),
          end
        ])
        if (!routeIsClear(draft, points, nodes)) continue
        candidates.push({
          key: `${sourceSide}-${targetSide}-${direction}`,
          points,
          sourceSide,
          targetSide
        })
      }
    }
  }
  return candidates.sort(
    (left, rightCandidate) =>
      routeLength(left.points) - routeLength(rightCandidate.points) ||
      left.points.length - rightCandidate.points.length ||
      left.key.localeCompare(rightCandidate.key)
  )
}

function exteriorRoute(
  draft: RouteDraft,
  nodes: AppFlowRouteNode[],
  index: number,
  routed: AppFlowRoutePoint[][]
) {
  const candidates = exteriorCandidates(draft, nodes, index)
  const candidate = candidates.reduce<ExteriorRouteCandidate | undefined>((best, route) => {
    const crossings = routed.filter((points) => routesCross(route.points, points)).length
    if (!best) return route
    const bestCrossings = routed.filter((points) => routesCross(best.points, points)).length
    return crossings < bestCrossings ? route : best
  }, undefined)
  if (!candidate) {
    draft.exteriorKey = 'unroutable'
    return []
  }
  draft.exteriorKey = candidate.key
  draft.sourceSide = candidate.sourceSide
  draft.targetSide = candidate.targetSide
  return candidate.points
}

function avoidObstacles(
  drafts: RouteDraft[],
  channels: Map<string, number>,
  nodes: AppFlowRouteNode[]
) {
  for (const draft of drafts) {
    if (draft.axis === 'exterior') continue
    const preferred = channels.get(draft.edge.id)
    const points = routePoints(draft, preferred)
    if (routeIsClear(draft, points, nodes)) continue
    if (draft.axis === 'channel' && preferred !== undefined) {
      const channel = chooseClearChannel(draft, preferred, nodes)
      if (channel !== null) {
        channels.set(draft.edge.id, channel)
        continue
      }
    }
    if (draft.axis !== 'channel') {
      const band = channelBand(draft.source, draft.target, nodes)
      draft.axis = 'channel'
      draft.channelBand = band
      draft.sourceSide = channelSide(draft.source, band)
      draft.targetSide = channelSide(draft.target, band)
      const channel = chooseClearChannel(
        draft,
        band.openEnded ? band.min : (band.min + band.max) / 2,
        nodes
      )
      if (channel !== null) {
        channels.set(draft.edge.id, channel)
        continue
      }
    }
    draft.axis = 'exterior'
  }
}

function routeAllDrafts(
  drafts: RouteDraft[],
  channels: Map<string, number>,
  nodes: AppFlowRouteNode[]
) {
  const exteriorDrafts = drafts
    .filter((draft) => draft.axis === 'exterior')
    .sort((left, rightDraft) => left.edge.id.localeCompare(rightDraft.edge.id))
  const exteriorIndexes = new Map(
    exteriorDrafts.map((draft, index) => [draft.edge.id, index] as const)
  )
  const pointsByEdge = new Map<string, AppFlowRoutePoint[]>()
  const routed: AppFlowRoutePoint[][] = []
  for (const draft of drafts) {
    if (draft.axis === 'exterior') continue
    const points = routePoints(draft, channels.get(draft.edge.id))
    pointsByEdge.set(draft.edge.id, points)
    routed.push(points)
  }
  for (const draft of exteriorDrafts) {
    const points = exteriorRoute(draft, nodes, exteriorIndexes.get(draft.edge.id) ?? 0, routed)
    pointsByEdge.set(draft.edge.id, points)
    routed.push(points)
  }
  return new Map(
    drafts.map((draft) => [draft.edge.id, pointsByEdge.get(draft.edge.id) ?? []] as const)
  )
}

function exteriorPromotionPriority(kind: AppScreenFlowEdgeKind) {
  if (kind === 'feedback' || kind === 'alternate') return 0
  if (kind === 'entry' || kind === 'exit') return 1
  return 2
}

function removeAvoidableCrossings(
  drafts: RouteDraft[],
  channels: Map<string, number>,
  nodes: AppFlowRouteNode[]
) {
  let attemptsRemaining = drafts.length
  while (attemptsRemaining > 0) {
    attemptsRemaining -= 1
    const routes = routeAllDrafts(drafts, channels, nodes)
    const crossing = crossingPair(routes)
    if (!crossing) return routes
    const [leftId, rightId] = crossing
    const left = drafts.find((draft) => draft.edge.id === leftId)
    const rightDraft = drafts.find((draft) => draft.edge.id === rightId)
    const candidate = [left, rightDraft]
      .filter((draft): draft is RouteDraft => draft !== undefined && draft.axis !== 'exterior')
      .sort(
        (a, b) =>
          exteriorPromotionPriority(a.edge.kind) - exteriorPromotionPriority(b.edge.kind) ||
          Number(a.axis !== 'channel') - Number(b.axis !== 'channel') ||
          a.edge.id.localeCompare(b.edge.id)
      )
      .at(0)
    if (!candidate) return routes
    candidate.axis = 'exterior'
  }
  return routeAllDrafts(drafts, channels, nodes)
}

export function routeAppFlowDrafts(
  drafts: RouteDraft[],
  channels: Map<string, number>,
  nodes: AppFlowRouteNode[]
) {
  avoidObstacles(drafts, channels, nodes)
  return removeAvoidableCrossings(drafts, channels, nodes)
}
