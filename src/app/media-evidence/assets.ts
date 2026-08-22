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

export function restoreAssetNodes(
  editor: Editor,
  pageId: string,
  assets: readonly { bytes: Uint8Array; hash: string }[],
  snapshots: readonly SceneNode[]
): void {
  for (const asset of assets) editor.graph.images.set(asset.hash, asset.bytes)
  for (const snapshot of snapshots) {
    editor.graph.createNode(snapshot.type, pageId, structuredClone(snapshot))
  }
}
