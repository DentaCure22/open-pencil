<script setup lang="ts">
import { computed, ref } from 'vue'

const { state = 'complete', text } = defineProps<{
  state?: 'complete' | 'stopped' | 'streaming'
  text: string
}>()

const expanded = ref(false)
const label = computed(() => (state === 'streaming' ? 'Thinking' : 'Thought'))
const trace = computed(() => {
  const value = text.trim()
  if (value && !['thinking', 'thought'].includes(value.toLowerCase())) return value
  if (state === 'streaming') return 'Reasoning is still in progress.'
  if (state === 'stopped') return 'Reasoning stopped before a summary was available.'
  return 'Reasoning completed.'
})
</script>

<template>
  <div
    data-test-id="ai-reasoning"
    :data-state="state"
    class="group min-w-0 py-0.5 text-[12px] leading-5 text-surface/80"
  >
    <button
      type="button"
      class="flex w-full min-w-0 items-center gap-1.5 rounded-[5px] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-component/30"
      :aria-expanded="expanded"
      :aria-label="expanded ? 'Hide thought trace' : 'Show thought trace'"
      data-test-id="ai-reasoning-toggle"
      @click="expanded = !expanded"
    >
      <span
        class="flex size-4 shrink-0 items-center justify-center"
        :class="state === 'streaming' ? 'animate-pulse text-accent' : 'text-muted/85'"
        aria-hidden="true"
      >
        <icon-lucide-brain class="size-3.5 stroke-[1.6]" />
      </span>
      <span class="min-w-0 flex-1 truncate">{{ label }}</span>
      <span
        class="flex size-6 shrink-0 items-center justify-center rounded-[5px] text-muted opacity-0 transition-[opacity,background-color,color] duration-150 group-hover:opacity-100 hover:bg-hover hover:text-surface group-focus-within:opacity-100 motion-reduce:transition-none [@media(hover:none)]:opacity-100"
        aria-hidden="true"
      >
        <icon-lucide-chevron-down
          v-if="expanded"
          class="size-3.5"
          data-direction="down"
          data-test-id="ai-disclosure-chevron"
        />
        <icon-lucide-chevron-right
          v-else
          class="size-3.5"
          data-direction="right"
          data-test-id="ai-disclosure-chevron"
        />
      </span>
    </button>
    <Transition
      enter-active-class="grid overflow-hidden transition-[grid-template-rows,opacity,transform] duration-200 ease-out motion-reduce:transition-none"
      enter-from-class="-translate-y-0.5 grid-rows-[0fr] opacity-0"
      enter-to-class="grid-rows-[1fr] translate-y-0 opacity-100"
      leave-active-class="grid overflow-hidden transition-[grid-template-rows,opacity,transform] duration-150 ease-in motion-reduce:transition-none"
      leave-from-class="grid-rows-[1fr] translate-y-0 opacity-100"
      leave-to-class="-translate-y-0.5 grid-rows-[0fr] opacity-0"
    >
      <div v-if="expanded" data-test-id="ai-reasoning-content">
        <p class="min-h-0 overflow-hidden py-1 whitespace-pre-wrap text-muted">{{ trace }}</p>
      </div>
    </Transition>
  </div>
</template>
