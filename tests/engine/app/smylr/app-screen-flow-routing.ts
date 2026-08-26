import { expect } from 'bun:test'

import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'

import type { AppScreenFlowDefinition } from '@/app/smylr-production/app-flow/model'
import { APP_FLOW_COLOR } from '@/app/smylr-production/app-flow/primitives'
import {
  appScreenFlowPluginValue,
  syncAppScreenFlowScene
} from '@/app/smylr-production/app-flow/scene'
type TestBounds = Pick<SceneNode, 'height' | 'width' | 'x' | 'y'>

type TestSegment = {
  axis: 'horizontal' | 'vertical'
  end: number
  fixed: number
  start: number
}

function overlaps(left: TestBounds, right: TestBounds) {
  return (
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y
  )
}

function absoluteBounds(parent: SceneNode, child: SceneNode): TestBounds {
  return { ...child, x: parent.x + child.x, y: parent.y + child.y }
}

function vectorSegmentBounds(
  parent: SceneNode,
  vector: SceneNode,
  segment: NonNullable<SceneNode['vectorNetwork']>['segments'][number]
): TestBounds {
  const network = vector.vectorNetwork
  const start = network?.vertices[segment.start]
  const end = network?.vertices[segment.end]
  if (!start || !end) throw new Error('Vector route segment is missing an endpoint')
  const controlStart = {
    x: start.x + segment.tangentStart.x,
    y: start.y + segment.tangentStart.y
  }
  const controlEnd = { x: end.x + segment.tangentEnd.x, y: end.y + segment.tangentEnd.y }
  const points = [start, end, controlStart, controlEnd]
  const minX = Math.min(...points.map((point) => point.x))
  const minY = Math.min(...points.map((point) => point.y))
  const maxX = Math.max(...points.map((point) => point.x))
  const maxY = Math.max(...points.map((point) => point.y))
  return {
    height: maxY - minY,
    width: maxX - minX,
    x: parent.x + vector.x + minX,
    y: parent.y + vector.y + minY
  }
}
function segmentFromBounds(bounds: TestBounds): TestSegment {
  return bounds.width >= bounds.height
    ? {
        axis: 'horizontal',
        end: bounds.x + bounds.width,
        fixed: bounds.y + bounds.height / 2,
        start: bounds.x
      }
    : {
        axis: 'vertical',
        end: bounds.y + bounds.height,
        fixed: bounds.x + bounds.width / 2,
        start: bounds.y
      }
}

function segmentsCross(left: TestSegment, right: TestSegment) {
  if (left.axis === right.axis) {
    return (
      left.fixed === right.fixed &&
      Math.min(left.end, right.end) > Math.max(left.start, right.start)
    )
  }
  const horizontal = left.axis === 'horizontal' ? left : right
  const vertical = left.axis === 'vertical' ? left : right
  return (
    vertical.fixed > horizontal.start &&
    vertical.fixed < horizontal.end &&
    horizontal.fixed > vertical.start &&
    horizontal.fixed < vertical.end
  )
}

type RoutedTestSegment = { edgeId: string; segment: TestSegment }

type RouteAssertionState = {
  labelBounds: TestBounds[]
  persistentLabels: SceneNode[]
  routeNodes: SceneNode[]
  routedSegments: RoutedTestSegment[]
}

function flowNodesWithKinds(children: SceneNode[], kinds: readonly string[]): SceneNode[] {
  return children.filter((node) => kinds.includes(appScreenFlowPluginValue(node, 'kind') ?? ''))
}

function assertFlowPaintOrder(
  children: SceneNode[],
  content: SceneNode[],
  edges: SceneNode[],
  overlays: SceneNode[]
): void {
  const childIndex = new Map(children.map((node, index) => [node.id, index]))
  expect(Math.min(...edges.map((edge) => childIndex.get(edge.id) ?? -1))).toBeGreaterThan(
    Math.max(...content.map((node) => childIndex.get(node.id) ?? -1))
  )
  expect(Math.max(...edges.map((edge) => childIndex.get(edge.id) ?? -1))).toBeLessThan(
    Math.min(...overlays.map((node) => childIndex.get(node.id) ?? Number.MAX_SAFE_INTEGER))
  )
}

function routeEdgeMetadata(edge: SceneNode) {
  const edgeId = appScreenFlowPluginValue(edge, 'appFlowEdgeId')
  const edgeKind = appScreenFlowPluginValue(edge, 'edgeKind')
  const sourceId = appScreenFlowPluginValue(edge, 'sourceFlowNodeId')
  const targetId = appScreenFlowPluginValue(edge, 'targetFlowNodeId')
  expect(appScreenFlowPluginValue(edge, 'sourceAnchorSide')).toMatch(/^(bottom|left|right|top)$/)
  expect(appScreenFlowPluginValue(edge, 'targetAnchorSide')).toMatch(/^(bottom|left|right|top)$/)
  expect(appScreenFlowPluginValue(edge, 'routeChannel')).toBeTruthy()
  if (edgeKind === 'entry' || edgeKind === 'exit') {
    expect(appScreenFlowPluginValue(edge, 'routeChannel')).toBe('direct-horizontal')
  }
  return { edgeId, edgeKind, sourceId, targetId }
}

