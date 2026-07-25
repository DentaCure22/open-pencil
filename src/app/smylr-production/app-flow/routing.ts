import type { Rect, Vector } from '@open-pencil/scene-graph/primitives'

import type {
  AppScreenFlowDefinition,
  AppScreenFlowEdge,
  AppScreenFlowEdgeKind,
  AppScreenFlowNode
} from './model'

export const APP_FLOW_EDGE_ARROW_SIZE = 20
export const APP_FLOW_EDGE_ENDPOINT_CLEARANCE = 36

const PORT_SPACING = 56
const CHANNEL_MARGIN = 16
const EXTERNAL_CHANNEL_SPACING = 64
const MIN_SMOOTH_STEP_LEG = 16

export type AppFlowAnchorSide = 'bottom' | 'left' | 'right' | 'top'

export type AppFlowRouteBounds = Rect

export type AppFlowRoutePoint = Vector

export type AppFlowRouteNode = {
  bounds: AppFlowRouteBounds
  node: AppScreenFlowNode
}

export type AppFlowEdgeRoute = {
  channel: string
  points: AppFlowRoutePoint[]
  sourceSide: AppFlowAnchorSide
  targetSide: AppFlowAnchorSide
}

type RouteAxis = 'channel' | 'exterior' | 'horizontal' | 'vertical'

type RouteDraft = {
  axis: RouteAxis
  channelBand?: ChannelBand
  edge: AppScreenFlowEdge
  exteriorKey?: string
  source: AppFlowRouteNode
  sourceOffset: number
  sourceSide: AppFlowAnchorSide
  target: AppFlowRouteNode
  targetOffset: number
  targetSide: AppFlowAnchorSide
}

type ChannelBand = {
  key: string
  max: number
  min: number
  openEnded: boolean
}

type PortUse = {
  draft: RouteDraft
  otherCenter: AppFlowRoutePoint
  role: 'source' | 'target'
}

type VerticalTrackUse = {
  draft: RouteDraft
  otherCenterX: number
  roles: Set<'source' | 'target'>
}

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

type RouteSegment = {
  end: AppFlowRoutePoint
  start: AppFlowRoutePoint
}

function right(bounds: AppFlowRouteBounds) {
  return bounds.x + bounds.width
}

function bottom(bounds: AppFlowRouteBounds) {
  return bounds.y + bounds.height
}

function center(bounds: AppFlowRouteBounds): AppFlowRoutePoint {
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
}

function rangesOverlap(startA: number, endA: number, startB: number, endB: number) {
  return Math.min(endA, endB) > Math.max(startA, startB)
}

function horizontalCorridorIsClear(
  source: AppFlowRouteNode,
  target: AppFlowRouteNode,
  nodes: AppFlowRouteNode[]
) {
  const sourceCenter = center(source.bounds)
  const targetCenter = center(target.bounds)
  if (
    !rangesOverlap(source.bounds.y, bottom(source.bounds), target.bounds.y, bottom(target.bounds))
  ) {
    return false
  }
  const start = Math.min(right(source.bounds), right(target.bounds))
  const end = Math.max(source.bounds.x, target.bounds.x)
  if (end <= start) return false
  const y = (sourceCenter.y + targetCenter.y) / 2
  return !nodes.some(({ bounds, node }) => {
    if (node.id === source.node.id || node.id === target.node.id) return false
    return bounds.y < y && bottom(bounds) > y && bounds.x < end && right(bounds) > start
  })
}

function verticalCorridorIsClear(
  source: AppFlowRouteNode,
  target: AppFlowRouteNode,
  nodes: AppFlowRouteNode[]
) {
  const sourceCenter = center(source.bounds)
  const targetCenter = center(target.bounds)
  if (
    !rangesOverlap(source.bounds.x, right(source.bounds), target.bounds.x, right(target.bounds))
  ) {
    return false
  }
  const start = Math.min(bottom(source.bounds), bottom(target.bounds))
  const end = Math.max(source.bounds.y, target.bounds.y)
  if (end <= start) return false
  const x = (sourceCenter.x + targetCenter.x) / 2
  return !nodes.some(({ bounds, node }) => {
    if (node.id === source.node.id || node.id === target.node.id) return false
    return bounds.x < x && right(bounds) > x && bounds.y < end && bottom(bounds) > start
  })
}

function horizontalGap(source: AppFlowRouteNode, target: AppFlowRouteNode) {
  return (
    Math.max(source.bounds.x, target.bounds.x) -
    Math.min(right(source.bounds), right(target.bounds))
  )
}

function verticalGap(source: AppFlowRouteNode, target: AppFlowRouteNode) {
  return (
    Math.max(source.bounds.y, target.bounds.y) -
    Math.min(bottom(source.bounds), bottom(target.bounds))
  )
}

