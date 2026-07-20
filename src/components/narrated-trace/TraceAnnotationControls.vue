<script setup lang="ts">
import IconFocus from '~icons/lucide/mouse-pointer-click'
import IconInk from '~icons/lucide/pen-line'

import { useEditorStore } from '@/app/editor/active-store'
import { narratedTraceAnnotationTool, setNarratedTraceAnnotationTool } from '@/app/narrated-trace'
import type { NarratedTraceAnnotationTool } from '@/app/narrated-trace'

const store = useEditorStore()

function toggleTool(tool: Exclude<NarratedTraceAnnotationTool, 'none'>) {
  if (narratedTraceAnnotationTool.value === tool) {
    setNarratedTraceAnnotationTool('none')
    return
  }
  // Ink creates/selects persistent scene nodes. Focus keeps the underlying
  // editor tool unchanged while its active styling is temporarily suppressed.
  if (tool !== 'focus') store.setTool('SELECT')
  setNarratedTraceAnnotationTool(tool)
}
</script>

<template>
  <div class="ml-1 flex items-center gap-0.5">
    <button
      data-test-id="narrated-trace-ink-tool"
      class="flex size-8 items-center justify-center rounded-lg transition-colors"
      :class="
        narratedTraceAnnotationTool === 'ink'
          ? 'bg-rose-500 text-white'
          : 'text-muted hover:bg-hover hover:text-surface'
      "
      aria-label="Ink intent tool"
      @click="toggleTool('ink')"
    >
      <IconInk class="size-4" />
    </button>
    <button
      data-test-id="narrated-trace-focus-tool"
      class="flex size-8 items-center justify-center rounded-lg transition-colors"
      :class="
        narratedTraceAnnotationTool === 'focus'
          ? 'bg-violet-500 text-white'
          : 'text-muted hover:bg-hover hover:text-surface'
      "
      aria-label="Fading focus trail tool"
      @click="toggleTool('focus')"
    >
      <IconFocus class="size-4" />
    </button>
  </div>
</template>
