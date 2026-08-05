import {
  objectGraphConnectionsOnPage,
  type ObjectGraphConnection,
  type ObjectGraphSignal
} from '@open-pencil/scene-graph'

import {
  runBoardTargetMutation,
  type BoardPermissionDescriptor,
  type BoardTargetReceipt
} from '@/app/board-permissions'
import type { EditorStore } from '@/app/editor/active-store'
import type { ObjectGraphDelivery, ObjectGraphSignalReceipt } from '@/app/object-graph/contracts'

function denied(
  connection: ObjectGraphConnection,
  reason: ObjectGraphDelivery['reason']
): ObjectGraphDelivery {
  return {
    connectionId: connection.id,
    reason,
    status: 'denied',
    targetNodeId: connection.targetNodeId
  }
}

function deliveryReason(reason: string | undefined) {
  if (reason === 'invalid-payload') return 'invalid-payload' as const
  if (reason === 'target-missing') return 'target-missing' as const
  return 'permission-denied' as const
}

function delivery(
  connection: ObjectGraphConnection,
  receipt: BoardTargetReceipt
): ObjectGraphDelivery {
  return {
    connectionId: connection.id,
    reason: receipt.status === 'denied' ? deliveryReason(receipt.reason) : undefined,
    status: receipt.status,
    targetNodeId: connection.targetNodeId
  }
}

function deliverData(
  store: EditorStore,
  permissions: BoardPermissionDescriptor,
  connection: ObjectGraphConnection,
  value: unknown
): ObjectGraphDelivery {
  if (!connection.permissions.includes('target.data.write')) {
    return denied(connection, 'permission-denied')
  }
  return delivery(
    connection,
    runBoardTargetMutation(store, permissions, {
      connectionId: connection.id,
      sourceNodeId: connection.sourceNodeId,
      targetNodeId: connection.targetNodeId,
      type: 'board.target.data',
      value
    })
  )
}

function deliverAction(
  store: EditorStore,
  permissions: BoardPermissionDescriptor,
  connection: ObjectGraphConnection,
  signal: Extract<ObjectGraphSignal, { kind: 'action' }>
): ObjectGraphDelivery {
  if (!connection.permissions.includes('target.action.execute')) {
    return denied(connection, 'permission-denied')
  }
  return delivery(
    connection,
    runBoardTargetMutation(store, permissions, {
      action: signal.action,
      targetNodeId: connection.targetNodeId,
      type: 'board.target.action'
    })
  )
}

function signalPermissions(
  store: EditorStore,
  sourceNodeId: string,
  outgoing: ObjectGraphConnection[]
): BoardPermissionDescriptor {
  return {
    actorId: sourceNodeId,
    defaultOrigin: { height: 0, width: 0, x: 0, y: 0 },
    labels: {
      create: 'Create connected object',
      delete: 'Delete connected object',
      update: 'Deliver connected signal'
    },
    marker: {
      key: 'source-node-id',
      pluginId: 'openpencil-object-graph',
      value: sourceNodeId
    },
    name: 'Object Graph delivery',
    pageId: store.state.currentPageId,
    permissions: [...new Set(outgoing.flatMap((connection) => connection.permissions))],
    targetNodeIds: outgoing.map((connection) => connection.targetNodeId)
  }
}

export function emitObjectGraphSignal(
  store: EditorStore,
  sourceNodeId: string,
  signal: ObjectGraphSignal
): ObjectGraphSignalReceipt {
  const source = store.graph.getNode(sourceNodeId)
  if (!source || !store.graph.isDescendant(source.id, store.state.currentPageId)) {
    return { changed: false, deliveries: [], signal, sourceNodeId }
  }
  const outgoing = objectGraphConnectionsOnPage(store.graph, store.state.currentPageId).filter(
    (connection) =>
      connection.automatic &&
      connection.kind === signal.kind &&
      connection.sourceNodeId === sourceNodeId
  )
  const permissions = signalPermissions(store, sourceNodeId, outgoing)
  const deliveries = store.undo.runBatch('Send connected signal', () =>
    outgoing.map((connection) =>
      signal.kind === 'data'
        ? deliverData(store, permissions, connection, signal.value)
        : deliverAction(store, permissions, connection, signal)
    )
  )
  const changed = deliveries.some((delivery) => delivery.status === 'applied')
  if (changed) store.requestRender()
  return { changed, deliveries, signal, sourceNodeId }
}
