import { TRANSPARENT } from '@open-pencil/core/constants'
import type { Editor } from '@open-pencil/core/editor'
import { CONTENT_SOURCE_REVISION, contentSourcePluginData } from '@open-pencil/core/io'
import type { Fill, SceneNode } from '@open-pencil/scene-graph'
import { assetReference, computeImageHash } from '@open-pencil/scene-graph/images'

import { hasAssetReference } from '@/app/media-evidence/assets'
import type { MediaEvidenceSource } from '@/app/media-evidence/source'

const EXTRACTED_PAGE_GAP = 32
const EXTRACTED_PAGE_WIDTH = 420
const MEDIA_PLUGIN_ID = 'open-pencil'
const EXTRACTION_VIEWPORT_INSETS = { bottom: 72, left: 264, right: 24, top: 80 }

export type ExtractedMediaImage = {
  bytes: Uint8Array
  fileName: string
  height: number
  width: number
}

type ExtractionMetadata = {
  key: string
  value: string
}

function pluginData(key: string, value: string): SceneNode['pluginData'][number] {
  return { key, pluginId: MEDIA_PLUGIN_ID, value }
}

function extractedMediaPluginData(
  image: ExtractedMediaImage,
  sourceNodeId: string,
  source: MediaEvidenceSource,
  hash: string,
  kind: 'pdf-page' | 'video-frame',
  metadata: ExtractionMetadata
): SceneNode['pluginData'] {
  return [
    ...contentSourcePluginData({
      fileName: image.fileName,
      format: 'png',
      mimeType: 'image/png',
      revision: CONTENT_SOURCE_REVISION,
      source: assetReference(hash)
    }),
    pluginData('media-evidence/kind', kind),
    pluginData('media-evidence/source-node-id', sourceNodeId),
    pluginData('media-evidence/source-asset-hash', source.assetHash),
    pluginData(metadata.key, metadata.value)
  ]
}

function extractedPageOffset(editor: Editor, sourceNodeId: string): number {
  return [...editor.graph.getAllNodes()].filter((node) =>
    node.pluginData.some(
      (entry) =>
        entry.pluginId === MEDIA_PLUGIN_ID &&
        entry.key === 'media-evidence/source-node-id' &&
        entry.value === sourceNodeId
    )
  ).length
}

function placeExtractedMediaImage(
  editor: Editor,
  sourceNode: SceneNode,
  source: MediaEvidenceSource,
  image: ExtractedMediaImage,
  kind: 'pdf-page' | 'video-frame',
  metadata: ExtractionMetadata,
  undoLabel: string
): string {
  const previousSelection = new Set(editor.state.selectedIds)
  const pageId = editor.state.currentPageId
  const absolute = editor.graph.getAbsolutePosition(sourceNode.id)
  const offset = extractedPageOffset(editor, sourceNode.id)
  const width = EXTRACTED_PAGE_WIDTH
  const height = width * (image.height / image.width)
  const hash = computeImageHash(image.bytes)
  const fill: Fill = {
    color: TRANSPARENT,
    imageHash: hash,
    imageScaleMode: 'FIT',
    opacity: 1,
    type: 'IMAGE',
    visible: true
  }

  editor.graph.images.set(hash, image.bytes)
  const node = editor.graph.createNode('RECTANGLE', pageId, {
    fills: [fill],
    height,
    name: image.fileName.replace(/\.png$/i, ''),
    pluginData: extractedMediaPluginData(image, sourceNode.id, source, hash, kind, metadata),
    width,
    x: absolute.x + sourceNode.width + EXTRACTED_PAGE_GAP + offset * EXTRACTED_PAGE_GAP,
    y: absolute.y + offset * EXTRACTED_PAGE_GAP
  })
  const snapshot = structuredClone(node)
  editor.select([node.id])
  editor.undo.push({
    label: undoLabel,
    forward: () => {
      editor.graph.images.set(hash, image.bytes)
      editor.graph.createNodeWithId(snapshot.id, snapshot.type, pageId, structuredClone(snapshot))
      editor.select([snapshot.id])
      editor.requestRender()
    },
    inverse: () => {
      editor.graph.deleteNode(snapshot.id)
      if (!hasAssetReference(editor, hash)) editor.graph.images.delete(hash)
      if (previousSelection.size > 0) editor.select([...previousSelection])
      else editor.clearSelection()
      editor.requestRender()
    }
  })
  editor.requestRender()
  editor.zoomToBounds(
    Math.min(absolute.x, node.x),
    Math.min(absolute.y, node.y),
    Math.max(absolute.x + sourceNode.width, node.x + node.width),
    Math.max(absolute.y + sourceNode.height, node.y + node.height),
    EXTRACTION_VIEWPORT_INSETS
  )
  return node.id
}

export function placeExtractedPdfPage(
  editor: Editor,
  sourceNode: SceneNode,
  source: MediaEvidenceSource,
  pageNumber: number,
  image: ExtractedMediaImage
): string {
  return placeExtractedMediaImage(
    editor,
    sourceNode,
    source,
    image,
    'pdf-page',
    { key: 'media-evidence/pdf-page', value: String(pageNumber) },
    `Extract PDF page ${pageNumber}`
  )
}

export function placeExtractedVideoFrame(
  editor: Editor,
  sourceNode: SceneNode,
  source: MediaEvidenceSource,
  timeMs: number,
  image: ExtractedMediaImage
): string {
  return placeExtractedMediaImage(
    editor,
    sourceNode,
    source,
    image,
    'video-frame',
    { key: 'media-evidence/video-time-ms', value: String(timeMs) },
    'Capture video frame'
  )
}
