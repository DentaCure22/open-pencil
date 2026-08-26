import type { Rect } from '@open-pencil/scene-graph/primitives'

import type { EditorStore } from '@/app/editor/session'
import { captureNarratedTraceSnapshot } from '@/app/narrated-trace'

import type {
  LocalWorkspaceAuthorityStatus,
  LocalWorkspaceScreenshotCompletion,
  LocalWorkspaceScreenshotIntent
} from './client'

const MAX_LIVE_SCREENSHOT_EDGE = 1_600

export type LocalWorkspaceScreenshotDependencies = {
  complete(completion: LocalWorkspaceScreenshotCompletion): Promise<void>
  currentAuthority(): LocalWorkspaceAuthorityStatus | null
  currentPageId(): string
  readIntent(): Promise<LocalWorkspaceScreenshotIntent | null>
  store: EditorStore
}

function unionBounds(bounds: Rect[]): Rect | null {
  if (bounds.length === 0) return null
  const minX = Math.min(...bounds.map(({ x }) => x))
  const minY = Math.min(...bounds.map(({ y }) => y))
  const maxX = Math.max(...bounds.map(({ width, x }) => x + width))
  const maxY = Math.max(...bounds.map(({ height, y }) => y + height))
  return { height: maxY - minY, width: maxX - minX, x: minX, y: minY }
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 32_768
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

function screenBounds(store: EditorStore, bounds: Rect): Rect {
  const { panX, panY, zoom } = store.state
  return {
    height: bounds.height * zoom,
    width: bounds.width * zoom,
    x: bounds.x * zoom + panX,
    y: bounds.y * zoom + panY
  }
}

function fullyVisible(bounds: Rect, width: number, height: number): boolean {
  return (
    bounds.x >= 0 &&
    bounds.y >= 0 &&
    bounds.x + bounds.width <= width &&
    bounds.y + bounds.height <= height
  )
}

async function captureVisibleObjects(
  store: EditorStore,
  intent: LocalWorkspaceScreenshotIntent
): Promise<LocalWorkspaceScreenshotCompletion> {
  const area = document.querySelector<HTMLElement>('[data-test-id="canvas-area"]')
  if (!area) throw new Error('The live Board surface is unavailable.')
  const areaRect = area.getBoundingClientRect()
  const nodes = intent.objectIds.map((id) => {
    const node = store.graph.getNode(id)
    if (!node || node.type === 'CANVAS' || !store.graph.isDescendant(id, intent.pageId)) {
      throw new Error(`Object "${id}" is not present on the visible Board.`)
    }
    return node
  })
  const bounds = unionBounds(nodes.map((node) => store.graph.getAbsoluteBounds(node.id)))
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
    throw new Error('The requested Board objects have no visible bounds.')
  }
  const cropBounds = screenBounds(store, bounds)
  if (!fullyVisible(cropBounds, areaRect.width, areaRect.height)) {
    throw new Error('The requested Board objects are not fully visible in the current viewport.')
  }
  const snapshot = await captureNarratedTraceSnapshot({
    allowCanvasLocationFallback: false,
    area,
    cropBounds,
    domOverlayIds: intent.objectIds,
    maxEdge: MAX_LIVE_SCREENSHOT_EDGE,
    minimumEdge: Math.max(bounds.width, bounds.height),
    target: {
      bounds,
      name: nodes.map(({ name }) => name).join(', '),
      path: [store.graph.getNode(intent.pageId)?.name || 'Board'],
      stableId: `canvas:${intent.pageId}`
    }
  })
  if (!snapshot) throw new Error('The live Board pixels could not be composed.')
  const bytes = new Uint8Array(await snapshot.blob.arrayBuffer())
  return {
    base64: bytesToBase64(bytes),
    bounds,
    byteLength: bytes.byteLength,
    mimeType: 'image/png',
    objectIds: [...intent.objectIds],
    pixelHeight: snapshot.height,
    pixelWidth: snapshot.width,
    requestId: intent.requestId,
    source: 'live_board',
    status: 'completed'
  }
}

export function createLocalWorkspaceScreenshotConsumer(
  dependencies: LocalWorkspaceScreenshotDependencies
) {
  let inFlight: Promise<boolean> | null = null

  function consumePending(): Promise<boolean> {
    if (inFlight) return inFlight
    inFlight = (async () => {
      const intent = await dependencies.readIntent()
      if (!intent) return false
      const authority = dependencies.currentAuthority()
      if (
        authority?.state !== 'ready' ||
        intent.authorityId !== authority.authorityId ||
        intent.workspaceId !== authority.identity.workspaceId ||
        intent.contentDocumentId !== authority.identity.documentId ||
        dependencies.currentPageId() !== intent.pageId
      ) {
        await dependencies.complete({
          error: 'The requested Board is not the currently visible editor page.',
          objectIds: [...intent.objectIds],
          requestId: intent.requestId,
          status: 'failed'
        })
        return false
      }
      try {
        await dependencies.complete(await captureVisibleObjects(dependencies.store, intent))
        return true
      } catch (error) {
        await dependencies.complete({
          error: error instanceof Error ? error.message : 'Live Board capture failed.',
          objectIds: [...intent.objectIds],
          requestId: intent.requestId,
          status: 'failed'
        })
        return false
      }
    })().finally(() => {
      inFlight = null
    })
    return inFlight
  }

  return { consumePending }
}
