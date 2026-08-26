import type { SceneNode } from '@open-pencil/scene-graph'

import { BOARD_SHAPE_PERMISSIONS, type BoardPermissionDescriptor } from '@/app/board-permissions'
import type { EditorStore } from '@/app/editor/active-store'

import {
  CODE_OBJECT_BOARD_API_VERSION,
  type CodeObjectActionReceipt,
  type CodeObjectBoardClient,
  type CodeObjectBoardPermission,
  type CodeObjectCreateBoardShapeAction,
  type CodeObjectDeleteBoardShapeAction,
  type CodeObjectUpdateBoardShapeAction,
  type DispatchCodeObjectBoardAction
} from '../contracts'
import { codeObjectDocument } from '../implementation'
import {
  dispatchOwnedBoardShapeAction,
  ownedBoardShapeSnapshots,
  type OwnedBoardShapeAction,
  type OwnedBoardShapeReceipt
} from './owned'

const CODE_OBJECT_OWNER_PLUGIN_KEY = 'board-owner-frame-id'
export const BOARD_SHAPE_ACCESS_PERMISSIONS: CodeObjectBoardPermission[] = [
  ...BOARD_SHAPE_PERMISSIONS
]

function codeObjectOwner(actor: SceneNode): BoardPermissionDescriptor | null {
  const document = codeObjectDocument(actor)
  if (!actor.parentId || !document) return null
  return {
    actorId: actor.id,
    defaultOrigin: {
      height: actor.height,
      width: actor.width,
      x: actor.x,
      y: actor.y
    },
    labels: {
      create: 'Create Code Object board shape',
      delete: 'Delete Code Object board shape',
      update: 'Update Code Object board shape'
    },
    marker: {
      key: CODE_OBJECT_OWNER_PLUGIN_KEY,
      pluginId: 'openpencil-code-object',
      value: actor.id
    },
    name: actor.name,
    pageId: actor.parentId,
    permissions: structuredClone(document.boardPermissions)
  }
}

function codeObjectReceipt(
  receipt: OwnedBoardShapeReceipt,
  type:
    | CodeObjectCreateBoardShapeAction['type']
    | CodeObjectDeleteBoardShapeAction['type']
    | CodeObjectUpdateBoardShapeAction['type']
): CodeObjectActionReceipt {
  return {
    actionId: receipt.actionId,
    actorFrameId: receipt.actorId,
    changed: receipt.changed,
    reason: receipt.reason,
    shape: receipt.shape,
    status: receipt.status,
    targetNodeId: receipt.targetNodeId,
    type
  }
}

function missingOwnerReceipt(
  actor: SceneNode,
  id: string,
  type: CodeObjectActionReceipt['type']
): CodeObjectActionReceipt {
  return {
    actionId: id,
    actorFrameId: actor.id,
    changed: false,
    reason: 'source-missing',
    status: 'denied',
    type
  }
}

function dispatchShapeAction(
  store: EditorStore,
  actor: SceneNode,
  action: OwnedBoardShapeAction,
  id: string,
  codeObjectType:
    | CodeObjectCreateBoardShapeAction['type']
    | CodeObjectDeleteBoardShapeAction['type']
    | CodeObjectUpdateBoardShapeAction['type']
): CodeObjectActionReceipt {
  const owner = codeObjectOwner(actor)
  if (!owner) return missingOwnerReceipt(actor, id, codeObjectType)
  return codeObjectReceipt(dispatchOwnedBoardShapeAction(store, owner, action, id), codeObjectType)
}

export function createOwnedBoardShape(
  store: EditorStore,
  actor: SceneNode,
  action: CodeObjectCreateBoardShapeAction,
  id: string
): CodeObjectActionReceipt {
  return dispatchShapeAction(
    store,
    actor,
    { shape: action.shape, type: 'board.shape.create' },
    id,
    action.type
  )
}

export function updateOwnedBoardShape(
  store: EditorStore,
  actor: SceneNode,
  action: CodeObjectUpdateBoardShapeAction,
  id: string
): CodeObjectActionReceipt {
  return dispatchShapeAction(
    store,
    actor,
    {
      changes: action.changes,
      shapeId: action.shapeId,
      type: 'board.shape.update'
    },
    id,
    action.type
  )
}

export function deleteOwnedBoardShape(
  store: EditorStore,
  actor: SceneNode,
  action: CodeObjectDeleteBoardShapeAction,
  id: string
): CodeObjectActionReceipt {
  return dispatchShapeAction(
    store,
    actor,
    { shapeId: action.shapeId, type: 'board.shape.delete' },
    id,
    action.type
  )
}

function codeObjectBoardSnapshot(
  store: EditorStore,
  actor: SceneNode | undefined
): Pick<CodeObjectBoardClient, 'permissions' | 'shapes'> {
  if (!actor) return { permissions: [], shapes: [] }
  const owner = codeObjectOwner(actor)
  if (!owner) return { permissions: [], shapes: [] }
  return {
    permissions: structuredClone(owner.permissions),
    shapes: ownedBoardShapeSnapshots(store, owner)
  }
}

export function createCodeObjectBoardClient(
  store: EditorStore,
  actorFrameId: string,
  dispatch: DispatchCodeObjectBoardAction
): CodeObjectBoardClient {
  const actor = store.graph.getNode(actorFrameId)
  const { permissions, shapes } = codeObjectBoardSnapshot(store, actor)
  return {
    apiVersion: CODE_OBJECT_BOARD_API_VERSION,
    createShape: (shape) =>
      dispatch({
        shape,
        type: 'code-object.board-shape.create'
      }),
    deleteShape: (shapeId) =>
      dispatch({
        shapeId,
        type: 'code-object.board-shape.delete'
      }),
    permissions,
    self: {
      height: actor?.height ?? 0,
      id: actor?.id ?? actorFrameId,
      name: actor?.name ?? 'Code Object',
      rotation: actor?.rotation ?? 0,
      width: actor?.width ?? 0,
      x: actor?.x ?? 0,
      y: actor?.y ?? 0
    },
    shapes,
    updateShape: (shapeId, changes) =>
      dispatch({
        changes,
        shapeId,
        type: 'code-object.board-shape.update'
      })
  }
}
