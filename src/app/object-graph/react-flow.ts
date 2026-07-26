import { Position, type Edge, type Node, type NodeHandle } from '@xyflow/react'

import {
  objectGraphConnectionVisualScale,
  objectGraphConnectionsOnPage,
  type ObjectGraphConnection,
  type ObjectGraphConnectionKind,
  type ObjectGraphPortSide,
  type SceneGraph,
  type SceneNode,
  type Vector
} from '@open-pencil/scene-graph'

import {
  OBJECT_GRAPH_PORT_SIDES,
  bestObjectGraphPortSide,
  projectObjectGraphNode,
  type ObjectGraphFixedPortSide,
  type ObjectGraphNodeProjection,
  type ObjectGraphPortAnchor
} from '@/app/object-graph/projection'
import { objectGraphNodesOnPage } from '@/app/object-graph/records'

export const OBJECT_GRAPH_NODE_TYPE = 'openpencil-object'
export const OBJECT_GRAPH_EDGE_TYPE = 'openpencil-connection'

export const OBJECT_GRAPH_KIND_COLORS: Record<ObjectGraphConnectionKind, string> = {
  action: '#a78bfa',
  data: '#22d3ee',
  visual: '#94a3b8'
}

export type ObjectGraphNodeData = {
  name: string
  ports: Record<ObjectGraphFixedPortSide, ObjectGraphReactPort>
  showHandles: boolean
}

export type ObjectGraphReactNode = Node<ObjectGraphNodeData, typeof OBJECT_GRAPH_NODE_TYPE>

export type ObjectGraphEdgeData = {
  kind: ObjectGraphConnectionKind
  label: string
  onDisconnect?: (connectionId: string) => void
  sourceAnchor: ObjectGraphPortAnchor
  targetAnchor: ObjectGraphPortAnchor
  visualScale: number
}

export type ObjectGraphReactEdge = Edge<ObjectGraphEdgeData>

export type ObjectGraphSnapshotOptions = {
  hoveredNodeId?: string | null
  onDisconnect?: (connectionId: string) => void
  selectedIds?: ReadonlySet<string>
}

type ResolvedPortSides = {
  source: ObjectGraphFixedPortSide
  target: ObjectGraphFixedPortSide
}

export type ObjectGraphReactPort = {
  normal: Vector
  position: Position
  x: number
  y: number
}

const HANDLE_HIT_SIZE = 28

function positionForNormal(normal: Vector): Position {
  if (Math.abs(normal.x) >= Math.abs(normal.y)) {
    return normal.x >= 0 ? Position.Right : Position.Left
  }
  return normal.y >= 0 ? Position.Bottom : Position.Top
}

function projectedPorts(
  projection: ObjectGraphNodeProjection
): Record<ObjectGraphFixedPortSide, ObjectGraphReactPort> {
  return Object.fromEntries(
    OBJECT_GRAPH_PORT_SIDES.map((side) => {
      const anchor = projection.ports[side]
      return [
        side,
        {
          normal: anchor.normal,
          position: positionForNormal(anchor.normal),
          x: anchor.point.x - projection.bounds.boundX,
          y: anchor.point.y - projection.bounds.boundY
        }
      ]
    })
  ) as Record<ObjectGraphFixedPortSide, ObjectGraphReactPort>
}

function projectedHandles(
  ports: Record<ObjectGraphFixedPortSide, ObjectGraphReactPort>
): NodeHandle[] {
  const radius = HANDLE_HIT_SIZE / 2
  return OBJECT_GRAPH_PORT_SIDES.map((side) => ({
    height: HANDLE_HIT_SIZE,
    id: objectGraphHandleId(side),
    position: ports[side].position,
    type: 'source',
    width: HANDLE_HIT_SIZE,
    x: ports[side].x - radius,
    y: ports[side].y - radius
  }))
}

function toReactFlowNode(
  graph: SceneGraph,
  node: SceneNode,
  options: ObjectGraphSnapshotOptions
): ObjectGraphReactNode {
  const projection = projectObjectGraphNode(node, graph)
  const { bounds } = projection
  const ports = projectedPorts(projection)
  return {
    ariaLabel: `${node.name}, ${node.type}`,
    className: 'openpencil-object-graph-node',
    connectable: true,
    data: {
      name: node.name,
      ports,
      showHandles: options.hoveredNodeId === node.id || (options.selectedIds?.has(node.id) ?? false)
    },
    deletable: false,
    draggable: false,
    handles: projectedHandles(ports),
    height: bounds.height,
    hidden: false,
    id: node.id,
    measured: { height: bounds.height, width: bounds.width },
    position: { x: bounds.boundX, y: bounds.boundY },
    selectable: false,
    selected: options.selectedIds?.has(node.id) ?? false,
    style: {
      background: 'transparent',
      border: 0,
      height: bounds.height,
      padding: 0,
      width: bounds.width
    },
    type: OBJECT_GRAPH_NODE_TYPE,
    width: bounds.width
  }
}

