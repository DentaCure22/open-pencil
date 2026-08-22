import type { Fill, SceneNode } from '@open-pencil/scene-graph'
import { rectIntersectionRatio } from '@open-pencil/scene-graph/geometry'
import {
  assetHashFromReference,
  assetReference,
  computeImageHash
} from '@open-pencil/scene-graph/images'
import type { Rect } from '@open-pencil/scene-graph/primitives'

import { TRANSPARENT } from '#core/constants'
import { resolvePasteTarget } from '#core/editor/clipboard/paste-target'
import type { EditorContext } from '#core/editor/types'
import {
  CONTENT_SOURCE_REVISION,
  contentSourcePluginData,
  readContentSource
} from '#core/io/content-source'

const IMAGE_MAX_DIMENSION = 4096
const IMAGE_GAP = 20
const IMAGE_PLACEMENT_MAX_WIDTH = 960
const IMAGE_PLACEMENT_MAX_HEIGHT = 640
const IMAGE_PLACEMENT_VIEWPORT_RATIO = 0.72
const IMAGE_CASCADE_STEP = 32
const IMAGE_CASCADE_ATTEMPTS = 24
const IMAGE_CASCADE_OVERLAP_RATIO = 0.94

const IMAGE_EXTENSION_MIME = new Map<string, string>([
  ['avif', 'image/avif'],
  ['gif', 'image/gif'],
  ['jpeg', 'image/jpeg'],
  ['jpg', 'image/jpeg'],
  ['png', 'image/png'],
  ['webp', 'image/webp']
])

export function fitImagePlacementSize(
  width: number,
  height: number,
  maxWidth = IMAGE_PLACEMENT_MAX_WIDTH,
  maxHeight = IMAGE_PLACEMENT_MAX_HEIGHT
): { h: number; w: number } {
  const ratio = Math.min(1, maxWidth / width, maxHeight / height)
  return {
    h: Math.max(1, Math.round(height * ratio)),
    w: Math.max(1, Math.round(width * ratio))
  }
}

function rasterMimeType(name: string, mimeType: string): string {
  if (mimeType) return mimeType
  const extension = name.match(/\.([^.]+)$/)?.[1]?.toLowerCase()
  return (extension ? IMAGE_EXTENSION_MIME.get(extension) : null) ?? 'application/octet-stream'
}

