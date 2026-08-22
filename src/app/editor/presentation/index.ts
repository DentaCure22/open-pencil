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
 * CanvasKit and Code Object presentation.
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

  onBeforeUnmount(cache.clear)
  return cache.resolve
}

export function createEditorNodeOverlayStyleCache(
  store: EditorStore,
  geometry: Readonly<Ref<EditorOverlayGeometryRevision>>,
  resolveStyle: OverlayStyleResolver
): EditorNodeOverlayStyleCache {
  const styles = new Map<string, { previewRevision: number; style: CSSProperties }>()
  let sceneVersion = -1

  function resolve(node: SceneNode): CSSProperties {
    if (sceneVersion !== store.state.sceneVersion) {
      sceneVersion = store.state.sceneVersion
      styles.clear()
    }

    const update = geometry.value
    const current = styles.get(node.id)
    const affected =
      update.nodeId === node.id ||
      Boolean(update.nodeId && store.graph.isDescendant(node.id, update.nodeId))
    if (current && (!affected || current.previewRevision === update.revision)) {
      return current.style
    }

    const style = resolveStyle(node)
    styles.set(node.id, { previewRevision: update.revision, style })
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
    store.onEditorEvent('overlay:requested', shared.scheduleSync),
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
    element.style.setProperty(
      CANVAS_VIEWPORT_TRANSFORM_CSS_VAR,
      `translate3d(${viewport.panX}px, ${viewport.panY}px, 0) scale(${viewport.zoom})`
    )
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
