import { ref, type CSSProperties } from 'vue'

import {
  CODE_OBJECT_VIEWPORT_PRESETS,
  codeObjectViewportPluginData,
  type CodeObjectViewportPresetId
} from '@open-pencil/core/code-object'
import type { SceneNode } from '@open-pencil/scene-graph'

import type { EditorStore } from '@/app/editor/active-store'

export type FrameCorner = 'nw' | 'ne' | 'se' | 'sw'
export { CODE_OBJECT_VIEWPORT_PRESETS, type CodeObjectViewportPresetId }

export const DEFAULT_CODE_OBJECT_RADIUS = 16

type FrameSnapshot = Pick<SceneNode, 'height' | 'rotation' | 'width' | 'x' | 'y'>
export type CodeObjectPresentationViewport = Pick<EditorStore['state'], 'panX' | 'panY' | 'zoom'>
type CodeObjectViewportStore = Pick<EditorStore, 'updateNodeWithUndo'> & {
  graph: Pick<EditorStore['graph'], 'getNode'>
}

export type CodeObjectTransformControllerStore = Pick<
  EditorStore,
  'commitNodeUpdate' | 'requestRepaint' | 'updateNode'
> & {
  graph: Pick<EditorStore['graph'], 'getAbsolutePosition' | 'getNode' | 'updateNodePreview'>
  state: Pick<EditorStore['state'], 'panX' | 'panY' | 'zoom'>
}
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

export const CODE_OBJECT_RESIZE_HANDLE_STYLE = {
  borderWidth: '2px',
  height: '10px',
  width: '10px'
} as const

export const CODE_OBJECT_ROTATE_HANDLE_STYLE = { height: '18px', width: '18px' } as const

export function codeObjectCanvasStyle(
  store: EditorStore,
  frame: SceneNode,
  viewport: CodeObjectPresentationViewport = store.state
) {
  const abs = store.graph.getAbsolutePosition(frame.id)
  const zoom = viewport.zoom
  const centerX = frame.width / 2
  const centerY = frame.height / 2
  return {
    backfaceVisibility: 'hidden',
    borderRadius: `${Math.max(0, frame.cornerRadius)}px`,
    contain: 'layout paint',
    height: `${Math.max(1, frame.height)}px`,
    opacity: String(frame.opacity),
    transform: `translate3d(${abs.x * zoom + viewport.panX}px, ${
      abs.y * zoom + viewport.panY
    }px, 0) scale(${zoom}) translate(${centerX}px, ${centerY}px) rotate(${
      frame.rotation
    }deg) translate(${-centerX}px, ${-centerY}px)`,
    transformOrigin: 'top left',
    width: `${Math.max(1, frame.width)}px`,
    willChange: 'transform'
  } satisfies CSSProperties
}

export function codeObjectScreenOverlayStyle(
  store: EditorStore,
  frame: SceneNode,
  viewport: CodeObjectPresentationViewport = store.state
) {
  const abs = store.graph.getAbsolutePosition(frame.id)
  const zoom = viewport.zoom
  return {
    borderRadius: `${Math.max(0, frame.cornerRadius * zoom)}px`,
    height: `${Math.max(1, frame.height * zoom)}px`,
    transform: `translate3d(${abs.x * zoom + viewport.panX}px, ${
      abs.y * zoom + viewport.panY
    }px, 0) rotate(${frame.rotation}deg)`,
    transformOrigin: 'center center',
    width: `${Math.max(1, frame.width * zoom)}px`
  }
}

export function codeObjectResizeHandles(frame: SceneNode, zoom: number) {
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

export function codeObjectRotationHandles(frame: SceneNode, zoom: number) {
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

function capturePointer(target: EventTarget | null, pointerId: number) {
  if (target && 'setPointerCapture' in target && typeof target.setPointerCapture === 'function') {
    target.setPointerCapture(pointerId)
  }
}

function frameSnapshotChanged(previous: FrameSnapshot, current: FrameSnapshot): boolean {
  return (Object.keys(previous) as (keyof FrameSnapshot)[]).some(
    (key) => previous[key] !== current[key]
  )
}

export function codeObjectViewportPresetId(
  frame: Pick<SceneNode, 'height' | 'width'> | null | undefined
): CodeObjectViewportPresetId | null {
  if (!frame) return null
  return (
    CODE_OBJECT_VIEWPORT_PRESETS.find(
      (preset) => preset.width === frame.width && preset.height === frame.height
    )?.id ?? null
  )
}

export function applyCodeObjectViewportPreset(
  store: CodeObjectViewportStore,
  frameId: string,
  presetId: CodeObjectViewportPresetId
) {
  const frame = store.graph.getNode(frameId)
  const preset = CODE_OBJECT_VIEWPORT_PRESETS.find((candidate) => candidate.id === presetId)
  if (!frame || !preset) return false
  const centerX = frame.x + frame.width / 2
  const centerY = frame.y + frame.height / 2
  const pluginData = codeObjectViewportPluginData(frame, presetId)
  store.updateNodeWithUndo(
    frame.id,
    {
      height: preset.height,
      ...(pluginData ? { pluginData } : {}),
      rotation: 0,
      width: preset.width,
      x: centerX - preset.width / 2,
      y: centerY - preset.height / 2
    },
    `Set ${preset.label} viewport`
  )
  return true
}

export function createCodeObjectTransformController(
  store: CodeObjectTransformControllerStore,
  onChange: () => void
) {
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
    capturePointer(event.currentTarget, event.pointerId)
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
    capturePointer(event.currentTarget, event.pointerId)
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
      const resizedPluginData =
        active.kind === 'resize' ? codeObjectViewportPluginData(frame, null) : null
      const previous =
        active.kind === 'rotate'
          ? { rotation: active.start.rotation }
          : {
              height: active.start.height,
              ...(resizedPluginData ? { pluginData: frame.pluginData } : {}),
              width: active.start.width,
              x: active.start.x,
              y: active.start.y
            }
      const changes =
        active.kind === 'rotate'
          ? { rotation: final.rotation }
          : {
              height: final.height,
              ...(resizedPluginData ? { pluginData: resizedPluginData } : {}),
              width: final.width,
              x: final.x,
              y: final.y
            }
      store.graph.updateNodePreview(frame.id, previous)
      store.updateNode(frame.id, changes)
      store.commitNodeUpdate(
        frame.id,
        previous,
        active.kind === 'rotate' ? 'Rotate code object' : 'Resize code object'
      )
    }
    onChange()
  }

  return { beginResize, beginRotate, drag, end, move }
}
