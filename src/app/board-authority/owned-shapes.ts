import { colorToHex, parseColor } from '@open-pencil/core/color'
import { randomHex } from '@open-pencil/core/random'
import type { SceneNode } from '@open-pencil/scene-graph'

import type { EditorStore } from '@/app/editor/active-store'

import {
  BOARD_AUTHORITY_API_VERSION,
  type BoardAuthorityDenialReason,
  type BoardAuthorityGrant,
  type BoardAuthorityReceipt,
  type BoardShapeAction,
  type BoardShapeClient,
  type BoardShapeCreateInput,
  type BoardShapeKind,
  type BoardShapeSnapshot,
  type BoardShapeUpdateInput
} from './contracts'
import { boardNodeMatchesGrant, isBoardAuthorityGrantActive } from './grants'
import { requiredShapeUpdatePermissions } from './update-permissions'

const DEFAULT_MAX_OWNED_SHAPES = 24

type NormalizedBoardShapeInput = {
  fill: string
  height: number
  kind: BoardShapeKind
  name: string
  width: number
  x: number
  y: number
}

function actionId(): string {
  return `board-action:${randomHex(8)}`
}

function receiptMetadata(owner: BoardAuthorityGrant) {
  return {
    apiVersion: owner.apiVersion,
    grantId: owner.grantId
  }
}

function deniedReceipt(
  id: string,
  owner: BoardAuthorityGrant,
  type: BoardShapeAction['type'],
  reason: BoardAuthorityDenialReason,
  targetNodeId?: string
): BoardAuthorityReceipt {
  return {
    actionId: id,
    actorId: owner.actorId,
    apiVersion: owner.apiVersion,
    changed: false,
    grantId: owner.grantId,
    reason,
    status: 'denied',
    targetNodeId,
    type
  }
}

function boardShapeKind(node: SceneNode): BoardShapeKind | null {
  if (node.type === 'RECTANGLE') return 'rectangle'
  if (node.type === 'ELLIPSE') return 'ellipse'
  return null
}

function boardShapeSnapshot(node: SceneNode): BoardShapeSnapshot | null {
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

export function ownedBoardShapeSnapshots(
  store: EditorStore,
  owner: BoardAuthorityGrant
): BoardShapeSnapshot[] {
  if (!isBoardAuthorityGrantActive(store, owner)) return []
  return store.graph
    .getChildren(owner.pageId)
    .filter((node) => boardNodeMatchesGrant(node, owner))
    .flatMap((node) => {
      const snapshot = boardShapeSnapshot(node)
      return snapshot ? [snapshot] : []
    })
}

function boundedNumber(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number
): number | null {
  const resolved = value === undefined ? fallback : value
  if (typeof resolved !== 'number' || !Number.isFinite(resolved)) return null
  return Math.min(maximum, Math.max(minimum, resolved))
}

function validFill(value: unknown, fallback = '#8B5CF6'): string | null {
  const resolved = value === undefined ? fallback : value
  return typeof resolved === 'string' && /^#[\da-f]{6}$/i.test(resolved)
    ? resolved.toUpperCase()
    : null
}

function normalizeBoardShapeInput(
  owner: BoardAuthorityGrant,
  input: BoardShapeCreateInput,
  ownedCount: number
): NormalizedBoardShapeInput | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  if (input.kind !== 'ellipse' && input.kind !== 'rectangle') return null
  const origin = owner.defaultOrigin
  const x = boundedNumber(
    input.x,
    origin.x + origin.width + 72 + ownedCount * 24,
    -1_000_000,
    1_000_000
  )
  const y = boundedNumber(input.y, origin.y + 64 + ownedCount * 24, -1_000_000, 1_000_000)
  const width = boundedNumber(input.width, 220, 24, 5_000)
  const height = boundedNumber(input.height, 160, 24, 5_000)
  const fill = validFill(input.fill)
  if (x === null || y === null || width === null || height === null || !fill) return null
  if (input.name !== undefined && typeof input.name !== 'string') return null
  return {
    fill,
    height,
    kind: input.kind,
    name: (input.name?.trim() || 'Board shape').slice(0, 120),
    width,
    x,
    y
  }
}