function nextClearRowTop(source: AppFlowRouteNode, nodes: AppFlowRouteNode[]) {
  const laneBottom = Math.max(
    ...nodes
      .filter(({ node }) => node.lane === source.node.lane)
      .map(({ bounds }) => bottom(bounds))
  )
  return Math.min(
    ...nodes.map(({ bounds }) => bounds.y).filter((candidate) => candidate > laneBottom)
  )
}

function channelBand(
  source: AppFlowRouteNode,
  target: AppFlowRouteNode,
  nodes: AppFlowRouteNode[]
): ChannelBand {
  const sourceCenter = center(source.bounds)
  const targetCenter = center(target.bounds)
  if (source.node.lane !== target.node.lane && sourceCenter.y !== targetCenter.y) {
    const upper = sourceCenter.y < targetCenter.y ? source : target
    const lower = upper === source ? target : source
    const min = bottom(upper.bounds) + APP_FLOW_EDGE_ENDPOINT_CLEARANCE
    const max = lower.bounds.y - APP_FLOW_EDGE_ENDPOINT_CLEARANCE
    if (max > min + CHANNEL_MARGIN * 2) {
      return { key: `gap:${min}:${max}`, max, min, openEnded: false }
    }
  }

  const rowBottom = Math.max(bottom(source.bounds), bottom(target.bounds))
  const nextTop = nextClearRowTop(source, nodes)
  const min = rowBottom + APP_FLOW_EDGE_ENDPOINT_CLEARANCE
  const max = nextTop - APP_FLOW_EDGE_ENDPOINT_CLEARANCE
  if (Number.isFinite(nextTop) && max > min + CHANNEL_MARGIN * 2) {
    return { key: `gap:${min}:${max}`, max, min, openEnded: false }
  }
  return {
    key: `outside:${source.node.lane}:${min}`,
    max: min,
    min,
    openEnded: true
  }
}

function channelSide(node: AppFlowRouteNode, band: ChannelBand): AppFlowAnchorSide {
  if (bottom(node.bounds) <= band.min) return 'bottom'
  if (node.bounds.y >= band.max) return 'top'
  return center(node.bounds).y < band.min ? 'bottom' : 'top'
}

function routeDraft(
  edge: AppScreenFlowEdge,
  source: AppFlowRouteNode,
  target: AppFlowRouteNode,
  nodes: AppFlowRouteNode[]
): RouteDraft {
  const sourceCenter = center(source.bounds)
  const targetCenter = center(target.bounds)
  const horizontalClear = horizontalCorridorIsClear(source, target, nodes)
  const verticalClear = verticalCorridorIsClear(source, target, nodes)
  const enoughHorizontalRoom =
    horizontalGap(source, target) > APP_FLOW_EDGE_ENDPOINT_CLEARANCE * 2 + MIN_SMOOTH_STEP_LEG * 2
  const enoughVerticalRoom =
    verticalGap(source, target) > APP_FLOW_EDGE_ENDPOINT_CLEARANCE * 2 + MIN_SMOOTH_STEP_LEG * 2
  if (source.node.lane === target.node.lane && horizontalClear && enoughHorizontalRoom) {
    const forward = targetCenter.x >= sourceCenter.x
    return {
      axis: 'horizontal',
      edge,
      source,
      sourceOffset: 0,
      sourceSide: forward ? 'right' : 'left',
      target,
      targetOffset: 0,
      targetSide: forward ? 'left' : 'right'
    }
  }
  if (source.node.lane !== target.node.lane && verticalClear && enoughVerticalRoom) {
    const downward = targetCenter.y >= sourceCenter.y
    return {
      axis: 'vertical',
      edge,
      source,
      sourceOffset: 0,
      sourceSide: downward ? 'bottom' : 'top',
      target,
      targetOffset: 0,
      targetSide: downward ? 'top' : 'bottom'
    }
  }
  if (
    horizontalClear &&
    enoughHorizontalRoom &&
    Math.abs(targetCenter.x - sourceCenter.x) >= Math.abs(targetCenter.y - sourceCenter.y)
  ) {
    const forward = targetCenter.x >= sourceCenter.x
    return {
      axis: 'horizontal',
      edge,
      source,
      sourceOffset: 0,
      sourceSide: forward ? 'right' : 'left',
      target,
      targetOffset: 0,
      targetSide: forward ? 'left' : 'right'
    }
  }
  const band = channelBand(source, target, nodes)
  return {
    axis: 'channel',
    channelBand: band,
    edge,
    source,
    sourceOffset: 0,
    sourceSide: channelSide(source, band),
    target,
    targetOffset: 0,
    targetSide: channelSide(target, band)
  }
}