function routeMayShowLabel(metadata: ReturnType<typeof routeEdgeMetadata>): boolean {
  return (
    ['open-chart', 'record', 'return', 'save', 'submit', 'undo'].includes(metadata.edgeId ?? '') &&
    metadata.edgeKind !== 'feedback' &&
    metadata.sourceId !== 'entry' &&
    metadata.targetId !== 'exit'
  )
}

function routeParts(graph: SceneGraph, edge: SceneNode, mayShowLabel: boolean) {
  const parts = graph.getChildren(edge.id)
  expect(parts.length).toBeGreaterThanOrEqual(2)
  expect(parts.length).toBeLessThanOrEqual(mayShowLabel ? 3 : 2)
  expect(
    parts
      .map((node) => appScreenFlowPluginValue(node, 'part'))
      .filter((part): part is string => Boolean(part))
      .sort()
  ).toEqual(
    parts.some((part) => appScreenFlowPluginValue(part, 'part') === 'label')
      ? ['arrow', 'label', 'path']
      : ['arrow', 'path']
  )
  const path = parts.find((node) => appScreenFlowPluginValue(node, 'part') === 'path')
  if (!path || path.type !== 'VECTOR' || !path.vectorNetwork) {
    throw new Error('Rounded route path was not created')
  }
  return {
    arrow: parts.find((node) => appScreenFlowPluginValue(node, 'part') === 'arrow'),
    label: parts.find((node) => appScreenFlowPluginValue(node, 'part') === 'label'),
    path
  }
}

function expectedRouteColor(edge: SceneNode, edgeKind: string | null) {
  if ((appScreenFlowPluginValue(edge, 'transitionLabel') ?? '') === 'Save failed') {
    return APP_FLOW_COLOR.coral
  }
  if (edgeKind === 'primary' || edgeKind === 'entry') return APP_FLOW_COLOR.connector
  if (edgeKind === 'alternate') return APP_FLOW_COLOR.amber
  if (edgeKind === 'exit') return APP_FLOW_COLOR.green
  return null
}

function assertRoutePath(edge: SceneNode, path: SceneNode, edgeKind: string | null): void {
  expect(path.vectorNetwork?.segments.length).toBeGreaterThan(0)
  if ((path.vectorNetwork?.segments.length ?? 0) > 1) {
    expect(
      path.vectorNetwork?.segments.some(
        (segment) =>
          segment.tangentStart.x !== 0 ||
          segment.tangentStart.y !== 0 ||
          segment.tangentEnd.x !== 0 ||
          segment.tangentEnd.y !== 0
      )
    ).toBe(true)
  }
  expect(path.strokes[0]?.cap).toBe('ROUND')
  expect(path.strokes[0]?.join).toBe('ROUND')
  expect(path.strokes).toHaveLength(1)
  expect(path.strokes[0]?.color).not.toEqual(APP_FLOW_COLOR.violet)
  expect(path.strokes[0]?.weight).toBe(
    edgeKind === 'alternate' || edgeKind === 'feedback' ? 2 : 2.5
  )
  const expectedColor = expectedRouteColor(edge, edgeKind)
  if (expectedColor) expect(path.strokes[0]?.color).toEqual(expectedColor)
}

function assertRouteArrow(arrow: SceneNode | undefined): void {
  expect(arrow?.type).toBe('POLYGON')
  expect({ height: arrow?.height, width: arrow?.width }).toEqual({ height: 20, width: 20 })
  expect(arrow?.fills).toHaveLength(1)
  expect(arrow?.strokes).toEqual([])
}

function assertRouteLabel(
  graph: SceneGraph,
  label: SceneNode | undefined,
  mayShowLabel: boolean
): void {
  if (!mayShowLabel) {
    expect(label).toBeUndefined()
    return
  }
  if (!label) return
  expect(label.type).toBe('FRAME')
  expect(label.height).toBe(36)
  expect(label.fills).toEqual([])
  expect(label.strokes).toEqual([])
  expect(graph.getChildren(label.id).find((node) => node.type === 'TEXT')?.fontSize).toBe(20)
  expect(graph.getChildren(label.id).some((node) => node.text)).toBe(true)
}

