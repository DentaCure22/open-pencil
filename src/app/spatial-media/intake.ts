import type { Editor } from '@open-pencil/core/editor'
import { CONTENT_SOURCE_REVISION, contentSourcePluginData } from '@open-pencil/core/io'
import type { SceneNode } from '@open-pencil/scene-graph'
import { rectIntersectionRatio } from '@open-pencil/scene-graph/geometry'
import { assetReference, computeImageHash } from '@open-pencil/scene-graph/images'
import type { Rect } from '@open-pencil/scene-graph/primitives'

import { restoreAssetNodes } from '@/app/media-evidence/assets'

import { classifySpatialFile } from './classify'
import { spatialMediaPluginData, spatialMediaSource } from './source'
import type {
  SpatialCameraState,
  SpatialPlacementFallback,
  SpatialPlacementResult,
  SpatialViewerClassification
} from './types'

const VIEWER_WIDTH = 720
const VIEWER_HEIGHT = 480
const VIEWER_GAP = 32
const CASCADE_STEP = 32
const CASCADE_ATTEMPTS = 24

type PreparedSpatialAsset = {
  bytes: Uint8Array
  classification: SpatialViewerClassification
  file: File
  fileName: string
  hash: string
}

function setSelection(editor: Editor, ids: string[]) {
  if (ids.length > 0) editor.select(ids)
  else editor.clearSelection()
}

function placementBounds(editor: Editor, count: number, cx: number, cy: number): Rect {
  const width = VIEWER_WIDTH * count + VIEWER_GAP * Math.max(0, count - 1)
  const initial = { height: VIEWER_HEIGHT, width, x: cx - width / 2, y: cy - VIEWER_HEIGHT / 2 }
  const occupied = editor.graph
    .getChildren(editor.state.currentPageId)
    .filter((node) => spatialMediaSource(node) !== null)
    .map((node) => ({ height: node.height, width: node.width, x: node.x, y: node.y }))
  for (let attempt = 0; attempt < CASCADE_ATTEMPTS; attempt++) {
    const candidate = {
      ...initial,
      x: initial.x + CASCADE_STEP * attempt,
      y: initial.y + CASCADE_STEP * attempt
    }
    if (!occupied.some((bounds) => rectIntersectionRatio(candidate, bounds) >= 0.9))
      return candidate
  }
  return initial
}

function hasAssetReference(editor: Editor, hash: string): boolean {
  for (const node of editor.graph.getAllNodes()) {
    const source = spatialMediaSource(node)
    if (source?.assetHash === hash || source?.previewHash === hash) return true
    if (node.fills.some((fill) => fill.imageHash === hash)) return true
  }
  return false
}

async function prepareAsset(
  file: File,
  classification: SpatialViewerClassification
): Promise<PreparedSpatialAsset> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  return {
    bytes,
    classification,
    file,
    fileName: file.name.trim() || `Untitled.${classification.format}`,
    hash: computeImageHash(bytes)
  }
}

function spatialMimeType(file: File, format: SpatialViewerClassification['format']): string {
  if (file.type) return file.type
  return format === 'glb' ? 'model/gltf-binary' : 'model/gltf+json'
}