function distributePorts(drafts: RouteDraft[]) {
  const groups = new Map<string, PortUse[]>()
  for (const draft of drafts) {
    const uses: PortUse[] = [
      { draft, otherCenter: center(draft.target.bounds), role: 'source' },
      { draft, otherCenter: center(draft.source.bounds), role: 'target' }
    ]
    for (const use of uses) {
      const node = use.role === 'source' ? draft.source : draft.target
      const side = use.role === 'source' ? draft.sourceSide : draft.targetSide
      const key = `${node.node.id}:${side}`
      groups.set(key, [...(groups.get(key) ?? []), use])
    }
  }
  for (const uses of groups.values()) {
    const first = uses[0]
    if (!first) continue
    const side = first.role === 'source' ? first.draft.sourceSide : first.draft.targetSide
    uses.sort((left, rightUse) => {
      const horizontalSide = side === 'top' || side === 'bottom'
      const leftPosition = horizontalSide ? left.otherCenter.x : left.otherCenter.y
      const rightPosition = horizontalSide ? rightUse.otherCenter.x : rightUse.otherCenter.y
      return (
        leftPosition - rightPosition || left.draft.edge.id.localeCompare(rightUse.draft.edge.id)
      )
    })
    uses.forEach((use, index) => {
      const rawOffset = (index - (uses.length - 1) / 2) * PORT_SPACING
      const node = use.role === 'source' ? use.draft.source : use.draft.target
      const dimension = side === 'top' || side === 'bottom' ? node.bounds.width : node.bounds.height
      const limit = Math.max(0, dimension / 2 - APP_FLOW_EDGE_ENDPOINT_CLEARANCE * 2)
      const offset = Math.max(-limit, Math.min(limit, rawOffset))
      if (use.role === 'source') use.draft.sourceOffset = offset
      else use.draft.targetOffset = offset
    })
  }
}

function distributeVerticalTracks(drafts: RouteDraft[]) {
  const groups = new Map<string, Map<string, VerticalTrackUse>>()
  for (const draft of drafts) {
    const endpoints = [
      { node: draft.source, role: 'source' as const, side: draft.sourceSide },
      { node: draft.target, role: 'target' as const, side: draft.targetSide }
    ]
    for (const endpoint of endpoints) {
      if (endpoint.side !== 'top' && endpoint.side !== 'bottom') continue
      const centerX = center(endpoint.node.bounds).x
      const groupKey = String(centerX)
      const group = groups.get(groupKey) ?? new Map<string, VerticalTrackUse>()
      const existing = group.get(draft.edge.id)
      if (existing) {
        existing.roles.add(endpoint.role)
      } else {
        const other = endpoint.role === 'source' ? draft.target : draft.source
        group.set(draft.edge.id, {
          draft,
          otherCenterX: center(other.bounds).x,
          roles: new Set([endpoint.role])
        })
      }
      groups.set(groupKey, group)
    }
  }
  for (const group of groups.values()) {
    const uses = [...group.values()].sort(
      (left, rightUse) =>
        left.otherCenterX - rightUse.otherCenterX ||
        left.draft.edge.id.localeCompare(rightUse.draft.edge.id)
    )
    uses.forEach((use, index) => {
      const offset = (index - (uses.length - 1) / 2) * PORT_SPACING
      if (use.roles.has('source')) use.draft.sourceOffset = offset
      if (use.roles.has('target')) use.draft.targetOffset = offset
    })
  }
}

function upperEndpointX(draft: RouteDraft) {
  const sourceIsUpper = center(draft.source.bounds).y <= center(draft.target.bounds).y
  const node = sourceIsUpper ? draft.source : draft.target
  const offset = sourceIsUpper ? draft.sourceOffset : draft.targetOffset
  return center(node.bounds).x + offset
}

function distributeChannels(drafts: RouteDraft[]) {
  const channelY = new Map<string, number>()
  const groups = new Map<string, RouteDraft[]>()
  for (const draft of drafts) {
    if (!draft.channelBand) continue
    groups.set(draft.channelBand.key, [...(groups.get(draft.channelBand.key) ?? []), draft])
  }
  for (const group of groups.values()) {
    group.sort((left, rightDraft) => {
      const leftSpan = Math.abs(center(left.source.bounds).x - center(left.target.bounds).x)
      const rightSpan = Math.abs(
        center(rightDraft.source.bounds).x - center(rightDraft.target.bounds).x
      )
      return (
        upperEndpointX(rightDraft) - upperEndpointX(left) ||
        rightSpan - leftSpan ||
        left.edge.id.localeCompare(rightDraft.edge.id)
      )
    })
    group.forEach((draft, index) => {
      const band = draft.channelBand
      if (!band) return
      const y = band.openEnded
        ? band.min + (index + 1) * EXTERNAL_CHANNEL_SPACING
        : band.min +
          CHANNEL_MARGIN +
          ((index + 1) * (band.max - band.min - CHANNEL_MARGIN * 2)) / (group.length + 1)
      channelY.set(draft.edge.id, y)
    })
  }
  return channelY
}

