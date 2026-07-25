import { randomHex } from '@open-pencil/core/random'

import type { EditorStore } from '@/app/editor/active-store'
import {
  reactShapeDocument as codeObjectDocument,
  reactShapePluginData as codeObjectPluginData,
  updateReactShapeState as updateCodeObjectState,
  type ReactShapeDocument as CodeObjectDocument,
  type ReactShapeState as CodeObjectState
} from '@/app/code-object/implementation'

import type {
  CodeObjectActionDenialReason,
  CodeObjectActionReceipt,
  CodeObjectBoardAction,
  CodeObjectConnection
} from './contracts'

const MAX_CONNECTIONS = 32
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

function jsonRecord(value: unknown): Record<string, unknown> | null {
  try {
    const serialized = JSON.stringify(value)
    if (!serialized || serialized.length > MAX_PATCH_CHARACTERS) return null
    const parsed: unknown = JSON.parse(serialized)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

function stateWithPatch(
  document: CodeObjectDocument,
  patch: Record<string, unknown>
): CodeObjectState {
  return {
    ...structuredClone(document.state),
    ...structuredClone(patch)
  } as CodeObjectState
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
  if (
    !actor ||
    !target ||
    !actorDocument ||
    !targetDocument ||
    actor.id === target.id ||
    actor.parentId !== target.parentId ||
    actorDocument.connections.length >= MAX_CONNECTIONS
  ) {
    return null
  }

  const existing = actorDocument.connections.find(
    (connection) => connection.targetFrameId === target.id
  )
  if (existing) return existing

  const connection: CodeObjectConnection = {
    id: `connection:${randomHex(8)}`,
    label: (label?.trim() || target.name || targetDocument.name).slice(0, 80),
    permissions: ['state.write'],
    targetFrameId: target.id
  }
  const nextDocument: CodeObjectDocument = {
    ...actorDocument,
    connections: [...actorDocument.connections, connection]
  }
  store.updateNodeWithUndo(
    actor.id,
    { pluginData: codeObjectPluginData(actor, nextDocument) },
    'Connect Code Objects'
  )
  return connection
}

export function disconnectCodeObjects(
  store: EditorStore,
  actorFrameId: string,
  connectionId: string
): boolean {
  const actor = store.graph.getNode(actorFrameId)
  const document = codeObjectDocument(actor)
  if (!actor || !document) return false
  const connections = document.connections.filter((connection) => connection.id !== connectionId)
  if (connections.length === document.connections.length) return false
  store.updateNodeWithUndo(
    actor.id,
    {
      pluginData: codeObjectPluginData(actor, {
        ...document,
        connections
      })
    },
    'Disconnect Code Objects'
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

  const connection = actorDocument.connections.find(
    (candidate) => candidate.id === action.connectionId
  )
  if (!connection) {
    return deniedReceipt(id, actorFrameId, action.type, 'connection-missing')
  }
  if (!connection.permissions.includes('state.write')) {
    return deniedReceipt(
      id,
      actorFrameId,
      action.type,
      'permission-denied',
      connection.targetFrameId
    )
  }

  const target = store.graph.getNode(connection.targetFrameId)
  const targetDocument = codeObjectDocument(target)
  if (!target || !targetDocument) {
    return deniedReceipt(
      id,
      actorFrameId,
      action.type,
      'target-missing',
      connection.targetFrameId
    )
  }
  if (actor.parentId !== target.parentId) {
    return deniedReceipt(id, actorFrameId, action.type, 'cross-page', target.id)
  }

  const targetPatch = jsonRecord(action.targetStatePatch)
  const sourcePatch =
    action.sourceStatePatch === undefined ? null : jsonRecord(action.sourceStatePatch)
  if (!targetPatch || (action.sourceStatePatch !== undefined && !sourcePatch)) {
    return deniedReceipt(id, actorFrameId, action.type, 'invalid-payload', target.id)
  }

  try {
    let changed = false
    store.undo.runBatch('Run Code Object action', () => {
      if (sourcePatch) {
        changed =
          updateCodeObjectState(
            store,
            actor.id,
            stateWithPatch(actorDocument, sourcePatch)
          ) || changed
      }
      changed =
        updateCodeObjectState(
          store,
          target.id,
          stateWithPatch(targetDocument, targetPatch)
        ) || changed
    })
    return {
      actionId: id,
      actorFrameId,
      changed,
      status: changed ? 'applied' : 'noop',
      targetFrameId: target.id,
      type: action.type
    }
  } catch {
    return deniedReceipt(id, actorFrameId, action.type, 'action-failed', target.id)
  }
}
