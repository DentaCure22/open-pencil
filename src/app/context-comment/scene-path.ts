import type { SceneNode } from '@open-pencil/scene-graph'

import type { EditorStore } from '@/app/editor/session'

export function contextCommentNodePath(store: EditorStore, node: SceneNode): string[] {
  const path: string[] = []
  const visited = new Set<string>()
  let current: SceneNode | undefined = node
  while (current && path.length < 32 && !visited.has(current.id)) {
    visited.add(current.id)
    path.unshift(current.name || current.type)
    current = current.parentId ? store.graph.getNode(current.parentId) : undefined
  }
  return path
}
