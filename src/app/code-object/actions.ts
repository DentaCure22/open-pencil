import { randomHex } from '@open-pencil/core/random'
import {
  objectGraphConnectionById,
  objectGraphConnectionsOnPage,
  type SceneNode
} from '@open-pencil/scene-graph'

import { runBoardMutation, type BoardPermissionDescriptor } from '@/app/board-permissions'
import {
  reactShapeDocument as codeObjectDocument,
  reactShapePluginData as codeObjectPluginData,
  updateReactShapeState as updateCodeObjectState,
  type ReactShapeDocument as CodeObjectDocument,
  type ReactShapeState as CodeObjectState
} from '@/app/code-object/implementation'
import type { EditorStore } from '@/app/editor/active-store'
import { connectObjects, disconnectObjects, emitObjectGraphSignal } from '@/app/object-graph'

import {
  BOARD_SHAPE_ACCESS_PERMISSIONS,
  createOwnedBoardShape,
  deleteOwnedBoardShape,
  updateOwnedBoardShape
} from './board-shapes/actions'
import {
  codeObjectConnectionDescriptors,
  normalizeLegacyCodeObjectConnections
} from './connection-migration'
import type {
  CodeObjectActionDenialReason,
  CodeObjectActionReceipt,
  CodeObjectBoardAction,
  CodeObjectConnection,
  CodeObjectStatePatch,
  CodeObjectStatePatchAction
} from './contracts'

export { createCodeObjectBoardClient } from './board-shapes/actions'

const MAX_PATCH_CHARACTERS = 128_000

type DispatchCodeObjectBoardActionOptions = {
  interactionEnabled: boolean
}

function actionId(): string {
  return `code-action:${randomHex(8)}`
}

function deniedReceipt(
  id: string,
  actorFrameId: string,
  type: CodeObjectBoardAction['type'],
  reason: CodeObjectActionDenialReason,
  targetFrameId?: string
): CodeObjectActionReceipt {
  return {
    actionId: id,
    actorFrameId,
    changed: false,
    reason,
    status: 'denied',
    targetFrameId,
    type
  }
}

function actionStatus(changed: boolean, denied: boolean): CodeObjectActionReceipt['status'] {
  if (changed) return 'applied'
  return denied ? 'denied' : 'noop'
}

