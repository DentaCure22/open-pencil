import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { isCodeObjectFrame } from './model'

export function codeObjectFramesForOverlay(graph: SceneGraph, pageId: string): SceneNode[] {
  const seenFrameIds = new Set<string>()
  return graph.getChildren(pageId).filter((node) => {
    if (!isCodeObjectFrame(node) || !node.visible || seenFrameIds.has(node.id)) return false
    seenFrameIds.add(node.id)
    return true
  })
}