function recordRouteGeometry(
  graph: SceneGraph,
  edge: SceneNode,
  metadata: ReturnType<typeof routeEdgeMetadata>,
  parts: ReturnType<typeof routeParts>,
  state: RouteAssertionState
): void {
  for (const routeSegment of parts.path.vectorNetwork?.segments ?? []) {
    const bounds = vectorSegmentBounds(edge, parts.path, routeSegment)
    expect(state.routeNodes.some((node) => overlaps(bounds, node))).toBe(false)
    const isStraight =
      routeSegment.tangentStart.x === 0 &&
      routeSegment.tangentStart.y === 0 &&
      routeSegment.tangentEnd.x === 0 &&
      routeSegment.tangentEnd.y === 0
    if (isStraight) {
      state.routedSegments.push({
        edgeId: metadata.edgeId ?? '',
        segment: segmentFromBounds(bounds)
      })
    }
  }
  if (parts.arrow) {
    const bounds = absoluteBounds(edge, parts.arrow)
    const target = state.routeNodes.find(
      (node) => appScreenFlowPluginValue(node, 'appFlowNodeId') === metadata.targetId
    )
    expect(target && overlaps(bounds, target)).toBe(false)
  }
  if (parts.label) {
    const bounds = absoluteBounds(edge, parts.label)
    expect(state.routeNodes.some((node) => overlaps(bounds, node))).toBe(false)
    expect(state.persistentLabels.some((node) => overlaps(bounds, node))).toBe(false)
    state.labelBounds.push(bounds)
  }
}

function assertRouteEdge(graph: SceneGraph, edge: SceneNode, state: RouteAssertionState): void {
  const metadata = routeEdgeMetadata(edge)
  const mayShowLabel = routeMayShowLabel(metadata)
  const parts = routeParts(graph, edge, mayShowLabel)
  expect(
    graph.getChildren(edge.id).find((node) => appScreenFlowPluginValue(node, 'part') === 'halo')
  ).toBeUndefined()
  assertRoutePath(edge, parts.path, metadata.edgeKind)
  assertRouteArrow(parts.arrow)
  assertRouteLabel(graph, parts.label, mayShowLabel)
  recordRouteGeometry(graph, edge, metadata, parts, state)
}

function assertNoRouteCrossings(routedSegments: RoutedTestSegment[]): void {
  for (let left = 0; left < routedSegments.length; left += 1) {
    for (let right = left + 1; right < routedSegments.length; right += 1) {
      const leftSegment = routedSegments[left]
      const rightSegment = routedSegments[right]
      if (!leftSegment || !rightSegment || leftSegment.edgeId === rightSegment.edgeId) continue
      expect(segmentsCross(leftSegment.segment, rightSegment.segment)).toBe(false)
    }
  }
}

function assertNoLabelOverlaps(labelBounds: TestBounds[]): void {
  for (let left = 0; left < labelBounds.length; left += 1) {
    for (let right = left + 1; right < labelBounds.length; right += 1) {
      const leftBounds = labelBounds[left]
      const rightBounds = labelBounds[right]
      if (leftBounds && rightBounds) expect(overlaps(leftBounds, rightBounds)).toBe(false)
    }
  }
}

export function assertScreenFlowRouting(definition: AppScreenFlowDefinition): void {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  syncAppScreenFlowScene(graph, page.id, definition)
  const children = graph.getChildren(page.id)
  const content = flowNodesWithKinds(children, [
    'app-screen-flow-feedback',
    'smylr-code-object-frame'
  ])
  const routeNodes = flowNodesWithKinds(children, [
    'app-screen-flow-feedback',
    'app-screen-flow-marker',
    'smylr-code-object-frame'
  ])
  const edges = flowNodesWithKinds(children, ['app-screen-flow-edge'])
  const overlays = flowNodesWithKinds(children, [
    'app-screen-flow-marker',
    'app-screen-flow-state-label'
  ])
  const persistentLabels = flowNodesWithKinds(children, [
    'app-screen-flow-chapter',
    'app-screen-flow-lane',
    'app-screen-flow-state-label',
    'smylr-board-guide'
  ])
  assertFlowPaintOrder(children, content, edges, overlays)
  const state: RouteAssertionState = {
    labelBounds: [],
    persistentLabels,
    routeNodes,
    routedSegments: []
  }
  for (const edge of edges) assertRouteEdge(graph, edge, state)
  expect(
    edges
      .filter((edge) => appScreenFlowPluginValue(edge, 'edgeKind') === 'primary')
      .every(
        (edge) => !(appScreenFlowPluginValue(edge, 'routeChannel') ?? '').startsWith('outside:')
      )
  ).toBe(true)
  assertNoRouteCrossings(state.routedSegments)
  assertNoLabelOverlaps(state.labelBounds)
}
