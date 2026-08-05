import { getAbsolutePositionFull, getWorldMatrix } from './coordinate'
import type { SceneGraph } from './index'
import TransformMatrix from './matrix'
import type { Vector } from './primitives'
import type { PluginDataEntry, SceneNode } from './types'

export const OBJECT_GRAPH_PLUGIN_ID = 'openpencil-object-graph'
export const OBJECT_GRAPH_SCHEMA_VERSION = 1 as const

const CONNECTION_KIND_KEY = 'kind'
const CONNECTION_DOCUMENT_KEY = 'connection'
const CONNECTION_KIND_VALUE = 'connection'
const CONNECTIONS_DOCUMENT_KEY = 'connections'
const INPUT_KEY_PREFIX = 'input:'
const PORTS_DOCUMENT_KEY = 'ports'

const OBJECT_GRAPH_PORT_ID_PATTERN = /^[A-Za-z][A-Za-z0-9._/-]{0,127}$/u
const MAX_OBJECT_GRAPH_PORTS = 256

export type ObjectGraphConnectionKind = 'action' | 'data' | 'visual'
export type ObjectGraphPortDirection = 'both' | 'input' | 'output'
export type ObjectGraphPortSide = 'auto' | 'bottom' | 'left' | 'right' | 'top'
export type ObjectGraphPermission = 'target.action.execute' | 'target.data.write'

export const OBJECT_GRAPH_PORT_SIDES = ['top', 'right', 'bottom', 'left'] as const

export type ObjectGraphFixedPortSide = Exclude<ObjectGraphPortSide, 'auto'>

export type ObjectGraphPortAnchor = {
  normal: Vector
  point: Vector
}

export type ObjectGraphPortDefinition = {
  direction: ObjectGraphPortDirection
  id: string
  kinds: ObjectGraphConnectionKind[]
  label: string
  offset: number
  side: ObjectGraphFixedPortSide
}

export type ObjectGraphNamedPortProjection = ObjectGraphPortAnchor & {
  definition: ObjectGraphPortDefinition
}

export type ObjectGraphNodeProjection = {
  bounds: ReturnType<typeof getAbsolutePositionFull>
  corners: [Vector, Vector, Vector, Vector]
  namedPorts: Record<string, ObjectGraphNamedPortProjection>
  ports: Record<ObjectGraphFixedPortSide, ObjectGraphPortAnchor>
}

export type ResolvedObjectGraphPortSides = {
  source: ObjectGraphFixedPortSide
  target: ObjectGraphFixedPortSide
}

export type ResolvedObjectGraphPort = {
  anchor: ObjectGraphPortAnchor
  id?: string
  side: ObjectGraphFixedPortSide
}

export type ResolvedObjectGraphPorts = {
  source: ResolvedObjectGraphPort
  target: ResolvedObjectGraphPort
}

export type ObjectGraphAction =
  | { type: 'hide' }
  | { opacity: number; type: 'set-opacity' }
  | { type: 'show' }
  | { type: 'toggle-opacity' }

export type ObjectGraphSignal =
  | { kind: 'action'; action: ObjectGraphAction }
  | { kind: 'data'; value: unknown }

export interface ObjectGraphInputEnvelope {
  connectionId: string
  sourceNodeId: string
  value: unknown
}

export interface ObjectGraphConnection {
  automatic: boolean
  id: string
  kind: ObjectGraphConnectionKind
  label: string
  permissions: ObjectGraphPermission[]
  schemaVersion: typeof OBJECT_GRAPH_SCHEMA_VERSION
  sourceNodeId: string
  sourcePort: ObjectGraphPortSide
  sourcePortId?: string
  targetNodeId: string
  targetPort: ObjectGraphPortSide
  targetPortId?: string
}

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
  runtimePortPoints: Readonly<Record<string, Vector>> = {}
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