function anchor(
  node: AppFlowRouteNode,
  side: AppFlowAnchorSide,
  offset: number
): AppFlowRoutePoint {
  const { bounds } = node
  if (side === 'left' || side === 'right') {
    return {
      x:
        side === 'left'
          ? bounds.x - APP_FLOW_EDGE_ENDPOINT_CLEARANCE
          : right(bounds) + APP_FLOW_EDGE_ENDPOINT_CLEARANCE,
      y: bounds.y + bounds.height / 2 + offset
    }
  }
  return {
    x: bounds.x + bounds.width / 2 + offset,
    y:
      side === 'top'
        ? bounds.y - APP_FLOW_EDGE_ENDPOINT_CLEARANCE
        : bottom(bounds) + APP_FLOW_EDGE_ENDPOINT_CLEARANCE
  }
}

function simplifyPoints(points: AppFlowRoutePoint[]) {
  const unique = points.filter(
    (point, index) =>
      index === 0 || point.x !== points[index - 1]?.x || point.y !== points[index - 1]?.y
  )
  return unique.filter((point, index) => {
    if (index === 0 || index === unique.length - 1) return true
    const previous = unique[index - 1] ?? point
    const next = unique[index + 1] ?? point
    return !(
      (previous.x === point.x && point.x === next.x) ||
      (previous.y === point.y && point.y === next.y)
    )
  })
}

function routePoints(draft: RouteDraft, channelY: number | undefined) {
  const start = anchor(draft.source, draft.sourceSide, draft.sourceOffset)
  const end = anchor(draft.target, draft.targetSide, draft.targetOffset)
  if (draft.axis === 'horizontal') {
    const middle = (start.x + end.x) / 2
    return simplifyPoints([start, { x: middle, y: start.y }, { x: middle, y: end.y }, end])
  }
  if (draft.axis === 'vertical') {
    const middle = (start.y + end.y) / 2
    return simplifyPoints([start, { x: start.x, y: middle }, { x: end.x, y: middle }, end])
  }
  const y = channelY ?? Math.max(start.y, end.y) + EXTERNAL_CHANNEL_SPACING
  return simplifyPoints([start, { x: start.x, y }, { x: end.x, y }, end])
}

function routeSegments(points: AppFlowRoutePoint[]) {
  return points.slice(1).map((end, index) => ({ end, start: points[index] ?? end }))
}

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

function segmentsCross(
  left: { end: AppFlowRoutePoint; start: AppFlowRoutePoint },
  rightSegment: { end: AppFlowRoutePoint; start: AppFlowRoutePoint }
) {
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
    const side = PERIMETER_SIDES[index]
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
      .filter((draft): draft is RouteDraft => Boolean(draft) && draft?.axis !== 'exterior')
      .sort(
        (a, b) =>
          exteriorPromotionPriority(a.edge.kind) - exteriorPromotionPriority(b.edge.kind) ||
          Number(a.axis !== 'channel') - Number(b.axis !== 'channel') ||
          a.edge.id.localeCompare(b.edge.id)
      )[0]
    if (!candidate) return routes
    candidate.axis = 'exterior'
  }
  return routeAllDrafts(drafts, channels, nodes)
}

function exteriorPromotionPriority(kind: AppScreenFlowEdgeKind) {
  if (kind === 'feedback' || kind === 'alternate') return 0
  if (kind === 'entry' || kind === 'exit') return 1
  return 2
}

export function planAppFlowEdgeRoutes(
  definition: AppScreenFlowDefinition,
  nodesById: ReadonlyMap<string, AppFlowRouteNode>
) {
  const nodes = [...nodesById.values()]
  const drafts = definition.edges.flatMap((edge) => {
    const source = nodesById.get(edge.sourceId)
    const target = nodesById.get(edge.targetId)
    return source && target ? [routeDraft(edge, source, target, nodes)] : []
  })
  distributePorts(drafts)
  distributeVerticalTracks(drafts)
  const channels = distributeChannels(drafts)
  avoidObstacles(drafts, channels, nodes)
  const pointsByEdge = removeAvoidableCrossings(drafts, channels, nodes)
  return new Map(
    drafts.map((draft) => {
      let channel = `direct-${draft.axis}`
      if (draft.axis === 'exterior') {
        channel = `outside:${draft.exteriorKey ?? 'unroutable'}:${draft.edge.id}`
      } else if (draft.axis === 'channel') {
        channel = `${draft.channelBand?.key ?? 'outside'}:${channels.get(draft.edge.id) ?? ''}`
      }
      return [
        draft.edge.id,
        {
          channel,
          points: pointsByEdge.get(draft.edge.id) ?? [],
          sourceSide: draft.sourceSide,
          targetSide: draft.targetSide
        } satisfies AppFlowEdgeRoute
      ]
    })
  )
}
