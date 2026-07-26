import {
  objectGraphConnectionsOnPage,
  OBJECT_GRAPH_SCHEMA_VERSION,
  setObjectGraphConnectionsOnPage,
  type ObjectGraphConnection,
  type SceneGraph
} from '@open-pencil/scene-graph'

import type { CodeObjectConnection } from './contracts'
import {
  reactShapeDocument as codeObjectDocument,
  setReactShapeDocument as setCodeObjectDocument
} from './implementation'

type CodeObjectConnectionStore = {
  graph: SceneGraph
  state: {
    currentPageId: string
  }
}

function sameLegacyConnection(
  connection: ObjectGraphConnection,
  sourceNodeId: string,
  targetNodeId: string
): boolean {
  return (
    connection.kind === 'data' &&
    connection.sourceNodeId === sourceNodeId &&
    connection.targetNodeId === targetNodeId
  )
}

function deterministicConnectionId(
  existing: Map<string, ObjectGraphConnection>,
  requestedId: string,
  sourceNodeId: string,
  targetNodeId: string
): string {
  const requested = existing.get(requestedId)
  if (!requested || sameLegacyConnection(requested, sourceNodeId, targetNodeId)) {
    return requestedId
  }
  const base = `${requestedId}:legacy:${sourceNodeId}`
  let candidate = base
  let suffix = 2
  let collision = existing.get(candidate)
  while (collision && !sameLegacyConnection(collision, sourceNodeId, targetNodeId)) {
    candidate = `${base}:${suffix}`
    suffix += 1
    collision = existing.get(candidate)
  }
  return candidate
}

function codeObjectFramesOnPage(store: CodeObjectConnectionStore): string[] {
  const frameIds: string[] = []
  const visit = (parentId: string): void => {
    for (const node of store.graph.getChildren(parentId)) {
      if (codeObjectDocument(node)) frameIds.push(node.id)
      visit(node.id)
    }
  }
  visit(store.state.currentPageId)
  return frameIds
}

/**
 * Moves readable legacy frame-owned `state.write` links into canonical page-owned Object Graph
 * records. Invalid links remain on the source frame so a temporarily missing target is not lost.
 */
export function normalizeLegacyCodeObjectConnections(store: CodeObjectConnectionStore): boolean {
  const pageId = store.state.currentPageId
  const stored = objectGraphConnectionsOnPage(store.graph, pageId)
  const byId = new Map(stored.map((connection) => [connection.id, connection]))
  let changed = false

  for (const sourceFrameId of codeObjectFramesOnPage(store)) {
    const source = store.graph.getNode(sourceFrameId)
    const document = codeObjectDocument(source)
    if (!source || !document || document.connections.length === 0) continue

    const retained: CodeObjectConnection[] = []
    for (const legacy of document.connections) {
      const target = store.graph.getNode(legacy.targetFrameId)
      if (
        !legacy.permissions.includes('state.write') ||
        !target ||
        !codeObjectDocument(target) ||
        target.id === source.id ||
        !store.graph.isDescendant(target.id, pageId)
      ) {
        retained.push(legacy)
        continue
      }

      const id = deterministicConnectionId(byId, legacy.id, source.id, target.id)
      const existing = byId.get(id)
      if (!existing) {
        byId.set(id, {
          automatic: true,
          id,
          kind: 'data',
          label: legacy.label,
          permissions: ['target.data.write'],
          schemaVersion: OBJECT_GRAPH_SCHEMA_VERSION,
          sourceNodeId: source.id,
          sourcePort: 'auto',
          targetNodeId: target.id,
          targetPort: 'auto'
        })
      }
      changed = true
    }

    if (retained.length !== document.connections.length) {
      setCodeObjectDocument(store.graph, source.id, {
        ...document,
        connections: retained
      })
    }
  }

  const normalized = [...byId.values()]
  if (JSON.stringify(stored) !== JSON.stringify(normalized)) {
    setObjectGraphConnectionsOnPage(store.graph, pageId, normalized)
    changed = true
  }
  return changed
}

export function codeObjectConnectionDescriptors(
  store: CodeObjectConnectionStore,
  actorFrameId: string
): CodeObjectConnection[] {
  normalizeLegacyCodeObjectConnections(store)
  return objectGraphConnectionsOnPage(store.graph, store.state.currentPageId).flatMap(
    (connection) => {
      if (
        connection.sourceNodeId !== actorFrameId ||
        connection.kind !== 'data' ||
        !connection.permissions.includes('target.data.write')
      ) {
        return []
      }
      return [
        {
          id: connection.id,
          label: connection.label,
          permissions: ['state.write'],
          targetFrameId: connection.targetNodeId
        }
      ]
    }
  )
}
