import { colorToHex, parseColor } from '@open-pencil/core/color'
import { randomHex } from '@open-pencil/core/random'
import type { SceneNode } from '@open-pencil/scene-graph'

import {
  boardNodeMatchesOwner,
  deleteBoardLeaf,
  normalizeBoardAppearanceChanges,
  normalizeBoardGeometryChanges,
  normalizeOwnedBoardGeometry,
  runBoardMutation,
  type BoardMutationReceipt,
  type BoardPermission,
  type BoardPermissionContext,
  type BoardPermissionDenialReason,
  type BoardPermissionDescriptor
} from '@/app/board-permissions'
import type { EditorStore } from '@/app/editor/active-store'

import type {
  CodeObjectBoardShapeKind,
  CodeObjectBoardShapeSnapshot,
  CodeObjectCreateBoardShapeInput,
  CodeObjectUpdateBoardShapeInput
} from '../contracts'

export type OwnedBoardShapeAction =
  | { shape: CodeObjectCreateBoardShapeInput; type: 'board.shape.create' }
  | { changes: CodeObjectUpdateBoardShapeInput; shapeId: string; type: 'board.shape.update' }
  | { shapeId: string; type: 'board.shape.delete' }

export type OwnedBoardShapeDenialReason =
  | BoardPermissionDenialReason
  | 'action-failed'
  | 'invalid-payload'
  | 'shape-limit'
  | 'shape-not-owned'

export type OwnedBoardShapeReceipt = BoardMutationReceipt<
  OwnedBoardShapeAction['type'],
  OwnedBoardShapeDenialReason
> & {
  shape?: CodeObjectBoardShapeSnapshot
}

const DEFAULT_MAX_OWNED_SHAPES = 24

type NormalizedBoardShapeInput = {
  fill: string
  height: number
  kind: CodeObjectBoardShapeKind
  name: string
  width: number
  x: number
  y: number
}

function actionId(): string {
  return `board-action:${randomHex(8)}`
}

function deniedReceipt(
  id: string,
  owner: Pick<BoardPermissionDescriptor, 'actorId'>,
  type: OwnedBoardShapeAction['type'],
  reason: OwnedBoardShapeDenialReason,
  targetNodeId?: string
): OwnedBoardShapeReceipt {
  return {
    actionId: id,
    actorId: owner.actorId,
    changed: false,
    reason,
    status: 'denied',
    targetNodeId,
    type
  }
}

function boardShapeKind(node: SceneNode): CodeObjectBoardShapeKind | null {
  if (node.type === 'RECTANGLE') return 'rectangle'
  if (node.type === 'ELLIPSE') return 'ellipse'
  return null
}

function boardShapeSnapshot(node: SceneNode): CodeObjectBoardShapeSnapshot | null {
  const kind = boardShapeKind(node)
  if (!kind) return null
  const fill = node.fills.find((candidate) => candidate.type === 'SOLID')
  return {
    fill: fill?.type === 'SOLID' ? colorToHex(fill.color) : '#8B5CF6',
    height: node.height,
    id: node.id,
    kind,
    name: node.name,
    opacity: node.opacity,
    rotation: node.rotation,
    visible: node.visible,
    width: node.width,
    x: node.x,
    y: node.y
  }
}

function ownedShapeSnapshots(
  store: EditorStore,
  owner: BoardPermissionContext
): CodeObjectBoardShapeSnapshot[] {
  return store.graph
    .getChildren(owner.pageId)
    .filter((node) => boardNodeMatchesOwner(node, owner))
    .flatMap((node) => {
      const snapshot = boardShapeSnapshot(node)
      return snapshot ? [snapshot] : []
    })
}

export function ownedBoardShapeSnapshots(
  store: EditorStore,
  owner: BoardPermissionDescriptor
): CodeObjectBoardShapeSnapshot[] {
  const permission = runBoardMutation(store, owner, [], (context) =>
    ownedShapeSnapshots(store, context)
  )
  return permission.status === 'allowed' ? permission.result : []
}

function validFill(value: unknown, fallback = '#8B5CF6'): string | null {
  const resolved = value === undefined ? fallback : value
  return typeof resolved === 'string' && /^#[\da-f]{6}$/i.test(resolved)
    ? resolved.toUpperCase()
    : null
}

