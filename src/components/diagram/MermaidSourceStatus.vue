<script setup lang="ts">
import { computed } from 'vue'

import { isMermaidDiagramContainer } from '@open-pencil/core/diagram'
import { mermaidDiagramOwner, reconcileMermaidDiagramSource } from '@open-pencil/core/editor'
import { useSceneComputed, useSelectionState } from '@open-pencil/vue'

import { openMermaidDiagramEditor, openMermaidDiagramUpgrade } from '@/app/diagram/mermaid/dialog'
import { useEditorStore } from '@/app/editor/active-store'
import { useAppTheme } from '@/app/shell/theme'
import { useButtonUI } from '@/components/ui/button'

const store = useEditorStore()
const { resolvedTheme } = useAppTheme()
const { selectedNode } = useSelectionState()
const result = useSceneComputed(() => {
  void store.state.sceneVersion
  return selectedNode.value
    ? reconcileMermaidDiagramSource(store.graph, selectedNode.value.id)
    : null
})
const conflicted = computed(() => result.value?.status !== 'current')
const owner = computed(() => {
  const node = selectedNode.value
  return node ? mermaidDiagramOwner(store.graph, node.id) : null
})
const editingParts = computed(() => owner.value?.id === store.state.enteredContainerId)
const legacyFlatDiagram = computed(() =>
  Boolean(owner.value && !isMermaidDiagramContainer(owner.value))
)
const ownerAppearance = computed(
  () =>
    owner.value?.pluginData.find(
      (entry) => entry.pluginId === 'open-pencil' && entry.key === 'mermaid/appearance'
    )?.value
)
const themeMismatch = computed(
  () =>
    !legacyFlatDiagram.value &&
    Boolean(ownerAppearance.value && ownerAppearance.value !== resolvedTheme.value)
)
const needsAttention = computed(() => conflicted.value || themeMismatch.value)
const editButton = useButtonUI({ tone: 'ghost', size: 'sm', bordered: true })

function editSource(): void {
  const diagramOwner = owner.value
  const source = result.value?.source
  if (diagramOwner && source !== undefined) {
    if (legacyFlatDiagram.value) openMermaidDiagramUpgrade(source)
    else openMermaidDiagramEditor(diagramOwner.id, source)
  }
}
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
          needsAttention ? 'bg-amber-400/10 text-amber-200' : 'bg-emerald-400/10 text-emerald-200'
        "
      >
        {{ conflicted ? 'Conflict' : themeMismatch ? 'Theme refresh' : 'Current' }} · r{{
          result.revision
        }}
      </span>
    </div>
    <p class="mt-1.5 text-[9.5px] leading-3.5 text-muted/75">
      {{
        themeMismatch
          ? 'Rendered for ' +
            ownerAppearance +
            ' mode. Refresh the source preview for ' +
            resolvedTheme +
            ' mode.'
          : result.message
      }}
    </p>
    <div class="mt-2 flex items-center justify-between gap-2 border-t border-border/70 pt-2">
      <p class="text-[9.5px] leading-3.5 text-muted/70">
        {{
          editingParts
            ? 'Editing native parts · press Esc to select the whole diagram.'
            : legacyFlatDiagram
              ? 'Legacy flat layers · upgrade to group semantic parts.'
              : 'Double-click the diagram to edit its native parts.'
        }}
      </p>
      <button
        type="button"
        data-test-id="mermaid-edit-source"
        :class="editButton.base"
        @click="editSource"
      >
        {{ legacyFlatDiagram ? 'Upgrade source' : themeMismatch ? 'Refresh theme' : 'Edit source' }}
      </button>
    </div>
  </section>
</template>