export async function placeSpatialMediaFiles(
  editor: Editor,
  files: File[],
  cx: number,
  cy: number
): Promise<SpatialPlacementResult> {
  const fallbacks: SpatialPlacementFallback[] = []
  const viewerInputs: Array<{ classification: SpatialViewerClassification; file: File }> = []
  for (const file of files) {
    const classification = classifySpatialFile(file)
    if (classification.disposition === 'spatial-viewer') {
      viewerInputs.push({ classification, file })
    } else {
      fallbacks.push({ classification, file })
    }
  }
  if (viewerInputs.length === 0) return { fallbacks, placedIds: [] }

  const prepared = await Promise.all(
    viewerInputs.map(({ classification, file }) => prepareAsset(file, classification))
  )
  const previousSelection = [...editor.state.selectedIds]
  const pageId = editor.state.currentPageId
  const bounds = placementBounds(editor, prepared.length, cx, cy)
  const snapshots: SceneNode[] = []
  let x = bounds.x
  for (const item of prepared) {
    editor.graph.images.set(item.hash, item.bytes)
    const sourceData = contentSourcePluginData({
      fileName: item.fileName,
      format: item.classification.format,
      mimeType: spatialMimeType(item.file, item.classification.format),
      revision: CONTENT_SOURCE_REVISION,
      source: assetReference(item.hash)
    })
    const node = editor.graph.createNode('FRAME', pageId, {
      clipsContent: true,
      cornerRadius: 12,
      fills: [
        {
          color: { a: 1, b: 0.055, g: 0.045, r: 0.039 },
          opacity: 1,
          type: 'SOLID',
          visible: true
        }
      ],
      height: VIEWER_HEIGHT,
      name: item.fileName.replace(/\.[^.]+$/, '') || item.fileName,
      pluginData: spatialMediaPluginData(sourceData, { format: item.classification.format }),
      strokes: [
        {
          align: 'INSIDE',
          color: { a: 0.5, b: 0.28, g: 0.23, r: 0.2 },
          opacity: 1,
          visible: true,
          weight: 1
        }
      ],
      width: VIEWER_WIDTH,
      x,
      y: bounds.y
    })
    snapshots.push(structuredClone(node))
    x += VIEWER_WIDTH + VIEWER_GAP
  }

  const placedIds = snapshots.map((node) => node.id)
  setSelection(editor, placedIds)
  editor.undo.push({
    label: 'Place 3D asset',
    forward: () => {
      restoreAssetNodes(editor, pageId, prepared, snapshots)
      setSelection(editor, placedIds)
      editor.requestRender()
    },
    inverse: () => {
      const previewHashes = placedIds.flatMap((id) => {
        const node = editor.graph.getNode(id)
        const previewHash = node ? spatialMediaSource(node)?.previewHash : null
        return previewHash ? [previewHash] : []
      })
      for (const id of placedIds) editor.graph.deleteNode(id)
      for (const hash of [...prepared.map((item) => item.hash), ...previewHashes]) {
        if (!hasAssetReference(editor, hash)) editor.graph.images.delete(hash)
      }
      setSelection(editor, previousSelection)
      editor.requestRender()
    }
  })
  editor.requestRender()
  return { fallbacks, placedIds }
}

function cameraEquals(first: SpatialCameraState | null, second: SpatialCameraState): boolean {
  if (!first) return false
  return [...first.position, ...first.target].every(
    (value, index) => Math.abs(value - [...second.position, ...second.target][index]) < 0.0001
  )
}

function pluginDataWithCamera(
  node: SceneNode,
  camera: SpatialCameraState,
  homeCamera: SpatialCameraState | null
) {
  const source = spatialMediaSource(node)
  return source
    ? spatialMediaPluginData(node.pluginData, {
        camera,
        format: source.format,
        homeCamera,
        previewHash: source.previewHash
      })
    : node.pluginData
}

export function initializeSpatialMediaCamera(
  editor: Editor,
  nodeId: string,
  camera: SpatialCameraState
): void {
  const node = editor.graph.getNode(nodeId)
  const source = node ? spatialMediaSource(node) : null
  if (!node || !source || (source.camera && source.homeCamera)) return
  editor.graph.updateNode(nodeId, {
    pluginData: spatialMediaPluginData(node.pluginData, {
      camera: source.camera ?? camera,
      format: source.format,
      homeCamera: source.homeCamera ?? camera,
      previewHash: source.previewHash
    })
  })
  editor.requestRender()
}

export function commitSpatialMediaCamera(
  editor: Editor,
  nodeId: string,
  camera: SpatialCameraState,
  label = 'Change 3D camera'
): void {
  const node = editor.graph.getNode(nodeId)
  const source = node ? spatialMediaSource(node) : null
  if (!node || !source || cameraEquals(source.camera, camera)) return
  const previous = structuredClone(node.pluginData)
  const next = pluginDataWithCamera(node, camera, source.homeCamera ?? camera)
  const apply = (pluginData: SceneNode['pluginData']) => {
    if (!editor.graph.getNode(nodeId)) return
    editor.graph.updateNode(nodeId, { pluginData: structuredClone(pluginData) })
    editor.requestRender()
  }
  apply(next)
  editor.undo.push({
    forward: () => apply(next),
    inverse: () => apply(previous),
    label
  })
}

export function storeSpatialMediaPreview(
  editor: Editor,
  nodeId: string,
  bytes: Uint8Array
): string | null {
  const node = editor.graph.getNode(nodeId)
  const source = node ? spatialMediaSource(node) : null
  if (!node || !source) return null
  const hash = computeImageHash(bytes)
  editor.graph.images.set(hash, bytes)
  editor.graph.updateNode(nodeId, {
    pluginData: spatialMediaPluginData(node.pluginData, {
      camera: source.camera,
      format: source.format,
      homeCamera: source.homeCamera,
      previewHash: hash
    })
  })
  editor.requestRender()
  return hash
}
