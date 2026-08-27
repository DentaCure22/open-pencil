import { getAbsolutePositionFull, getWorldMatrix } from './coordinate'
import type { SceneGraph } from './index'
import TransformMatrix from './matrix'
import { OBJECT_GRAPH_PORT_SIDES } from './object-graph-model'
import type {
  ObjectGraphConnection,
  ObjectGraphFixedPortSide,
  ObjectGraphNamedPortProjection,
  ObjectGraphNodeProjection,
  ObjectGraphPortAnchor,
  ResolvedObjectGraphPorts,
  ResolvedObjectGraphPortSides
} from './object-graph-model'
import {
  isObjectGraphConnectionNode,
  objectGraphConnectionsOnPage,
  readObjectGraphPorts
} from './object-graph-persistence'
import type { Vector } from './primitives'
import type { SceneNode } from './types'

export * from './object-graph-model'
export * from './object-graph-persistence'

const LOCAL_PORT_NORMALS: Record<ObjectGraphFixedPortSide, Vector> = {
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  top: { x: 0, y: -1 }
}

function normalizeVector(vector: Vector): Vector {
  const length = Math.hypot(vector.x, vector.y)
  return length === 0 ? { x: 1, y: 0 } : { x: vector.x / length, y: vector.y / length }
}

function transformPortNormal(matrix: ReturnType<typeof getWorldMatrix>, normal: Vector): Vector {
  return normalizeVector({
    x: matrix[0] * normal.x + matrix[1] * normal.y,
    y: matrix[3] * normal.x + matrix[4] * normal.y
  })
}

function localPortPoint(node: SceneNode, side: ObjectGraphFixedPortSide, offset = 0.5): Vector {
  if (side === 'top') return { x: node.width * offset, y: 0 }
  if (side === 'right') return { x: node.width, y: node.height * offset }
  if (side === 'bottom') return { x: node.width * offset, y: node.height }
  return { x: 0, y: node.height * offset }
}

export function projectObjectGraphNode(
  node: SceneNode,
  graph: SceneGraph,
  runtimePortPoints: Readonly<Partial<Record<string, Vector>>> = {}
): ObjectGraphNodeProjection {
  const matrix = getWorldMatrix(node, graph)
  const bounds = getAbsolutePositionFull(node, graph)
  const mappedCorners = TransformMatrix.mapPoints(matrix, [
    0,
    0,
    node.width,
    0,
    node.width,
    node.height,
    0,
    node.height
  ])
  const corners: [Vector, Vector, Vector, Vector] = [
    { x: mappedCorners[0], y: mappedCorners[1] },
    { x: mappedCorners[2], y: mappedCorners[3] },
    { x: mappedCorners[4], y: mappedCorners[5] },
    { x: mappedCorners[6], y: mappedCorners[7] }
  ]
  const ports = Object.fromEntries(
    OBJECT_GRAPH_PORT_SIDES.map((side) => [
      side,
      {
        normal: transformPortNormal(matrix, LOCAL_PORT_NORMALS[side]),
        point: TransformMatrix.mapPoint(matrix, localPortPoint(node, side))
      }
    ])
  ) as Record<ObjectGraphFixedPortSide, ObjectGraphPortAnchor>

  const namedPorts = Object.create(null) as Record<string, ObjectGraphNamedPortProjection>
  for (const definition of readObjectGraphPorts(node)) {
    const runtimePoint = runtimePortPoints[definition.id]
    const localPoint = runtimePoint
      ? localPortPoint(
          node,
          definition.side,
          definition.side === 'left' || definition.side === 'right'
            ? Math.max(0, Math.min(node.height, runtimePoint.y)) / Math.max(node.height, 1)
            : Math.max(0, Math.min(node.width, runtimePoint.x)) / Math.max(node.width, 1)
        )
      : localPortPoint(node, definition.side, definition.offset)
    namedPorts[definition.id] = {
      definition,
      normal: transformPortNormal(matrix, LOCAL_PORT_NORMALS[definition.side]),
      point: TransformMatrix.mapPoint(matrix, localPoint)
    }
  }

  return { bounds, corners, namedPorts, ports }
}

