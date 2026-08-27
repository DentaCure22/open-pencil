import type { Rect, Vector } from '@open-pencil/scene-graph/primitives'

import type { AppScreenFlowEdge, AppScreenFlowNode } from './model'

export const APP_FLOW_EDGE_ARROW_SIZE = 20
export const APP_FLOW_EDGE_ENDPOINT_CLEARANCE = 36

export const PORT_SPACING = 56
export const CHANNEL_MARGIN = 16
export const EXTERNAL_CHANNEL_SPACING = 64
export const MIN_SMOOTH_STEP_LEG = 16

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

export type RouteAxis = 'channel' | 'exterior' | 'horizontal' | 'vertical'

export type ChannelBand = {
  key: string
  max: number
  min: number
  openEnded: boolean
}

export type RouteDraft = {
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

export type RouteSegment = {
  end: AppFlowRoutePoint
  start: AppFlowRoutePoint
}

export function right(bounds: AppFlowRouteBounds) {
  return bounds.x + bounds.width
}

export function bottom(bounds: AppFlowRouteBounds) {
  return bounds.y + bounds.height
}

export function center(bounds: AppFlowRouteBounds): AppFlowRoutePoint {
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
}

export function rangesOverlap(startA: number, endA: number, startB: number, endB: number) {
  return Math.min(endA, endB) > Math.max(startA, startB)
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

export function channelBand(
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

export function channelSide(node: AppFlowRouteNode, band: ChannelBand): AppFlowAnchorSide {
  if (bottom(node.bounds) <= band.min) return 'bottom'
  if (node.bounds.y >= band.max) return 'top'
  return center(node.bounds).y < band.min ? 'bottom' : 'top'
}

export function anchor(
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

export function simplifyPoints(points: AppFlowRoutePoint[]) {
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

export function routePoints(draft: RouteDraft, channelY: number | undefined) {
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

export function routeSegments(points: AppFlowRoutePoint[]): RouteSegment[] {
  return points.slice(1).map((end, index) => ({ end, start: points[index] ?? end }))
}
