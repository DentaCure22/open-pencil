import type { SceneNode } from '@open-pencil/scene-graph'

import type { EditorContext } from '#core/editor/types'

export type OverflowDetach = { id: string; parentId: string }

export function isChildFullyOutsideParent(
  child: Pick<SceneNode, 'height' | 'width' | 'x' | 'y'>,
  parent: Pick<SceneNode, 'height' | 'width'>
): boolean {
  return (
    child.x + child.width < 0 ||
    child.x > parent.width ||
    child.y + child.height < 0 ||
    child.y > parent.height
  )
}

function isPageLevelParent(ctx: EditorContext, parentId: string | null): boolean {
  return !parentId || parentId === ctx.graph.rootId || parentId === ctx.state.currentPageId
}

function isFrameContainer(node: SceneNode | undefined): node is SceneNode {
  return node?.type === 'FRAME' || node?.type === 'SECTION'
}

function detachChildIfOutside(
  ctx: EditorContext,
  id: string,
  seen: Set<string>
): OverflowDetach | null {
  if (seen.has(id)) return null
  const node = ctx.graph.getNode(id)
  if (!node?.parentId || isPageLevelParent(ctx, node.parentId)) return null
  const parent = ctx.graph.getNode(node.parentId)
  if (!isFrameContainer(parent) || !isChildFullyOutsideParent(node, parent)) return null
  seen.add(id)
  const parentId = parent.id
  const grandparentId = parent.parentId ?? ctx.state.currentPageId
  ctx.graph.reparentNode(id, grandparentId)
  return { id, parentId }
}

export function detachOutsideFrameMembership(
  ctx: EditorContext,
  nodeIds: Iterable<string>
): OverflowDetach[] {
  const detached: OverflowDetach[] = []
  const seen = new Set<string>()

  for (const id of nodeIds) {
    const node = ctx.graph.getNode(id)
    if (isFrameContainer(node)) {
      for (const childId of node.childIds.slice()) {
        const result = detachChildIfOutside(ctx, childId, seen)
        if (result) detached.push(result)
      }
    }
    const result = detachChildIfOutside(ctx, id, seen)
    if (result) detached.push(result)
  }

  return detached
}
