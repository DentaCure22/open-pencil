<script setup lang="ts">
import { useStickToBottom } from 'vue-stick-to-bottom'
import { watch } from 'vue'

import { IS_BROWSER } from '@/constants'

const {
  canLoadOlder = false,
  initialAtBottom = true,
  initialScrollTop,
  loadingOlder = false
} = defineProps<{
  canLoadOlder?: boolean
  initialAtBottom?: boolean
  initialScrollTop?: number
  loadingOlder?: boolean
}>()

const emit = defineEmits<{
  'load-older': []
}>()

const SEND_SCROLL_DURATION_MS = 420
const SEND_SCROLL_SPRING = { damping: 0.82, mass: 1, stiffness: 0.12 } as const

const { contentRef, escapedFromLock, isAtBottom, scrollRef, scrollToBottom, setOptions } =
  useStickToBottom({
    initial: initialScrollTop === undefined && initialAtBottom ? 'instant' : false,
    // Match T3's live-follow model: keep the live edge fixed while content grows.
    // A spring makes the viewport chase every resize and turns steady streaming
    // into visible catch-up motion.
    resize: 'instant'
  })

let smoothResizeActive = false

// Hide a populated transcript until its initial scroll position and virtualized
// message heights have settled. After that, pin a locked live edge in
// ResizeObserver's pre-paint phase so streaming growth cannot flash one frame
// before the viewport catches up. The library still owns escape and manual
// navigation behavior.
watch(
  [scrollRef, contentRef],
  ([viewport, content], _previous, onCleanup) => {
    if (!viewport || !content) return
    const pinInitialPosition = () => {
      if (initialScrollTop !== undefined) {
        viewport.scrollTop = Math.max(
          0,
          Math.min(initialScrollTop, viewport.scrollHeight - viewport.clientHeight)
        )
      } else if (initialAtBottom) {
        viewport.scrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
      }
    }
    const initializingPosition = initialScrollTop !== undefined || initialAtBottom
    if (initializingPosition) content.style.visibility = 'hidden'
    pinInitialPosition()
    let revealFrame = 0
    if (initializingPosition) {
      revealFrame = requestAnimationFrame(() => {
        pinInitialPosition()
        revealFrame = requestAnimationFrame(() => {
          pinInitialPosition()
          content.style.visibility = ''
        })
      })
    }
    let previousHeight = content.getBoundingClientRect().height
    const observer = new ResizeObserver((entries) => {
      const height = entries[0]?.contentRect.height ?? previousHeight
      const resized = height !== previousHeight
      previousHeight = height
      if (!resized || smoothResizeActive || escapedFromLock.value || !isAtBottom.value) {
        return
      }
      viewport.scrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
    })
    observer.observe(content)
    onCleanup(() => {
      if (revealFrame) cancelAnimationFrame(revealFrame)
      content.style.visibility = ''
      observer.disconnect()
    })
  },
  { flush: 'post', immediate: true }
)

async function scrollToLatest(animation: 'instant' | 'smooth' = 'smooth'): Promise<boolean> {
  const reducedMotion = IS_BROWSER && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (animation === 'instant' || reducedMotion) {
    return await scrollToBottom({ animation: 'instant', ignoreEscapes: true })
  }

  smoothResizeActive = true
  setOptions({ resize: SEND_SCROLL_SPRING })
  try {
    return await scrollToBottom({
      animation: SEND_SCROLL_SPRING,
      duration: SEND_SCROLL_DURATION_MS,
      ignoreEscapes: true
    })
  } finally {
    smoothResizeActive = false
    setOptions({ resize: 'instant' })
  }
}

defineExpose({ scrollToLatest })

function onTranscriptScroll() {
  const viewport = scrollRef.value
  if (!viewport || !contentRef.value || !canLoadOlder || loadingOlder) return
  if (viewport.scrollTop <= 80) emit('load-older')
}
</script>

<template>
  <div
    aria-label="Conversation transcript"
    class="relative h-0 min-h-0 flex-1 overflow-clip"
    role="log"
  >
    <div
      ref="scrollRef"
      data-test-id="ai-conversation-viewport"
      tabindex="-1"
      class="scrollbar-panel h-full min-h-0 w-full touch-pan-y overflow-y-auto overscroll-y-contain outline-none"
      style="overflow-anchor: none"
      @scroll.passive="onTranscriptScroll"
    >
      <div ref="contentRef" class="flex min-h-full flex-col">
        <slot />
      </div>
    </div>
    <slot name="overlay" :scroll-element="scrollRef" />
    <button
      v-if="!isAtBottom"
      type="button"
      aria-label="Scroll to latest message"
      data-test-id="ai-conversation-scroll-button"
      class="absolute bottom-2 left-1/2 z-10 flex size-7 -translate-x-1/2 items-center justify-center rounded-full border border-border bg-panel text-muted shadow-chrome-panel hover:bg-hover hover:text-surface"
      @click="scrollToLatest()"
    >
      <icon-lucide-arrow-down class="size-3.5" />
    </button>
  </div>
</template>
