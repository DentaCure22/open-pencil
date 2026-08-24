<script setup lang="ts">
import { computed } from 'vue'

import { useStreamedText } from './streamed-text'

const { state = 'complete', text } = defineProps<{
  state?: 'complete' | 'stopped' | 'streaming'
  text: string
}>()

const displayed = useStreamedText(
  () => text,
  () => state === 'streaming'
)
const summary = computed(() => {
  const incoming = text.trim()
  if (!incoming || ['thinking', 'thought'].includes(incoming.toLowerCase())) return ''
  return displayed.value.trim()
})
</script>

<template>
  <p
    v-if="summary"
    data-test-id="ai-reasoning"
    :data-state="state"
    class="my-1 whitespace-pre-wrap font-sans text-[13px] leading-5"
    :class="state === 'streaming' ? 'agent-thought-shimmer' : 'text-muted'"
  >
    {{ summary }}
  </p>
</template>
