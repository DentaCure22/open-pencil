import { randomHex } from '@open-pencil/core/random'

import { codeObjectDocument, codeObjectPluginData } from '@/app/code-object/implementation'
import type { EditorStore } from '@/app/editor/active-store'

import {
  BOARD_SHAPE_ACCESS_PERMISSIONS,
  createOwnedBoardShape,
  deleteOwnedBoardShape,
  updateOwnedBoardShape
} from './board-shapes/actions'
import type {
  CodeObjectActionDenialReason,
  CodeObjectActionReceipt,
  CodeObjectBoardAction
} from './contracts'

export { createCodeObjectBoardClient } from './board-shapes/actions'

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
  if (!actor || !codeObjectDocument(actor)) {
    return deniedReceipt(id, actorFrameId, action.type, 'source-missing')
  }

  if (action.type === 'code-object.board-shape.create') {
    return createOwnedBoardShape(store, actor, action, id)
  }
  if (action.type === 'code-object.board-shape.update') {
    return updateOwnedBoardShape(store, actor, action, id)
  }
  return deleteOwnedBoardShape(store, actor, action, id)
}
