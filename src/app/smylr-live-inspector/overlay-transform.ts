import type { Vector } from '@open-pencil/scene-graph/primitives'

export const LIVE_INSPECTOR_CORNER_HANDLES = ['nw', 'ne', 'se', 'sw'] as const

export type LiveInspectorCornerHandle = (typeof LIVE_INSPECTOR_CORNER_HANDLES)[number]

type PointerPosition = {
  clientX: number
  clientY: number
  pointerId: number
}

type TransformRect = Vector & {
  height: number
  width: number
}

type TransformBounds = {
  height: number
  left: number
  top: number
  width: number
}

export type LiveInspectorMoveTransform = {
  baseX: number
  baseY: number
  kind: 'move'
  pointerId: number
  selectOnClick: boolean
  startClientX: number
  startClientY: number
  startRectX: number
  startRectY: number
}

type LiveInspectorResizeTransform = {
  baseX: number
  baseY: number
  handle: LiveInspectorCornerHandle
  kind: 'resize'
  pointerId: number
  startClientX: number
  startClientY: number
  startHeight: number
  startWidth: number
}

type LiveInspectorRotateTransform = {
  centerClientX: number
  centerClientY: number
  kind: 'rotate'
  pointerId: number
  startAngle: number
  startRotation: number
}

export type LiveInspectorOverlayTransform =
  | LiveInspectorMoveTransform
  | LiveInspectorResizeTransform
  | LiveInspectorRotateTransform

type BeginTransformInput = {
  action:
    | { handle: LiveInspectorCornerHandle; kind: 'resize' }
    | { kind: 'move'; selectOnClick: boolean }
    | { kind: 'rotate' }
  bounds?: TransformBounds
  pointer: PointerPosition
  rect?: TransformRect
  styles?: Record<string, string>
}

export type LiveInspectorTransformUpdate =
  | {
      kind: 'move'
      position: Vector
      styles: { translate: string }
    }
  | {
      kind: 'resize'
      size: { height: number; width: number }
      styles: { height: string; translate?: string; width: string }
    }
  | {
      kind: 'rotate'
      styles: { rotate: string }
    }

const MIN_CONTAINER_SIZE = 24

function translatePair(value: string | undefined) {
  if (!value || value === 'none') return { x: 0, y: 0 }
  const parts = value.trim().split(/\s+/)
  return {
    x: Number.parseFloat(parts[0] ?? '0') || 0,
    y: Number.parseFloat(parts[1] ?? '0') || 0
  }
}

function numericRotation(value: string | undefined) {
  if (!value || value === 'none') return 0
  return Number.parseFloat(value) || 0
}

export function beginLiveInspectorOverlayTransform({
  action,
  bounds,
  pointer,
  rect,
  styles
}: BeginTransformInput): LiveInspectorOverlayTransform | null {
  if (action.kind === 'rotate') {
    if (!bounds) return null
    const centerClientX = bounds.left + bounds.width / 2
    const centerClientY = bounds.top + bounds.height / 2
    return {
      centerClientX,
      centerClientY,
      kind: 'rotate',
      pointerId: pointer.pointerId,
      startAngle: Math.atan2(pointer.clientY - centerClientY, pointer.clientX - centerClientX),
      startRotation: numericRotation(styles?.rotate)
    }
  }

  if (!rect) return null
  const translate = translatePair(styles?.translate)
  if (action.kind === 'resize') {
    return {
      baseX: translate.x,
      baseY: translate.y,
      handle: action.handle,
      kind: 'resize',
      pointerId: pointer.pointerId,
      startClientX: pointer.clientX,
      startClientY: pointer.clientY,
      startHeight: rect.height,
      startWidth: rect.width
    }
  }

  return {
    baseX: translate.x,
    baseY: translate.y,
    kind: 'move',
    pointerId: pointer.pointerId,
    selectOnClick: action.selectOnClick,
    startClientX: pointer.clientX,
    startClientY: pointer.clientY,
    startRectX: rect.x,
    startRectY: rect.y
  }
}

export function updateLiveInspectorOverlayTransform(
  transform: LiveInspectorOverlayTransform,
  pointer: PointerPosition,
  zoom: number
): LiveInspectorTransformUpdate | null {
  if (transform.pointerId !== pointer.pointerId) return null

  if (transform.kind === 'rotate') {
    const angle = Math.atan2(
      pointer.clientY - transform.centerClientY,
      pointer.clientX - transform.centerClientX
    )
    const degrees = transform.startRotation + ((angle - transform.startAngle) * 180) / Math.PI
    return {
      kind: 'rotate',
      styles: { rotate: `${Math.round(degrees * 10) / 10}deg` }
    }
  }

  const safeZoom = Math.max(zoom, 0.01)
  const deltaX = (pointer.clientX - transform.startClientX) / safeZoom
  const deltaY = (pointer.clientY - transform.startClientY) / safeZoom
  if (transform.kind === 'move') {
    const x = Math.round(deltaX)
    const y = Math.round(deltaY)
    return {
      kind: 'move',
      position: { x: transform.startRectX + x, y: transform.startRectY + y },
      styles: { translate: `${transform.baseX + x}px ${transform.baseY + y}px` }
    }
  }

  const west = transform.handle.includes('w')
  const north = transform.handle.includes('n')
  const width = Math.max(
    MIN_CONTAINER_SIZE,
    Math.round(transform.startWidth + (west ? -deltaX : deltaX))
  )
  const height = Math.max(
    MIN_CONTAINER_SIZE,
    Math.round(transform.startHeight + (north ? -deltaY : deltaY))
  )
  const styles: { height: string; translate?: string; width: string } = {
    height: `${height}px`,
    width: `${width}px`
  }
  if (west || north) {
    const appliedX = west ? transform.startWidth - width : 0
    const appliedY = north ? transform.startHeight - height : 0
    styles.translate = `${transform.baseX + appliedX}px ${transform.baseY + appliedY}px`
  }
  return { kind: 'resize', size: { height, width }, styles }
}

export function liveInspectorTransformDistance(
  transform: LiveInspectorOverlayTransform,
  pointer: PointerPosition
) {
  if (transform.kind === 'rotate') return Number.POSITIVE_INFINITY
  return Math.hypot(
    pointer.clientX - transform.startClientX,
    pointer.clientY - transform.startClientY
  )
}
