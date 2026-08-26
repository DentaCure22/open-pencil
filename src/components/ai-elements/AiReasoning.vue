<script setup lang="ts">
import { computed } from 'vue'

import AiMarkdown from './AiMarkdown.vue'

const { state = 'complete', text } = defineProps<{
  state?: 'complete' | 'stopped' | 'streaming'
  text: string
}>()

const summary = computed(() => {
  const incoming = text.trim()
  if (!incoming || ['thinking', 'thought'].includes(incoming.toLowerCase())) return ''
  return incoming
})
</script>

<template>
  <div
    v-if="summary"
    data-test-id="ai-reasoning"
    :data-state="state"
    class="my-1 min-w-0 font-sans text-[13px] leading-5 font-normal"
    :class="state === 'streaming' ? 'agent-thought-shimmer' : 'text-surface'"
  >
    <AiMarkdown :content="summary" :streaming="state === 'streaming'" variant="activity" />
  </div>
</template>
