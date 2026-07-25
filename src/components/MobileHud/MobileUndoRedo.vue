<script setup lang="ts">
import { computed } from 'vue'

import Tip from '@/components/ui/Tip.vue'
import { useEditorCommands, useI18n } from '@open-pencil/vue'
import {
  liveInspectorCanRedoDraft,
  liveInspectorCanUndoDraft,
  liveInspectorRedoDraftLabel,
  liveInspectorUndoDraftLabel,
  redoLiveInspectorDraft,
  undoLiveInspectorDraft
} from '@/app/smylr-live-inspector/session'

const { commands } = useI18n()
const { getCommand } = useEditorCommands()
const undoCommand = getCommand('edit.undo')
const redoCommand = getCommand('edit.redo')
const canUndo = computed(() => liveInspectorCanUndoDraft.value || undoCommand.enabled.value)
const canRedo = computed(() => liveInspectorCanRedoDraft.value || redoCommand.enabled.value)
const undoLabel = computed(() =>
  liveInspectorCanUndoDraft.value
    ? `Undo ${liveInspectorUndoDraftLabel.value}`
    : commands.value.undo
)
const redoLabel = computed(() =>
  liveInspectorCanRedoDraft.value
    ? `Redo ${liveInspectorRedoDraftLabel.value}`
    : commands.value.redo
)

function undo() {
  if (liveInspectorCanUndoDraft.value) undoLiveInspectorDraft()
  else if (undoCommand.enabled.value) undoCommand.run()
}

function redo() {
  if (liveInspectorCanRedoDraft.value) redoLiveInspectorDraft()
  else if (redoCommand.enabled.value) redoCommand.run()
}
</script>

<template>
  <div class="flex gap-1.5">
    <Tip :label="undoLabel">
      <button
        data-test-id="editor-undo"
        aria-label="Undo"
        :disabled="!canUndo"
        class="flex size-6 items-center justify-center rounded text-muted transition-colors select-none enabled:cursor-pointer enabled:hover:bg-hover enabled:hover:text-surface enabled:active:bg-hover disabled:cursor-default disabled:opacity-35"
        @click="undo"
      >
        <icon-lucide-undo-2 class="size-3.5" />
      </button>
    </Tip>
    <Tip :label="redoLabel">
      <button
        data-test-id="editor-redo"
        aria-label="Redo"
        :disabled="!canRedo"
        class="flex size-6 items-center justify-center rounded text-muted transition-colors select-none enabled:cursor-pointer enabled:hover:bg-hover enabled:hover:text-surface enabled:active:bg-hover disabled:cursor-default disabled:opacity-35"
        @click="redo"
      >
        <icon-lucide-redo-2 class="size-3.5" />
      </button>
    </Tip>
  </div>
</template>
