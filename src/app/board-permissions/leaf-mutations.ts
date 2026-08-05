import type { Rect, SceneNode } from '@open-pencil/scene-graph'

import type { EditorStore } from '@/app/editor/active-store'

import type { BoardPermissionDescriptor } from './contracts'

export type BoardGeometryInput = {
  height?: unknown
  opacity?: unknown
  rotation?: unknown
  width?: unknown
  x?: unknown
  y?: unknown
}

export type BoardAppearanceInput = {
  name?: unknown
  visible?: unknown
}

export type OwnedBoardGeometry = Rect

export function boundedBoardNumber(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number
): number | null {
  const resolved = value === undefined ? fallback : value
  if (typeof resolved !== 'number' || !Number.isFinite(resolved)) return null
  return Math.min(maximum, Math.max(minimum, resolved))
}

export function normalizeOwnedBoardGeometry(
  owner: Pick<BoardPermissionDescriptor, 'defaultOrigin'>,
  input: BoardGeometryInput,
  ownedCount: number
): OwnedBoardGeometry | null {
  const origin = owner.defaultOrigin
  const x = boundedBoardNumber(
    input.x,
    origin.x + origin.width + 72 + ownedCount * 24,
    -1_000_000,
    1_000_000
  )
  const y = boundedBoardNumber(input.y, origin.y + 64 + ownedCount * 24, -1_000_000, 1_000_000)
  const width = boundedBoardNumber(input.width, 220, 24, 5_000)
  const height = boundedBoardNumber(input.height, 160, 24, 5_000)
  return x === null || y === null || width === null || height === null
    ? null
    : { height, width, x, y }
}

export function normalizeBoardGeometryChanges(
  input: BoardGeometryInput
): Partial<SceneNode> | null {
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
    const value = boundedBoardNumber(inputValue, 0, minimum, maximum)
    if (value === null) return null
    changes[key] = key === 'rotation' ? ((value % 360) + 360) % 360 : value
  }
  return changes
}

export function normalizeBoardAppearanceChanges(
  input: BoardAppearanceInput,
  fallbackName: string
): Partial<SceneNode> | null {
  const changes: Partial<SceneNode> = {}
  if (input.visible !== undefined) {
    if (typeof input.visible !== 'boolean') return null
    changes.visible = input.visible
  }
  if (input.name !== undefined) {
    if (typeof input.name !== 'string') return null
    changes.name = (input.name.trim() || fallbackName).slice(0, 120)
  }
  return changes
}

export function restoreBoardLeaf(store: EditorStore, snapshot: SceneNode): void {
  if (store.graph.getNode(snapshot.id) || !snapshot.parentId) return
  const { childIds: _childIds, id, parentId, ...overrides } = structuredClone(snapshot)
  store.graph.createNodeWithId(id, snapshot.type, parentId, { ...overrides, childIds: [] })
}

export function deleteBoardLeaf(
  store: EditorStore,
  target: SceneNode,
  label: string,
  history: 'transient' | 'undoable'
): void {
  const snapshot = structuredClone(target)
  const previousSelection = new Set(store.state.selectedIds)
  store.graph.deleteNode(target.id)
  store.select([...previousSelection].filter((selectedId) => selectedId !== target.id))
  if (history === 'transient') return
  store.undo.push({
    label,
    forward: () => {
      store.graph.deleteNode(snapshot.id)
      store.select([...store.state.selectedIds].filter((selectedId) => selectedId !== snapshot.id))
      store.requestRender()
    },
    inverse: () => {
      restoreBoardLeaf(store, snapshot)
      store.select([...previousSelection])
      store.requestRender()
    }
  })
}
