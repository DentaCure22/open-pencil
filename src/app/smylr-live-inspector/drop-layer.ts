import type { SmylrLiveContainerNode } from '../smylr-live-container/types'

export type LiveDropLayerDirection = 'above' | 'below'

type ResolveLiveDropLayerOptions = {
  currentStyles?: Record<string, string>
  direction: LiveDropLayerDirection
  selected: SmylrLiveContainerNode
  tree: SmylrLiveContainerNode
  x: number
  y: number
}

function liveNodePath(
  node: SmylrLiveContainerNode,
  id: string,
  path: SmylrLiveContainerNode[] = []
): SmylrLiveContainerNode[] | null {
  const nextPath = [...path, node]
  if (node.id === id) return nextPath
  for (const child of node.children ?? []) {
    const match = liveNodePath(child, id, nextPath)
    if (match) return match
  }
  return null
}

function deepestDropTarget(
  node: SmylrLiveContainerNode,
  x: number,
  y: number,
  selectedId: string,
  excludedIds: Set<string>,
  offsetX = 0,
  offsetY = 0
): SmylrLiveContainerNode | null {
  if (node.id === selectedId) return null
  const absoluteX = offsetX + node.rect.x
  const absoluteY = offsetY + node.rect.y
  if (
    x < absoluteX ||
    y < absoluteY ||
    x > absoluteX + node.rect.width ||
    y > absoluteY + node.rect.height
  ) {
    return null
  }

  // Later DOM siblings normally paint above earlier siblings.
  for (const child of [...(node.children ?? [])].reverse()) {
    const match = deepestDropTarget(
      child,
      x,
      y,
      selectedId,
      excludedIds,
      absoluteX,
      absoluteY
    )
    if (match) return match
  }
  return excludedIds.has(node.id) ? null : node
}

function numericZIndex(value: string | undefined) {
  if (!value || value === 'auto') return 0
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : 0
}

export function resolveLiveDropLayer({
  currentStyles,
  direction,
  selected,
  tree,
  x,
  y
}: ResolveLiveDropLayerOptions) {
  const selectedPath = liveNodePath(tree, selected.id) ?? []
  const excludedIds = new Set(selectedPath.map((node) => node.id))
  const target = deepestDropTarget(tree, x, y, selected.id, excludedIds)
  if (!target) return null

  const targetZIndex = numericZIndex(target.computedStyle?.['z-index'])
  const styles: Record<string, string> = {
    ...currentStyles,
    'z-index': String(targetZIndex + (direction === 'above' ? 1 : -1))
  }
  const currentPosition = currentStyles?.position ?? selected.computedStyle?.position
  if (!currentPosition || currentPosition === 'static') styles.position = 'relative'
  return { direction, styles, target }
}
