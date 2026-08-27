import {
  onBeforeUnmount,
  onMounted,
  readonly,
  shallowRef,
  type CSSProperties,
  type Ref,
  type ShallowRef
} from 'vue'

import type { SceneNode } from '@open-pencil/scene-graph'
import {
  cancelEditorPresentationFrame,
  scheduleEditorPresentationFrame,
  type EditorPresentationFrame
} from '@open-pencil/vue/presentation'

import type { EditorStore } from '@/app/editor/active-store'

export type EditorPresentationViewport = Readonly<{
  panX: number
  panY: number
  revision: number
  zoom: number
}>

export const CANVAS_VIEWPORT_TRANSFORM_CSS_VAR = '--openpencil-canvas-viewport-transform'
export const CANVAS_VIEWPORT_TRANSFORM = `var(${CANVAS_VIEWPORT_TRANSFORM_CSS_VAR})`
export const CANVAS_GRID_POSITION_CSS_VAR = '--openpencil-canvas-grid-position'
export const CANVAS_GRID_SIZE_CSS_VAR = '--openpencil-canvas-grid-size'
export const CANVAS_GRID_POSITION = `var(${CANVAS_GRID_POSITION_CSS_VAR})`
export const CANVAS_GRID_SIZE = `var(${CANVAS_GRID_SIZE_CSS_VAR})`

const BASE_GRID_STEP = 24
const MIN_GRID_STEP_PX = 18
const MAX_GRID_STEP_PX = 36

export function canvasGridStepPx(zoom: number): number {
  const safeZoom = Math.max(zoom, 0.02)
  let worldStep = BASE_GRID_STEP
  while (worldStep * safeZoom < MIN_GRID_STEP_PX) worldStep *= 2
  while (worldStep * safeZoom > MAX_GRID_STEP_PX) worldStep /= 2
  return worldStep * safeZoom
}

type SharedPresentationViewport = {
  active: boolean
  refCount: number
  scheduleSync: () => void
  syncPresentationFrame: (presentation: EditorPresentationFrame) => void
  unsubscribe: Array<() => void>
  viewport: ShallowRef<EditorPresentationViewport>
}

type SharedOverlayGeometryVersion = {
  refCount: number
  unsubscribe: (() => void) | null
  version: ShallowRef<EditorOverlayGeometryRevision>
}

export type EditorOverlayGeometryRevision = Readonly<{
  nodeId: string | null
  revision: number
}>

type OverlayStyleResolver = (node: SceneNode) => CSSProperties

export interface EditorNodeOverlayStyleCache {
  clear(): void
  resolve(node: SceneNode): CSSProperties
}

const presentationViewports = new WeakMap<EditorStore, SharedPresentationViewport>()
const overlayGeometryVersions = new WeakMap<EditorStore, SharedOverlayGeometryVersion>()

function initialViewport(store: EditorStore): EditorPresentationViewport {
  return {
    panX: store.state.panX,
    panY: store.state.panY,
    revision: 0,
    zoom: store.state.zoom
  }
}

/**
 * Keeps DOM-backed Board surfaces on the same animation-frame snapshot as
 * CanvasKit and Code Object presentation. Hover and other overlay-only
 * chrome do not move the camera, so they do not bump this viewport.
 */
export function useEditorPresentationViewport(store: EditorStore) {
  const existing = presentationViewports.get(store)
  const shared = existing ?? createSharedPresentationViewport(store)
  if (!existing) presentationViewports.set(store, shared)

  onMounted(() => retainPresentationViewport(store, shared))
  onBeforeUnmount(() => releasePresentationViewport(store, shared))

  return readonly(shared.viewport)
}

/** Re-renders DOM-backed objects for transient geometry without coupling them to camera movement. */
export function useEditorOverlayGeometryVersion(store: EditorStore) {
  const existing = overlayGeometryVersions.get(store)
  const shared =
    existing ??
    ({
      refCount: 0,
      unsubscribe: null,
      version: shallowRef({ nodeId: null, revision: 0 })
    } satisfies SharedOverlayGeometryVersion)
  if (!existing) overlayGeometryVersions.set(store, shared)

  onMounted(() => {
    shared.refCount += 1
    if (shared.refCount === 1) {
      shared.unsubscribe = store.onEditorEvent('node:previewUpdated', (nodeId) => {
        shared.version.value = {
          nodeId,
          revision: shared.version.value.revision + 1
        }
      })
    }
  })
  onBeforeUnmount(() => {
    shared.refCount -= 1
    if (shared.refCount > 0) return
    shared.unsubscribe?.()
    shared.unsubscribe = null
    overlayGeometryVersions.delete(store)
  })

  return readonly(shared.version)
}

/**
 * Keeps style objects stable for overlays that are unrelated to the current
 * preview mutation. Committed graph changes invalidate the small cache once.
 */
export function useEditorNodeOverlayStyle(store: EditorStore, resolveStyle: OverlayStyleResolver) {
  const geometry = useEditorOverlayGeometryVersion(store)
  const cache = createEditorNodeOverlayStyleCache(store, geometry, resolveStyle)

  onBeforeUnmount(() => cache.clear())
  return (node: SceneNode) => cache.resolve(node)
}

