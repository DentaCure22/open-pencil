import * as Y from 'yjs'

import type { SceneNode } from '@open-pencil/scene-graph'

import type { EditorStore } from '@/app/editor/active-store'

export type YNodes = Y.Map<Y.Map<unknown>>

export type StructuralSyncTargets = {
  childIds: Set<string>
  parentIds: Set<string>
}

type PreviousPlacement = {
  parentId: string
  x: number
  y: number
}

type CycleBreak = {
  childId: string
  placement: PreviousPlacement
}

const Y_PREVIOUS_PLACEMENT = '__openPencilCollab.structure.previousPlacement'

export function isStructureYKey(key: string): boolean {
  return key === Y_PREVIOUS_PLACEMENT
}

export function yChildIds(ynode: Y.Map<unknown> | undefined): string[] {
  const value = ynode?.get('childIds')
  if (!Array.isArray(value)) return []
  return value.filter((childId): childId is string => typeof childId === 'string')
}

export function yParentId(ynode: Y.Map<unknown> | undefined): string | null {
  const value = ynode?.get('parentId')
  return typeof value === 'string' ? value : null
}

export function equalStringArrays(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

export function syncParentChildIdsFromGraph(
  store: EditorStore,
  ynodes: YNodes,
  parentIds: ReadonlyArray<string | null>,
  syncFullNode: (node: SceneNode, ynode: Y.Map<unknown>) => void
) {
  for (const parentId of new Set(parentIds)) {
    if (!parentId) continue
    const parent = store.graph.getNode(parentId)
    if (!parent) continue
    let yparent = ynodes.get(parentId)
    if (!yparent) {
      yparent = new Y.Map()
      ynodes.set(parentId, yparent)
      syncFullNode(parent, yparent)
    } else if (!equalStringArrays(yChildIds(yparent), parent.childIds)) {
      yparent.set('childIds', structuredClone(parent.childIds))
    }
  }
}

function parentOrigin(store: EditorStore, parentId: string) {
  const parent = store.graph.getNode(parentId)
  if (parentId === store.graph.rootId || parent?.type === 'CANVAS') return { x: 0, y: 0 }
  return store.graph.getAuthoritativeAbsolutePosition(parentId)
}

export function syncPreviousPlacement(
  store: EditorStore,
  node: SceneNode,
  changes: Partial<SceneNode> | undefined,
  relatedParentIds: ReadonlyArray<string | null>,
  ynode: Y.Map<unknown>
) {
  if (!changes || !Object.hasOwn(changes, 'parentId')) return
  const previousParentId = relatedParentIds.flatMap((parentId) =>
    parentId && parentId !== node.parentId ? [parentId] : []
  )[0]
  if (!previousParentId || !store.graph.getNode(previousParentId)) return
  const absolutePosition = store.graph.getAuthoritativeAbsolutePosition(node.id)
  const origin = parentOrigin(store, previousParentId)
  const placement: PreviousPlacement = {
    parentId: previousParentId,
    x: absolutePosition.x - origin.x,
    y: absolutePosition.y - origin.y
  }
  const previousPlacement = readPreviousPlacement(ynode)
  if (
    previousPlacement?.parentId === placement.parentId &&
    previousPlacement.x === placement.x &&
    previousPlacement.y === placement.y
  ) {
    return
  }
  ynode.set(Y_PREVIOUS_PLACEMENT, placement)
}

function readPreviousPlacement(ynode: Y.Map<unknown> | undefined): PreviousPlacement | null {
  const value = ynode?.get(Y_PREVIOUS_PLACEMENT)
  if (typeof value !== 'object' || value === null) return null
  if (!('parentId' in value) || typeof value.parentId !== 'string') return null
  if (!('x' in value) || typeof value.x !== 'number') return null
  if (!('y' in value) || typeof value.y !== 'number') return null
  return { parentId: value.parentId, x: value.x, y: value.y }
}

function createsCycle(childId: string, parentId: string, ynodes: YNodes): boolean {
  const visited = new Set([childId])
  let currentId: string | undefined = parentId
  while (currentId) {
    if (visited.has(currentId)) return true
    visited.add(currentId)
    currentId = yParentId(ynodes.get(currentId)) ?? undefined
  }
  return false
}

function parentCycleFrom(startId: string, ynodes: YNodes): string[] {
  const path: string[] = []
  const pathIndex = new Map<string, number>()
  let nodeId: string | undefined = startId
  while (nodeId && ynodes.has(nodeId)) {
    const cycleStart = pathIndex.get(nodeId)
    if (cycleStart !== undefined) return path.slice(cycleStart)
    pathIndex.set(nodeId, path.length)
    path.push(nodeId)
    nodeId = yParentId(ynodes.get(nodeId)) ?? undefined
  }
  return []
}

function compareIds(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function fallbackContainerId(ynodes: YNodes, cycle: ReadonlySet<string>): string | null {
  const canvases = [...ynodes]
    .filter(([nodeId, ynode]) => !cycle.has(nodeId) && ynode.get('type') === 'CANVAS')
    .map(([nodeId, ynode]) => ({
      containsCycleMember: yChildIds(ynode).some((childId) => cycle.has(childId)),
      nodeId
    }))
    .sort((left, right) => {
      if (left.containsCycleMember !== right.containsCycleMember) {
        return left.containsCycleMember ? -1 : 1
      }
      return compareIds(left.nodeId, right.nodeId)
    })
  if (canvases[0]) return canvases[0].nodeId
  return (
    [...ynodes]
      .filter(([nodeId, ynode]) => !cycle.has(nodeId) && yParentId(ynode) === null)
      .map(([nodeId]) => nodeId)
      .sort(compareIds)[0] ?? null
  )
}

function cycleBreak(cycleIds: string[], ynodes: YNodes): CycleBreak | null {
  const cycle = new Set(cycleIds)
  const previousPlacements = cycleIds
    .flatMap((childId) => {
      const placement = readPreviousPlacement(ynodes.get(childId))
      return placement ? [{ childId, placement }] : []
    })
    .filter(
      ({ childId, placement }) =>
        ynodes.has(placement.parentId) &&
        !cycle.has(placement.parentId) &&
        !createsCycle(childId, placement.parentId, ynodes)
    )
    .sort((left, right) =>
      compareIds(
        `${left.childId}\u0000${left.placement.parentId}`,
        `${right.childId}\u0000${right.placement.parentId}`
      )
    )
  const previousPlacement = previousPlacements.at(0)
  if (previousPlacement) return previousPlacement

  const parentId = fallbackContainerId(ynodes, cycle)
  const childId = [...cycleIds].sort()[0]
  const ychild = childId ? ynodes.get(childId) : undefined
  if (!childId || !parentId || !ychild || createsCycle(childId, parentId, ynodes)) return null
  const x = ychild.get('x')
  const y = ychild.get('y')
  return {
    childId,
    placement: {
      parentId,
      x: typeof x === 'number' ? x : 0,
      y: typeof y === 'number' ? y : 0
    }
  }
}

function breakParentCycles(ynodes: YNodes, targets: StructuralSyncTargets) {
  const repairedCycles = new Set<string>()
  for (const startId of [...targets.childIds].sort()) {
    const cycleIds = parentCycleFrom(startId, ynodes)
    const cycleKey = [...cycleIds].sort().join('\0')
    if (cycleIds.length === 0 || repairedCycles.has(cycleKey)) continue
    repairedCycles.add(cycleKey)
    const repair = cycleBreak(cycleIds, ynodes)
    if (!repair) continue
    const ychild = ynodes.get(repair.childId)
    if (!ychild) continue
    const oldParentId = yParentId(ychild)
    ychild.set('parentId', repair.placement.parentId)
    ychild.set('x', repair.placement.x)
    ychild.set('y', repair.placement.y)
    targets.childIds.add(repair.childId)
    if (oldParentId) targets.parentIds.add(oldParentId)
    targets.parentIds.add(repair.placement.parentId)
  }
}

function indexParentIdsByChildId(parentLists: ReadonlyMap<string, string[]>) {
  const parentIdsByChildId = new Map<string, Set<string>>()
  for (const [parentId, childIds] of parentLists) {
    for (const childId of childIds) {
      const parentIds = parentIdsByChildId.get(childId) ?? new Set<string>()
      parentIds.add(parentId)
      parentIdsByChildId.set(childId, parentIds)
    }
  }
  return parentIdsByChildId
}

function reconcileParentChildList(
  childIds: string[],
  childId: string,
  shouldContainChild: boolean
): string[] {
  if (!shouldContainChild) {
    return childIds.includes(childId)
      ? childIds.filter((listedChildId) => listedChildId !== childId)
      : childIds
  }
  const firstIndex = childIds.indexOf(childId)
  if (firstIndex === -1) return [...childIds, childId]
  if (childIds.lastIndexOf(childId) === firstIndex) return childIds
  return childIds.filter(
    (listedChildId, index) => listedChildId !== childId || index === firstIndex
  )
}

export function reconcileYjsParentChildIds(ynodes: YNodes, targets: StructuralSyncTargets) {
  breakParentCycles(ynodes, targets)
  for (const childId of targets.childIds) {
    const parentId = yParentId(ynodes.get(childId))
    if (parentId && ynodes.has(parentId)) targets.parentIds.add(parentId)
  }
  const parentLists = new Map<string, string[]>()
  for (const parentId of targets.parentIds) {
    const yparent = ynodes.get(parentId)
    if (!yparent) continue
    parentLists.set(parentId, yChildIds(yparent))
  }

  const parentIdsByChildId = indexParentIdsByChildId(parentLists)
  const changedParentIds = new Set<string>()

  for (const childId of [...targets.childIds].sort()) {
    const desiredParentId = yParentId(ynodes.get(childId))
    const validDesiredParentId =
      desiredParentId && ynodes.has(desiredParentId) ? desiredParentId : null
    const affectedParentIds = parentIdsByChildId.get(childId) ?? new Set<string>()
    if (validDesiredParentId) affectedParentIds.add(validDesiredParentId)
    for (const parentId of affectedParentIds) {
      const childIds = parentLists.get(parentId)
      if (!childIds) continue
      const reconciled = reconcileParentChildList(
        childIds,
        childId,
        parentId === validDesiredParentId
      )
      if (reconciled === childIds) continue
      parentLists.set(parentId, reconciled)
      changedParentIds.add(parentId)
    }
  }

  for (const parentId of changedParentIds) {
    ynodes.get(parentId)?.set('childIds', parentLists.get(parentId))
    targets.parentIds.add(parentId)
  }
}

function yStructureDepth(nodeId: string, ynodes: YNodes): number {
  const visited = new Set<string>()
  let depth = 0
  let parentId = yParentId(ynodes.get(nodeId))
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId)
    depth += 1
    parentId = yParentId(ynodes.get(parentId))
  }
  return depth
}

