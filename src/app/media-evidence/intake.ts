import type { Editor } from '@open-pencil/core/editor'
import { CONTENT_SOURCE_REVISION, contentSourcePluginData } from '@open-pencil/core/io'
import type { SceneNode } from '@open-pencil/scene-graph'
import { assetReference, computeImageHash } from '@open-pencil/scene-graph/images'
import type { Rect } from '@open-pencil/scene-graph/primitives'

import { contentSourceAssetHash, hasAssetReference } from '@/app/media-evidence/assets'
import {
  fileExtension,
  mediaEvidenceFrameSize,
  mediaEvidenceMimeType,
  mediaIntakeKind,
  type MediaEvidenceKind
} from '@/app/media-evidence/source'
import { placePdfFiles } from '@/app/pdf-intake/intake'

const MEDIA_GAP = 32
const MEDIA_CASCADE_STEP = 32
const MEDIA_CASCADE_ATTEMPTS = 24
const MEDIA_CASCADE_OVERLAP_RATIO = 0.94

type PreparedMediaEvidence = {
  bytes: Uint8Array
  file: File
  fileName: string
  hash: string
  kind: MediaEvidenceKind
  size: { height: number; width: number }
}

function setSelection(editor: Editor, ids: Set<string>) {
  if (ids.size > 0) editor.select([...ids])
  else editor.clearSelection()
}

function intersectionRatio(first: Rect, second: Rect): number {
  const intersectionWidth = Math.max(
    0,
    Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x)
  )
  const intersectionHeight = Math.max(
    0,
    Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y)
  )
  if (intersectionWidth === 0 || intersectionHeight === 0) return 0
  const smallerArea = Math.min(first.width * first.height, second.width * second.height)
  return smallerArea > 0 ? (intersectionWidth * intersectionHeight) / smallerArea : 0
}

function cascadedMediaPlacement(editor: Editor, pageId: string, bounds: Rect): Rect {
  const occupied = editor.graph
    .getChildren(pageId)
    .filter((node) => Boolean(contentSourceAssetHash(node)))
    .map((node) => ({ height: node.height, width: node.width, x: node.x, y: node.y }))
  let candidate = bounds
  for (let attempt = 0; attempt < MEDIA_CASCADE_ATTEMPTS; attempt++) {
    let conflicts = false
    for (const item of occupied) {
      if (intersectionRatio(candidate, item) >= MEDIA_CASCADE_OVERLAP_RATIO) {
        conflicts = true
        break
      }
    }
    if (!conflicts) return candidate
    candidate = {
      ...bounds,
      x: bounds.x + MEDIA_CASCADE_STEP * (attempt + 1),
      y: bounds.y + MEDIA_CASCADE_STEP * (attempt + 1)
    }
  }
  return candidate
}

async function prepareViewerFile(file: File): Promise<PreparedMediaEvidence | null> {
  const kind = mediaIntakeKind(file)
  if (!kind || kind === 'pdf' || kind === 'raster') return null
  const bytes = new Uint8Array(await file.arrayBuffer())
  return {
    bytes,
    file,
    fileName: file.name.trim() || `Untitled ${kind}`,
    hash: computeImageHash(bytes),
    kind,
    size: mediaEvidenceFrameSize(kind)
  }
}

