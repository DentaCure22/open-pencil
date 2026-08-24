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

import {
  clearCodeObjectRuntimeActivity,
  publishCodeObjectRuntimeActivity
} from '@/app/code-object/runtime-activity'
import {
  CODE_OBJECT_LIVE_RUNTIME_CAP,
  reconcileLiveRuntimeResidency,
  sameStringSet
} from '@/app/code-object/runtime-residency'
import type { EditorStore } from '@/app/editor/active-store'

const CODE_OBJECT_RUNTIME_OVERSCAN_PX = 256

interface CodeObjectRuntimeResidencyOptions {
  frames: ComputedRef<SceneNode[]>
  pinnedFrameIds: () => ReadonlySet<string>
  store: EditorStore
}

export function useCodeObjectRuntimeResidency({
  frames,
  pinnedFrameIds,
  store
}: CodeObjectRuntimeResidencyOptions) {
  const documentVisible = ref(!document.hidden)
  const viewportActiveFrameIds = ref<Set<string>>(new Set())
  const interactedAtByFrame = ref<Record<string, number>>({})
  const residentFrameIds = ref<Set<string>>(new Set())
  const surfaceHosts = new Map<string, HTMLElement>()
  let mounted = false
  let viewportObserver: IntersectionObserver | null = null
  let interactionSequence = 0

  const relevantFrameIds = computed(() => {
    const pinned = pinnedFrameIds()
    return new Set(
      frames.value
        .filter((frame) => viewportActiveFrameIds.value.has(frame.id) || pinned.has(frame.id))
        .map((frame) => frame.id)
    )
  })
  const activeFrameIds = computed(() => {
    if (!documentVisible.value) return new Set<string>()
    return reconcileLiveRuntimeResidency({
      cap: CODE_OBJECT_LIVE_RUNTIME_CAP,
      frameIds: [...relevantFrameIds.value],
      interactedAtByFrame: interactedAtByFrame.value,
      pinnedFrameIds: [...pinnedFrameIds()],
      residentFrameIds: residentFrameIds.value
    })
  })

  function promote(frameId: string) {
    interactionSequence += 1
    interactedAtByFrame.value = {
      ...interactedAtByFrame.value,
      [frameId]: interactionSequence
    }
  }

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

  watch(frames, (nextFrames) => {
    const currentFrameIds = new Set(nextFrames.map((frame) => frame.id))
    const nextInteracted = Object.fromEntries(
      Object.entries(interactedAtByFrame.value).filter(([frameId]) => currentFrameIds.has(frameId))
    )
    if (Object.keys(nextInteracted).length !== Object.keys(interactedAtByFrame.value).length) {
      interactedAtByFrame.value = nextInteracted
    }
  })

  watch(
    () => [...activeFrameIds.value].sort().join('\0'),
    () => {
      const frameIds = activeFrameIds.value
      if (!sameStringSet(residentFrameIds.value, frameIds)) {
        residentFrameIds.value = new Set(frameIds)
      }
      publishCodeObjectRuntimeActivity(store, frameIds)
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

  return {
    activeFrameIds,
    bindSurfaceHost,
    documentVisible,
    promote,
    relevantFrameIds,
    viewportActiveFrameIds
  }
}
