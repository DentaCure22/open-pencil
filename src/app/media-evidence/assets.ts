import type { Editor } from '@open-pencil/core/editor'
import { readContentSource } from '@open-pencil/core/io'
import type { SceneNode } from '@open-pencil/scene-graph'
import { assetHashFromReference } from '@open-pencil/scene-graph/images'

export function contentSourceAssetHash(node: SceneNode): string | null {
  const source = readContentSource(node)
  return source ? assetHashFromReference(source.source) : null
}

export function hasAssetReference(editor: Editor, hash: string): boolean {
  for (const node of editor.graph.getAllNodes()) {
    if (contentSourceAssetHash(node) === hash) return true
    if (node.fills.some((fill) => fill.imageHash === hash)) return true
  }
  return false
}
