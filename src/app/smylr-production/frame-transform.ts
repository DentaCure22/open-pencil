import { ref } from 'vue'

import type { SceneNode } from '@open-pencil/scene-graph'

import type { EditorStore } from '@/app/editor/active-store'

export type FrameCorner = 'nw' | 'ne' | 'se' | 'sw'
export type LiveFrameViewportPresetId = 'desktop' | 'laptop' | 'phone' | 'tablet'

export type LiveFrameViewportPreset = {
  height: number
  id: LiveFrameViewportPresetId
  label: string
  width: number
}

export const LIVE_FRAME_BASE_VIEWPORT = { height: 900, width: 1280 } as const

export const LIVE_FRAME_VIEWPORT_PRESETS: LiveFrameViewportPreset[] = [
  { height: 900, id: 'desktop', label: 'Desktop', width: 1440 },
  { height: 800, id: 'laptop', label: 'Laptop', width: 1280 },
  { height: 1024, id: 'tablet', label: 'Tablet', width: 768 },
  { height: 844, id: 'phone', label: 'Phone', width: 390 }
]

type FrameSnapshot = Pick<SceneNode, 'height' | 'rotation' | 'width' | 'x' | 'y'>
type TransformDrag =
  | {
      corner: FrameCorner
      frameId: string
      kind: 'resize'
      pointerId: number
      startClientX: number
      startClientY: number
      start: FrameSnapshot
    }
  | {
      centerClientX: number
      centerClientY: number
      frameId: string
      kind: 'rotate'
      pointerId: number
      startAngle: number
      start: FrameSnapshot
    }

export const LIVE_FRAME_RESIZE_HANDLE_STYLE = {
  borderWidth: '1px',
  height: '10px',
  width: '10px'
} as const

export const LIVE_FRAME_ROTATE_HANDLE_STYLE = { height: '18px', width: '18px' } as const

export function liveFrameHeaderStyle(zoom: number) {
  const normalizedZoom = Math.min(1, Math.max(0, zoom))
  const scale = 0.72 + normalizedZoom * 0.28
  return {
    bottom: 'calc(100% + 6px)',
    transform: `translateX(-50%) scale(${scale})`,
    transformOrigin: 'bottom center'
  }
}

export function liveFrameCanvasStyle(store: EditorStore, frame: SceneNode) {
  const abs = store.graph.getAbsolutePosition(frame.id)
  const zoom = store.state.zoom
  const centerX = frame.width / 2
  const centerY = frame.height / 2
  return {
    height: `${Math.max(1, frame.height)}px`,
    transform: `translate3d(${abs.x * zoom + store.state.panX}px, ${
      abs.y * zoom + store.state.panY
    }px, 0) scale(${zoom}) translate(${centerX}px, ${centerY}px) rotate(${
      frame.rotation
    }deg) translate(${-centerX}px, ${-centerY}px)`,
    transformOrigin: 'top left',
    width: `${Math.max(1, frame.width)}px`
  }
}

export function liveFrameScreenOverlayStyle(store: EditorStore, frame: SceneNode) {
  const abs = store.graph.getAbsolutePosition(frame.id)
  const zoom = store.state.zoom
  return {
    height: `${Math.max(1, frame.height * zoom)}px`,
    transform: `translate3d(${abs.x * zoom + store.state.panX}px, ${
      abs.y * zoom + store.state.panY
    }px, 0) rotate(${frame.rotation}deg)`,
    transformOrigin: 'center center',
    width: `${Math.max(1, frame.width * zoom)}px`
  }
}

export function liveFrameResizeHandles(frame: SceneNode, zoom: number) {
  return [
    { id: 'nw', transform: 'translate(-50%, -50%)', x: 0, y: 0 },
    { id: 'ne', transform: 'translate(-50%, -50%)', x: frame.width * zoom, y: 0 },
    {
      id: 'se',
      transform: 'translate(-50%, -50%)',
      x: frame.width * zoom,
      y: frame.height * zoom
    },
    { id: 'sw', transform: 'translate(-50%, -50%)', x: 0, y: frame.height * zoom }
  ] satisfies Array<{ id: FrameCorner; transform: string; x: number; y: number }>
}

export function liveFrameRotationHandles(frame: SceneNode, zoom: number) {
  return [
    { id: 'nw', transform: 'translate(-100%, -100%)', x: 0, y: 0 },
    { id: 'ne', transform: 'translate(0, -100%)', x: frame.width * zoom, y: 0 },
    { id: 'se', transform: 'none', x: frame.width * zoom, y: frame.height * zoom },
    { id: 'sw', transform: 'translate(-100%, 0)', x: 0, y: frame.height * zoom }
  ] satisfies Array<{ id: FrameCorner; transform: string; x: number; y: number }>
}

function snapshot(frame: SceneNode): FrameSnapshot {
  return {
    height: frame.height,
    rotation: frame.rotation,
    width: frame.width,
    x: frame.x,
    y: frame.y
  }
}

function frameSnapshotChanged(previous: FrameSnapshot, current: FrameSnapshot): boolean {
  return (Object.keys(previous) as (keyof FrameSnapshot)[]).some(
    (key) => previous[key] !== current[key]
  )
}

function applyLiveFrameViewport(
  store: EditorStore,
  frameId: string,
  viewport: { height: number; width: number },
  label: string
) {
  const frame = store.graph.getNode(frameId)
  if (!frame) return false
  const centerX = frame.x + frame.width / 2
  const centerY = frame.y + frame.height / 2
  store.updateNodeWithUndo(
    frame.id,
    {
      height: viewport.height,
      rotation: 0,
      width: viewport.width,
      x: centerX - viewport.width / 2,
      y: centerY - viewport.height / 2
    },
    label
  )
  return true
}

