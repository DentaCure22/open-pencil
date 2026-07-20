<script setup lang="ts">
import { computed } from 'vue'

import { reconcileMermaidDiagramSource } from '@open-pencil/core/editor'
import { useSceneComputed, useSelectionState } from '@open-pencil/vue'

import { useEditorStore } from '@/app/editor/active-store'

const store = useEditorStore()
const { selectedNode } = useSelectionState()
const result = useSceneComputed(() => {
  void store.state.sceneVersion
  return selectedNode.value
    ? reconcileMermaidDiagramSource(store.graph, selectedNode.value.id)
    : null
})
const conflicted = computed(() => result.value?.status !== 'current')
</script>

<template>
  <section
    v-if="result"
    data-test-id="mermaid-source-status"
    class="mx-3 my-2 rounded-lg border border-white/[0.065] bg-white/[0.025] p-2.5"
  >
    <div class="flex items-center justify-between gap-2">
      <span class="text-[10px] font-semibold tracking-[0.04em] text-muted uppercase">
        Mermaid source
      </span>
      <span
        data-test-id="mermaid-source-status-label"
        class="rounded-full px-2 py-0.5 text-[9.5px] font-medium"
        :class="
          conflicted ? 'bg-amber-400/10 text-amber-200' : 'bg-emerald-400/10 text-emerald-200'
        "
      >
        {{ conflicted ? 'Conflict' : 'Current' }} · r{{ result.revision }}
      </span>
    </div>
    <p class="mt-1.5 text-[9.5px] leading-3.5 text-muted/75">{{ result.message }}</p>
  </section>
</template>