export function createClipboardImageActions(ctx: EditorContext) {
  function nodeReferencesStoredAsset(node: { fills: Fill[]; pluginData: SceneNode['pluginData'] }) {
    if (node.fills.some((fill) => Boolean(fill.imageHash))) return true
    const source = readContentSource(node)
    return Boolean(source && assetHashFromReference(source.source))
  }

  function hasAssetReference(hash: string): boolean {
    for (const node of ctx.graph.getAllNodes()) {
      if (node.fills.some((fill) => fill.imageHash === hash)) return true
      const source = readContentSource(node)
      if (source && assetHashFromReference(source.source) === hash) return true
    }
    return false
  }

  function cascadePlacement(parentId: string, bounds: Rect): Rect {
    const occupied = ctx.graph
      .getChildren(parentId)
      .filter(nodeReferencesStoredAsset)
      .map((node) => ({ height: node.height, width: node.width, x: node.x, y: node.y }))
    let candidate = bounds
    for (let attempt = 0; attempt < IMAGE_CASCADE_ATTEMPTS; attempt++) {
      let conflicts = false
      for (const item of occupied) {
        if (rectIntersectionRatio(candidate, item) >= IMAGE_CASCADE_OVERLAP_RATIO) {
          conflicts = true
          break
        }
      }
      if (!conflicts) return candidate
      candidate = {
        ...bounds,
        x: bounds.x + IMAGE_CASCADE_STEP * (attempt + 1),
        y: bounds.y + IMAGE_CASCADE_STEP * (attempt + 1)
      }
    }
    return candidate
  }

  function placementLimit() {
    const viewport = ctx.getViewportSize()
    const zoom = Math.max(ctx.state.zoom, 0.01)
    return {
      height: Math.min(
        IMAGE_PLACEMENT_MAX_HEIGHT,
        viewport.height > 0
          ? (viewport.height * IMAGE_PLACEMENT_VIEWPORT_RATIO) / zoom
          : IMAGE_PLACEMENT_MAX_HEIGHT
      ),
      width: Math.min(
        IMAGE_PLACEMENT_MAX_WIDTH,
        viewport.width > 0
          ? (viewport.width * IMAGE_PLACEMENT_VIEWPORT_RATIO) / zoom
          : IMAGE_PLACEMENT_MAX_WIDTH
      )
    }
  }

  function storeImage(bytes: Uint8Array): string {
    const hash = computeImageHash(bytes)
    ctx.graph.images.set(hash, bytes)
    return hash
  }

  function decodeImageDimensions(bytes: Uint8Array): { w: number; h: number } | null {
    const ck = ctx.getCk()
    if (!ck) return null
    const skImg = ck.MakeImageFromEncoded(bytes)
    if (!skImg) return null
    let w = skImg.width()
    let h = skImg.height()
    skImg.delete()
    if (w > IMAGE_MAX_DIMENSION || h > IMAGE_MAX_DIMENSION) {
      const ratio = Math.min(IMAGE_MAX_DIMENSION / w, IMAGE_MAX_DIMENSION / h)
      w = Math.round(w * ratio)
      h = Math.round(h * ratio)
    }
    return { w, h }
  }

  function placeImageNode(
    bytes: Uint8Array,
    x: number,
    y: number,
    w: number,
    h: number,
    name = 'Image',
    mimeType = 'application/octet-stream',
    parentId = resolvePasteTarget(ctx)
  ): string | null {
    const hash = storeImage(bytes)
    const displayName = name.replace(/\.[^.]+$/, '')
    const extension = name.match(/\.([^.]+)$/)?.[1]?.toLowerCase()
    const fill: Fill = {
      type: 'IMAGE',
      imageHash: hash,
      imageScaleMode: 'FILL',
      color: TRANSPARENT,
      opacity: 1,
      visible: true
    }
    const node = ctx.graph.createNode('RECTANGLE', parentId, {
      name: displayName,
      x,
      y,
      width: w,
      height: h,
      fills: [fill],
      pluginData: contentSourcePluginData({
        fileName: name,
        format: extension || 'raster-image',
        mimeType,
        revision: CONTENT_SOURCE_REVISION,
        source: assetReference(hash)
      })
    })
    const id = node.id
    const snapshot = structuredClone(node)
    ctx.undo.push({
      label: 'Place image',
      forward: () => {
        ctx.graph.images.set(hash, bytes)
        ctx.graph.createNode(snapshot.type, parentId, structuredClone(snapshot))
      },
      inverse: () => {
        ctx.graph.deleteNode(id)
        if (!hasAssetReference(hash)) ctx.graph.images.delete(hash)
        const next = new Set(ctx.state.selectedIds)
        next.delete(id)
        ctx.setSelectedIds(next)
      }
    })
    return id
  }

  async function placeImageFiles(files: File[], cx: number, cy: number): Promise<string[]> {
    const prepared: Array<{
      bytes: Uint8Array
      mimeType: string
      name: string
      w: number
      h: number
    }> = []
    const limit = placementLimit()
    for (const file of files) {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const dims = decodeImageDimensions(bytes)
      if (dims) {
        prepared.push({
          bytes,
          mimeType: rasterMimeType(file.name, file.type),
          name: file.name,
          ...fitImagePlacementSize(dims.w, dims.h, limit.width, limit.height)
        })
      }
    }
    if (!prepared.length) return []

    let totalW = 0
    for (const p of prepared) totalW += p.w
    totalW += IMAGE_GAP * (prepared.length - 1)
    const maxH = Math.max(...prepared.map((p) => p.h))

    const parentId = resolvePasteTarget(ctx)
    const placement = cascadePlacement(parentId, {
      height: maxH,
      width: totalW,
      x: cx - totalW / 2,
      y: cy - maxH / 2
    })
    let curX = placement.x
    const topY = placement.y
    const ids: string[] = []
    for (const p of prepared) {
      const id = placeImageNode(p.bytes, curX, topY, p.w, p.h, p.name, p.mimeType, parentId)
      if (id) ids.push(id)
      curX += p.w + IMAGE_GAP
    }
    if (ids.length) {
      ctx.setSelectedIds(new Set(ids))
      ctx.requestRender()
    }
    return ids
  }

  return { storeImage, placeImageFiles }
}
