import type { SceneGraph } from './index'
import {
  OBJECT_GRAPH_PLUGIN_ID,
  OBJECT_GRAPH_SCHEMA_VERSION,
  type ObjectGraphConnection,
  type ObjectGraphConnectionKind,
  type ObjectGraphInputEnvelope,
  type ObjectGraphPermission,
  type ObjectGraphPortDefinition,
  type ObjectGraphPortDirection,
  type ObjectGraphPortSide
} from './object-graph-model'
import type { PluginDataEntry, SceneNode } from './types'

const CONNECTION_KIND_KEY = 'kind'
const CONNECTION_DOCUMENT_KEY = 'connection'
const CONNECTION_KIND_VALUE = 'connection'
const CONNECTIONS_DOCUMENT_KEY = 'connections'
const INPUT_KEY_PREFIX = 'input:'
const PORTS_DOCUMENT_KEY = 'ports'

const OBJECT_GRAPH_PORT_ID_PATTERN = /^[A-Za-z][A-Za-z0-9._/-]{0,127}$/u
const MAX_OBJECT_GRAPH_PORTS = 256

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
