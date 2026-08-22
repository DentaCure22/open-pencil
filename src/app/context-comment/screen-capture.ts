import type { Rect } from '@open-pencil/scene-graph/primitives'

import type { EditorStore } from '@/app/editor/session'
import { captureNarratedTraceSnapshot } from '@/app/narrated-trace'

import {
  contextCommentState,
  setContextCommentCapturePreparing,
  setContextCommentCaptureSource,
  startContextCommentCapture
} from './state'
import type { ContextCommentBoardCapture, ContextCommentCaptureSource } from './types'

const MAX_BOARD_CAPTURE_EDGE = 2_048

function canvasArea() {
  return document.querySelector<HTMLElement>('[data-test-id="canvas-area"]')
}

function mediaPlaybackSnapshot(): NonNullable<ContextCommentCaptureSource['mediaPlayback']> {
  return Object.fromEntries(
    [...document.querySelectorAll<HTMLElement>('[data-media-node-id]')].flatMap((surface) => {
      const nodeId = surface.dataset.mediaNodeId
      const media = surface.querySelector<HTMLMediaElement>('video, audio')
      if (!nodeId || !media || !Number.isFinite(media.currentTime)) return []
      return [
        [
          nodeId,
          {
            currentTimeSeconds: media.currentTime,
            ...(Number.isFinite(media.duration) ? { durationSeconds: media.duration } : {}),
            paused: media.paused
          }
        ] as const
      ]
    })
  )
}

export async function captureOpenPencilBoardSource(
  store: EditorStore
): Promise<ContextCommentCaptureSource> {
  const area = canvasArea()
  if (!area) throw new Error('The Board surface is unavailable.')
  const bounds = area.getBoundingClientRect()
  if (bounds.width <= 0 || bounds.height <= 0) {
    throw new Error('The Board surface has no visible pixels.')
  }

  const capturedAtEpochMs = Date.now()
  const mediaPlayback = mediaPlaybackSnapshot()
  const snapshot = await captureNarratedTraceSnapshot({
    area,
    cropBounds: { height: bounds.height, width: bounds.width, x: 0, y: 0 },
    maxEdge: MAX_BOARD_CAPTURE_EDGE,
    target: {
      name: 'Current Board',
      path: [store.graph.getNode(store.state.currentPageId)?.name || 'Board'],
      stableId: `canvas:${store.state.currentPageId}`
    }
  })
  if (!snapshot) throw new Error('OpenPencil could not compose the visible Board pixels.')

  return {
    capturedAtEpochMs,
    canvasBounds: {
      height: bounds.height,
      width: bounds.width,
      x: bounds.left,
      y: bounds.top
    },
    displaySurface: 'board',
    height: snapshot.height,
    imageUrl: URL.createObjectURL(snapshot.blob),
    ...(Object.keys(mediaPlayback).length > 0 ? { mediaPlayback } : {}),
    source: snapshot.source,
    viewport: {
      panX: store.state.panX,
      panY: store.state.panY,
      zoom: store.state.zoom
    },
    viewportHeight: bounds.height,
    viewportWidth: bounds.width,
    width: snapshot.width
  }
}

export async function prepareContextCommentScreenCapture(store: EditorStore) {
  const draftId = contextCommentState.draft?.id
  if (!draftId || contextCommentState.capturePreparing) return
  contextCommentState.captureMode = false
  setContextCommentCapturePreparing(true)
  contextCommentState.error = null
  try {
    const source = await captureOpenPencilBoardSource(store)
    if (contextCommentState.draft?.id !== draftId) {
      URL.revokeObjectURL(source.imageUrl)
      return
    }
    setContextCommentCaptureSource(source)
    startContextCommentCapture()
  } catch (error) {
    startContextCommentCapture()
    contextCommentState.error =
      error instanceof Error ? error.message : 'The visible Board could not be captured.'
  } finally {
    setContextCommentCapturePreparing(false)
  }
}

export function contextCommentSourceCropBounds(
  source: ContextCommentCaptureSource,
  screenBounds: Rect
): Rect {
  const scaleX = source.width / Math.max(1, source.viewportWidth)
  const scaleY = source.height / Math.max(1, source.viewportHeight)
  const sourceOffsetX = source.displaySurface === 'board' ? 0 : source.canvasBounds.x
  const sourceOffsetY = source.displaySurface === 'board' ? 0 : source.canvasBounds.y
  return {
    height: screenBounds.height * scaleY,
    width: screenBounds.width * scaleX,
    x: (sourceOffsetX + screenBounds.x) * scaleX,
    y: (sourceOffsetY + screenBounds.y) * scaleY
  }
}

export function contextCommentBoardCapture(
  source: ContextCommentCaptureSource,
  screenBounds: Rect
): ContextCommentBoardCapture {
  const zoom = Math.max(source.viewport.zoom, 0.01)
  return {
    boardBounds: {
      height: screenBounds.height / zoom,
      width: screenBounds.width / zoom,
      x: (screenBounds.x - source.viewport.panX) / zoom,
      y: (screenBounds.y - source.viewport.panY) / zoom
    },
    screenBounds: { ...screenBounds },
    viewport: { ...source.viewport }
  }
}

function rectsOverlap(left: Rect, right: Rect) {
  return (
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y
  )
}

export function contextCommentCropContainsLiveIframe(screenBounds: Rect) {
  const area = canvasArea()
  if (!area) return false
  const areaBounds = area.getBoundingClientRect()
  return [...area.querySelectorAll<HTMLIFrameElement>('iframe')].some((frame) => {
    const bounds = frame.getBoundingClientRect()
    if (bounds.width <= 0 || bounds.height <= 0 || frame.getClientRects().length === 0) return false
    return rectsOverlap(screenBounds, {
      height: bounds.height,
      width: bounds.width,
      x: bounds.left - areaBounds.left,
      y: bounds.top - areaBounds.top
    })
  })
}
