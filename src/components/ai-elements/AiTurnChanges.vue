<script setup lang="ts">
import { computed } from 'vue'

import type { AiTurnChanges } from '@/app/agent-chat/types'

const { changes } = defineProps<{ changes: AiTurnChanges }>()
const emit = defineEmits<{ 'open-diff': [] }>()

const fileCountLabel = computed(
  () => `${String(changes.files.length)} ${changes.files.length === 1 ? 'file' : 'files'}`
)
</script>

<template>
  <section class="relative flex justify-center" data-test-id="ai-turn-changes">
    <button
      type="button"
      class="inline-flex h-[38px] items-center gap-2 whitespace-nowrap rounded-full border border-border/70 bg-agent-surface px-3.5 text-[14px] font-normal tracking-[-0.01em] text-muted shadow-[0_1px_2px_rgba(0,0,0,0.05)] transition-[background-color,border-color,transform] hover:border-border hover:bg-hover/35 active:scale-[0.985]"
      data-test-id="ai-turn-changes-toggle"
      aria-label="Open latest turn diff"
      @click="emit('open-diff')"
    >
      <span>{{ fileCountLabel }} changed</span>
      <span class="text-success tabular-nums">+{{ changes.additions }}</span>
      <span class="text-red-500 tabular-nums">−{{ changes.deletions }}</span>
    </button>
  </section>
</template>
