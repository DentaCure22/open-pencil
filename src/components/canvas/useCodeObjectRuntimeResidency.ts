import { useEventListener } from '@vueuse/core'
import {
  computed,
  onMounted,
  onUnmounted,
  ref,
  watch,
  type ComponentPublicInstance,
  type ComputedRef
} from 'vue'

import type { SceneNode } from '@open-pencil/scene-graph'

import { codeObjectDocument } from '@/app/code-object/model'
import { loadedCodeObjectRuntime } from '@/app/code-object/runtime'
import {
  clearCodeObjectRuntimeActivity,
  publishCodeObjectRuntimeActivity
} from '@/app/code-object/runtime-activity'
import type { EditorStore } from '@/app/editor/active-store'

const CODE_OBJECT_RUNTIME_OVERSCAN_PX = 256

interface CodeObjectRuntimeResidencyOptions {
  frames: ComputedRef<SceneNode[]>
  pinnedFrameIds: () => ReadonlySet<string>
  preserveRuntimesOnUnmount: () => boolean
  store: EditorStore
}

export function useCodeObjectRuntimeResidency({
  frames,
  pinnedFrameIds,
  preserveRuntimesOnUnmount,
  store
}: CodeObjectRuntimeResidencyOptions) {
  const documentVisible = ref(!document.hidden)
  const viewportActiveFrameIds = ref<Set<string>>(new Set())
  const surfaceHosts = new Map<string, HTMLElement>()
  let mounted = false
  let viewportObserver: IntersectionObserver | null = null

  const relevantFrameIds = computed(() => {
    const pinned = pinnedFrameIds()
    return new Set(
      frames.value
        .filter((frame) => viewportActiveFrameIds.value.has(frame.id) || pinned.has(frame.id))
        .map((frame) => frame.id)
    )
  })
  const activeFrameIds = computed(() =>
    documentVisible.value ? relevantFrameIds.value : new Set<string>()
  )

  function updateViewportActivity(entries: IntersectionObserverEntry[]) {
    const nextFrameIds = new Set(viewportActiveFrameIds.value)
    let changed = false
    for (const entry of entries) {
      const frameId = (entry.target as HTMLElement).dataset.codeObjectId
      if (!frameId) continue
      if (entry.isIntersecting) {
        if (!nextFrameIds.has(frameId)) {
          nextFrameIds.add(frameId)
          changed = true
        }
      } else if (nextFrameIds.delete(frameId)) changed = true
    }
    if (changed) viewportActiveFrameIds.value = nextFrameIds
  }

  function setFallbackViewportActivity(frameId: string, active: boolean) {
    const nextFrameIds = new Set(viewportActiveFrameIds.value)
    const changed = active ? !nextFrameIds.has(frameId) : nextFrameIds.has(frameId)
    if (!changed) return
    if (active) nextFrameIds.add(frameId)
    else nextFrameIds.delete(frameId)
    viewportActiveFrameIds.value = nextFrameIds
  }

  function ensureViewportObserver() {
    if (!mounted || viewportObserver || typeof IntersectionObserver === 'undefined') return
    const firstHost = surfaceHosts.values().next().value
    const canvasArea = firstHost?.closest<HTMLElement>('[data-test-id="canvas-area"]')
    if (!canvasArea) return
    viewportObserver = new IntersectionObserver(updateViewportActivity, {
      root: canvasArea,
      rootMargin: `${CODE_OBJECT_RUNTIME_OVERSCAN_PX}px`
    })
    for (const host of surfaceHosts.values()) viewportObserver.observe(host)
  }

  function bindSurfaceHost(frameId: string, value: Element | ComponentPublicInstance | null) {
    const previous = surfaceHosts.get(frameId)
    const host = value instanceof HTMLElement ? value : null
    if (previous === host) return
    if (previous) viewportObserver?.unobserve(previous)
    if (!host) {
      surfaceHosts.delete(frameId)
      setFallbackViewportActivity(frameId, false)
      return
    }
    surfaceHosts.set(frameId, host)
    ensureViewportObserver()
    if (viewportObserver) viewportObserver.observe(host)
    else if (mounted) setFallbackViewportActivity(frameId, true)
  }

  useEventListener(document, 'visibilitychange', () => {
    documentVisible.value = !document.hidden
  })

  watch(
    activeFrameIds,
    (frameIds) => {
      publishCodeObjectRuntimeActivity(store, frameIds)
      if (preserveRuntimesOnUnmount()) return
      const reactRuntimeFrameIds = new Set(
        [...frameIds].filter((frameId) => {
          const frame = store.graph.getNode(frameId)
          return frame && codeObjectDocument(frame)?.component !== 'smylr-production-app'
        })
      )
      loadedCodeObjectRuntime()?.disposeCodeObjectsExcept(reactRuntimeFrameIds)
    },
    { immediate: true }
  )

  onMounted(() => {
    mounted = true
    ensureViewportObserver()
    if (!viewportObserver) {
      viewportActiveFrameIds.value = new Set(surfaceHosts.keys())
    }
  })

  onUnmounted(() => {
    mounted = false
    viewportObserver?.disconnect()
    viewportObserver = null
    surfaceHosts.clear()
    viewportActiveFrameIds.value = new Set()
    clearCodeObjectRuntimeActivity(store)
  })

  return { activeFrameIds, bindSurfaceHost, documentVisible, relevantFrameIds }
}
