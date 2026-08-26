<script setup lang="ts">
import { computed } from 'vue'

import AiMarkdown from './AiMarkdown.vue'

const { state = 'complete', text } = defineProps<{
  state?: 'complete' | 'stopped' | 'streaming'
  text: string
}>()

const commentary = computed(() => text.trim())
</script>

<template>
  <div
    v-if="commentary"
    data-test-id="ai-commentary"
    :data-state="state"
    class="my-1 min-w-0 font-sans text-[13px] leading-5 font-normal"
    :class="state === 'streaming' ? 'agent-thought-shimmer' : 'text-surface'"
  >
    <AiMarkdown :content="commentary" :streaming="state === 'streaming'" variant="activity" />
  </div>
</template>
