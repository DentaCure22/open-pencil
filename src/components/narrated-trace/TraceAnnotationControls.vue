<script setup lang="ts">
import { useEventListener } from '@vueuse/core'
import { computed, onBeforeUnmount, watch } from 'vue'
import IconMic from '~icons/lucide/mic'
import IconMicOff from '~icons/lucide/mic-off'
import IconFocus from '~icons/lucide/mouse-pointer-click'
import IconInk from '~icons/lucide/pen-line'

import { IS_BROWSER } from '@open-pencil/core/constants'

import { useEditorStore } from '@/app/editor/active-store'
import {
  activateNarratedTraceAnnotationTool,
  clearNarratedTraceMicTurnsOutsideScope,
  disposeNarratedTraceMic,
  NARRATED_TRACE_ANNOTATION_SHORTCUTS,
  narratedTraceAnnotationTool,
  narratedTraceMicError,
  narratedTraceMicPhase,
  narratedTraceMicPinned,
  narratedTraceScopeForStore,
  reanchorNarratedTraceMic,
  setNarratedTraceAnnotationTool,
  stopNarratedTraceMic,
  toggleNarratedTraceMicPinned
} from '@/app/narrated-trace'
import { toast } from '@/app/shell/ui'
import { activeTab } from '@/app/tabs'
import ToolButton from '@/components/Toolbar/ToolButton.vue'
import Tip from '@/components/ui/Tip.vue'

import type { NarratedTraceActiveAnnotationTool } from '@/app/narrated-trace'

const store = useEditorStore()

const inkLabel = `Ink intent tool (${NARRATED_TRACE_ANNOTATION_SHORTCUTS.ink.label})`
const focusLabel = computed(() => {
  const base = `Fading focus trail tool (${NARRATED_TRACE_ANNOTATION_SHORTCUTS.focus.label})`
  if (narratedTraceMicPhase.value === 'checking') return `${base} · Starting microphone`
  if (narratedTraceMicPhase.value === 'listening') return `${base} · Microphone on`
  if (narratedTraceMicError.value) return `${base} · Microphone unavailable`
  return base
})

const micLabel = computed(() => {
  if (narratedTraceMicPinned.value) {
    return narratedTraceMicPhase.value === 'listening'
      ? 'Microphone pinned on · recording continuously'
      : 'Microphone pinned · reconnecting'
  }
  if (narratedTraceMicError.value) return 'Pin microphone on · currently unavailable'
  return 'Pin microphone on · records continuously, independent of Focus'
})

async function selectTool(tool: NarratedTraceActiveAnnotationTool) {
  const activated = await activateNarratedTraceAnnotationTool(store, tool)
  if (tool === 'focus' && !activated && narratedTraceMicError.value) {
    toast.warning(narratedTraceMicError.value)
  }
}

async function toggleMic() {
  const changed = await toggleNarratedTraceMicPinned(store)
  if (!changed && narratedTraceMicError.value) toast.warning(narratedTraceMicError.value)
}

watch(
  () => [activeTab.value?.id, store.state.currentPageId] as const,
  () => {
    setNarratedTraceAnnotationTool('none')
    clearNarratedTraceMicTurnsOutsideScope(narratedTraceScopeForStore(store))
    // A pinned mic keeps recording across Board and page switches; it just needs a fresh anchor.
    if (narratedTraceMicPinned.value) void reanchorNarratedTraceMic(store)
  },
  { immediate: true }
)

onBeforeUnmount(stopNarratedTraceMic)
if (IS_BROWSER) useEventListener(window, 'pagehide', disposeNarratedTraceMic)
</script>

<template>
  <div class="flex flex-col items-center gap-0.5">
    <Tip :label="inkLabel" side="right">
      <ToolButton
        data-test-id="narrated-trace-ink-tool"
        :icon="IconInk"
        :label="inkLabel"
        :active="narratedTraceAnnotationTool === 'ink'"
        :aria-pressed="narratedTraceAnnotationTool === 'ink'"
        @click="selectTool('ink')"
      />
    </Tip>
    <Tip :label="focusLabel" side="right">
      <ToolButton
        data-test-id="narrated-trace-focus-tool"
        :data-mic-phase="narratedTraceMicPhase"
        :icon="IconFocus"
        :label="focusLabel"
        :active="narratedTraceAnnotationTool === 'focus'"
        :aria-busy="narratedTraceMicPhase === 'checking'"
        :aria-pressed="narratedTraceAnnotationTool === 'focus'"
        @click="selectTool('focus')"
      />
    </Tip>
    <Tip :label="micLabel" side="right">
      <ToolButton
        data-test-id="narrated-trace-mic-toggle"
        :data-mic-phase="narratedTraceMicPhase"
        :icon="narratedTraceMicPinned ? IconMic : IconMicOff"
        :label="micLabel"
        :active="narratedTraceMicPinned"
        :aria-busy="narratedTraceMicPhase === 'checking'"
        :aria-pressed="narratedTraceMicPinned"
        @click="toggleMic"
      />
    </Tip>
  </div>
</template>
