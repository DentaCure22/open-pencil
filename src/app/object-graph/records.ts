import {
  isObjectGraphConnectionNode,
  legacyObjectGraphConnectionsOnPage,
  objectGraphConnectionById,
  objectGraphConnectionsOnPage,
  setObjectGraphConnectionsOnPage,
  type ObjectGraphConnection,
  type SceneGraph,
  type SceneNode
} from '@open-pencil/scene-graph'

export type ObjectGraphRecordSnapshot = ObjectGraphConnection

export function objectGraphNodesOnPage(graph: SceneGraph, pageId: string): SceneNode[] {
  const objects: SceneNode[] = []
  const visit = (parentId: string): void => {
    for (const node of graph.getChildren(parentId)) {
      if (node.internalOnly || isObjectGraphConnectionNode(node)) continue
      objects.push(node)
      visit(node.id)
    }
  }
  visit(pageId)
  return objects
}

export function objectGraphConnectionName(
  graph: SceneGraph,
  connection: ObjectGraphConnection
): string {
  const source = graph.getNode(connection.sourceNodeId)?.name ?? 'Missing source'
  const target = graph.getNode(connection.targetNodeId)?.name ?? 'Missing target'
  const kind = connection.kind.charAt(0).toUpperCase() + connection.kind.slice(1)
  return `${kind}: ${source} → ${target}`
}

function upsertConnection(
  graph: SceneGraph,
  pageId: string,
  connection: ObjectGraphConnection
): void {
  const connections = objectGraphConnectionsOnPage(graph, pageId)
  const index = connections.findIndex((candidate) => candidate.id === connection.id)
  if (index !== -1) connections[index] = structuredClone(connection)
  else connections.push(structuredClone(connection))
  setObjectGraphConnectionsOnPage(graph, pageId, connections)
}

export function createObjectGraphConnectionRecord(
  graph: SceneGraph,
  pageId: string,
  connection: ObjectGraphConnection
): ObjectGraphRecordSnapshot {
  upsertConnection(graph, pageId, connection)
  return structuredClone(connection)
}

export function snapshotObjectGraphConnectionRecord(
  graph: SceneGraph,
  pageId: string,
  connectionId: string
): ObjectGraphRecordSnapshot | null {
  const connection = objectGraphConnectionById(graph, pageId, connectionId)
  return connection ? structuredClone(connection) : null
}

export function restoreObjectGraphConnectionRecord(
  graph: SceneGraph,
  pageId: string,
  snapshot: ObjectGraphRecordSnapshot
): void {
  upsertConnection(graph, pageId, snapshot)
}

export function removeObjectGraphConnectionRecord(
  graph: SceneGraph,
  pageId: string,
  connectionId: string
): boolean {
  const connections = objectGraphConnectionsOnPage(graph, pageId)
  const next = connections.filter((connection) => connection.id !== connectionId)
  return next.length < connections.length && setObjectGraphConnectionsOnPage(graph, pageId, next)
}

export function replaceObjectGraphConnectionRecord(
  graph: SceneGraph,
  pageId: string,
  connection: ObjectGraphConnection
): boolean {
  if (!objectGraphConnectionById(graph, pageId, connection.id)) return false
  upsertConnection(graph, pageId, connection)
  return true
}

export function normalizeObjectGraphConnectionRecords(graph: SceneGraph, pageId: string): boolean {
  const stored = objectGraphConnectionsOnPage(graph, pageId)
  const legacy = legacyObjectGraphConnectionsOnPage(graph, pageId)
  const byId = new Map(stored.map((connection) => [connection.id, connection]))
  for (const { connection } of legacy) {
    if (!byId.has(connection.id)) byId.set(connection.id, connection)
  }

  const normalized: ObjectGraphConnection[] = []
  let changed = legacy.length > 0
  for (const connection of byId.values()) {
    const source = graph.getNode(connection.sourceNodeId)
    const target = graph.getNode(connection.targetNodeId)
    if (!source || !target) {
      changed = true
      continue
    }
    normalized.push(connection)
  }

  if (JSON.stringify(stored) !== JSON.stringify(normalized)) {
    setObjectGraphConnectionsOnPage(graph, pageId, normalized)
    changed = true
  }
  for (const { node } of legacy) graph.deleteNode(node.id)
  return changed
}
