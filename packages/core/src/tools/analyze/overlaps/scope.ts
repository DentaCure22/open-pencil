import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import type { AnalyzeOverlapsArgs, OverlapNodeSummary, OverlapScope } from './index'

export function parseNodeTypes(raw: string | undefined): Set<string> | undefined {
  if (!raw) return undefined
  const types = raw
    .split(',')
    .map((value) => value.trim().toUpperCase())
    .filter((value) => value.length > 0)
  return types.length > 0 ? new Set(types) : undefined
}

export function toNodeSummary(node: SceneNode): OverlapNodeSummary {
  return {
    id: node.id,
    name: node.name,
    type: node.type,
    parentId: node.parentId,
    x: Math.round(node.x),
    y: Math.round(node.y),
    width: Math.round(node.width),
    height: Math.round(node.height),
    rotation: Math.round(node.rotation),
    opacity: node.opacity,
    visible: node.visible,
    locked: node.locked
  }
}

export function isEffectivelyHidden(graph: SceneGraph, node: SceneNode): boolean {
  let current: SceneNode | undefined = node
  while (current) {
    if (!current.visible) return true
    current = current.parentId ? graph.getNode(current.parentId) : undefined
  }
  return false
}

export function isEffectivelyLocked(graph: SceneGraph, node: SceneNode): boolean {
  let current: SceneNode | undefined = node
  while (current) {
    if (current.locked) return true
    current = current.parentId ? graph.getNode(current.parentId) : undefined
  }
  return false
}

export function findPageId(graph: SceneGraph, node: SceneNode): string | null {
  let current: SceneNode | undefined = node
  while (current) {
    if (current.type === 'CANVAS') return current.id
    if (current.parentId === null) return null
    current = graph.getNode(current.parentId)
  }
  return null
}

export function findPageIdByName(graph: SceneGraph, name: string | undefined): string | undefined {
  if (!name) return undefined
  const page = graph.getPages().find((candidate) => candidate.name === name)
  return page?.id
}

export function pairRelationship(
  nodeA: SceneNode,
  nodeB: SceneNode,
  graph: SceneGraph
): {
  sameParent: boolean
  topLevel: boolean
  insideParent: boolean
  ancestor: 'neither' | 'a-ancestor' | 'b-ancestor'
} {
  const sameParent = nodeA.parentId === nodeB.parentId && nodeA.parentId !== null
  const parentA = nodeA.parentId ? graph.getNode(nodeA.parentId) : undefined
  const parentB = nodeB.parentId ? graph.getNode(nodeB.parentId) : undefined
  const topLevel = parentA?.type === 'CANVAS' && parentB?.type === 'CANVAS'
  const insideParent = sameParent && parentA?.type !== 'CANVAS'
  let ancestor: 'neither' | 'a-ancestor' | 'b-ancestor' = 'neither'
  if (nodeA.id !== nodeB.id) {
    if (graph.isDescendant(nodeB.id, nodeA.id)) ancestor = 'a-ancestor'
    else if (graph.isDescendant(nodeA.id, nodeB.id)) ancestor = 'b-ancestor'
  }
  return { sameParent, topLevel, insideParent, ancestor }
}

export function matchesParentOverflowScope(scope: OverlapScope): boolean {
  return scope === 'all' || scope === 'inside-parent'
}

export function matchesScope(
  relationship: ReturnType<typeof pairRelationship>,
  scope: OverlapScope
): boolean {
  switch (scope) {
    case 'all':
      return true
    case 'same-parent':
      return relationship.sameParent
    case 'cross-parent':
      return !relationship.sameParent
    case 'top-level':
      return relationship.topLevel
    case 'inside-parent':
      return relationship.insideParent
    default:
      return true
  }
}

function isCandidate(
  node: SceneNode,
  graph: SceneGraph,
  options: {
    includeHidden: boolean
    includeLocked: boolean
    includeAbsolute: boolean
    pageId: string | undefined
  }
): boolean {
  if (node.type === 'CANVAS') return false
  if (!options.includeHidden && isEffectivelyHidden(graph, node)) return false
  if (!options.includeLocked && isEffectivelyLocked(graph, node)) return false
  if (!options.includeAbsolute && node.layoutPositioning === 'ABSOLUTE') return false
  if (options.pageId && findPageId(graph, node) !== options.pageId) return false
  return true
}

export function filterNodes(
  graph: SceneGraph,
  args: AnalyzeOverlapsArgs
): { candidates: SceneNode[]; totalNodes: number; analyzedNodes: number } {
  const includeHidden = args.include_hidden === true
  const includeLocked = args.include_locked === true
  const includeAbsolute = args.include_absolute === true
  const pageIdFilter = args.page_id?.trim()
  const typeFilter = parseNodeTypes(args.type)

  const candidates: SceneNode[] = []
  let totalNodes = 0

  for (const node of graph.getAllNodes()) {
    if (node.type === 'CANVAS') continue
    if (pageIdFilter && findPageId(graph, node) !== pageIdFilter) continue
    totalNodes++
    if (
      !isCandidate(node, graph, {
        includeHidden,
        includeLocked,
        includeAbsolute,
        pageId: undefined
      })
    ) {
      continue
    }
    if (typeFilter && !typeFilter.has(node.type)) continue
    candidates.push(node)
  }

  return { candidates, totalNodes, analyzedNodes: candidates.length }
}
