import type * as Y from 'yjs'

import type { SceneNode } from '@open-pencil/scene-graph'

import {
  expandDerivedNodeChanges,
  isSourceInvalidationYKey,
  syncFullSourceInvalidationState,
  syncSourceInvalidationsForChanges
} from '@/app/collab/source-metadata'

export function collabValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (left instanceof Uint8Array || right instanceof Uint8Array) {
    return (
      left instanceof Uint8Array &&
      right instanceof Uint8Array &&
      left.length === right.length &&
      left.every((value, index) => value === right[index])
    )
  }
  return JSON.stringify(left) === JSON.stringify(right)
}

export function syncNodePropsToYMap(node: SceneNode, ynode: Y.Map<unknown>) {
  const nodeKeys = new Set(Object.keys(node))
  for (const key of ynode.keys()) {
    if (!nodeKeys.has(key) && !isSourceInvalidationYKey(key)) ynode.delete(key)
  }
  for (const [key, value] of Object.entries(node)) {
    if (!collabValuesEqual(ynode.get(key), value)) {
      ynode.set(key, structuredClone(value))
    }
  }
  syncFullSourceInvalidationState(node, ynode)
}

function syncNodeChangesToYMap(
  node: SceneNode,
  changes: Partial<SceneNode>,
  ynode: Y.Map<unknown>
) {
  for (const key of Object.keys(changes) as (keyof SceneNode)[]) {
    const value = node[key]
    if (value === undefined) ynode.delete(key)
    else ynode.set(key, structuredClone(value))
  }
  syncSourceInvalidationsForChanges(node, changes, ynode)
}

export function syncNodeFieldsToYMap(
  node: SceneNode,
  changes: Partial<SceneNode> | undefined,
  ynode: Y.Map<unknown>,
  materializingNode: boolean
) {
  if (materializingNode || !changes) {
    syncNodePropsToYMap(node, ynode)
    return
  }
  syncNodeChangesToYMap(node, expandDerivedNodeChanges(node, changes), ynode)
}

export function shouldSyncObjectGraphPage(
  node: SceneNode,
  changes: Partial<SceneNode> | undefined,
  materializingNode: boolean
): boolean {
  return (
    node.type === 'CANVAS' &&
    (materializingNode || !changes || Object.hasOwn(changes, 'pluginData'))
  )
}

export function hasStructuralNodeChange(
  changes: Partial<SceneNode> | undefined,
  relatedParentIds: ReadonlyArray<string | null>,
  materializingNode: boolean
): boolean {
  return (
    materializingNode ||
    !changes ||
    Object.hasOwn(changes, 'parentId') ||
    Object.hasOwn(changes, 'childIds') ||
    relatedParentIds.length > 0
  )
}