export function objectGraphHandleId(
  side: Exclude<ObjectGraphPortSide, 'auto'>
): `port:${Exclude<ObjectGraphPortSide, 'auto'>}` {
  return `port:${side}`
}

export function parseObjectGraphHandleSide(
  handleId: string | null | undefined
): ObjectGraphPortSide {
  const side = handleId?.startsWith('port:') ? handleId.slice(5) : ''
  return side === 'bottom' || side === 'left' || side === 'right' || side === 'top' ? side : 'auto'
}

function resolveAutomaticPortSides(
  source: ObjectGraphNodeProjection,
  target: ObjectGraphNodeProjection
): ResolvedPortSides {
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

export function resolveObjectGraphPortSides(
  graph: SceneGraph,
  connection: Pick<
    ObjectGraphConnection,
    'sourceNodeId' | 'sourcePort' | 'targetNodeId' | 'targetPort'
  >
): ResolvedPortSides {
  const sourceNode = graph.getNode(connection.sourceNodeId)
  const targetNode = graph.getNode(connection.targetNodeId)
  if (!sourceNode || !targetNode) return { source: 'right', target: 'left' }
  const automatic = resolveAutomaticPortSides(
    projectObjectGraphNode(sourceNode, graph),
    projectObjectGraphNode(targetNode, graph)
  )
  return {
    source: connection.sourcePort === 'auto' ? automatic.source : connection.sourcePort,
    target: connection.targetPort === 'auto' ? automatic.target : connection.targetPort
  }
}

function toReactFlowEdge(
  graph: SceneGraph,
  connection: ObjectGraphConnection,
  options: ObjectGraphSnapshotOptions
): ObjectGraphReactEdge {
  const ports = resolveObjectGraphPortSides(graph, connection)
  const color = OBJECT_GRAPH_KIND_COLORS[connection.kind]
  const sourceNode = graph.getNode(connection.sourceNodeId)
  const targetNode = graph.getNode(connection.targetNodeId)
  if (!sourceNode || !targetNode) {
    throw new Error(`Object Graph connection ${connection.id} has unavailable endpoints`)
  }
  const sourceAnchor = projectObjectGraphNode(sourceNode, graph).ports[ports.source]
  const targetAnchor = projectObjectGraphNode(targetNode, graph).ports[ports.target]
  return {
    animated: false,
    ariaLabel: `${connection.kind} connection`,
    data: {
      kind: connection.kind,
      label: connection.label,
      onDisconnect: options.onDisconnect,
      sourceAnchor,
      targetAnchor,
      visualScale: objectGraphConnectionVisualScale(sourceNode, targetNode)
    },
    deletable: true,
    id: connection.id,
    selectable: true,
    selected: options.selectedIds?.has(connection.id) ?? false,
    source: connection.sourceNodeId,
    sourceHandle: objectGraphHandleId(ports.source),
    style: { stroke: color, strokeWidth: connection.kind === 'visual' ? 2 : 2.5 },
    target: connection.targetNodeId,
    targetHandle: objectGraphHandleId(ports.target),
    type: OBJECT_GRAPH_EDGE_TYPE
  }
}

export function objectGraphReactFlowSnapshot(
  graph: SceneGraph,
  pageId: string,
  options: ObjectGraphSnapshotOptions = {}
): {
  edges: ObjectGraphReactEdge[]
  nodes: ObjectGraphReactNode[]
} {
  const connections = objectGraphConnectionsOnPage(graph, pageId)
  return {
    edges: connections.map((connection) => toReactFlowEdge(graph, connection, options)),
    nodes: objectGraphNodesOnPage(graph, pageId).map((node) =>
      toReactFlowNode(graph, node, options)
    )
  }
}

function sameProjectedNode(current: ObjectGraphReactNode, next: ObjectGraphReactNode): boolean {
  return (
    current.ariaLabel === next.ariaLabel &&
    current.className === next.className &&
    current.connectable === next.connectable &&
    current.data.name === next.data.name &&
    sameProjectedPorts(current.data.ports, next.data.ports) &&
    current.data.showHandles === next.data.showHandles &&
    current.height === next.height &&
    current.hidden === next.hidden &&
    current.position.x === next.position.x &&
    current.position.y === next.position.y &&
    current.selected === next.selected &&
    current.width === next.width
  )
}

function sameVector(current: Vector, next: Vector): boolean {
  return current.x === next.x && current.y === next.y
}

function sameProjectedPorts(
  current: ObjectGraphNodeData['ports'],
  next: ObjectGraphNodeData['ports']
): boolean {
  for (const side of OBJECT_GRAPH_PORT_SIDES) {
    if (
      current[side].position !== next[side].position ||
      !sameVector(current[side].normal, next[side].normal) ||
      current[side].x !== next[side].x ||
      current[side].y !== next[side].y
    ) {
      return false
    }
  }
  return true
}

function sameProjectedEdgeData(current: ObjectGraphReactEdge, next: ObjectGraphReactEdge): boolean {
  return (
    current.data?.kind === next.data?.kind &&
    current.data?.label === next.data?.label &&
    current.data?.onDisconnect === next.data?.onDisconnect &&
    current.data?.visualScale === next.data?.visualScale &&
    Boolean(
      current.data &&
      next.data &&
      sameVector(current.data.sourceAnchor.point, next.data.sourceAnchor.point) &&
      sameVector(current.data.sourceAnchor.normal, next.data.sourceAnchor.normal) &&
      sameVector(current.data.targetAnchor.point, next.data.targetAnchor.point) &&
      sameVector(current.data.targetAnchor.normal, next.data.targetAnchor.normal)
    )
  )
}

function sameProjectedEdgeEndpoints(
  current: ObjectGraphReactEdge,
  next: ObjectGraphReactEdge
): boolean {
  return (
    current.source === next.source &&
    current.sourceHandle === next.sourceHandle &&
    current.target === next.target &&
    current.targetHandle === next.targetHandle
  )
}

function sameProjectedEdgeAppearance(
  current: ObjectGraphReactEdge,
  next: ObjectGraphReactEdge
): boolean {
  return (
    current.animated === next.animated &&
    current.ariaLabel === next.ariaLabel &&
    current.selected === next.selected &&
    current.style?.stroke === next.style?.stroke &&
    current.style?.strokeWidth === next.style?.strokeWidth &&
    current.type === next.type
  )
}

function sameProjectedEdge(current: ObjectGraphReactEdge, next: ObjectGraphReactEdge): boolean {
  return (
    sameProjectedEdgeData(current, next) &&
    sameProjectedEdgeEndpoints(current, next) &&
    sameProjectedEdgeAppearance(current, next)
  )
}

export function reconcileObjectGraphNodes(
  current: ObjectGraphReactNode[],
  next: ObjectGraphReactNode[]
): ObjectGraphReactNode[] {
  const currentById = new Map(current.map((node) => [node.id, node]))
  let changed = current.length !== next.length
  const reconciled = next.map((node) => {
    const previous = currentById.get(node.id)
    if (!previous) {
      changed = true
      return node
    }
    if (sameProjectedNode(previous, node)) return previous
    changed = true
    return {
      ...node,
      dragging: previous.dragging,
      resizing: previous.resizing
    }
  })
  return changed ? reconciled : current
}

export function reconcileObjectGraphEdges(
  current: ObjectGraphReactEdge[],
  next: ObjectGraphReactEdge[]
): ObjectGraphReactEdge[] {
  const currentById = new Map(current.map((edge) => [edge.id, edge]))
  let changed = current.length !== next.length
  const reconciled = next.map((edge) => {
    const previous = currentById.get(edge.id)
    if (previous && sameProjectedEdge(previous, edge)) return previous
    changed = true
    return edge
  })
  return changed ? reconciled : current
}

export function canAddObjectGraphConnection(
  graph: SceneGraph,
  pageId: string,
  connection: Pick<
    ObjectGraphConnection,
    'kind' | 'sourceNodeId' | 'sourcePort' | 'targetNodeId' | 'targetPort'
  >,
  ignoredConnectionId?: string
): boolean {
  if (connection.sourceNodeId === connection.targetNodeId) return false
  const nodeIds = new Set(objectGraphNodesOnPage(graph, pageId).map((node) => node.id))
  if (!nodeIds.has(connection.sourceNodeId) || !nodeIds.has(connection.targetNodeId)) {
    return false
  }
  const ports = resolveObjectGraphPortSides(graph, connection)
  return !objectGraphConnectionsOnPage(graph, pageId).some((existing) => {
    if (existing.id === ignoredConnectionId || existing.kind !== connection.kind) return false
    const existingPorts = resolveObjectGraphPortSides(graph, existing)
    return (
      existing.sourceNodeId === connection.sourceNodeId &&
      existing.targetNodeId === connection.targetNodeId &&
      existingPorts.source === ports.source &&
      existingPorts.target === ports.target
    )
  })
}

export function connectedObjectGraphEdgeIds(
  graph: SceneGraph,
  pageId: string,
  nodeId: string
): string[] {
  return objectGraphConnectionsOnPage(graph, pageId)
    .filter(
      (connection) => connection.sourceNodeId === nodeId || connection.targetNodeId === nodeId
    )
    .map((connection) => connection.id)
}
