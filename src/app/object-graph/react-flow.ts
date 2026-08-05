import { getBezierPath, Position, type Edge, type Node } from '@xyflow/react'

import {
  OBJECT_GRAPH_PORT_SIDES,
  objectGraphConnectionsOnPage,
  projectObjectGraphNode,
  resolveProjectedObjectGraphPorts,
  type ObjectGraphConnection,
  type ObjectGraphNodeProjection,
  type ObjectGraphPortAnchor,
  type ObjectGraphPortDirection,
  type ObjectGraphPortSide,
  type SceneGraph,
  type SceneNode,
  type Vector
} from '@open-pencil/scene-graph'

import type { ObjectGraphNavigationEndpoint } from '@/app/object-graph/navigation'
import { visibleObjectGraphNodesOnPage } from '@/app/object-graph/records'

export const OBJECT_GRAPH_NODE_TYPE = 'openpencil-object'
export const OBJECT_GRAPH_EDGE_TYPE = 'openpencil-connection'

export type ObjectGraphNodeData = {
  endpoint?: {
    handleId: string
    role: ObjectGraphNavigationEndpoint
  }
  name: string
  ports: Record<string, ObjectGraphReactPort>
  showHandles: boolean
}

export type ObjectGraphReactNode = Node<ObjectGraphNodeData, typeof OBJECT_GRAPH_NODE_TYPE>

export type ObjectGraphReactEdge = Edge<Record<string, never>, typeof OBJECT_GRAPH_EDGE_TYPE>

export type ObjectGraphSnapshotOptions = {
  activeConnectionId?: string | null
  hoveredNodeId?: string | null
  runtimePortPoints?: (nodeId: string) => Readonly<Record<string, Vector>> | undefined
  selectedIds?: ReadonlySet<string>
}

export type ObjectGraphReactPort = {
  direction: ObjectGraphPortDirection
  handleId: string
  label: string
  legacy: boolean
  normal: Vector
  position: Position
  x: number
  y: number
}

function positionForNormal(normal: Vector): Position {
  if (Math.abs(normal.x) >= Math.abs(normal.y)) {
    return normal.x >= 0 ? Position.Right : Position.Left
  }
  return normal.y >= 0 ? Position.Bottom : Position.Top
}

function projectedPorts(
  projection: ObjectGraphNodeProjection
): Record<string, ObjectGraphReactPort> {
  const legacy = Object.fromEntries(
    OBJECT_GRAPH_PORT_SIDES.map((side) => {
      const anchor = projection.ports[side]
      return [
        side,
        {
          direction: 'both' as const,
          handleId: objectGraphHandleId(side),
          label: side,
          legacy: true,
          normal: anchor.normal,
          position: positionForNormal(anchor.normal),
          x: anchor.point.x - projection.bounds.boundX,
          y: anchor.point.y - projection.bounds.boundY
        }
      ]
    })
  )
  const named = Object.fromEntries(
    Object.values(projection.namedPorts).map(({ definition, normal, point }) => [
      `named:${definition.id}`,
      {
        direction: definition.direction,
        handleId: objectGraphNamedHandleId(definition.id),
        label: definition.label,
        legacy: false,
        normal,
        position: positionForNormal(normal),
        x: point.x - projection.bounds.boundX,
        y: point.y - projection.bounds.boundY
      }
    ])
  )
  return { ...legacy, ...named }
}

