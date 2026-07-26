import { randomHex } from '@open-pencil/core/random'
import {
  objectGraphInputPluginData,
  type ObjectGraphAction,
  type SceneNode
} from '@open-pencil/scene-graph'

import {
  reactShapeDocument as codeObjectDocument,
  updateReactShapeState as updateCodeObjectState
} from '@/app/code-object/implementation'
import type { EditorStore } from '@/app/editor/active-store'

import type {
  BoardAuthorityDenialReason,
  BoardAuthorityGrant,
  BoardTargetAction,
  BoardTargetReceipt
} from './contracts'
import { isBoardAuthorityGrantActive } from './grants'

const MAX_TARGET_DATA_CHARACTERS = 64_000

function actionId(): string {
  return `board-action:${randomHex(8)}`
}

function deniedReceipt(
  id: string,
  grant: BoardAuthorityGrant,
  action: BoardTargetAction,
  reason: BoardAuthorityDenialReason
): BoardTargetReceipt {
  return {
    actionId: id,
    actorId: grant.actorId,
    apiVersion: grant.apiVersion,
    changed: false,
    grantId: grant.grantId,
    reason,
    status: 'denied',
    targetNodeId: action.targetNodeId,
    type: action.type
  }
}

function targetNode(
  store: EditorStore,
  grant: BoardAuthorityGrant,
  action: BoardTargetAction,
  id: string
): SceneNode | BoardTargetReceipt {
  if (!isBoardAuthorityGrantActive(store, grant)) {
    return deniedReceipt(id, grant, action, 'grant-invalid')
  }
  if (!grant.targetNodeIds?.includes(action.targetNodeId)) {
    return deniedReceipt(id, grant, action, 'capability-denied')
  }
  const target = store.graph.getNode(action.targetNodeId)
  if (!target || !store.graph.isDescendant(target.id, grant.pageId)) {
    return deniedReceipt(id, grant, action, 'target-missing')
  }
  return target
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

function serializableRecord(
  value: unknown
): { valid: true; value: Record<string, unknown> } | { valid: false } {
  const parsed = serializableValue(value)
  if (!parsed.valid || !isRecord(parsed.value)) {
    return { valid: false }
  }
  return { valid: true, value: parsed.value }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function appliedReceipt(
  id: string,
  grant: BoardAuthorityGrant,
  action: BoardTargetAction,
  changed: boolean
): BoardTargetReceipt {
  return {
    actionId: id,
    actorId: grant.actorId,
    apiVersion: grant.apiVersion,
    changed,
    grantId: grant.grantId,
    status: changed ? 'applied' : 'noop',
    targetNodeId: action.targetNodeId,
    type: action.type
  }
}

export function dispatchBoardTargetAction(
  store: EditorStore,
  grant: BoardAuthorityGrant,
  action: BoardTargetAction,
  id = actionId()
): BoardTargetReceipt {
  const target = targetNode(store, grant, action, id)
  if ('status' in target) return target

  if (action.type === 'board.target.action') {
    if (!grant.permissions.includes('target.action.execute')) {
      return deniedReceipt(id, grant, action, 'capability-denied')
    }
    const changes = actionChanges(target, action.action)
    if (!changes) return appliedReceipt(id, grant, action, false)
    store.updateNodeWithUndo(target.id, changes, grant.labels.update)
    return appliedReceipt(id, grant, action, true)
  }

  if (action.type === 'board.target.state') {
    if (
      !grant.permissions.includes('target.state.write') ||
      action.sourceNodeId !== grant.actorId
    ) {
      return deniedReceipt(id, grant, action, 'capability-denied')
    }
    const patch = serializableRecord(action.patch)
    const document = codeObjectDocument(target)
    if (!patch.valid || !document) {
      return deniedReceipt(id, grant, action, 'invalid-payload')
    }
    const changed = updateCodeObjectState(store, target.id, {
      ...structuredClone(document.state),
      ...structuredClone(patch.value)
    })
    return appliedReceipt(id, grant, action, changed)
  }

  if (!grant.permissions.includes('target.data.write') || action.sourceNodeId !== grant.actorId) {
    return deniedReceipt(id, grant, action, 'capability-denied')
  }
  const parsed = serializableValue(action.value)
  if (!parsed.valid) return deniedReceipt(id, grant, action, 'invalid-payload')
  const pluginData = objectGraphInputPluginData(target, {
    connectionId: action.connectionId,
    sourceNodeId: action.sourceNodeId,
    value: parsed.value
  })
  if (JSON.stringify(pluginData) === JSON.stringify(target.pluginData)) {
    return appliedReceipt(id, grant, action, false)
  }
  store.updateNodeWithUndo(target.id, { pluginData }, grant.labels.update)
  return appliedReceipt(id, grant, action, true)
}