async function placeViewerFiles(editor: Editor, files: File[], cx: number, cy: number) {
  const prepared = (await Promise.all(files.map((file) => prepareViewerFile(file)))).filter(
    (item): item is PreparedMediaEvidence => item !== null
  )
  if (prepared.length === 0) return []

  const previousSelection = new Set(editor.state.selectedIds)
  const pageId = editor.state.currentPageId
  const totalWidth =
    prepared.reduce((sum, item) => sum + item.size.width, 0) + MEDIA_GAP * (prepared.length - 1)
  const maxHeight = Math.max(...prepared.map((item) => item.size.height))
  const placement = cascadedMediaPlacement(editor, pageId, {
    height: maxHeight,
    width: totalWidth,
    x: cx - totalWidth / 2,
    y: cy - maxHeight / 2
  })
  let x = placement.x
  const snapshots: SceneNode[] = []

  for (const item of prepared) {
    editor.graph.images.set(item.hash, item.bytes)
    const node = editor.graph.createNode('FRAME', pageId, {
      name: item.fileName.replace(/\.[^.]+$/, '') || item.fileName,
      x,
      y: placement.y,
      width: item.size.width,
      height: item.size.height,
      clipsContent: true,
      cornerRadius: 12,
      fills: [
        {
          type: 'SOLID',
          color: { r: 0.055, g: 0.059, b: 0.071, a: 1 },
          opacity: 1,
          visible: true
        }
      ],
      strokes: [
        {
          align: 'INSIDE',
          color: { r: 0.42, g: 0.39, b: 0.58, a: 0.55 },
          opacity: 1,
          visible: true,
          weight: 1
        }
      ],
      pluginData: contentSourcePluginData({
        fileName: item.fileName,
        format: fileExtension(item.fileName) || item.kind,
        mimeType: mediaEvidenceMimeType(item.file, item.kind),
        revision: CONTENT_SOURCE_REVISION,
        source: assetReference(item.hash)
      })
    })
    snapshots.push(structuredClone(node))
    x += item.size.width + MEDIA_GAP
  }

  const ids = snapshots.map((node) => node.id)
  setSelection(editor, new Set(ids))
  editor.undo.push({
    label: 'Place media evidence',
    forward: () => {
      for (const item of prepared) editor.graph.images.set(item.hash, item.bytes)
      for (const snapshot of snapshots) {
        editor.graph.createNode(snapshot.type, pageId, structuredClone(snapshot))
      }
      setSelection(editor, new Set(ids))
      editor.requestRender()
    },
    inverse: () => {
      for (const id of ids) editor.graph.deleteNode(id)
      for (const item of prepared) {
        if (!hasAssetReference(editor, item.hash)) editor.graph.images.delete(item.hash)
      }
      setSelection(editor, previousSelection)
      editor.requestRender()
    }
  })
  editor.requestRender()
  return ids
}

function viewerCenterBelowRasters(
  editor: Editor,
  rasterIds: string[],
  viewerFiles: File[],
  cy: number
) {
  if (rasterIds.length === 0 || viewerFiles.length === 0) return cy
  const rasterBottom = Math.max(
    ...rasterIds.map((id) => {
      const bounds = editor.graph.getAbsoluteBounds(id)
      return bounds.y + bounds.height
    })
  )
  const viewerHeight = Math.max(
    ...viewerFiles.map((file) => {
      const kind = mediaIntakeKind(file)
      return kind && kind !== 'raster' ? mediaEvidenceFrameSize(kind).height : 0
    })
  )
  return rasterBottom + MEDIA_GAP + viewerHeight / 2
}

export async function placeMediaEvidenceFiles(
  editor: Editor,
  files: File[],
  cx: number,
  cy: number
): Promise<string[]> {
  const pdfFiles = files.filter((file) => mediaIntakeKind(file) === 'pdf')
  const rasterFiles = files.filter((file) => mediaIntakeKind(file) === 'raster')
  const viewerFiles = files.filter((file) => {
    const kind = mediaIntakeKind(file)
    return kind !== null && kind !== 'pdf' && kind !== 'raster'
  })
  if (pdfFiles.length === 0 && rasterFiles.length === 0 && viewerFiles.length === 0) return []

  // Evidence is a board object, not a child of whichever frame happened to be selected.
  editor.clearSelection()

  const pdfIds = await placePdfFiles(editor, pdfFiles, cx, cy)
  const rasterIds = rasterFiles.length > 0 ? await editor.placeImageFiles(rasterFiles, cx, cy) : []
  const viewerY = viewerCenterBelowRasters(editor, rasterIds, viewerFiles, cy)
  const viewerIds = await placeViewerFiles(editor, viewerFiles, cx, viewerY)
  const ids = [...pdfIds, ...rasterIds, ...viewerIds]
  editor.select(ids)
  return ids
}