function pluginValue(node: Pick<SceneNode, 'pluginData'>, key: string): string | null {
  return (
    node.pluginData.find((entry) => entry.pluginId === OBJECT_GRAPH_PLUGIN_ID && entry.key === key)
      ?.value ?? null
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function connectionKind(value: unknown): ObjectGraphConnectionKind | null {
  return value === 'action' || value === 'data' || value === 'visual' ? value : null
}

function portSide(value: unknown): ObjectGraphPortSide | null {
  return value === 'auto' ||
    value === 'bottom' ||
    value === 'left' ||
    value === 'right' ||
    value === 'top'
    ? value
    : null
}

function portDirection(value: unknown): ObjectGraphPortDirection | null {
  return value === 'both' || value === 'input' || value === 'output' ? value : null
}

function portId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const id = value.trim()
  return OBJECT_GRAPH_PORT_ID_PATTERN.test(id) ? id : null
}

function optionalPortId(value: unknown): string | null | undefined {
  return value === undefined ? undefined : portId(value)
}

export function parseObjectGraphPortDefinition(value: unknown): ObjectGraphPortDefinition | null {
  if (!isRecord(value)) return null
  const direction = portDirection(value.direction)
  const id = portId(value.id)
  const side = portSide(value.side)
  if (
    !direction ||
    !id ||
    side === null ||
    side === 'auto' ||
    typeof value.label !== 'string' ||
    value.label.length > 120 ||
    typeof value.offset !== 'number' ||
    !Number.isFinite(value.offset) ||
    value.offset < 0 ||
    value.offset > 1 ||
    !Array.isArray(value.kinds) ||
    value.kinds.length === 0
  ) {
    return null
  }
  const kinds = value.kinds.map(connectionKind)
  if (kinds.some((kind) => !kind)) return null
  const uniqueKinds = [...new Set(kinds)] as ObjectGraphConnectionKind[]
  if (uniqueKinds.length !== kinds.length) return null
  return {
    direction,
    id,
    kinds: uniqueKinds,
    label: value.label.trim() || id,
    offset: value.offset,
    side
  }
}

export function parseObjectGraphPorts(value: unknown): ObjectGraphPortDefinition[] | null {
  if (!Array.isArray(value) || value.length > MAX_OBJECT_GRAPH_PORTS) return null
  const ports = value.map(parseObjectGraphPortDefinition)
  if (ports.some((port) => !port)) return null
  const parsed = ports as ObjectGraphPortDefinition[]
  if (new Set(parsed.map(({ id }) => id)).size !== parsed.length) return null
  return parsed
}

function permissions(value: unknown): ObjectGraphPermission[] | null {
  if (!Array.isArray(value)) return null
  const parsed = value.filter(
    (permission): permission is ObjectGraphPermission =>
      permission === 'target.action.execute' || permission === 'target.data.write'
  )
  return parsed.length === value.length ? parsed : null
}

export function isObjectGraphConnectionNode(node: SceneNode | null | undefined): boolean {
  return Boolean(
    node?.type === 'GROUP' && pluginValue(node, CONNECTION_KIND_KEY) === CONNECTION_KIND_VALUE
  )
}

export function parseObjectGraphConnection(parsed: unknown): ObjectGraphConnection | null {
  if (!isRecord(parsed)) return null
  const kind = connectionKind(parsed.kind)
  const sourcePort = portSide(parsed.sourcePort)
  const sourcePortId = optionalPortId(parsed.sourcePortId)
  const targetPort = portSide(parsed.targetPort)
  const targetPortId = optionalPortId(parsed.targetPortId)
  const granted = permissions(parsed.permissions)
  if (
    parsed.schemaVersion !== OBJECT_GRAPH_SCHEMA_VERSION ||
    typeof parsed.automatic !== 'boolean' ||
    typeof parsed.id !== 'string' ||
    !kind ||
    typeof parsed.label !== 'string' ||
    !granted ||
    typeof parsed.sourceNodeId !== 'string' ||
    !sourcePort ||
    sourcePortId === null ||
    typeof parsed.targetNodeId !== 'string' ||
    !targetPort ||
    targetPortId === null
  ) {
    return null
  }
  return {
    automatic: parsed.automatic,
    id: parsed.id,
    kind,
    label: parsed.label,
    permissions: granted,
    schemaVersion: OBJECT_GRAPH_SCHEMA_VERSION,
    sourceNodeId: parsed.sourceNodeId,
    sourcePort,
    ...(sourcePortId ? { sourcePortId } : {}),
    targetNodeId: parsed.targetNodeId,
    targetPort,
    ...(targetPortId ? { targetPortId } : {})
  }
}

export function readObjectGraphPorts(
  node: Pick<SceneNode, 'pluginData'> | null | undefined
): ObjectGraphPortDefinition[] {
  if (!node) return []
  const serialized = pluginValue(node, PORTS_DOCUMENT_KEY)
  if (!serialized) return []
  try {
    return parseObjectGraphPorts(JSON.parse(serialized)) ?? []
  } catch {
    return []
  }
}

export function objectGraphPortsPluginData(
  node: Pick<SceneNode, 'pluginData'>,
  ports: ObjectGraphPortDefinition[]
): PluginDataEntry[] {
  const parsed = parseObjectGraphPorts(ports)
  if (!parsed) throw new TypeError('Object Graph ports are invalid.')
  const pluginData = node.pluginData.filter(
    (entry) => !(entry.pluginId === OBJECT_GRAPH_PLUGIN_ID && entry.key === PORTS_DOCUMENT_KEY)
  )
  if (parsed.length > 0) {
    pluginData.push({
      key: PORTS_DOCUMENT_KEY,
      pluginId: OBJECT_GRAPH_PLUGIN_ID,
      value: JSON.stringify([...parsed].sort((left, right) => left.id.localeCompare(right.id)))
    })
  }
  return pluginData
}

export function setObjectGraphPorts(
  graph: SceneGraph,
  nodeId: string,
  ports: ObjectGraphPortDefinition[]
): boolean {
  const node = graph.getNode(nodeId)
  if (!node) return false
  graph.updateNode(nodeId, { pluginData: objectGraphPortsPluginData(node, ports) })
  return true
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

export function readObjectGraphConnection(
  node: SceneNode | null | undefined
): ObjectGraphConnection | null {
  if (!node || !isObjectGraphConnectionNode(node)) return null
  const serialized = pluginValue(node, CONNECTION_DOCUMENT_KEY)
  if (!serialized) return null
  try {
    return parseObjectGraphConnection(JSON.parse(serialized))
  } catch {
    return null
  }
}

export function objectGraphConnectionPluginData(
  node: Pick<SceneNode, 'pluginData'>,
  connection: ObjectGraphConnection
): PluginDataEntry[] {
  return [
    ...node.pluginData.filter(
      (entry) =>
        !(
          entry.pluginId === OBJECT_GRAPH_PLUGIN_ID &&
          (entry.key === CONNECTION_KIND_KEY || entry.key === CONNECTION_DOCUMENT_KEY)
        )
    ),
    {
      key: CONNECTION_KIND_KEY,
      pluginId: OBJECT_GRAPH_PLUGIN_ID,
      value: CONNECTION_KIND_VALUE
    },
    {
      key: CONNECTION_DOCUMENT_KEY,
      pluginId: OBJECT_GRAPH_PLUGIN_ID,
      value: JSON.stringify(connection)
    }
  ]
}

export function readObjectGraphConnections(
  page: Pick<SceneNode, 'pluginData'> | null | undefined
): ObjectGraphConnection[] {
  if (!page) return []
  const serialized = pluginValue(page, CONNECTIONS_DOCUMENT_KEY)
  if (!serialized) return []
  try {
    const parsed: unknown = JSON.parse(serialized)
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((value) => {
      const connection = parseObjectGraphConnection(value)
      return connection ? [connection] : []
    })
  } catch {
    return []
  }
}

export function objectGraphConnectionsPluginData(
  page: Pick<SceneNode, 'pluginData'>,
  connections: ObjectGraphConnection[]
): PluginDataEntry[] {
  const pluginData = page.pluginData.filter(
    (entry) =>
      !(entry.pluginId === OBJECT_GRAPH_PLUGIN_ID && entry.key === CONNECTIONS_DOCUMENT_KEY)
  )
  if (connections.length > 0) {
    const ordered = [...connections].sort((left, right) => left.id.localeCompare(right.id))
    pluginData.push({
      key: CONNECTIONS_DOCUMENT_KEY,
      pluginId: OBJECT_GRAPH_PLUGIN_ID,
      value: JSON.stringify(ordered)
    })
  }
  return pluginData
}

export function objectGraphInputPluginData(
  node: Pick<SceneNode, 'pluginData'>,
  input: ObjectGraphInputEnvelope
): PluginDataEntry[] {
  const key = `${INPUT_KEY_PREFIX}${input.connectionId}`
  return [
    ...node.pluginData.filter(
      (entry) => !(entry.pluginId === OBJECT_GRAPH_PLUGIN_ID && entry.key === key)
    ),
    {
      key,
      pluginId: OBJECT_GRAPH_PLUGIN_ID,
      value: JSON.stringify(input)
    }
  ]
}

export function readObjectGraphInputs(
  node: Pick<SceneNode, 'pluginData'> | null | undefined
): ObjectGraphInputEnvelope[] {
  if (!node) return []
  return node.pluginData.flatMap((entry) => {
    if (entry.pluginId !== OBJECT_GRAPH_PLUGIN_ID || !entry.key.startsWith(INPUT_KEY_PREFIX)) {
      return []
    }
    try {
      const parsed: unknown = JSON.parse(entry.value)
      if (
        !isRecord(parsed) ||
        typeof parsed.connectionId !== 'string' ||
        typeof parsed.sourceNodeId !== 'string'
      ) {
        return []
      }
      return [
        {
          connectionId: parsed.connectionId,
          sourceNodeId: parsed.sourceNodeId,
          value: parsed.value
        }
      ]
    } catch {
      return []
    }
  })
}

export function objectGraphConnectionsOnPage(
  graph: SceneGraph,
  pageId: string
): ObjectGraphConnection[] {
  return readObjectGraphConnections(graph.getNode(pageId))
}

export function objectGraphConnectionById(
  graph: SceneGraph,
  pageId: string,
  connectionId: string
): ObjectGraphConnection | null {
  return (
    objectGraphConnectionsOnPage(graph, pageId).find(
      (connection) => connection.id === connectionId
    ) ?? null
  )
}

export function objectGraphConnectionForSelection(
  graph: SceneGraph,
  pageId: string,
  selectedIds: ReadonlySet<string>
): ObjectGraphConnection | null {
  if (selectedIds.size !== 1) return null
  const connectionId = selectedIds.values().next().value
  return typeof connectionId === 'string'
    ? objectGraphConnectionById(graph, pageId, connectionId)
    : null
}

export function setObjectGraphConnectionsOnPage(
  graph: SceneGraph,
  pageId: string,
  connections: ObjectGraphConnection[]
): boolean {
  const page = graph.getNode(pageId)
  if (!page) return false
  graph.updateNode(pageId, {
    pluginData: objectGraphConnectionsPluginData(page, connections)
  })
  return true
}

export function legacyObjectGraphConnectionsOnPage(
  graph: SceneGraph,
  pageId: string
): Array<{ connection: ObjectGraphConnection; node: SceneNode }> {
  return graph.getChildren(pageId).flatMap((node) => {
    const connection = readObjectGraphConnection(node)
    return connection ? [{ connection, node }] : []
  })
}

export function objectGraphConnectionsForNode(
  graph: SceneGraph,
  pageId: string,
  nodeId: string
): ObjectGraphConnection[] {
  return objectGraphConnectionsOnPage(graph, pageId).filter(
    (connection) => connection.sourceNodeId === nodeId || connection.targetNodeId === nodeId
  )
}