function normalizeBoardShapeInput(
  owner: BoardPermissionContext,
  input: CodeObjectCreateBoardShapeInput,
  ownedCount: number
): NormalizedBoardShapeInput | null {
  const geometry = normalizeOwnedBoardGeometry(owner, input, ownedCount)
  const fill = validFill(input.fill)
  if (!geometry || !fill) return null
  if (input.name !== undefined && typeof input.name !== 'string') return null
  return {
    fill,
    ...geometry,
    kind: input.kind,
    name: (input.name?.trim() || 'Board shape').slice(0, 120)
  }
}

function requiredShapeUpdatePermissions(input: CodeObjectUpdateBoardShapeInput): BoardPermission[] {
  const permissions = new Set<BoardPermission>()
  if (
    input.x !== undefined ||
    input.y !== undefined ||
    input.width !== undefined ||
    input.height !== undefined ||
    input.rotation !== undefined
  ) {
    permissions.add('shape.update.geometry')
  }
  if (
    input.fill !== undefined ||
    input.name !== undefined ||
    input.opacity !== undefined ||
    input.visible !== undefined
  ) {
    permissions.add('shape.update.appearance')
  }
  return [...permissions]
}

function ownerPluginData(node: SceneNode, owner: BoardPermissionContext): SceneNode['pluginData'] {
  return [
    ...node.pluginData.filter(
      (entry) => entry.pluginId !== owner.marker.pluginId || entry.key !== owner.marker.key
    ),
    {
      key: owner.marker.key,
      pluginId: owner.marker.pluginId,
      value: owner.marker.value
    }
  ]
}

function createOwnedBoardShape(
  store: EditorStore,
  owner: BoardPermissionContext,
  action: Extract<OwnedBoardShapeAction, { type: 'board.shape.create' }>,
  id: string
): OwnedBoardShapeReceipt {
  const owned = ownedShapeSnapshots(store, owner)
  if (owned.length >= (owner.maxShapes ?? DEFAULT_MAX_OWNED_SHAPES)) {
    return deniedReceipt(id, owner, action.type, 'shape-limit')
  }
  const input = normalizeBoardShapeInput(owner, action.shape, owned.length)
  if (!input || !store.graph.getNode(owner.pageId)) {
    return deniedReceipt(id, owner, action.type, 'invalid-payload')
  }

  try {
    let createdId = ''
    store.undo.runBatch(owner.labels.create, () => {
      createdId = store.createShape(
        input.kind === 'ellipse' ? 'ELLIPSE' : 'RECTANGLE',
        input.x,
        input.y,
        input.width,
        input.height,
        owner.pageId
      )
      const created = store.graph.getNode(createdId)
      if (!created) throw new Error('Created board shape was unavailable')
      store.updateNodeWithUndo(
        created.id,
        {
          fills: [
            {
              color: parseColor(input.fill),
              opacity: 1,
              type: 'SOLID',
              visible: true
            }
          ],
          name: input.name,
          pluginData: ownerPluginData(created, owner)
        },
        owner.labels.create
      )
    })
    const created = store.graph.getNode(createdId)
    const shape = created ? boardShapeSnapshot(created) : null
    if (!shape) return deniedReceipt(id, owner, action.type, 'action-failed', createdId)
    return {
      actionId: id,
      actorId: owner.actorId,
      changed: true,
      shape,
      status: 'applied',
      targetNodeId: shape.id,
      type: action.type
    }
  } catch {
    return deniedReceipt(id, owner, action.type, 'action-failed')
  }
}

function ownedTarget(
  store: EditorStore,
  owner: BoardPermissionContext,
  shapeId: string
): SceneNode | null {
  const target = store.graph.getNode(shapeId)
  if (!target || target.parentId !== owner.pageId || !boardShapeKind(target)) return null
  return boardNodeMatchesOwner(target, owner) ? target : null
}

