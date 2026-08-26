<script setup lang="ts">
import { computed } from 'vue'

import { splitStreamedTextTail } from './streamed-text'

const { active = false, text } = defineProps<{
  active?: boolean
  text: string
}>()

const split = computed(() => (active ? splitStreamedTextTail(text) : undefined))
</script>

<template>
  <template v-if="split">
    {{ split.stable
    }}<template v-for="segment in split.tail" :key="segment.key"
      ><template v-if="segment.value !== undefined">{{ segment.value }}</template
      ><span v-else class="assistant-stream-word"
        ><span v-for="glyph in segment.glyphs" :key="glyph.key" class="assistant-stream-glyph">{{
          glyph.value
        }}</span></span
      ></template
    >
  </template>
  <template v-else>{{ text }}</template>
</template>

<style scoped>
@keyframes assistant-stream-glyph-in {
  from {
    opacity: 0.18;
  }
  to {
    opacity: 1;
  }
}

.assistant-stream-word {
  white-space: nowrap;
}

.assistant-stream-glyph {
  animation: assistant-stream-glyph-in 110ms cubic-bezier(0.2, 0.7, 0.2, 1) both;
}

@media (prefers-reduced-motion: reduce) {
  .assistant-stream-glyph {
    animation: none;
  }
}
</style>
