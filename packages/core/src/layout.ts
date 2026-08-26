import { Direction } from 'yoga-layout'

import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { applyYogaLayout } from './layout/apply'
import { buildFlexTree } from './layout/flex-tree'
import { buildGridTree } from './layout/grid'
import { freeYogaTree } from './layout/yoga-helpers'
import { resolveNodeLayoutDirection } from './text/direction'

export {
  estimateTextSize,
  getTextMeasurer,
  setTextMeasurer,
  type TextMeasurer
} from './layout/text-measurement'

export function computeLayout(graph: SceneGraph, frameId: string): void {
  const frame = graph.getNode(frameId)
  if (!frame || frame.layoutMode === 'NONE') return

  const rootDirection = resolveComputedLayoutDirection(graph, frame)
  const yogaRoot =
    frame.layoutMode === 'GRID'
      ? buildGridTree(graph, frame, rootDirection)
      : buildFlexTree(graph, frame, rootDirection)
  yogaRoot.calculateLayout(
    undefined,
    undefined,
    rootDirection === 'RTL' ? Direction.RTL : Direction.LTR
  )
  applyYogaLayout(graph, frame, yogaRoot, computeLayout)
  freeYogaTree(yogaRoot)
}

function resolveComputedLayoutDirection(
  graph: SceneGraph,
  node: Pick<SceneNode, 'layoutDirection' | 'parentId'>
): 'LTR' | 'RTL' {
  const parent = node.parentId ? graph.getNode(node.parentId) : null
  const inheritedDirection = parent ? resolveComputedLayoutDirection(graph, parent) : 'LTR'
  return resolveNodeLayoutDirection(node, inheritedDirection)
}

export function computeAllLayouts(graph: SceneGraph, scopeId?: string): void {
  const visited = new Set<string>()
  computeLayoutsBottomUp(graph, scopeId ?? graph.rootId, visited)
}

function computeLayoutsBottomUp(graph: SceneGraph, nodeId: string, visited: Set<string>): void {
  const node = graph.getNode(nodeId)
  if (!node || visited.has(nodeId)) return
  visited.add(nodeId)

  for (const childId of node.childIds) {
    computeLayoutsBottomUp(graph, childId, visited)
  }

  if (node.layoutMode !== 'NONE' && !preservesImportedInstanceLayout(node)) {
    computeLayout(graph, nodeId)
  }
}

function preservesImportedInstanceLayout(node: SceneNode): boolean {
  return node.type === 'INSTANCE' && node.source.format === 'fig'
}
