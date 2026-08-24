import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { codeObjectDocument, type CodeObjectDocument } from './model'

type CachedOverlayDocument = {
  document: CodeObjectDocument | null
  pluginData: SceneNode['pluginData']
}

const overlayDocumentCache = new WeakMap<SceneNode, CachedOverlayDocument>()

export function cachedCodeObjectDocument(node: SceneNode): CodeObjectDocument | null {
  const current = overlayDocumentCache.get(node)
  if (current && current.pluginData === node.pluginData) return current.document
  const document = codeObjectDocument(node)
  overlayDocumentCache.set(node, { document, pluginData: node.pluginData })
  return document
}

export function overlayListNeedsRescan(changes: Partial<SceneNode>): boolean {
  return (
    'visible' in changes ||
    'pluginData' in changes ||
    'type' in changes ||
    'internalOnly' in changes
  )
}

export function codeObjectFramesForOverlay(graph: SceneGraph, pageId: string): SceneNode[] {
  const seenFrameIds = new Set<string>()
  const frames: SceneNode[] = []

  function visit(parentId: string) {
    const parent = graph.getNode(parentId)
    if (!parent) return
    for (const childId of parent.childIds) {
      const node = graph.getNode(childId)
      if (!node || !node.visible) continue
      const nodeId = node.id
      if (cachedCodeObjectDocument(node)) {
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
