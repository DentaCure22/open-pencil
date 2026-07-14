<script setup lang="ts">
import { computed } from 'vue'

import {
  formatNarratedTraceTime,
  narratedTraceElapsedMs,
  narratedTraceHistory,
  narratedTraceIncludedCount,
  narratedTraceSession,
  narratedTraceStatus,
  narratedTraceViewMode,
  renameNarratedTraceTitle,
  saveNarratedTraceRecord,
  stopNarratedTraceRecording
} from '@/app/narrated-trace'
import Tip from '@/components/ui/Tip.vue'

const elapsed = computed(() => formatNarratedTraceTime(narratedTraceElapsedMs.value))
const isActive = computed(
  () => narratedTraceStatus.value === 'recording' || narratedTraceStatus.value === 'paused'
)

function compactGeneratedTitle(title: string) {
  const generated = /^Session · ([^,]+ \d{1,2}), \d{4}, (.+)$/.exec(title)
  return generated ? `${generated[1]} · ${generated[2]}` : title
}

const traceTitle = computed(() => {
  const session = narratedTraceSession.value
  if (!session) return 'Narrated Session'
  const savedTitle = narratedTraceHistory.value.find((record) => record.id === session.id)?.title
  return compactGeneratedTitle(session.title?.trim() || savedTitle || 'Narrated Session')
})
const statusText = computed(() => {
  if (narratedTraceViewMode.value === 'history') {
    const count = narratedTraceHistory.value.length
    if (count === 0) return 'No saved traces'
    return `${count} ${count === 1 ? 'trace' : 'traces'}`
  }
  if (narratedTraceStatus.value === 'recording') return `Listening · ${elapsed.value}`
  if (narratedTraceStatus.value === 'paused') return `Paused · ${elapsed.value}`
  if (narratedTraceStatus.value === 'review') {
    const count = narratedTraceIncludedCount.value
    if (count === 0) return 'No moments'
    return `${count} ${count === 1 ? 'moment' : 'moments'}`
  }
  return 'Ready to trace'
})

function commitTraceTitle(event: Event) {
  const input = event.currentTarget as HTMLInputElement
  const title = input.value.trim()
  if (!title || !narratedTraceSession.value) {
    input.value = traceTitle.value
    return
  }
  input.value = title
  void renameNarratedTraceTitle(narratedTraceSession.value.id, title)
}

function finishTitleEdit(event: KeyboardEvent) {
  const input = event.currentTarget as HTMLInputElement
  input.blur()
}

async function toggleHistory() {
  if (narratedTraceViewMode.value === 'history') {
    narratedTraceViewMode.value = 'timeline'
    return
  }
  if (isActive.value) stopNarratedTraceRecording()
  const session = narratedTraceSession.value
  if (session) await saveNarratedTraceRecord(session)
  narratedTraceViewMode.value = 'history'
}
</script>

<template>
  <div
    data-test-id="narrated-trace-header"
    class="group/trace-header flex min-w-0 flex-1 items-center gap-2"
  >
    <div class="min-w-0 flex-1">
      <input
        v-if="narratedTraceSession && narratedTraceViewMode !== 'history'"
        data-test-id="narrated-trace-title"
        :value="traceTitle"
        class="-ml-1 block h-5 w-full cursor-text truncate rounded-[5px] border-0 bg-transparent px-1 py-0 text-[12px] leading-5 font-semibold tracking-[-0.01em] text-surface outline-none transition-colors hover:bg-white/[0.04] focus:bg-white/[0.065] focus:ring-1 focus:ring-white/[0.08]"
        aria-label="Trace title"
        title="Rename trace"
        @change="commitTraceTitle"
        @keydown.enter.prevent="finishTitleEdit"
      />
      <div
        v-else
        class="truncate text-[12px] leading-5 font-semibold tracking-[-0.01em] text-surface"
      >
        {{ narratedTraceViewMode === 'history' ? 'History' : 'Narrated Session' }}
      </div>
      <div class="flex min-w-0 items-center gap-1.5 text-[9.5px] leading-3.5 text-muted/70">
        <span
          v-if="isActive"
          class="size-1.5 shrink-0 rounded-full"
          :class="narratedTraceStatus === 'recording' ? 'bg-red-400' : 'bg-amber-300'"
        />
        <span class="truncate">{{ statusText }}</span>
      </div>
    </div>
    <Tip
      v-if="
        narratedTraceSession ||
        narratedTraceHistory.length > 0 ||
        narratedTraceViewMode === 'history'
      "
      :label="narratedTraceViewMode === 'history' ? 'Back to trace' : 'Trace history'"
      side="bottom"
    >
      <button
        type="button"
        data-test-id="narrated-trace-history-toggle"
        :aria-label="narratedTraceViewMode === 'history' ? 'Back to trace' : 'Open trace history'"
        class="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted/75 transition-all hover:bg-white/[0.055] hover:text-surface group-hover/trace-header:text-muted"
        :class="narratedTraceViewMode === 'history' ? 'bg-white/[0.075] text-surface' : ''"
        @click="toggleHistory"
      >
        <icon-lucide-arrow-left v-if="narratedTraceViewMode === 'history'" class="size-3.5" />
        <icon-lucide-history v-else class="size-3.5" />
      </button>
    </Tip>
  </div>
</template>
