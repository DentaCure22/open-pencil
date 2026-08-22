import { Buffer } from 'node:buffer'

import { computeContentBounds, headlessRenderNodes } from '@open-pencil/core/io/formats/raster'
import type { Rect } from '@open-pencil/scene-graph/primitives'

import type { AuthorityBoardDocument } from './document'

const MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024
const MAX_SCREENSHOT_DIMENSION = 1_600
const MAX_SCREENSHOT_PIXELS = 2_560_000

export type AuthorityBoardScreenshot = {
  base64: string
  bounds: Rect
  byteLength: number
  mimeType: 'image/png'
  objectIds: string[]
  pixelHeight: number
  pixelWidth: number
  scale: number
}

function fittedScale(width: number, height: number, requestedScale: number): number {
  return Math.min(
    requestedScale,
    MAX_SCREENSHOT_DIMENSION / width,
    MAX_SCREENSHOT_DIMENSION / height,
    Math.sqrt(MAX_SCREENSHOT_PIXELS / (width * height))
  )
}

export async function renderAuthorityBoardScreenshot(
  document: AuthorityBoardDocument,
  pageId: string,
  objectIds: string[],
  requestedScale: number
): Promise<AuthorityBoardScreenshot> {
  for (const id of objectIds) {
    const node = document.graph.getNode(id)
    if (!node || node.type === 'CANVAS' || !document.graph.isDescendant(id, pageId)) {
      throw new Error(`board_screenshot object_id "${id}" is missing or outside the target page.`)
    }
  }

  const bounds = computeContentBounds(document.graph, objectIds)
  if (!bounds) throw new Error('board_screenshot found no visible saved content.')
  const width = bounds.maxX - bounds.minX
  const height = bounds.maxY - bounds.minY
  if (width <= 0 || height <= 0) {
    throw new Error('board_screenshot requires objects with positive visible bounds.')
  }

  const scale = fittedScale(width, height, requestedScale)
  const bytes = await headlessRenderNodes(document.graph, pageId, objectIds, {
    format: 'PNG',
    scale
  })
  if (!bytes) throw new Error('board_screenshot could not render the requested saved content.')
  if (bytes.byteLength > MAX_SCREENSHOT_BYTES) {
    throw new Error(
      `board_screenshot produced ${String(bytes.byteLength)} bytes; select fewer objects.`
    )
  }

  return {
    base64: Buffer.from(bytes).toString('base64'),
    bounds: { height, width, x: bounds.minX, y: bounds.minY },
    byteLength: bytes.byteLength,
    mimeType: 'image/png',
    objectIds,
    pixelHeight: Math.ceil(height * scale),
    pixelWidth: Math.ceil(width * scale),
    scale
  }
}