function ownedActionTarget(
  store: EditorStore,
  owner: BoardPermissionContext,
  action: Extract<OwnedBoardShapeAction, { shapeId: string }>,
  id: string
): SceneNode | OwnedBoardShapeReceipt {
  const target = ownedTarget(store, owner, action.shapeId)
  return (
    target ??
    deniedReceipt(
      id,
      owner,
      action.type,
      store.graph.getNode(action.shapeId) ? 'shape-not-owned' : 'target-missing',
      action.shapeId
    )
  )
}

function normalizeAppearanceChanges(
  input: CodeObjectUpdateBoardShapeInput
): Partial<SceneNode> | null {
  const changes = normalizeBoardAppearanceChanges(input, 'Board shape')
  if (!changes) return null
  if (input.fill !== undefined) {
    const fill = validFill(input.fill)
    if (!fill) return null
    changes.fills = [
      {
        color: parseColor(fill),
        opacity: 1,
        type: 'SOLID',
        visible: true
      }
    ]
  }
  return changes
}

function normalizeBoardShapeChanges(
  input: CodeObjectUpdateBoardShapeInput
): Partial<SceneNode> | null {
  const geometry = normalizeBoardGeometryChanges(input)
  const appearance = normalizeAppearanceChanges(input)
  return geometry && appearance ? { ...geometry, ...appearance } : null
}

function updateOwnedBoardShape(
  store: EditorStore,
  owner: BoardPermissionContext,
  action: Extract<OwnedBoardShapeAction, { type: 'board.shape.update' }>,
  id: string
): OwnedBoardShapeReceipt {
  const target = ownedActionTarget(store, owner, action, id)
  if ('status' in target) return target
  const changes = normalizeBoardShapeChanges(action.changes)
  if (!changes) return deniedReceipt(id, owner, action.type, 'invalid-payload', target.id)
  const changed = Object.entries(changes).some(([key, value]) => {
    const current = target[key as keyof SceneNode]
    return JSON.stringify(current) !== JSON.stringify(value)
  })
  if (!changed) {
    return {
      actionId: id,
      actorId: owner.actorId,
      changed: false,
      shape: boardShapeSnapshot(target) ?? undefined,
      status: 'noop',
      targetNodeId: target.id,
      type: action.type
    }
  }
  store.updateNodeWithUndo(target.id, changes, owner.labels.update)
  const updated = store.graph.getNode(target.id)
  return {
    actionId: id,
    actorId: owner.actorId,
    changed: true,
    shape: updated ? (boardShapeSnapshot(updated) ?? undefined) : undefined,
    status: 'applied',
    targetNodeId: target.id,
    type: action.type
  }
}

function deleteOwnedBoardShape(
  store: EditorStore,
  owner: BoardPermissionContext,
  action: Extract<OwnedBoardShapeAction, { type: 'board.shape.delete' }>,
  id: string
): OwnedBoardShapeReceipt {
  const target = ownedActionTarget(store, owner, action, id)
  if ('status' in target) return target
  deleteBoardLeaf(store, target, owner.labels.delete, 'undoable')
  store.requestRender()
  return {
    actionId: id,
    actorId: owner.actorId,
    changed: true,
    status: 'applied',
    targetNodeId: target.id,
    type: action.type
  }
}

export function dispatchOwnedBoardShapeAction(
  store: EditorStore,
  owner: BoardPermissionDescriptor,
  action: OwnedBoardShapeAction,
  id = actionId()
): OwnedBoardShapeReceipt {
  let requiredPermissions: readonly BoardPermission[]
  if (action.type === 'board.shape.create') requiredPermissions = ['shape.create']
  else if (action.type === 'board.shape.delete') requiredPermissions = ['shape.delete']
  else requiredPermissions = requiredShapeUpdatePermissions(action.changes)
  const permission = runBoardMutation(store, owner, requiredPermissions, (context) => {
    if (action.type === 'board.shape.create') {
      return createOwnedBoardShape(store, context, action, id)
    }
    if (action.type === 'board.shape.update') {
      return updateOwnedBoardShape(store, context, action, id)
    }
    return deleteOwnedBoardShape(store, context, action, id)
  })
  return permission.status === 'allowed'
    ? permission.result
    : deniedReceipt(id, owner, action.type, permission.reason)
}