export function bestObjectGraphPortSide(
  projection: ObjectGraphNodeProjection,
  toward: Vector
): ObjectGraphFixedPortSide {
  const direction = normalizeVector({
    x: toward.x - projection.bounds.centerX,
    y: toward.y - projection.bounds.centerY
  })
  let best: ObjectGraphFixedPortSide = OBJECT_GRAPH_PORT_SIDES[0]
  let bestScore = Number.NEGATIVE_INFINITY
  for (const side of OBJECT_GRAPH_PORT_SIDES) {
    const normal = projection.ports[side].normal
    const score = normal.x * direction.x + normal.y * direction.y
    if (score > bestScore) {
      best = side
      bestScore = score
    }
  }
  return best
}

function resolveAutomaticPortSides(
  source: ObjectGraphNodeProjection,
  target: ObjectGraphNodeProjection
): ResolvedObjectGraphPortSides {
  return {
    source: bestObjectGraphPortSide(source, {
      x: target.bounds.centerX,
      y: target.bounds.centerY
    }),
    target: bestObjectGraphPortSide(target, {
      x: source.bounds.centerX,
      y: source.bounds.centerY
    })
  }
}

export function resolveProjectedObjectGraphPortSides(
  connection: Pick<
    ObjectGraphConnection,
    'sourcePort' | 'sourcePortId' | 'targetPort' | 'targetPortId'
  >,
  source: ObjectGraphNodeProjection,
  target: ObjectGraphNodeProjection
): ResolvedObjectGraphPortSides {
  const sourceNamed = connection.sourcePortId
    ? source.namedPorts[connection.sourcePortId]
    : undefined
  const targetNamed = connection.targetPortId
    ? target.namedPorts[connection.targetPortId]
    : undefined
  const automatic = resolveAutomaticPortSides(source, target)
  return {
    source:
      sourceNamed?.definition.side ??
      (connection.sourcePort === 'auto' ? automatic.source : connection.sourcePort),
    target:
      targetNamed?.definition.side ??
      (connection.targetPort === 'auto' ? automatic.target : connection.targetPort)
  }
}

export function resolveProjectedObjectGraphPorts(
  connection: Pick<
    ObjectGraphConnection,
    'sourcePort' | 'sourcePortId' | 'targetPort' | 'targetPortId'
  >,
  source: ObjectGraphNodeProjection,
  target: ObjectGraphNodeProjection
): ResolvedObjectGraphPorts | null {
  const sides = resolveProjectedObjectGraphPortSides(connection, source, target)
  const sourceNamed = connection.sourcePortId
    ? source.namedPorts[connection.sourcePortId]
    : undefined
  const targetNamed = connection.targetPortId
    ? target.namedPorts[connection.targetPortId]
    : undefined
  if ((connection.sourcePortId && !sourceNamed) || (connection.targetPortId && !targetNamed)) {
    return null
  }
  return {
    source: {
      anchor: sourceNamed ?? source.ports[sides.source],
      ...(connection.sourcePortId ? { id: connection.sourcePortId } : {}),
      side: sides.source
    },
    target: {
      anchor: targetNamed ?? target.ports[sides.target],
      ...(connection.targetPortId ? { id: connection.targetPortId } : {}),
      side: sides.target
    }
  }
}

export function resolveObjectGraphPortSides(
  graph: SceneGraph,
  connection: Pick<
    ObjectGraphConnection,
    'sourceNodeId' | 'sourcePort' | 'sourcePortId' | 'targetNodeId' | 'targetPort' | 'targetPortId'
  >
): ResolvedObjectGraphPortSides {
  const sourceNode = graph.getNode(connection.sourceNodeId)
  const targetNode = graph.getNode(connection.targetNodeId)
  if (!sourceNode || !targetNode) return { source: 'right', target: 'left' }
  return resolveProjectedObjectGraphPortSides(
    connection,
    projectObjectGraphNode(sourceNode, graph),
    projectObjectGraphNode(targetNode, graph)
  )
}

export function resolveObjectGraphPorts(
  graph: SceneGraph,
  connection: Pick<
    ObjectGraphConnection,
    'sourceNodeId' | 'sourcePort' | 'sourcePortId' | 'targetNodeId' | 'targetPort' | 'targetPortId'
  >
): ResolvedObjectGraphPorts | null {
  const sourceNode = graph.getNode(connection.sourceNodeId)
  const targetNode = graph.getNode(connection.targetNodeId)
  if (!sourceNode || !targetNode) return null
  return resolveProjectedObjectGraphPorts(
    connection,
    projectObjectGraphNode(sourceNode, graph),
    projectObjectGraphNode(targetNode, graph)
  )
}