export function applyLiveFrameViewportPreset(
  store: EditorStore,
  frameId: string,
  presetId: LiveFrameViewportPresetId
) {
  const preset = LIVE_FRAME_VIEWPORT_PRESETS.find((candidate) => candidate.id === presetId)
  return preset
    ? applyLiveFrameViewport(store, frameId, preset, `Set ${preset.label} viewport`)
    : false
}

export function resetLiveFrameTransform(store: EditorStore, frameId: string) {
  return applyLiveFrameViewport(
    store,
    frameId,
    LIVE_FRAME_BASE_VIEWPORT,
    'Reset live app frame transform'
  )
}

export function liveFrameViewportPresetId(
  frame: Pick<SceneNode, 'height' | 'width'> | null | undefined
): LiveFrameViewportPresetId | null {
  if (!frame) return null
  return (
    LIVE_FRAME_VIEWPORT_PRESETS.find(
      (preset) => preset.width === frame.width && preset.height === frame.height
    )?.id ?? null
  )
}

export function createLiveFrameTransformController(store: EditorStore, onChange: () => void) {
  const drag = ref<TransformDrag | null>(null)

  function beginResize(frameId: string, corner: FrameCorner, event: PointerEvent) {
    const frame = store.graph.getNode(frameId)
    if (!frame || event.button !== 0) return
    drag.value = {
      corner,
      frameId,
      kind: 'resize',
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      start: snapshot(frame)
    }
    ;(event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId)
  }

  function beginRotate(frameId: string, event: PointerEvent) {
    const frame = store.graph.getNode(frameId)
    const canvas = (event.currentTarget as HTMLElement | null)?.closest(
      '[data-test-id="canvas-area"]'
    )
    if (!frame || !canvas || event.button !== 0) return
    const rect = canvas.getBoundingClientRect()
    const abs = store.graph.getAbsolutePosition(frame.id)
    const centerClientX =
      rect.left + (abs.x + frame.width / 2) * store.state.zoom + store.state.panX
    const centerClientY =
      rect.top + (abs.y + frame.height / 2) * store.state.zoom + store.state.panY
    drag.value = {
      centerClientX,
      centerClientY,
      frameId,
      kind: 'rotate',
      pointerId: event.pointerId,
      startAngle: Math.atan2(event.clientY - centerClientY, event.clientX - centerClientX),
      start: snapshot(frame)
    }
    ;(event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId)
  }

  function move(event: PointerEvent) {
    const active = drag.value
    if (!active || active.pointerId !== event.pointerId) return
    const frame = store.graph.getNode(active.frameId)
    if (!frame) return

    if (active.kind === 'rotate') {
      const angle = Math.atan2(
        event.clientY - active.centerClientY,
        event.clientX - active.centerClientX
      )
      store.graph.updateNodePreview(frame.id, {
        rotation: active.start.rotation + ((angle - active.startAngle) * 180) / Math.PI
      })
    } else {
      const zoom = Math.max(store.state.zoom, 0.01)
      const screenDx = (event.clientX - active.startClientX) / zoom
      const screenDy = (event.clientY - active.startClientY) / zoom
      const radians = (-active.start.rotation * Math.PI) / 180
      const dx = screenDx * Math.cos(radians) - screenDy * Math.sin(radians)
      const dy = screenDx * Math.sin(radians) + screenDy * Math.cos(radians)
      const minimum = 40
      let left = 0
      let top = 0
      let right = active.start.width
      let bottom = active.start.height
      if (active.corner.includes('w')) left = Math.min(dx, right - minimum)
      if (active.corner.includes('e')) right = Math.max(minimum, active.start.width + dx)
      if (active.corner.includes('n')) top = Math.min(dy, bottom - minimum)
      if (active.corner.includes('s')) bottom = Math.max(minimum, active.start.height + dy)
      const width = right - left
      const height = bottom - top
      const localCenterDx = (left + right - active.start.width) / 2
      const localCenterDy = (top + bottom - active.start.height) / 2
      const forward = (active.start.rotation * Math.PI) / 180
      const centerDx = localCenterDx * Math.cos(forward) - localCenterDy * Math.sin(forward)
      const centerDy = localCenterDx * Math.sin(forward) + localCenterDy * Math.cos(forward)
      store.graph.updateNodePreview(frame.id, {
        height,
        width,
        x: active.start.x + active.start.width / 2 + centerDx - width / 2,
        y: active.start.y + active.start.height / 2 + centerDy - height / 2
      })
    }
    store.requestRepaint()
    onChange()
  }

  function end(event: PointerEvent) {
    const active = drag.value
    if (!active || active.pointerId !== event.pointerId) return
    const frame = store.graph.getNode(active.frameId)
    drag.value = null
    if (!frame) return
    const final = snapshot(frame)
    if (frameSnapshotChanged(active.start, final)) {
      const previous =
        active.kind === 'rotate'
          ? { rotation: active.start.rotation }
          : {
              height: active.start.height,
              width: active.start.width,
              x: active.start.x,
              y: active.start.y
            }
      const changes =
        active.kind === 'rotate'
          ? { rotation: final.rotation }
          : { height: final.height, width: final.width, x: final.x, y: final.y }
      store.graph.updateNodePreview(frame.id, previous)
      store.updateNode(frame.id, changes)
      store.commitNodeUpdate(
        frame.id,
        previous,
        active.kind === 'rotate' ? 'Rotate live app frame' : 'Resize live app frame'
      )
    }
    onChange()
  }

  return { beginResize, beginRotate, drag, end, move }
}
