import type { AppScreenFlowDefinition, AppScreenFlowEdge } from './model'
import {
  APP_FLOW_EDGE_ENDPOINT_CLEARANCE,
  bottom,
  CHANNEL_MARGIN,
  channelBand,
  channelSide,
  center,
  EXTERNAL_CHANNEL_SPACING,
  MIN_SMOOTH_STEP_LEG,
  PORT_SPACING,
  rangesOverlap,
  right,
  type AppFlowEdgeRoute,
  type AppFlowRouteNode,
  type AppFlowRoutePoint,
  type ChannelBand,
  type RouteDraft
} from './routing-model'
import { routeAppFlowDrafts } from './routing-obstacles'

export {
  APP_FLOW_EDGE_ARROW_SIZE,
  APP_FLOW_EDGE_ENDPOINT_CLEARANCE,
  type AppFlowAnchorSide,
  type AppFlowEdgeRoute,
  type AppFlowRouteBounds,
  type AppFlowRouteNode,
  type AppFlowRoutePoint
} from './routing-model'

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
    const first = uses.at(0)
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
      const band: ChannelBand | undefined = draft.channelBand
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
  const pointsByEdge = routeAppFlowDrafts(drafts, channels, nodes)
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
