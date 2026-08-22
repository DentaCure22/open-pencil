import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { isCodeObjectFrame } from './model'

export function codeObjectFramesForOverlay(graph: SceneGraph, pageId: string): SceneNode[] {
  const seenFrameIds = new Set<string>()
  const frames: SceneNode[] = []

  function visit(parentId: string) {
    for (const node of graph.getChildren(parentId)) {
      if (!node.visible) continue
      const nodeId = node.id
      if (isCodeObjectFrame(node)) {
        if (seenFrameIds.has(nodeId)) continue
        seenFrameIds.add(nodeId)
        frames.push(node)
        continue
      }
      visit(nodeId)
    }
  }

  visit(pageId)
  return frames
}
