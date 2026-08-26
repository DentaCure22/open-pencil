import type { SmylrLiveContainerNode, SmylrLiveContainerRect } from '../smylr-live-container/types'

export type SmylrLiveInspectorFlatNode = {
  childCount: number
  depth: number
  node: SmylrLiveContainerNode
}

export type LiveInspectorNavigationDirection = 'child' | 'next' | 'parent' | 'previous'

export type LiveInspectorTreeIndex = {
  adjacentNode(
    id: string,
    direction: LiveInspectorNavigationDirection,
    fallbackId?: string
  ): SmylrLiveContainerNode | null
  flatNodes: readonly SmylrLiveInspectorFlatNode[]
  node(id: string | null): SmylrLiveContainerNode | null
  rect(id: string | null): SmylrLiveContainerRect | null
}

export function findLiveInspectorNode(
  node: SmylrLiveContainerNode | undefined,
  id: string | null
): SmylrLiveContainerNode | null {
  if (!node || !id) return null
  if (node.id === id) return node
  for (const child of node.children ?? []) {
    const match = findLiveInspectorNode(child, id)
    if (match) return match
  }
  return null
}

/** Resolve a tree node's parent-relative measurements into frame-local bounds. */
export function findLiveInspectorNodeRect(
  node: SmylrLiveContainerNode | undefined,
  id: string | null,
  offsetX = 0,
  offsetY = 0
): SmylrLiveContainerRect | null {
  if (!node || !id) return null
  const x = offsetX + node.rect.x
  const y = offsetY + node.rect.y
  if (node.id === id) return { height: node.rect.height, width: node.rect.width, x, y }
  for (const child of node.children ?? []) {
    const match = findLiveInspectorNodeRect(child, id, x, y)
    if (match) return match
  }
  return null
}

export function createLiveInspectorTreeIndex(
  root: SmylrLiveContainerNode | undefined
): LiveInspectorTreeIndex {
  const nodes = new Map<string, SmylrLiveContainerNode>()
  const parents = new Map<string, SmylrLiveContainerNode>()
  const rects = new Map<string, SmylrLiveContainerRect>()
  const flatNodes: SmylrLiveInspectorFlatNode[] = []

  function visit(
    node: SmylrLiveContainerNode,
    depth: number,
    offsetX: number,
    offsetY: number,
    parent?: SmylrLiveContainerNode
  ) {
    const x = offsetX + node.rect.x
    const y = offsetY + node.rect.y
    nodes.set(node.id, node)
    if (parent) parents.set(node.id, parent)
    rects.set(node.id, { height: node.rect.height, width: node.rect.width, x, y })
    flatNodes.push({ childCount: node.children?.length ?? 0, depth, node })
    for (const child of node.children ?? []) visit(child, depth + 1, x, y, node)
  }

  if (root) visit(root, 0, 0, 0)

  return {
    adjacentNode(id, direction, fallbackId) {
      const selectedNode = nodes.get(id) ?? root
      if (!selectedNode) return null
      if (direction === 'child') return selectedNode.children?.[0] ?? null
      if (direction === 'parent') return parents.get(id) ?? null
      const index = flatNodes.findIndex((item) => item.node.id === id)
      const fallbackIndex = fallbackId
        ? flatNodes.findIndex((item) => item.node.id === fallbackId)
        : -1
      const currentIndex = index !== -1 ? index : fallbackIndex
      const nextIndex = direction === 'next' ? currentIndex + 1 : currentIndex - 1
      return flatNodes[nextIndex]?.node ?? null
    },
    flatNodes,
    node: (id) => (id ? (nodes.get(id) ?? null) : null),
    rect: (id) => (id ? (rects.get(id) ?? null) : null)
  }
}