function ownerPluginData(node: SceneNode, owner: BoardAuthorityGrant): SceneNode['pluginData'] {
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
  owner: BoardAuthorityGrant,
  action: Extract<BoardShapeAction, { type: 'board.shape.create' }>,
  id: string
): BoardAuthorityReceipt {
  if (!isBoardAuthorityGrantActive(store, owner)) {
    return deniedReceipt(id, owner, action.type, 'grant-invalid')
  }
  if (!owner.permissions.includes('shape.create')) {
    return deniedReceipt(id, owner, action.type, 'capability-denied')
  }
  const owned = ownedBoardShapeSnapshots(store, owner)
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
      ...receiptMetadata(owner),
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
  owner: BoardAuthorityGrant,
  shapeId: string
): SceneNode | null {
  const target = store.graph.getNode(shapeId)
  if (!target || target.parentId !== owner.pageId || !boardShapeKind(target)) return null
  return boardNodeMatchesGrant(target, owner) ? target : null
}

function normalizeGeometryChanges(input: BoardShapeUpdateInput): Partial<SceneNode> | null {
  const changes: Partial<SceneNode> = {}
  const definitions = [
    ['x', -1_000_000, 1_000_000],
    ['y', -1_000_000, 1_000_000],
    ['width', 24, 5_000],
    ['height', 24, 5_000],
    ['rotation', -360_000, 360_000],
    ['opacity', 0, 1]
  ] as const
  for (const [key, minimum, maximum] of definitions) {
    const inputValue = input[key]
    if (inputValue === undefined) continue
    const value = boundedNumber(inputValue, 0, minimum, maximum)
    if (value === null) return null
    changes[key] = key === 'rotation' ? ((value % 360) + 360) % 360 : value
  }
  return changes
}

function normalizeAppearanceChanges(input: BoardShapeUpdateInput): Partial<SceneNode> | null {
  const changes: Partial<SceneNode> = {}
  if (input.visible !== undefined) {
    if (typeof input.visible !== 'boolean') return null
    changes.visible = input.visible
  }
  if (input.name !== undefined) {
    if (typeof input.name !== 'string') return null
    changes.name = (input.name.trim() || 'Board shape').slice(0, 120)
  }
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

function normalizeBoardShapeChanges(input: BoardShapeUpdateInput): Partial<SceneNode> | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const geometry = normalizeGeometryChanges(input)
  const appearance = normalizeAppearanceChanges(input)
  return geometry && appearance ? { ...geometry, ...appearance } : null
}

