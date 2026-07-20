<script setup lang="ts">
import { computed } from 'vue'
import IconMicrophone from '~icons/lucide/mic'
import IconPause from '~icons/lucide/pause'
import IconPlay from '~icons/lucide/play'
import IconStop from '~icons/lucide/square'

import { useAIChat } from '@/app/ai/chat/use'
import {
  formatNarratedTraceTime,
  narratedTraceElapsedMs,
  narratedTraceStatus,
  pauseNarratedTraceRecording,
  resumeNarratedTraceRecording,
  startNarratedTraceRecording,
  stopNarratedTraceRecording
} from '@/app/narrated-trace'
import Tip from '@/components/ui/Tip.vue'

const { activeTab } = useAIChat()

const elapsed = computed(() => formatNarratedTraceTime(narratedTraceElapsedMs.value))
const isActive = computed(
  () => narratedTraceStatus.value === 'recording' || narratedTraceStatus.value === 'paused'
)

function startRecording() {
  activeTab.value = 'trace'
  startNarratedTraceRecording()
}

function togglePause() {
  if (narratedTraceStatus.value === 'recording') {
    pauseNarratedTraceRecording()
  } else {
    resumeNarratedTraceRecording()
  }
}

function stopRecording() {
  stopNarratedTraceRecording()
  activeTab.value = 'trace'
}
</script>

<template>
  <div class="ml-1 flex items-center gap-0.5">
    <template v-if="!isActive">
      <Tip label="Record narrated session">
        <button
          data-test-id="narrated-trace-start"
          class="flex size-8 items-center justify-center rounded-lg text-surface/80 transition-colors hover:bg-hover hover:text-surface"
          aria-label="Start narrated trace"
          @click="startRecording"
        >
          <IconMicrophone class="size-4" />
        </button>
      </Tip>
    </template>

    <template v-else>
      <div
        class="flex items-center gap-0.5 rounded-lg p-0.5"
        :class="
          narratedTraceStatus === 'recording'
            ? 'bg-red-500/10 text-red-200'
            : 'bg-amber-400/10 text-amber-100'
        "
      >
        <div class="flex h-7 items-center gap-1.5 px-1.5 text-[10px] tabular-nums">
          <span
            class="size-2 rounded-full"
            :class="narratedTraceStatus === 'recording' ? 'bg-red-500' : 'bg-amber-400'"
          />
          <span data-test-id="narrated-trace-timer">{{ elapsed }}</span>
        </div>
        <Tip :label="narratedTraceStatus === 'recording' ? 'Pause trace' : 'Resume trace'">
          <button
            data-test-id="narrated-trace-pause"
            class="flex size-7 items-center justify-center rounded-md hover:bg-white/10"
            :aria-label="narratedTraceStatus === 'recording' ? 'Pause trace' : 'Resume trace'"
            @click="togglePause"
          >
            <component
              :is="narratedTraceStatus === 'recording' ? IconPause : IconPlay"
              class="size-3.5"
            />
          </button>
        </Tip>
        <Tip label="Finish and review trace">
          <button
            data-test-id="narrated-trace-stop"
            class="flex size-7 items-center justify-center rounded-md hover:bg-white/10"
            aria-label="Finish and review trace"
            @click="stopRecording"
          >
            <IconStop class="size-3.5" />
          </button>
        </Tip>
      </div>
    </template>
  </div>
</template>
