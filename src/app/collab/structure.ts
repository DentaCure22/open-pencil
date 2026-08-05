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
    } else {
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

function parentMap(ynodes: YNodes): Map<string, string> {
  const result = new Map<string, string>()
  for (const [nodeId, ynode] of ynodes) {
    const parentId = yParentId(ynode)
    if (parentId && ynodes.has(parentId)) result.set(nodeId, parentId)
  }
  return result
}

function findParentCycles(parents: Map<string, string>): string[][] {
  const complete = new Set<string>()
  const cycles: string[][] = []
  for (const startId of [...parents.keys()].sort()) {
    if (complete.has(startId)) continue
    const path: string[] = []
    const pathIndex = new Map<string, number>()
    let nodeId: string | undefined = startId
    while (nodeId && !complete.has(nodeId)) {
      const cycleStart = pathIndex.get(nodeId)
      if (cycleStart !== undefined) {
        cycles.push(path.slice(cycleStart))
        break
      }
      pathIndex.set(nodeId, path.length)
      path.push(nodeId)
      nodeId = parents.get(nodeId)
    }
    for (const visitedId of path) complete.add(visitedId)
  }
  return cycles
}

function createsCycle(
  childId: string,
  parentId: string,
  parents: ReadonlyMap<string, string>
): boolean {
  const visited = new Set([childId])
  let currentId: string | undefined = parentId
  while (currentId) {
    if (visited.has(currentId)) return true
    visited.add(currentId)
    currentId = parents.get(currentId)
  }
  return false
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

function cycleBreak(
  cycleIds: string[],
  ynodes: YNodes,
  parents: Map<string, string>
): CycleBreak | null {
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
        !createsCycle(childId, placement.parentId, parents)
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
  if (!childId || !parentId || !ychild || createsCycle(childId, parentId, parents)) return null
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
  const parents = parentMap(ynodes)
  for (const cycleIds of findParentCycles(parents)) {
    const repair = cycleBreak(cycleIds, ynodes, parents)
    if (!repair) continue
    const ychild = ynodes.get(repair.childId)
    if (!ychild) continue
    const oldParentId = parents.get(repair.childId)
    ychild.set('parentId', repair.placement.parentId)
    ychild.set('x', repair.placement.x)
    ychild.set('y', repair.placement.y)
    parents.set(repair.childId, repair.placement.parentId)
    targets.childIds.add(repair.childId)
    if (oldParentId) targets.parentIds.add(oldParentId)
    targets.parentIds.add(repair.placement.parentId)
  }
}

export function reconcileYjsParentChildIds(ynodes: YNodes, targets: StructuralSyncTargets) {
  breakParentCycles(ynodes, targets)
  const parentLists = new Map<string, string[]>()
  const originalParentLists = new Map<string, string[]>()
  for (const [parentId, yparent] of ynodes) {
    const childIds = yChildIds(yparent)
    parentLists.set(parentId, childIds)
    originalParentLists.set(parentId, [...childIds])
  }

  for (const childId of [...targets.childIds].sort()) {
    const desiredParentId = yParentId(ynodes.get(childId))
    const validDesiredParentId =
      desiredParentId && ynodes.has(desiredParentId) ? desiredParentId : null
    if (validDesiredParentId) targets.parentIds.add(validDesiredParentId)
    for (const [parentId, childIds] of parentLists) {
      if (childIds.includes(childId)) targets.parentIds.add(parentId)
      const keptDesiredIndex = parentId === validDesiredParentId ? childIds.indexOf(childId) : -1
      const reconciledChildIds = childIds.filter(
        (listedChildId, index) => listedChildId !== childId || index === keptDesiredIndex
      )
      if (parentId === validDesiredParentId && keptDesiredIndex === -1) {
        reconciledChildIds.push(childId)
      }
      parentLists.set(parentId, reconciledChildIds)
    }
  }

  for (const [parentId, childIds] of parentLists) {
    const original = originalParentLists.get(parentId) ?? []
    if (equalStringArrays(original, childIds)) continue
    ynodes.get(parentId)?.set('childIds', childIds)
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