function isCodeObjectStatePatch(value: unknown): value is CodeObjectStatePatch {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function jsonRecord(value: unknown): CodeObjectStatePatch | null {
  try {
    const serialized = JSON.stringify(value)
    if (!serialized || serialized.length > MAX_PATCH_CHARACTERS) return null
    const parsed: unknown = JSON.parse(serialized)
    return isCodeObjectStatePatch(parsed) ? parsed : null
  } catch {
    return null
  }
}

function stateWithPatch(
  document: CodeObjectDocument,
  patch: CodeObjectStatePatch
): CodeObjectState {
  return {
    ...structuredClone(document.state),
    ...structuredClone(patch)
  } as CodeObjectState
}

function targetStatePermissions(actor: SceneNode, targetNodeId: string) {
  if (!actor.parentId) return null
  const descriptor: BoardPermissionDescriptor = {
    actorId: actor.id,
    defaultOrigin: { height: actor.height, width: actor.width, x: actor.x, y: actor.y },
    labels: {
      create: 'Create connected Code Object',
      delete: 'Delete connected Code Object',
      update: 'Update connected Code Object state'
    },
    marker: {
      key: 'source-frame-id',
      pluginId: 'openpencil-object-graph',
      value: actor.id
    },
    name: 'Connected Code Object state',
    pageId: actor.parentId,
    permissions: ['target.state.write'],
    targetNodeIds: [targetNodeId]
  }
  return descriptor
}

function patchConnectedCodeObjectState(
  store: EditorStore,
  actor: SceneNode,
  actorDocument: CodeObjectDocument,
  action: CodeObjectStatePatchAction,
  id: string
): CodeObjectActionReceipt {
  normalizeLegacyCodeObjectConnections(store)
  const connection = objectGraphConnectionById(
    store.graph,
    store.state.currentPageId,
    action.connectionId
  )
  if (!connection || connection.sourceNodeId !== actor.id || connection.kind !== 'data') {
    return deniedReceipt(id, actor.id, action.type, 'connection-missing')
  }
  if (!connection.permissions.includes('target.data.write')) {
    return deniedReceipt(id, actor.id, action.type, 'permission-denied', connection.targetNodeId)
  }

  const target = store.graph.getNode(connection.targetNodeId)
  const targetDocument = codeObjectDocument(target)
  if (!target || !targetDocument) {
    return deniedReceipt(id, actor.id, action.type, 'target-missing', connection.targetNodeId)
  }
  if (actor.parentId !== target.parentId) {
    return deniedReceipt(id, actor.id, action.type, 'cross-page', target.id)
  }

  const targetPatch = jsonRecord(action.targetStatePatch)
  const sourcePatch =
    action.sourceStatePatch === undefined ? null : jsonRecord(action.sourceStatePatch)
  if (!targetPatch || (action.sourceStatePatch !== undefined && !sourcePatch)) {
    return deniedReceipt(id, actor.id, action.type, 'invalid-payload', target.id)
  }

  const permissions = targetStatePermissions(actor, target.id)
  if (!permissions) return deniedReceipt(id, actor.id, action.type, 'permission-denied', target.id)
  try {
    const outcome = store.undo.runBatch('Run Code Object action', () => {
      return runBoardMutation(
        store,
        permissions,
        ['target.state.write'],
        () => {
          const targetChanged = updateCodeObjectState(store, target.id, {
            ...structuredClone(targetDocument.state),
            ...structuredClone(targetPatch)
          })
          const sourceChanged = sourcePatch
            ? updateCodeObjectState(store, actor.id, stateWithPatch(actorDocument, sourcePatch))
            : false
          return targetChanged || sourceChanged
        },
        target.id
      )
    })
    if (outcome.status === 'denied') {
      return deniedReceipt(
        id,
        actor.id,
        action.type,
        outcome.reason as CodeObjectActionDenialReason,
        target.id
      )
    }
    const changed = outcome.result
    return {
      actionId: id,
      actorFrameId: actor.id,
      changed,
      status: changed ? 'applied' : 'noop',
      targetFrameId: target.id,
      targetNodeId: target.id,
      type: action.type
    }
  } catch {
    return deniedReceipt(id, actor.id, action.type, 'action-failed', target.id)
  }
}

export function connectCodeObjects(
  store: EditorStore,
  actorFrameId: string,
  targetFrameId: string,
  label?: string
): CodeObjectConnection | null {
  const actor = store.graph.getNode(actorFrameId)
  const target = store.graph.getNode(targetFrameId)
  const actorDocument = codeObjectDocument(actor)
  const targetDocument = codeObjectDocument(target)
  normalizeLegacyCodeObjectConnections(store)
  if (
    !actor ||
    !target ||
    !actorDocument ||
    !targetDocument ||
    actor.id === target.id ||
    actor.parentId !== target.parentId
  ) {
    return null
  }

  const existing = objectGraphConnectionsOnPage(store.graph, store.state.currentPageId).find(
    (connection) =>
      connection.sourceNodeId === actor.id &&
      connection.targetNodeId === target.id &&
      connection.kind === 'data'
  )
  if (existing) {
    return {
      id: existing.id,
      label: existing.label,
      permissions: existing.permissions.includes('target.data.write') ? ['state.write'] : [],
      targetFrameId: existing.targetNodeId
    }
  }

  let connection: CodeObjectConnection | null = null
  store.undo.runBatch('Connect Code Objects', () => {
    const graphConnection = connectObjects(store, {
      kind: 'data',
      label: label?.trim() || target.name || targetDocument.name,
      sourceNodeId: actor.id,
      targetNodeId: target.id
    })
    if (!graphConnection) return
    connection = {
      id: graphConnection.id,
      label: (label?.trim() || target.name || targetDocument.name).slice(0, 80),
      permissions: ['state.write'],
      targetFrameId: target.id
    }
  })
  return connection
}

export { codeObjectConnectionDescriptors }

export function disconnectCodeObjects(
  store: EditorStore,
  actorFrameId: string,
  connectionId: string
): boolean {
  normalizeLegacyCodeObjectConnections(store)
  const actor = store.graph.getNode(actorFrameId)
  const connection = objectGraphConnectionById(store.graph, store.state.currentPageId, connectionId)
  if (!actor || !codeObjectDocument(actor) || connection?.sourceNodeId !== actor.id) return false
  return disconnectObjects(store, connectionId)
}

export function setCodeObjectBoardShapeAccess(
  store: EditorStore,
  actorFrameId: string,
  enabled: boolean
): boolean {
  const actor = store.graph.getNode(actorFrameId)
  const document = codeObjectDocument(actor)
  if (!actor || !document) return false
  const boardPermissions = enabled
    ? [...new Set([...document.boardPermissions, ...BOARD_SHAPE_ACCESS_PERMISSIONS])]
    : document.boardPermissions.filter(
        (permission) => !BOARD_SHAPE_ACCESS_PERMISSIONS.includes(permission)
      )
  if (JSON.stringify(boardPermissions) === JSON.stringify(document.boardPermissions)) return false
  store.updateNodeWithUndo(
    actor.id,
    {
      pluginData: codeObjectPluginData(actor, {
        ...document,
        boardPermissions
      })
    },
    enabled ? 'Allow Code Object board shapes' : 'Revoke Code Object board shapes'
  )
  return true
}

export function dispatchCodeObjectBoardAction(
  store: EditorStore,
  actorFrameId: string,
  action: CodeObjectBoardAction,
  options: DispatchCodeObjectBoardActionOptions
): CodeObjectActionReceipt {
  const id = actionId()
  if (!options.interactionEnabled) {
    return deniedReceipt(id, actorFrameId, action.type, 'interaction-required')
  }

  const actor = store.graph.getNode(actorFrameId)
  const actorDocument = codeObjectDocument(actor)
  if (!actor || !actorDocument) {
    return deniedReceipt(id, actorFrameId, action.type, 'source-missing')
  }

  if (action.type === 'code-object.state.patch') {
    return patchConnectedCodeObjectState(store, actor, actorDocument, action, id)
  }
  if (action.type === 'code-object.graph.emit') {
    const receipt = emitObjectGraphSignal(store, actor.id, action.signal)
    const denied = receipt.deliveries.find((delivery) => delivery.status === 'denied')
    return {
      actionId: id,
      actorFrameId: actor.id,
      changed: receipt.changed,
      reason: denied?.reason,
      status: actionStatus(receipt.changed, Boolean(denied)),
      targetNodeIds: receipt.deliveries.map((delivery) => delivery.targetNodeId),
      type: action.type
    }
  }
  if (action.type === 'code-object.board-shape.create') {
    return createOwnedBoardShape(store, actor, action, id)
  }
  if (action.type === 'code-object.board-shape.update') {
    return updateOwnedBoardShape(store, actor, action, id)
  }
  return deleteOwnedBoardShape(store, actor, action, id)
}
