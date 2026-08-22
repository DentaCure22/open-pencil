import { usePreferredReducedMotion, useRafFn } from '@vueuse/core'
import { ref } from 'vue'

import type { EditorStore } from '@/app/editor/active-store'

export type EditorViewport = {
  panX: number
  panY: number
  zoom: number
}

type ViewportAnimation = {
  from: EditorViewport
  startedAt: number
  to: EditorViewport
}

const VIEWPORT_ANIMATION_DURATION_MS = 200

function easeOutCubic(progress: number): number {
  return 1 - (1 - progress) ** 3
}

export function viewportSnapshot(store: EditorStore): EditorViewport {
  return {
    panX: store.state.panX,
    panY: store.state.panY,
    zoom: store.state.zoom
  }
}

export function viewportMatches(
  first: EditorViewport,
  second: EditorViewport,
  tolerance = 0.01
): boolean {
  return (
    Math.abs(first.panX - second.panX) <= tolerance &&
    Math.abs(first.panY - second.panY) <= tolerance &&
    Math.abs(first.zoom - second.zoom) <= tolerance
  )
}

export function useViewportAnimation(store: EditorStore) {
  const reducedMotion = usePreferredReducedMotion()
  const animation = ref<ViewportAnimation | null>(null)
  const { pause, resume } = useRafFn(
    ({ timestamp }) => {
      const current = animation.value
      if (!current) {
        pause()
        return
      }
      const progress = Math.min(1, (timestamp - current.startedAt) / VIEWPORT_ANIMATION_DURATION_MS)
      const eased = easeOutCubic(progress)
      store.setViewport({
        panX: current.from.panX + (current.to.panX - current.from.panX) * eased,
        panY: current.from.panY + (current.to.panY - current.from.panY) * eased,
        zoom: current.from.zoom + (current.to.zoom - current.from.zoom) * eased
      })
      if (progress < 1) return
      animation.value = null
      pause()
    },
    { immediate: false }
  )

  function animateTo(target: EditorViewport) {
    const from = viewportSnapshot(store)
    if (viewportMatches(from, target)) {
      store.setViewport(target)
      return
    }
    if (reducedMotion.value === 'reduce') {
      animation.value = null
      pause()
      store.setViewport(target)
      return
    }
    animation.value = { from, startedAt: performance.now(), to: target }
    resume()
  }

  function cancel() {
    animation.value = null
    pause()
  }

  function isAnimatingTo(target: EditorViewport): boolean {
    return !!animation.value && viewportMatches(animation.value.to, target)
  }

  return { animateTo, cancel, isAnimatingTo }
}
