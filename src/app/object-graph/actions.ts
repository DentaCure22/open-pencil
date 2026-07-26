import { randomHex } from '@open-pencil/core/random'
import {
  objectGraphConnectionById,
  OBJECT_GRAPH_SCHEMA_VERSION,
  objectGraphConnectionsForNode,
  type ObjectGraphConnection,
  type ObjectGraphPermission
} from '@open-pencil/scene-graph'

import type { EditorStore } from '@/app/editor/active-store'
import type {
  ConnectObjectsInput,
  ObjectGraphConnectionSnapshot
} from '@/app/object-graph/contracts'
import { canAddObjectGraphConnection } from '@/app/object-graph/react-flow'
import {
  createObjectGraphConnectionRecord,
  removeObjectGraphConnectionRecord,
  replaceObjectGraphConnectionRecord,
  restoreObjectGraphConnectionRecord,
  snapshotObjectGraphConnectionRecord
} from '@/app/object-graph/records'

const MAX_CONNECTIONS_PER_OBJECT = 64

function connectionPermissions(input: ConnectObjectsInput): ObjectGraphPermission[] {
  if (input.kind === 'action') return ['target.action.execute']
  if (input.kind === 'data') return ['target.data.write']
  return []
}

function isObjectOnCurrentPage(store: EditorStore, nodeId: string): boolean {
  return (
    nodeId !== store.state.currentPageId &&
    store.graph.isDescendant(nodeId, store.state.currentPageId)
  )
}

export function connectObjects(
  store: EditorStore,
  input: ConnectObjectsInput
): ObjectGraphConnection | null {
  const source = store.graph.getNode(input.sourceNodeId)
  const target = store.graph.getNode(input.targetNodeId)
  if (
    !source ||
    !target ||
    source.id === target.id ||
    !isObjectOnCurrentPage(store, source.id) ||
    !isObjectOnCurrentPage(store, target.id) ||
    objectGraphConnectionsForNode(store.graph, store.state.currentPageId, source.id).length >=
      MAX_CONNECTIONS_PER_OBJECT
  ) {
    return null
  }
  const connection: ObjectGraphConnection = {
    automatic: input.automatic ?? input.kind !== 'visual',
    id: `object-connection:${randomHex(8)}`,
    kind: input.kind,
    label: (input.label?.trim() || input.kind).slice(0, 80),
    permissions: connectionPermissions(input),
    schemaVersion: OBJECT_GRAPH_SCHEMA_VERSION,
    sourceNodeId: source.id,
    sourcePort: input.sourcePort ?? 'auto',
    targetNodeId: target.id,
    targetPort: input.targetPort ?? 'auto'
  }
  if (!canAddObjectGraphConnection(store.graph, store.state.currentPageId, connection)) {
    return null
  }

  const previousSelection = new Set(store.state.selectedIds)
  const snapshot = createObjectGraphConnectionRecord(
    store.graph,
    store.state.currentPageId,
    connection
  )
  store.undo.push({
    forward: () => {
      restoreObjectGraphConnectionRecord(store.graph, store.state.currentPageId, snapshot)
      store.select([...previousSelection])
      store.requestRender()
    },
    inverse: () => {
      removeObjectGraphConnectionRecord(store.graph, store.state.currentPageId, snapshot.id)
      store.select([...previousSelection])
      store.requestRender()
    },
    label: `Connect objects with ${connection.kind}`
  })
  store.requestRender()
  return connection
}

export function disconnectObjects(store: EditorStore, connectionNodeId: string): boolean {
  const snapshot = snapshotObjectGraphConnectionRecord(
    store.graph,
    store.state.currentPageId,
    connectionNodeId
  )
  if (!snapshot) return false
  const previousSelection = new Set(store.state.selectedIds)
  removeObjectGraphConnectionRecord(store.graph, store.state.currentPageId, connectionNodeId)
  store.undo.push({
    forward: () => {
      removeObjectGraphConnectionRecord(store.graph, store.state.currentPageId, connectionNodeId)
      store.clearSelection()
      store.requestRender()
    },
    inverse: () => {
      restoreObjectGraphConnectionRecord(store.graph, store.state.currentPageId, snapshot)
      store.select([...previousSelection])
      store.requestRender()
    },
    label: `Disconnect ${snapshot.kind} objects`
  })
  store.clearSelection()
  store.requestRender()
  return true
}

export function reconnectObjects(
  store: EditorStore,
  connectionNodeId: string,
  input: Pick<ConnectObjectsInput, 'sourceNodeId' | 'sourcePort' | 'targetNodeId' | 'targetPort'>
): boolean {
  const current = objectGraphConnectionById(
    store.graph,
    store.state.currentPageId,
    connectionNodeId
  )
  if (!current) return false
  const source = store.graph.getNode(input.sourceNodeId)
  const target = store.graph.getNode(input.targetNodeId)
  if (!source || !target) return false
  const next: ObjectGraphConnection = {
    ...current,
    sourceNodeId: input.sourceNodeId,
    sourcePort: input.sourcePort ?? 'auto',
    targetNodeId: input.targetNodeId,
    targetPort: input.targetPort ?? 'auto'
  }
  if (
    !isObjectOnCurrentPage(store, next.sourceNodeId) ||
    !isObjectOnCurrentPage(store, next.targetNodeId) ||
    !canAddObjectGraphConnection(store.graph, store.state.currentPageId, next, connectionNodeId)
  ) {
    return false
  }
  const previousSelection = new Set(store.state.selectedIds)
  const apply = (connection: ObjectGraphConnection): void => {
    replaceObjectGraphConnectionRecord(store.graph, store.state.currentPageId, connection)
    store.select([...previousSelection])
    store.requestRender()
  }
  apply(next)
  store.undo.push({
    forward: () => apply(next),
    inverse: () => apply(current),
    label: 'Reconnect objects'
  })
  return true
}

export function objectConnectionsForNode(
  store: EditorStore,
  nodeId: string
): ObjectGraphConnectionSnapshot[] {
  return objectGraphConnectionsForNode(store.graph, store.state.currentPageId, nodeId).map(
    (connection) => {
      const outgoing = connection.sourceNodeId === nodeId
      const peerId = outgoing ? connection.targetNodeId : connection.sourceNodeId
      return {
        connection,
        incoming: !outgoing,
        nodeId: connection.id,
        outgoing,
        peerName: store.graph.getNode(peerId)?.name ?? 'Missing object'
      }
    }
  )
}