function updateOwnedBoardShape(
  store: EditorStore,
  owner: BoardAuthorityGrant,
  action: Extract<BoardShapeAction, { type: 'board.shape.update' }>,
  id: string
): BoardAuthorityReceipt {
  if (!isBoardAuthorityGrantActive(store, owner)) {
    return deniedReceipt(id, owner, action.type, 'grant-invalid', action.shapeId)
  }
  if (
    requiredShapeUpdatePermissions(action.changes).some(
      (permission) => !owner.permissions.includes(permission)
    )
  ) {
    return deniedReceipt(id, owner, action.type, 'capability-denied', action.shapeId)
  }
  const target = ownedTarget(store, owner, action.shapeId)
  if (!target) {
    return deniedReceipt(
      id,
      owner,
      action.type,
      store.graph.getNode(action.shapeId) ? 'shape-not-owned' : 'target-missing',
      action.shapeId
    )
  }
  const changes = normalizeBoardShapeChanges(action.changes)
  if (!changes) return deniedReceipt(id, owner, action.type, 'invalid-payload', target.id)
  const changed = Object.entries(changes).some(([key, value]) => {
    const current = target[key as keyof SceneNode]
    return JSON.stringify(current) !== JSON.stringify(value)
  })
  if (!changed) {
    return {
      ...receiptMetadata(owner),
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
    ...receiptMetadata(owner),
    actionId: id,
    actorId: owner.actorId,
    changed: true,
    shape: updated ? (boardShapeSnapshot(updated) ?? undefined) : undefined,
    status: 'applied',
    targetNodeId: target.id,
    type: action.type
  }
}

function restoreOwnedBoardShape(store: EditorStore, snapshot: SceneNode) {
  if (store.graph.getNode(snapshot.id) || !snapshot.parentId) return
  const { childIds: _childIds, id, parentId, ...overrides } = structuredClone(snapshot)
  store.graph.createNodeWithId(id, snapshot.type, parentId, { ...overrides, childIds: [] })
}

function deleteOwnedBoardShape(
  store: EditorStore,
  owner: BoardAuthorityGrant,
  action: Extract<BoardShapeAction, { type: 'board.shape.delete' }>,
  id: string
): BoardAuthorityReceipt {
  if (!isBoardAuthorityGrantActive(store, owner)) {
    return deniedReceipt(id, owner, action.type, 'grant-invalid', action.shapeId)
  }
  if (!owner.permissions.includes('shape.delete')) {
    return deniedReceipt(id, owner, action.type, 'capability-denied', action.shapeId)
  }
  const target = ownedTarget(store, owner, action.shapeId)
  if (!target) {
    return deniedReceipt(
      id,
      owner,
      action.type,
      store.graph.getNode(action.shapeId) ? 'shape-not-owned' : 'target-missing',
      action.shapeId
    )
  }
  const snapshot = structuredClone(target)
  const previousSelection = new Set(store.state.selectedIds)
  const selectionWithoutTarget = [...previousSelection].filter(
    (selectedId) => selectedId !== target.id
  )
  store.graph.deleteNode(target.id)
  store.select(selectionWithoutTarget)
  store.undo.push({
    label: owner.labels.delete,
    forward: () => {
      store.graph.deleteNode(snapshot.id)
      store.select([...store.state.selectedIds].filter((selectedId) => selectedId !== snapshot.id))
      store.requestRender()
    },
    inverse: () => {
      restoreOwnedBoardShape(store, snapshot)
      store.select([...previousSelection])
      store.requestRender()
    }
  })
  store.requestRender()
  return {
    ...receiptMetadata(owner),
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
  owner: BoardAuthorityGrant,
  action: BoardShapeAction,
  id = actionId()
): BoardAuthorityReceipt {
  if (!isBoardAuthorityGrantActive(store, owner)) {
    return deniedReceipt(id, owner, action.type, 'grant-invalid')
  }
  if (!store.graph.getNode(owner.pageId)) {
    return deniedReceipt(id, owner, action.type, 'source-missing')
  }
  if (action.type === 'board.shape.create') {
    return createOwnedBoardShape(store, owner, action, id)
  }
  if (action.type === 'board.shape.update') {
    return updateOwnedBoardShape(store, owner, action, id)
  }
  return deleteOwnedBoardShape(store, owner, action, id)
}

export function createOwnedBoardShapeClient(
  store: EditorStore,
  owner: BoardAuthorityGrant
): BoardShapeClient {
  return {
    apiVersion: BOARD_AUTHORITY_API_VERSION,
    createShape: async (shape) =>
      dispatchOwnedBoardShapeAction(store, owner, { shape, type: 'board.shape.create' }),
    deleteShape: async (shapeId) =>
      dispatchOwnedBoardShapeAction(store, owner, { shapeId, type: 'board.shape.delete' }),
    grantId: owner.grantId,
    permissions: structuredClone(owner.permissions),
    shapes: ownedBoardShapeSnapshots(store, owner),
    updateShape: async (shapeId, changes) =>
      dispatchOwnedBoardShapeAction(store, owner, {
        changes,
        shapeId,
        type: 'board.shape.update'
      })
  }
}
