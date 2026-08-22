import type { SmylrLiveContainerRect } from '@/app/smylr-live-container/types'

export type ContainerLabelPlacement = {
  horizontal: 'left' | 'right'
  maxWidth: number
  vertical: 'above' | 'below' | 'inside-top'
}

const LABEL_EDGE_GAP = 8
const LABEL_MAX_WIDTH = 360
const LABEL_VERTICAL_CLEARANCE = 32

type ContainerViewport = {
  height: number
  width: number
}

export function getContainerLabelPlacement(
  rect: SmylrLiveContainerRect,
  viewport: ContainerViewport,
  zoom: number
): ContainerLabelPlacement {
  const safeZoom = Math.max(zoom, 0.01)
  const leftAnchor = Math.min(Math.max(rect.x, 0), viewport.width)
  const rightAnchor = Math.min(Math.max(rect.x + rect.width, 0), viewport.width)
  const roomFromLeft = Math.max(0, viewport.width - leftAnchor) * safeZoom
  const roomFromRight = Math.max(0, rightAnchor) * safeZoom
  const horizontal =
    roomFromLeft < LABEL_MAX_WIDTH && roomFromRight > roomFromLeft ? 'right' : 'left'
  const horizontalRoom = horizontal === 'left' ? roomFromLeft : roomFromRight

  const roomAbove = Math.max(0, rect.y) * safeZoom
  const roomBelow = Math.max(0, viewport.height - rect.y - rect.height) * safeZoom
  let vertical: ContainerLabelPlacement['vertical'] = 'above'
  if (roomAbove < LABEL_VERTICAL_CLEARANCE) {
    vertical = roomBelow >= LABEL_VERTICAL_CLEARANCE ? 'below' : 'inside-top'
  }

  return {
    horizontal,
    maxWidth: Math.max(1, Math.min(LABEL_MAX_WIDTH, horizontalRoom - LABEL_EDGE_GAP)) / safeZoom,
    vertical
  }
}
