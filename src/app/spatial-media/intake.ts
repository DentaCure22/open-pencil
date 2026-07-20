import type { Editor } from '@open-pencil/core/editor'
import { CONTENT_SOURCE_REVISION, contentSourcePluginData } from '@open-pencil/core/io'
import type { SceneNode } from '@open-pencil/scene-graph'
import { assetReference, computeImageHash } from '@open-pencil/scene-graph/images'
import type { Rect } from '@open-pencil/scene-graph/primitives'

import { classifySpatialFile } from './classify'
import {
  resolveSpatialResourceFiles,
  spatialResourceMimeType,
  type SpatialResolvedResourceFile,
  validateSpatialBundleSize
} from './resources'
import { spatialMediaPluginData, spatialMediaSource } from './source'
import type {
  SpatialCameraState,
  SpatialPlacementFallback,
  SpatialPlacementResult,
  SpatialResourceReference,
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
  resources: PreparedSpatialResource[]
}

type PreparedSpatialResource = {
  bytes: Uint8Array
  reference: SpatialResourceReference
}

function setSelection(editor: Editor, ids: string[]) {
  if (ids.length > 0) editor.select(ids)
  else editor.clearSelection()
}

function overlaps(first: Rect, second: Rect): boolean {
  const overlapLeft = Math.max(first.x, second.x)
  const overlapTop = Math.max(first.y, second.y)
  const overlapRight = Math.min(first.x + first.width, second.x + second.width)
  const overlapBottom = Math.min(first.y + first.height, second.y + second.height)
  if (overlapRight <= overlapLeft || overlapBottom <= overlapTop) return false
  const overlapArea = (overlapRight - overlapLeft) * (overlapBottom - overlapTop)
  const smallerArea = Math.min(first.width * first.height, second.width * second.height)
  return overlapArea >= smallerArea * 0.9
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
    if (!occupied.some((bounds) => overlaps(candidate, bounds))) return candidate
  }
  return initial
}

function hasAssetReference(editor: Editor, hash: string): boolean {
  for (const node of editor.graph.getAllNodes()) {
    const source = spatialMediaSource(node)
    if (source?.assetHash === hash || source?.previewHash === hash) return true
    if (source?.resources.some((resource) => resource.assetHash === hash)) return true
    if (node.fills.some((fill) => fill.imageHash === hash)) return true
  }
  return false
}

async function prepareAsset(
  file: File,
  classification: SpatialViewerClassification,
  resolvedResources: SpatialResolvedResourceFile[]
): Promise<PreparedSpatialAsset> {
  validateSpatialBundleSize(file, resolvedResources)
  const bytes = new Uint8Array(await file.arrayBuffer())
  const resources = await Promise.all(
    resolvedResources.map(async ({ file: resourceFile, uri }) => {
      const resourceBytes = new Uint8Array(await resourceFile.arrayBuffer())
      return {
        bytes: resourceBytes,
        reference: {
          assetHash: computeImageHash(resourceBytes),
          fileName: resourceFile.name,
          mimeType: spatialResourceMimeType(uri),
          uri
        }
      }
    })
  )
  return {
    bytes,
    classification,
    file,
    fileName: file.name.trim() || `Untitled.${classification.format}`,
    hash: computeImageHash(bytes),
    resources
  }
}

function spatialMimeType(file: File, format: SpatialViewerClassification['format']): string {
  if (file.type) return file.type
  if (format === 'glb') return 'model/gltf-binary'
  if (format === 'gltf') return 'model/gltf+json'
  if (format === 'obj') return 'model/obj'
  return 'model/stl'
}

export async function placeSpatialMediaFiles(
  editor: Editor,
  files: File[],
  cx: number,
  cy: number
): Promise<SpatialPlacementResult> {
  const viewerInputs: Array<{ classification: SpatialViewerClassification; file: File }> = []
  for (const file of files) {
    const classification = classifySpatialFile(file)
    if (classification.disposition === 'spatial-viewer') {
      viewerInputs.push({ classification, file })
    }
  }
  const resourceCandidates = files.filter(
    (file) => !viewerInputs.some((input) => input.file === file)
  )
  const resourceGroups = await Promise.all(
    viewerInputs.map(({ file }) => resolveSpatialResourceFiles(file, resourceCandidates))
  )
  const resourceFiles = new Set(
    resourceGroups.flatMap((resources) => resources.map(({ file }) => file))
  )
  const fallbacks: SpatialPlacementFallback[] = []
  for (const file of files) {
    if (resourceFiles.has(file) || viewerInputs.some((input) => input.file === file)) continue
    const classification = classifySpatialFile(file)
    if (classification.disposition !== 'spatial-viewer') fallbacks.push({ classification, file })
  }
  if (viewerInputs.length === 0) return { fallbacks, placedIds: [] }

  const prepared = await Promise.all(
    viewerInputs.map(({ classification, file }, index) =>
      prepareAsset(file, classification, resourceGroups[index] ?? [])
    )
  )
  const previousSelection = [...editor.state.selectedIds]
  const pageId = editor.state.currentPageId
  const bounds = placementBounds(editor, prepared.length, cx, cy)
  const snapshots: SceneNode[] = []
  let x = bounds.x
  for (const item of prepared) {
    editor.graph.images.set(item.hash, item.bytes)
    for (const resource of item.resources) {
      editor.graph.images.set(resource.reference.assetHash, resource.bytes)
    }
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
      pluginData: spatialMediaPluginData(sourceData, {
        format: item.classification.format,
        resources: item.resources.map(({ reference }) => reference)
      }),
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
      for (const item of prepared) editor.graph.images.set(item.hash, item.bytes)
      for (const item of prepared) {
        for (const resource of item.resources) {
          editor.graph.images.set(resource.reference.assetHash, resource.bytes)
        }
      }
      for (const snapshot of snapshots) {
        editor.graph.createNode(snapshot.type, pageId, structuredClone(snapshot))
      }
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
      const retainedHashes = prepared.flatMap((item) => [
        item.hash,
        ...item.resources.map((resource) => resource.reference.assetHash)
      ])
      for (const hash of [...retainedHashes, ...previewHashes]) {
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
        previewHash: source.previewHash,
        resources: source.resources
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
      previewHash: source.previewHash,
      resources: source.resources
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
      previewHash: hash,
      resources: source.resources
    })
  })
  editor.requestRender()
  return hash
}
