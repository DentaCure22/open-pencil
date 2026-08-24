<script setup lang="ts">
import { useStickToBottom } from 'vue-stick-to-bottom'

const { canLoadOlder = false, loadingOlder = false } = defineProps<{
  canLoadOlder?: boolean
  loadingOlder?: boolean
}>()

const emit = defineEmits<{
  'load-older': []
}>()

const { contentRef, isAtBottom, scrollRef, scrollToBottom } = useStickToBottom({
  initial: 'instant',
  resize: 'instant'
})

function onTranscriptScroll() {
  const viewport = scrollRef.value
  if (!viewport || !canLoadOlder || loadingOlder) return
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
      class="h-full min-h-0 w-full touch-pan-y overflow-y-auto overscroll-y-contain outline-none"
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
      @click="scrollToBottom({ animation: 'smooth' })"
    >
      <icon-lucide-arrow-down class="size-3.5" />
    </button>
  </div>
</template>