export function reconcileGraphStructure(
  store: EditorStore,
  ynodes: YNodes,
  { childIds, parentIds }: StructuralSyncTargets
) {
  const orderedChildIds = [...childIds].sort((left, right) => {
    const depthDifference = yStructureDepth(left, ynodes) - yStructureDepth(right, ynodes)
    return depthDifference === 0 ? compareIds(left, right) : depthDifference
  })
  for (const childId of orderedChildIds) {
    const ychild = ynodes.get(childId)
    const child = store.graph.getNode(childId)
    if (!ychild || !child) continue
    const desiredParentId = yParentId(ychild)
    if (!desiredParentId || !store.graph.getNode(desiredParentId)) continue
    if (child.parentId === desiredParentId) continue
    const oldParentId = child.parentId
    store.graph.reparentNode(childId, desiredParentId)
    if (store.graph.getNode(childId)?.parentId !== desiredParentId) continue
    const x = ychild.get('x')
    const y = ychild.get('y')
    store.graph.updateNode(childId, {
      ...(typeof x === 'number' ? { x } : {}),
      ...(typeof y === 'number' ? { y } : {})
    })
    if (oldParentId) parentIds.add(oldParentId)
    parentIds.add(desiredParentId)
  }

  for (const parentId of parentIds) {
    const parent = store.graph.getNode(parentId)
    const yparent = ynodes.get(parentId)
    if (!parent || !yparent) continue
    const childIds = yChildIds(yparent)
    if (equalStringArrays(parent.childIds, childIds)) continue
    store.graph.updateNode(parentId, { childIds })
  }
}