function toReactFlowNode(
  node: SceneNode,
  projection: ObjectGraphNodeProjection,
  options: ObjectGraphSnapshotOptions,
  endpoint?: ObjectGraphNodeData['endpoint']
): ObjectGraphReactNode {
  const { bounds } = projection
  const ports = projectedPorts(projection)
  return {
    ariaLabel: `${node.name}, ${node.type}`,
    className: 'openpencil-object-graph-node',
    connectable: true,
    data: {
      endpoint,
      name: node.name,
      ports,
      showHandles: options.hoveredNodeId === node.id || (options.selectedIds?.has(node.id) ?? false)
    },
    deletable: false,
    draggable: false,
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

export function objectGraphNamedHandleId(portId: string): string {
  return `named-port:${encodeURIComponent(portId)}`
}

export type ObjectGraphHandleEndpoint = {
  port: ObjectGraphPortSide
  portId?: string
}

export function parseObjectGraphHandle(
  handleId: string | null | undefined
): ObjectGraphHandleEndpoint {
  const side = parseObjectGraphHandleSide(handleId)
  if (side !== 'auto') return { port: side }
  if (!handleId?.startsWith('named-port:')) return { port: 'auto' }
  try {
    const portId = decodeURIComponent(handleId.slice('named-port:'.length))
    return portId ? { port: 'auto', portId } : { port: 'auto' }
  } catch {
    return { port: 'auto' }
  }
}

export function parseObjectGraphHandleSide(
  handleId: string | null | undefined
): ObjectGraphPortSide {
  const side = handleId?.startsWith('port:') ? handleId.slice(5) : ''
  return side === 'bottom' || side === 'left' || side === 'right' || side === 'top' ? side : 'auto'
}

type ProjectedObjectGraphNode = {
  node: SceneNode
  projection: ObjectGraphNodeProjection
}

export type ResolvedObjectGraphConnectionGeometry = {
  geometry: {
    label: Vector
    path: string
  }
  sourceAnchor: ObjectGraphPortAnchor
  targetAnchor: ObjectGraphPortAnchor
}

function projectVisibleObjectGraphNodes(
  graph: SceneGraph,
  pageId: string,
  runtimePortPoints?: ObjectGraphSnapshotOptions['runtimePortPoints']
): ProjectedObjectGraphNode[] {
  return visibleObjectGraphNodesOnPage(graph, pageId).map((node) => ({
    node,
    projection: projectObjectGraphNode(node, graph, runtimePortPoints?.(node.id))
  }))
}

function projectionMap(
  projectedNodes: readonly ProjectedObjectGraphNode[]
): Map<string, ObjectGraphNodeProjection> {
  return new Map(projectedNodes.map(({ node, projection }) => [node.id, projection] as const))
}

function resolveProjectedConnectionGeometry(
  connection: ObjectGraphConnection,
  projections: ReadonlyMap<string, ObjectGraphNodeProjection>
): ResolvedObjectGraphConnectionGeometry {
  const sourceProjection = projections.get(connection.sourceNodeId)
  const targetProjection = projections.get(connection.targetNodeId)
  if (!sourceProjection || !targetProjection) {
    throw new Error(`Object Graph connection ${connection.id} has unavailable endpoints`)
  }
  const ports = resolveProjectedObjectGraphPorts(connection, sourceProjection, targetProjection)
  if (!ports) {
    throw new Error(`Object Graph connection ${connection.id} has unavailable named ports`)
  }
  const sourceAnchor = ports.source.anchor
  const targetAnchor = ports.target.anchor
  const [path, labelX, labelY] = getBezierPath({
    sourcePosition: positionForNormal(sourceAnchor.normal),
    sourceX: sourceAnchor.point.x,
    sourceY: sourceAnchor.point.y,
    targetPosition: positionForNormal(targetAnchor.normal),
    targetX: targetAnchor.point.x,
    targetY: targetAnchor.point.y
  })
  return {
    geometry: { label: { x: labelX, y: labelY }, path },
    sourceAnchor,
    targetAnchor
  }
}

export function resolveObjectGraphConnectionGeometry(
  graph: SceneGraph,
  pageId: string,
  connection: ObjectGraphConnection
): ResolvedObjectGraphConnectionGeometry {
  const projectedNodes = projectVisibleObjectGraphNodes(graph, pageId)
  return resolveProjectedConnectionGeometry(connection, projectionMap(projectedNodes))
}

function toReactFlowEdge(
  graph: SceneGraph,
  connection: ObjectGraphConnection,
  options: ObjectGraphSnapshotOptions,
  projections: ReadonlyMap<string, ObjectGraphNodeProjection>
): ObjectGraphReactEdge {
  const sourceNode = graph.getNode(connection.sourceNodeId)
  const targetNode = graph.getNode(connection.targetNodeId)
  if (!sourceNode || !targetNode) {
    throw new Error(`Object Graph connection ${connection.id} has unavailable endpoints`)
  }
  const sourceProjection = projections.get(connection.sourceNodeId)
  const targetProjection = projections.get(connection.targetNodeId)
  if (!sourceProjection || !targetProjection) {
    throw new Error(`Object Graph connection ${connection.id} has unavailable endpoints`)
  }
  const ports = resolveProjectedObjectGraphPorts(connection, sourceProjection, targetProjection)
  if (!ports) {
    throw new Error(`Object Graph connection ${connection.id} has unavailable named ports`)
  }
  return {
    ariaLabel: `${connection.kind} connection from ${sourceNode.name} to ${targetNode.name}`,
    deletable: true,
    id: connection.id,
    selectable: true,
    selected: options.selectedIds?.has(connection.id) ?? false,
    source: connection.sourceNodeId,
    sourceHandle: ports.source.id
      ? objectGraphNamedHandleId(ports.source.id)
      : objectGraphHandleId(ports.source.side),
    target: connection.targetNodeId,
    targetHandle: ports.target.id
      ? objectGraphNamedHandleId(ports.target.id)
      : objectGraphHandleId(ports.target.side),
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
  const projectedNodes = projectVisibleObjectGraphNodes(graph, pageId, options.runtimePortPoints)
  const nodes = projectedNodes.map(({ node }) => node)
  const projections = projectionMap(projectedNodes)
  const nodeIds = new Set(nodes.map((node) => node.id))
  const connections = objectGraphConnectionsOnPage(graph, pageId).filter((connection) => {
    if (!nodeIds.has(connection.sourceNodeId) || !nodeIds.has(connection.targetNodeId)) {
      return false
    }
    const source = projections.get(connection.sourceNodeId)
    const target = projections.get(connection.targetNodeId)
    return Boolean(source && target && resolveProjectedObjectGraphPorts(connection, source, target))
  })
  const activeConnection = connections.find(
    (connection) =>
      connection.id === options.activeConnectionId ||
      (options.selectedIds?.has(connection.id) ?? false)
  )
  const activeSource = activeConnection ? projections.get(activeConnection.sourceNodeId) : undefined
  const activeTarget = activeConnection ? projections.get(activeConnection.targetNodeId) : undefined
  const activePorts =
    activeConnection && activeSource && activeTarget
      ? resolveProjectedObjectGraphPorts(activeConnection, activeSource, activeTarget)
      : null
  return {
    edges: connections.map((connection) =>
      toReactFlowEdge(graph, connection, options, projections)
    ),
    nodes: projectedNodes.map(({ node, projection }) => {
      let endpoint: ObjectGraphNodeData['endpoint']
      if (activeConnection && activePorts) {
        if (node.id === activeConnection.sourceNodeId) {
          endpoint = {
            handleId: activePorts.source.id
              ? objectGraphNamedHandleId(activePorts.source.id)
              : objectGraphHandleId(activePorts.source.side),
            role: 'source'
          }
        } else if (node.id === activeConnection.targetNodeId) {
          endpoint = {
            handleId: activePorts.target.id
              ? objectGraphNamedHandleId(activePorts.target.id)
              : objectGraphHandleId(activePorts.target.side),
            role: 'target'
          }
        }
      }
      return toReactFlowNode(node, projection, options, endpoint)
    })
  }
}

function sameProjectedEndpoint(
  current: ObjectGraphNodeData['endpoint'],
  next: ObjectGraphNodeData['endpoint']
): boolean {
  return current?.handleId === next?.handleId && current?.role === next?.role
}

function sameProjectedNode(current: ObjectGraphReactNode, next: ObjectGraphReactNode): boolean {
  return (
    current.ariaLabel === next.ariaLabel &&
    current.className === next.className &&
    current.connectable === next.connectable &&
    sameProjectedEndpoint(current.data.endpoint, next.data.endpoint) &&
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
  const keys = Object.keys(current)
  if (keys.length !== Object.keys(next).length) return false
  for (const key of keys) {
    const currentPort = current[key]
    const nextPort = next[key]
    if (
      currentPort.direction !== nextPort.direction ||
      currentPort.handleId !== nextPort.handleId ||
      currentPort.label !== nextPort.label ||
      currentPort.legacy !== nextPort.legacy ||
      currentPort.position !== nextPort.position ||
      !sameVector(currentPort.normal, nextPort.normal) ||
      currentPort.x !== nextPort.x ||
      currentPort.y !== nextPort.y
    ) {
      return false
    }
  }
  return true
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
    current.type === next.type
  )
}

function sameProjectedEdge(current: ObjectGraphReactEdge, next: ObjectGraphReactEdge): boolean {
  return sameProjectedEdgeEndpoints(current, next) && sameProjectedEdgeAppearance(current, next)
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