export function createEditorNodeOverlayStyleCache(
  store: EditorStore,
  geometry: Readonly<Ref<EditorOverlayGeometryRevision>>,
  resolveStyle: OverlayStyleResolver
): EditorNodeOverlayStyleCache {
  const styles = new Map<
    string,
    { presentedX: number; presentedY: number; previewRevision: number; style: CSSProperties }
  >()
  let sceneVersion = -1

  function resolve(node: SceneNode): CSSProperties {
    if (sceneVersion !== store.state.sceneVersion) {
      sceneVersion = store.state.sceneVersion
      styles.clear()
    }

    const update = geometry.value
    const presented = store.graph.getPresentedNodePosition(node.id)
    const current = styles.get(node.id)
    const affected =
      update.nodeId === node.id ||
      Boolean(update.nodeId && store.graph.isDescendant(node.id, update.nodeId))
    if (
      current &&
      current.presentedX === presented.x &&
      current.presentedY === presented.y &&
      (!affected || current.previewRevision === update.revision)
    ) {
      return current.style
    }

    const style = resolveStyle(node)
    styles.set(node.id, {
      presentedX: presented.x,
      presentedY: presented.y,
      previewRevision: update.revision,
      style
    })
    return style
  }

  return { clear: () => styles.clear(), resolve }
}

export function useSceneNodeOverlayStyle(store: EditorStore) {
  return useEditorNodeOverlayStyle(store, (node) => sceneNodeOverlayStyle(store, node))
}

function createSharedPresentationViewport(store: EditorStore): SharedPresentationViewport {
  const shared: SharedPresentationViewport = {
    active: false,
    refCount: 0,
    scheduleSync: () => scheduleEditorPresentationFrame(store, shared.syncPresentationFrame),
    syncPresentationFrame: (presentation) => {
      if (!shared.active) return
      shared.viewport.value = {
        panX: presentation.viewport.x,
        panY: presentation.viewport.y,
        revision: presentation.revision,
        zoom: presentation.viewport.zoom
      }
    },
    unsubscribe: [],
    viewport: shallowRef<EditorPresentationViewport>(initialViewport(store))
  }
  return shared
}

function retainPresentationViewport(store: EditorStore, shared: SharedPresentationViewport) {
  shared.refCount += 1
  if (shared.refCount > 1) return
  shared.active = true
  shared.unsubscribe = [
    store.onEditorEvent('viewport:changed', shared.scheduleSync),
    store.onEditorEvent('render:requested', shared.scheduleSync),
    store.onEditorEvent('repaint:requested', shared.scheduleSync)
  ]
}

function releasePresentationViewport(store: EditorStore, shared: SharedPresentationViewport) {
  shared.refCount -= 1
  if (shared.refCount > 0) return
  shared.active = false
  cancelEditorPresentationFrame(store, shared.syncPresentationFrame)
  for (const stop of shared.unsubscribe) stop()
  shared.unsubscribe = []
  presentationViewports.delete(store)
}

export function sceneNodeOverlayStyle(
  store: Pick<EditorStore, 'graph'>,
  node: SceneNode
): CSSProperties {
  const absolute = store.graph.getAbsolutePosition(node.id)
  const centerX = node.width / 2
  const centerY = node.height / 2
  return {
    height: `${Math.max(1, node.height)}px`,
    opacity: node.opacity,
    transform: `${CANVAS_VIEWPORT_TRANSFORM} translate3d(${absolute.x}px, ${absolute.y}px, 0) translate(${centerX}px, ${centerY}px) rotate(${node.rotation}deg) translate(${-centerX}px, ${-centerY}px)`,
    transformOrigin: 'top left',
    width: `${Math.max(1, node.width)}px`
  }
}

export function useCanvasViewportCssVariables(store: EditorStore, target: Ref<HTMLElement | null>) {
  let unsubscribe: Array<() => void> = []

  function sync(viewport: Pick<EditorStore['state'], 'panX' | 'panY' | 'zoom'> = store.state) {
    const element = target.value
    if (!element) return
    const gridStep = canvasGridStepPx(viewport.zoom)
    element.style.setProperty(
      CANVAS_VIEWPORT_TRANSFORM_CSS_VAR,
      `translate3d(${viewport.panX}px, ${viewport.panY}px, 0) scale(${viewport.zoom})`
    )
    element.style.setProperty(CANVAS_GRID_POSITION_CSS_VAR, `${viewport.panX}px ${viewport.panY}px`)
    element.style.setProperty(CANVAS_GRID_SIZE_CSS_VAR, `${gridStep}px`)
  }

  function syncPresentationFrame(presentation: EditorPresentationFrame) {
    sync({
      panX: presentation.viewport.x,
      panY: presentation.viewport.y,
      zoom: presentation.viewport.zoom
    })
  }

  function scheduleSync() {
    scheduleEditorPresentationFrame(store, syncPresentationFrame)
  }

  onMounted(() => {
    sync()
    unsubscribe = [
      store.onEditorEvent('viewport:changed', scheduleSync),
      store.onEditorEvent('repaint:requested', scheduleSync)
    ]
  })
  onBeforeUnmount(() => {
    cancelEditorPresentationFrame(store, syncPresentationFrame)
    for (const stop of unsubscribe) stop()
    unsubscribe = []
  })
}
