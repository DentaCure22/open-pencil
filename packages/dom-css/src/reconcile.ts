import { computeAllLayouts } from '@open-pencil/core/layout'
import { cloneSceneNode, type SceneGraph, type SceneNode } from '@open-pencil/scene-graph'

import {
  replaceElementSourceMetadata,
  replaceDocumentSourceMetadata,
  replaceSourceStatus,
  refreshSourceBaselines,
  sourceBaselineForNode,
  sourceControlledSnapshot,
  sourceIdForNode
} from './source-metadata'
import { designDocumentToSceneGraph } from './to-scene-graph'
import type { DesignDocument } from './types'

export interface ReconcileDesignDocumentOptions {
  parentId?: string
  pageName?: string
}

export interface ReconcileDesignDocumentResult {
  created: number
  updated: number
  deleted: number
  detached: number
  replaced: number
  preservedOverrides: number
  rootIds: string[]
}

function deepEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function descendants(graph: SceneGraph, parentId: string): SceneNode[] {
  return graph.flattenTree(parentId).map(({ node }) => node)
}

function sourceIndex(graph: SceneGraph, parentId: string): Map<string, SceneNode> {
  const index = new Map<string, SceneNode>()
  for (const node of descendants(graph, parentId)) {
    const sourceId = sourceIdForNode(node)
    if (!sourceId) continue
    if (index.has(sourceId)) throw new Error(`Duplicate source ID "${sourceId}" in target graph`)
    index.set(sourceId, node)
  }
  return index
}

function createProps(node: SceneNode): Partial<SceneNode> {
  const clone = cloneSceneNode(node)
  const { id: _id, parentId: _parentId, childIds: _childIds, ...props } = clone
  return props
}

function cloneDesiredSubtree(
  desiredGraph: SceneGraph,
  desired: SceneNode,
  targetGraph: SceneGraph,
  parentId: string,
  result: ReconcileDesignDocumentResult,
  consumedSourceIds: Set<string>
): SceneNode {
  const created = targetGraph.createNode(desired.type, parentId, createProps(desired))
  result.created += 1
  const sourceId = sourceIdForNode(desired)
  if (sourceId) consumedSourceIds.add(sourceId)
  for (const child of desiredGraph.getChildren(desired.id)) {
    cloneDesiredSubtree(desiredGraph, child, targetGraph, created.id, result, consumedSourceIds)
  }
  return created
}

function mergeDesiredNode(
  targetGraph: SceneGraph,
  current: SceneNode,
  desired: SceneNode,
  result: ReconcileDesignDocumentResult
): void {
  const baseline = sourceBaselineForNode(current)
  const currentSnapshot = sourceControlledSnapshot(current)
  const desiredSnapshot = sourceControlledSnapshot(desired)
  const changes: Record<string, unknown> = {}
  let conflicts = 0

  for (const [field, desiredValue] of Object.entries(desiredSnapshot)) {
    const currentValue = currentSnapshot[field]
    const baselineValue = baseline?.[field]
    if (!baseline || deepEqual(currentValue, baselineValue)) {
      if (!deepEqual(currentValue, desiredValue)) changes[field] = structuredClone(desiredValue)
      continue
    }
    if (!deepEqual(currentValue, desiredValue)) conflicts += 1
  }

  changes.pluginData = replaceElementSourceMetadata(
    current,
    desired,
    conflicts > 0 ? 'conflict' : 'current'
  )
  targetGraph.preserveSourceMetadataDuring(() => {
    targetGraph.updateNode(current.id, changes)
  })
  result.updated += 1
  result.preservedOverrides += conflicts
}

