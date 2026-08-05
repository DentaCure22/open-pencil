import {
  getAbsolutePositionFull,
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

type ClipBounds = {
  height: number
  width: number
  x: number
  y: number
}

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

function nodeClipBounds(node: SceneNode, graph: SceneGraph): ClipBounds {
  const bounds = getAbsolutePositionFull(node, graph)
  return { height: bounds.height, width: bounds.width, x: bounds.boundX, y: bounds.boundY }
}

function clipIntersection(left: ClipBounds, right: ClipBounds): ClipBounds | null {
  const x = Math.max(left.x, right.x)
  const y = Math.max(left.y, right.y)
  const rightEdge = Math.min(left.x + left.width, right.x + right.width)
  const bottomEdge = Math.min(left.y + left.height, right.y + right.height)
  return rightEdge > x && bottomEdge > y
    ? { height: bottomEdge - y, width: rightEdge - x, x, y }
    : null
}

function intersectsClip(bounds: ClipBounds, clip: ClipBounds | null): boolean {
  return !clip || clipIntersection(bounds, clip) !== null
}

export function visibleObjectGraphNodesOnPage(graph: SceneGraph, pageId: string): SceneNode[] {
  const objects: SceneNode[] = []
  const visit = (parentId: string, inheritedClip: ClipBounds | null): void => {
    for (const node of graph.getChildren(parentId)) {
      if (
        node.internalOnly ||
        isObjectGraphConnectionNode(node) ||
        !node.visible ||
        node.opacity <= 0
      ) {
        continue
      }
      const bounds = inheritedClip || node.clipsContent ? nodeClipBounds(node, graph) : null
      if (!bounds || intersectsClip(bounds, inheritedClip)) objects.push(node)
      const ownClip = node.clipsContent ? (bounds ?? nodeClipBounds(node, graph)) : null
      const childClip = ownClip
        ? inheritedClip
          ? clipIntersection(inheritedClip, ownClip)
          : ownClip
        : inheritedClip
      if (!node.clipsContent || childClip) visit(node.id, childClip)
    }
  }
  visit(pageId, null)
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
  const endpointIds = new Set(objectGraphNodesOnPage(graph, pageId).map((node) => node.id))
  const byId = new Map(stored.map((connection) => [connection.id, connection]))
  for (const { connection } of legacy) {
    if (!byId.has(connection.id)) byId.set(connection.id, connection)
  }

  const normalized: ObjectGraphConnection[] = []
  let changed = legacy.length > 0
  for (const connection of byId.values()) {
    if (!endpointIds.has(connection.sourceNodeId) || !endpointIds.has(connection.targetNodeId)) {
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
