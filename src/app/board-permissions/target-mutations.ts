import { randomHex } from '@open-pencil/core/random'
import {
  objectGraphInputPluginData,
  type ObjectGraphAction,
  type SceneNode
} from '@open-pencil/scene-graph'

import type { EditorStore } from '@/app/editor/active-store'

import type {
  BoardMutationReceipt,
  BoardPermission,
  BoardPermissionDenialReason,
  BoardPermissionDescriptor
} from './contracts'
import { runBoardMutation } from './run'

const MAX_TARGET_DATA_CHARACTERS = 64_000

export type BoardTargetMutation =
  | {
      action: ObjectGraphAction
      targetNodeId: string
      type: 'board.target.action'
    }
  | {
      connectionId: string
      sourceNodeId: string
      targetNodeId: string
      type: 'board.target.data'
      value: unknown
    }

export type BoardTargetReceipt = BoardMutationReceipt<
  BoardTargetMutation['type'],
  BoardPermissionDenialReason | 'invalid-payload'
>

function actionId(): string {
  return `board-action:${randomHex(8)}`
}

function requiredPermission(action: BoardTargetMutation): BoardPermission {
  return action.type === 'board.target.action' ? 'target.action.execute' : 'target.data.write'
}

function deniedReceipt(
  id: string,
  descriptor: BoardPermissionDescriptor,
  action: BoardTargetMutation,
  reason: BoardPermissionDenialReason | 'invalid-payload'
): BoardTargetReceipt {
  return {
    actionId: id,
    actorId: descriptor.actorId,
    changed: false,
    reason,
    status: 'denied',
    targetNodeId: action.targetNodeId,
    type: action.type
  }
}

function actionChanges(node: SceneNode, action: ObjectGraphAction): Partial<SceneNode> | null {
  if (action.type === 'hide') return node.visible ? { visible: false } : null
  if (action.type === 'show') return node.visible ? null : { visible: true }
  if (action.type === 'toggle-opacity') {
    return { opacity: node.opacity > 0.7 ? 0.4 : 1 }
  }
  if (!Number.isFinite(action.opacity)) return null
  const opacity = Math.max(0, Math.min(1, action.opacity))
  return opacity === node.opacity ? null : { opacity }
}

function serializableValue(value: unknown): { valid: true; value: unknown } | { valid: false } {
  try {
    const serialized = JSON.stringify(value)
    if (!serialized || serialized.length > MAX_TARGET_DATA_CHARACTERS) return { valid: false }
    return { valid: true, value: JSON.parse(serialized) as unknown }
  } catch {
    return { valid: false }
  }
}

function appliedReceipt(
  id: string,
  descriptor: BoardPermissionDescriptor,
  action: BoardTargetMutation,
  changed: boolean
): BoardTargetReceipt {
  return {
    actionId: id,
    actorId: descriptor.actorId,
    changed,
    status: changed ? 'applied' : 'noop',
    targetNodeId: action.targetNodeId,
    type: action.type
  }
}

export function runBoardTargetMutation(
  store: EditorStore,
  descriptor: BoardPermissionDescriptor,
  action: BoardTargetMutation,
  id = actionId()
): BoardTargetReceipt {
  const permission = runBoardMutation(
    store,
    descriptor,
    [requiredPermission(action)],
    () => store.graph.getNode(action.targetNodeId),
    action.targetNodeId
  )
  if (permission.status === 'denied') {
    return deniedReceipt(id, descriptor, action, permission.reason)
  }
  const target = permission.result
  if (!target) return deniedReceipt(id, descriptor, action, 'target-missing')

  if (action.type === 'board.target.action') {
    const changes = actionChanges(target, action.action)
    if (!changes) return appliedReceipt(id, descriptor, action, false)
    store.updateNodeWithUndo(target.id, changes, descriptor.labels.update)
    return appliedReceipt(id, descriptor, action, true)
  }

  if (action.sourceNodeId !== descriptor.actorId) {
    return deniedReceipt(id, descriptor, action, 'capability-denied')
  }
  const parsed = serializableValue(action.value)
  if (!parsed.valid) return deniedReceipt(id, descriptor, action, 'invalid-payload')
  const pluginData = objectGraphInputPluginData(target, {
    connectionId: action.connectionId,
    sourceNodeId: action.sourceNodeId,
    value: parsed.value
  })
  if (JSON.stringify(pluginData) === JSON.stringify(target.pluginData)) {
    return appliedReceipt(id, descriptor, action, false)
  }
  store.updateNodeWithUndo(target.id, { pluginData }, descriptor.labels.update)
  return appliedReceipt(id, descriptor, action, true)
}
