<script setup lang="ts">
import { shallowRef, type ComponentPublicInstance } from 'vue'
import { useStickToBottom } from 'vue-stick-to-bottom'

const { contentRef, isAtBottom, scrollRef, scrollToBottom } = useStickToBottom({
  damping: 0.7,
  initial: 'instant',
  mass: 1.25,
  resize: { damping: 0.7, stiffness: 0.05, mass: 1.25 },
  stiffness: 0.05
})
const scrollElement = shallowRef<HTMLElement | null>(null)

function bindScrollRef(element: Element | ComponentPublicInstance | null) {
  const next = element instanceof HTMLElement ? element : null
  scrollRef.value = next
  scrollElement.value = next
}

function bindContentRef(element: Element | ComponentPublicInstance | null) {
  contentRef.value = element instanceof HTMLElement ? element : null
}
</script>

<template>
  <div
    aria-label="Conversation transcript"
    class="relative h-0 min-h-0 flex-1 overflow-hidden"
    role="log"
  >
    <div
      :ref="bindScrollRef"
      data-test-id="ai-conversation-viewport"
      tabindex="-1"
      class="h-full min-h-0 w-full touch-pan-y overflow-y-auto overscroll-y-contain outline-none"
      style="overflow-anchor: none"
    >
      <div :ref="bindContentRef" class="flex min-h-full flex-col">
        <slot />
      </div>
    </div>
    <slot name="overlay" :scroll-element="scrollElement" />
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
