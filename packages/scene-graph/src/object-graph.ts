import type { SceneGraph } from './index'
import type { PluginDataEntry, SceneNode } from './types'

export const OBJECT_GRAPH_PLUGIN_ID = 'openpencil-object-graph'
export const OBJECT_GRAPH_SCHEMA_VERSION = 1 as const

const CONNECTION_KIND_KEY = 'kind'
const CONNECTION_DOCUMENT_KEY = 'connection'
const CONNECTION_KIND_VALUE = 'connection'
const CONNECTIONS_DOCUMENT_KEY = 'connections'
const INPUT_KEY_PREFIX = 'input:'

export type ObjectGraphConnectionKind = 'action' | 'data' | 'visual'
export type ObjectGraphPortSide = 'auto' | 'bottom' | 'left' | 'right' | 'top'
export type ObjectGraphPermission = 'target.action.execute' | 'target.data.write'

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
  targetNodeId: string
  targetPort: ObjectGraphPortSide
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

function parseObjectGraphConnection(parsed: unknown): ObjectGraphConnection | null {
  if (!isRecord(parsed)) return null
  const kind = connectionKind(parsed.kind)
  const sourcePort = portSide(parsed.sourcePort)
  const targetPort = portSide(parsed.targetPort)
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
    typeof parsed.targetNodeId !== 'string' ||
    !targetPort
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
    targetNodeId: parsed.targetNodeId,
    targetPort
  }
}

const OBJECT_GRAPH_REFERENCE_DIAGONAL = Math.hypot(240, 160)
const OBJECT_GRAPH_VISUAL_SCALE_EXPONENT = 2 / 3

function endpointVisualScale(node: Pick<SceneNode, 'height' | 'width'>): number {
  return Math.max(1, Math.hypot(node.width, node.height) / OBJECT_GRAPH_REFERENCE_DIAGONAL)
}

export function objectGraphConnectionVisualScale(
  source: Pick<SceneNode, 'height' | 'width'>,
  target: Pick<SceneNode, 'height' | 'width'>
): number {
  const largestEndpointScale = Math.max(endpointVisualScale(source), endpointVisualScale(target))
  return largestEndpointScale ** OBJECT_GRAPH_VISUAL_SCALE_EXPONENT
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
    pluginData.push({
      key: CONNECTIONS_DOCUMENT_KEY,
      pluginId: OBJECT_GRAPH_PLUGIN_ID,
      value: JSON.stringify(connections)
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
