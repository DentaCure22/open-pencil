import {
  onBeforeUnmount,
  onMounted,
  readonly,
  shallowRef,
  type CSSProperties,
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

type SharedPresentationViewport = {
  active: boolean
  refCount: number
  scheduleSync: () => void
  syncPresentationFrame: (presentation: EditorPresentationFrame) => void
  unsubscribe: Array<() => void>
  viewport: ShallowRef<EditorPresentationViewport>
}

const presentationViewports = new WeakMap<EditorStore, SharedPresentationViewport>()

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
 * CanvasKit, Code Objects, and Object Graph presentation.
 */
export function useEditorPresentationViewport(store: EditorStore) {
  const existing = presentationViewports.get(store)
  const shared = existing ?? createSharedPresentationViewport(store)
  if (!existing) presentationViewports.set(store, shared)

  onMounted(() => retainPresentationViewport(store, shared))
  onBeforeUnmount(() => releasePresentationViewport(store, shared))

  return readonly(shared.viewport)
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
  node: SceneNode,
  viewport: EditorPresentationViewport
): CSSProperties {
  const absolute = store.graph.getAbsolutePosition(node.id)
  const zoom = viewport.zoom
  return {
    height: `${Math.max(1, node.height * zoom)}px`,
    opacity: node.opacity,
    transform: `translate3d(${absolute.x * zoom + viewport.panX}px, ${
      absolute.y * zoom + viewport.panY
    }px, 0) rotate(${node.rotation}deg)`,
    transformOrigin: 'center center',
    width: `${Math.max(1, node.width * zoom)}px`
  }
}
