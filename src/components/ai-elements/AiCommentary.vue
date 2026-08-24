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
const commentary = computed(() => displayed.value.trim())
</script>

<template>
  <p
    v-if="commentary"
    data-test-id="ai-commentary"
    :data-state="state"
    class="my-1 whitespace-pre-wrap font-sans text-[13px] leading-5"
    :class="state === 'streaming' ? 'agent-thought-shimmer' : 'text-muted'"
  >
    {{ commentary }}
  </p>
</template>
