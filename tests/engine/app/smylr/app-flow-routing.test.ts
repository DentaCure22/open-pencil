import { describe, expect, test } from 'bun:test'

import {
  PRODUCT_MAP_DENTAL_CHART_APP_FLOW,
  type AppScreenFlowDefinition,
  type AppScreenFlowNode
} from '@/app/smylr-production/app-flow/model'
import {
  APP_FLOW_EDGE_ENDPOINT_CLEARANCE,
  type AppFlowEdgeRoute,
  type AppFlowRouteNode,
  type AppFlowRoutePoint,
  planAppFlowEdgeRoutes
} from '@/app/smylr-production/app-flow/routing'

type RouteSegment = {
  end: AppFlowRoutePoint
  start: AppFlowRoutePoint
}

function definitionNode(definition: AppScreenFlowDefinition, id: string) {
  const node = definition.nodes.find((candidate) => candidate.id === id)
  if (!node) throw new Error(`Missing flow node ${id}`)
  return node
}

function screenNode(id: string, lane: AppScreenFlowNode['lane'] = 'primary'): AppScreenFlowNode {
  return { id, kind: 'screen', label: id, lane, state: id }
}

function routeNode(
  node: AppScreenFlowNode,
  x: number,
  y: number,
  width: number,
  height: number
): AppFlowRouteNode {
  return { bounds: { height, width, x, y }, node }
}

function routeSegments(points: AppFlowRoutePoint[]): RouteSegment[] {
  return points.slice(1).map((end, index) => ({ end, start: points[index] ?? end }))
}

function segmentIntersectsInflatedNode(segment: RouteSegment, routeNodeValue: AppFlowRouteNode) {
  const { bounds } = routeNodeValue
  const left = bounds.x - APP_FLOW_EDGE_ENDPOINT_CLEARANCE
  const right = bounds.x + bounds.width + APP_FLOW_EDGE_ENDPOINT_CLEARANCE
  const top = bounds.y - APP_FLOW_EDGE_ENDPOINT_CLEARANCE
  const bottom = bounds.y + bounds.height + APP_FLOW_EDGE_ENDPOINT_CLEARANCE
  if (segment.start.y === segment.end.y) {
    const start = Math.min(segment.start.x, segment.end.x)
    const end = Math.max(segment.start.x, segment.end.x)
    return segment.start.y > top && segment.start.y < bottom && end > left && start < right
  }
  const start = Math.min(segment.start.y, segment.end.y)
  const end = Math.max(segment.start.y, segment.end.y)
  return segment.start.x > left && segment.start.x < right && end > top && start < bottom
}

function expectClearRoute(
  route: AppFlowEdgeRoute,
  nodes: AppFlowRouteNode[],
  sourceId: string,
  targetId: string
) {
  const obstacles = nodes.filter(({ node }) => node.id !== sourceId && node.id !== targetId)
  for (const segment of routeSegments(route.points)) {
    expect(obstacles.some((node) => segmentIntersectsInflatedNode(segment, node))).toBe(false)
  }
}

describe('app flow obstacle-safe routing', () => {
  test('moves patient-admin down 200px without routing History through Dental Chart', () => {
    const definition = PRODUCT_MAP_DENTAL_CHART_APP_FLOW
    const history = definition.edges.find(
      (edge) => edge.sourceId === 'patient-admin' && edge.targetId === 'health-chart'
    )
    if (!history) throw new Error('Missing Product Map History edge')
    const routeNodes = [
      routeNode(definitionNode(definition, 'calendar'), 560, 707, 960, 675),
      routeNode(definitionNode(definition, 'patient-admin'), 1808, 907, 960, 675),
      routeNode(definitionNode(definition, 'dental-chart'), 3056, 707, 960, 675),
      routeNode(definitionNode(definition, 'treatment-plan'), 4304, 707, 960, 675),
      routeNode(definitionNode(definition, 'health-chart'), 3056, -160, 960, 675)
    ]
    const nodesById = new Map(routeNodes.map((node) => [node.node.id, node]))
    const focusedDefinition = { ...definition, edges: [history] }

    const route = planAppFlowEdgeRoutes(focusedDefinition, nodesById).get(history.id)
    const repeated = planAppFlowEdgeRoutes(focusedDefinition, nodesById).get(history.id)
    if (!route) throw new Error('History route was not planned')

    expect(route).toEqual(repeated)
    expect(route.channel.startsWith('gap:')).toBe(true)
    expectClearRoute(route, routeNodes, history.sourceId, history.targetId)
  })

  test('falls back deterministically to a clear exterior route when every lower channel is blocked', () => {
    const source = screenNode('source')
    const target = screenNode('target')
    const middle = screenNode('middle')
    const belowSource = screenNode('below-source', 'feedback')
    const belowTarget = screenNode('below-target', 'feedback')
    const routeNodes = [
      routeNode(source, 0, 0, 100, 100),
      routeNode(target, 400, 0, 100, 100),
      routeNode(middle, 160, -100, 180, 300),
      routeNode(belowSource, 0, 120, 100, 300),
      routeNode(belowTarget, 400, 120, 100, 300)
    ]
    const definition: AppScreenFlowDefinition = {
      edges: [
        {
          id: 'blocked-path',
          kind: 'primary',
          label: 'Blocked path',
          sourceId: source.id,
          targetId: target.id
        }
      ],
      id: 'obstacle-fixture',
      label: 'Obstacle fixture',
      nodes: routeNodes.map(({ node }) => node),
      pageId: 'fixture',
      route: '/fixture',
      schemaVersion: '1',
      source: 'fixture',
      sourceFile: 'fixture.md'
    }
    const nodesById = new Map(routeNodes.map((node) => [node.node.id, node]))

    const route = planAppFlowEdgeRoutes(definition, nodesById).get('blocked-path')
    const repeated = planAppFlowEdgeRoutes(definition, nodesById).get('blocked-path')
    if (!route) throw new Error('Blocked route was not planned')

    expect(route).toEqual(repeated)
    expect(route.channel.startsWith('outside:top-top-')).toBe(true)
    expect(route.sourceSide).toBe('top')
    expect(route.targetSide).toBe('top')
    expectClearRoute(route, routeNodes, source.id, target.id)
  })
})
