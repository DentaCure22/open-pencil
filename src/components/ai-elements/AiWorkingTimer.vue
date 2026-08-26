<script setup lang="ts">
import { useNow } from '@vueuse/core'
import { computed } from 'vue'

import { formatElapsedDuration } from './model'

const { startedAt } = defineProps<{
  startedAt: string
}>()

// Keep the ticking clock isolated from the activity timeline. T3 updates this
// label independently so a one-second timer does not repaint the live work row.
const now = useNow({ interval: 1_000 })
const elapsed = computed(() => {
  const start = Date.parse(startedAt)
  if (!Number.isFinite(start)) return ''
  return formatElapsedDuration(Math.max(0, now.value.getTime() - start))
})
</script>

<template>
  <span class="tabular-nums">{{ elapsed }}</span>
</template>
