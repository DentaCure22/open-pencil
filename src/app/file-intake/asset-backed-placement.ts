import type { Editor } from '@open-pencil/core/editor'
import type { SceneNode } from '@open-pencil/scene-graph'

import { hasAssetReference } from '@/app/media-evidence/assets'

export type CreatedAssetBackedSurface = {
  assetHash: string
  bytes: Uint8Array
  root: SceneNode
  snapshots: SceneNode[]
}

export type AssetBackedFilePlacementResult = {
  fallbackFiles: File[]
  placedIds: string[]
}

type CreateAssetBackedSurface = (
  editor: Editor,
  file: File,
  cx: number,
  cy: number,
  offset: number
) => Promise<CreatedAssetBackedSurface>

type AssetBackedPlacementOptions = {
  createSurface: CreateAssetBackedSurface
  pluralLabel: string
  singularLabel: string
}

function setSelection(editor: Editor, ids: string[]): void {
  if (ids.length > 0) editor.select(ids)
  else editor.clearSelection()
}

export function captureAssetBackedSurface(
  editor: Editor,
  root: SceneNode,
  assetHash: string,
  bytes: Uint8Array
): CreatedAssetBackedSurface {
  editor.graph.images.set(assetHash, bytes)
  const persistedRoot = editor.graph.getNode(root.id) ?? root
  return {
    assetHash,
    bytes,
    root: persistedRoot,
    snapshots: [structuredClone(persistedRoot)]
  }
}

export function restoreSceneNodeSnapshots(editor: Editor, snapshots: SceneNode[]): void {
  for (const snapshot of snapshots) {
    editor.graph.createNodeWithId(
      snapshot.id,
      snapshot.type,
      snapshot.parentId ?? editor.state.currentPageId,
      { ...structuredClone(snapshot), childIds: [] }
    )
  }
}

export async function placeAssetBackedFiles(
  editor: Editor,
  files: File[],
  cx: number,
  cy: number,
  options: AssetBackedPlacementOptions
): Promise<AssetBackedFilePlacementResult> {
  const previousSelection = [...editor.state.selectedIds]
  const created: CreatedAssetBackedSurface[] = []
  const fallbackFiles: File[] = []
  for (const [index, file] of files.entries()) {
    try {
      created.push(await options.createSurface(editor, file, cx, cy, index))
    } catch {
      fallbackFiles.push(file)
    }
  }

  const placedIds = created.map(({ root }) => root.id)
  if (placedIds.length === 0) return { fallbackFiles, placedIds }

  editor.select(placedIds)
  editor.undo.push({
    forward: () => {
      for (const item of created) {
        editor.graph.images.set(item.assetHash, item.bytes)
        restoreSceneNodeSnapshots(editor, item.snapshots)
      }
      editor.select(placedIds)
      editor.requestRender()
    },
    inverse: () => {
      for (const id of placedIds) editor.graph.deleteNode(id)
      for (const item of created) {
        if (!hasAssetReference(editor, item.assetHash)) editor.graph.images.delete(item.assetHash)
      }
      setSelection(editor, previousSelection)
      editor.requestRender()
    },
    label: files.length === 1 ? options.singularLabel : options.pluralLabel
  })
  editor.requestRender()
  return { fallbackFiles, placedIds }
}