function reconcileDesiredSubtree(
  desiredGraph: SceneGraph,
  desired: SceneNode,
  targetGraph: SceneGraph,
  parentId: string,
  insertIndex: number,
  currentBySourceId: Map<string, SceneNode>,
  result: ReconcileDesignDocumentResult,
  consumedSourceIds: Set<string>
): SceneNode {
  const sourceId = sourceIdForNode(desired)
  const current = sourceId ? currentBySourceId.get(sourceId) : undefined
  if (!current) {
    const created = cloneDesiredSubtree(
      desiredGraph,
      desired,
      targetGraph,
      parentId,
      result,
      consumedSourceIds
    )
    targetGraph.insertChildAt(created.id, parentId, insertIndex)
    return created
  }

  if (!sourceId) throw new Error('Matched source node is missing its source ID')
  consumedSourceIds.add(sourceId)
  if (current.type !== desired.type) {
    const replacement = cloneDesiredSubtree(
      desiredGraph,
      desired,
      targetGraph,
      parentId,
      result,
      consumedSourceIds
    )
    targetGraph.insertChildAt(replacement.id, parentId, insertIndex)
    targetGraph.deleteNode(current.id)
    result.replaced += 1
    return replacement
  }

  if (current.parentId !== parentId) targetGraph.reparentNode(current.id, parentId)
  targetGraph.insertChildAt(current.id, parentId, insertIndex)
  mergeDesiredNode(targetGraph, current, desired, result)

  for (const [childIndex, desiredChild] of desiredGraph.getChildren(desired.id).entries()) {
    reconcileDesiredSubtree(
      desiredGraph,
      desiredChild,
      targetGraph,
      current.id,
      childIndex,
      currentBySourceId,
      result,
      consumedSourceIds
    )
  }
  return current
}

function removeMissingSourceNodes(
  graph: SceneGraph,
  currentBySourceId: Map<string, SceneNode>,
  consumedSourceIds: Set<string>,
  result: ReconcileDesignDocumentResult
): void {
  const missing = [...currentBySourceId.entries()].filter(
    ([sourceId]) => !consumedSourceIds.has(sourceId)
  )
  const missingIds = new Set(missing.map(([, node]) => node.id))

  for (const [, node] of missing) {
    if (!graph.getNode(node.id) || (node.parentId && missingIds.has(node.parentId))) continue
    const baseline = sourceBaselineForNode(node)
    const unchanged = baseline !== null && deepEqual(sourceControlledSnapshot(node), baseline)
    if (unchanged) {
      graph.deleteNode(node.id)
      result.deleted += 1
      continue
    }
    graph.updateNode(node.id, { pluginData: replaceSourceStatus(node, 'detached') })
    result.detached += 1
  }
}

/**
 * Re-import DesignDOM into an existing page with a three-way merge.
 * Source-owned properties update, manual canvas overrides survive, and stable source IDs retain
 * their SceneNode IDs. Deleted but manually edited source layers are detached instead of erased.
 */
export function reconcileDesignDocumentToSceneGraph(
  graph: SceneGraph,
  document: DesignDocument,
  options: ReconcileDesignDocumentOptions = {}
): ReconcileDesignDocumentResult {
  const parentId = options.parentId ?? graph.getPages()[0]?.id
  if (!parentId || !graph.getNode(parentId)) throw new Error('Reconciliation target is missing')

  const desiredGraph = designDocumentToSceneGraph(document, { pageName: options.pageName })
  const desiredPage = desiredGraph.getPages()[0]
  computeAllLayouts(desiredGraph, desiredPage.id)
  refreshSourceBaselines(desiredGraph)
  sourceIndex(desiredGraph, desiredPage.id)
  const currentBySourceId = sourceIndex(graph, parentId)

  for (const [hash, bytes] of desiredGraph.images) graph.images.set(hash, bytes)
  const targetParent = graph.getNode(parentId)
  if (targetParent) {
    graph.updateNode(targetParent.id, {
      pluginData: replaceDocumentSourceMetadata(targetParent, desiredPage)
    })
  }

  const result: ReconcileDesignDocumentResult = {
    created: 0,
    updated: 0,
    deleted: 0,
    detached: 0,
    replaced: 0,
    preservedOverrides: 0,
    rootIds: []
  }
  const consumedSourceIds = new Set<string>()
  for (const [index, desiredRoot] of desiredGraph.getChildren(desiredPage.id).entries()) {
    const root = reconcileDesiredSubtree(
      desiredGraph,
      desiredRoot,
      graph,
      parentId,
      index,
      currentBySourceId,
      result,
      consumedSourceIds
    )
    result.rootIds.push(root.id)
  }
  removeMissingSourceNodes(graph, currentBySourceId, consumedSourceIds, result)
  return result
}