function isObjectGraphEndpointOnPage(graph: SceneGraph, pageId: string, nodeId: string): boolean {
  let current = graph.getNode(nodeId)
  if (!current || current.id === pageId) return false
  while (current.id !== pageId) {
    if (current.internalOnly || isObjectGraphConnectionNode(current) || !current.parentId) {
      return false
    }
    const parent = graph.getNode(current.parentId)
    if (!parent) return false
    current = parent
  }
  return true
}

export function canAddObjectGraphConnection(
  graph: SceneGraph,
  pageId: string,
  connection: Pick<
    ObjectGraphConnection,
    | 'kind'
    | 'sourceNodeId'
    | 'sourcePort'
    | 'sourcePortId'
    | 'targetNodeId'
    | 'targetPort'
    | 'targetPortId'
  >,
  ignoredConnectionId?: string
): boolean {
  if (connection.sourceNodeId === connection.targetNodeId) return false
  if (
    !isObjectGraphEndpointOnPage(graph, pageId, connection.sourceNodeId) ||
    !isObjectGraphEndpointOnPage(graph, pageId, connection.targetNodeId)
  ) {
    return false
  }
  const sourcePort = connection.sourcePortId
    ? readObjectGraphPorts(graph.getNode(connection.sourceNodeId)).find(
        ({ id }) => id === connection.sourcePortId
      )
    : undefined
  const targetPort = connection.targetPortId
    ? readObjectGraphPorts(graph.getNode(connection.targetNodeId)).find(
        ({ id }) => id === connection.targetPortId
      )
    : undefined
  if (
    (connection.sourcePortId &&
      (!sourcePort ||
        sourcePort.direction === 'input' ||
        !sourcePort.kinds.includes(connection.kind))) ||
    (connection.targetPortId &&
      (!targetPort ||
        targetPort.direction === 'output' ||
        !targetPort.kinds.includes(connection.kind)))
  ) {
    return false
  }
  const ports = resolveObjectGraphPorts(graph, connection)
  if (!ports) return false
  return !findEquivalentObjectGraphConnection(graph, pageId, connection, ignoredConnectionId)
}

export function findEquivalentObjectGraphConnection(
  graph: SceneGraph,
  pageId: string,
  connection: Pick<
    ObjectGraphConnection,
    | 'kind'
    | 'sourceNodeId'
    | 'sourcePort'
    | 'sourcePortId'
    | 'targetNodeId'
    | 'targetPort'
    | 'targetPortId'
  >,
  ignoredConnectionId?: string
): ObjectGraphConnection | null {
  const ports = resolveObjectGraphPorts(graph, connection)
  if (!ports) return null
  return (
    objectGraphConnectionsOnPage(graph, pageId).find((existing) => {
      if (existing.id === ignoredConnectionId || existing.kind !== connection.kind) return false
      const existingPorts = resolveObjectGraphPorts(graph, existing)
      if (!existingPorts) return false
      return (
        existing.sourceNodeId === connection.sourceNodeId &&
        existing.targetNodeId === connection.targetNodeId &&
        (existing.sourcePortId ?? `side:${existingPorts.source.side}`) ===
          (connection.sourcePortId ?? `side:${ports.source.side}`) &&
        (existing.targetPortId ?? `side:${existingPorts.target.side}`) ===
          (connection.targetPortId ?? `side:${ports.target.side}`)
      )
    }) ?? null
  )
}

const OBJECT_GRAPH_REFERENCE_DIAGONAL = Math.hypot(240, 160)
const OBJECT_GRAPH_VISUAL_SCALE_EXPONENT = 2 / 3

export function objectGraphEndpointVisualScale(node: Pick<SceneNode, 'height' | 'width'>): number {
  const boardScale = Math.max(
    1,
    Math.hypot(node.width, node.height) / OBJECT_GRAPH_REFERENCE_DIAGONAL
  )
  return boardScale ** OBJECT_GRAPH_VISUAL_SCALE_EXPONENT
}

export function objectGraphConnectionVisualScale(
  source: Pick<SceneNode, 'height' | 'width'>,
  target: Pick<SceneNode, 'height' | 'width'>
): number {
  return Math.max(objectGraphEndpointVisualScale(source), objectGraphEndpointVisualScale(target))
}
