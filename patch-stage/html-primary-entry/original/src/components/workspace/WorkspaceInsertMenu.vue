<script setup lang="ts">
import { ref } from 'vue'

import type { WorkspaceInsertKind } from '@/app/workspace-ui/use'
import IconButton from '@/components/ui/IconButton.vue'

export type { WorkspaceInsertKind } from '@/app/workspace-ui/use'

const { canInsertDesignArtifact = false, canInsertLiveApp = false } = defineProps<{
  canInsertDesignArtifact?: boolean
  canInsertLiveApp?: boolean
}>()

const emit = defineEmits<{
  insert: [kind: WorkspaceInsertKind]
}>()

const open = ref(false)

const writingItems: Array<{ kind: WorkspaceInsertKind; label: string }> = [
  { kind: 'heading', label: 'Heading' },
  { kind: 'paragraph', label: 'Text' },
  { kind: 'task', label: 'Checklist' }
]

function insert(kind: WorkspaceInsertKind) {
  emit('insert', kind)
  open.value = false
}
</script>

<template>
  <div class="relative">
    <IconButton
      data-test-id="workspace-insert-menu"
      label="Insert workspace object"
      :active="open"
      @click="open = !open"
    >
      <icon-lucide-plus class="size-4" />
    </IconButton>
    <div
      v-if="open"
      data-test-id="workspace-insert-popover"
      class="absolute bottom-10 left-1/2 z-50 w-56 -translate-x-1/2 rounded-lg border border-border bg-panel p-1.5 text-left shadow-xl"
      @pointerdown.stop
    >
      <div class="px-2 py-1 text-[9px] font-medium tracking-wider text-muted uppercase">Write</div>
      <button
        v-for="item in writingItems"
        :key="item.kind"
        type="button"
        :data-test-id="`workspace-insert-${item.kind}`"
        class="flex h-7 w-full items-center rounded px-2 text-[11px] text-surface hover:bg-hover"
        @click="insert(item.kind)"
      >
        {{ item.label }}
      </button>
      <div class="my-1 h-px bg-border" />
      <div class="px-2 py-1 text-[9px] font-medium tracking-wider text-muted uppercase">
        Organize and map
      </div>
      <button
        data-test-id="workspace-insert-collection"
        type="button"
        class="flex h-7 w-full items-center gap-2 rounded px-2 text-[11px] text-surface hover:bg-hover"
        @click="insert('collection')"
      >
        <icon-lucide-table-2 class="size-3.5 text-muted" /> Collection
      </button>
      <button
        data-test-id="workspace-insert-graph-node"
        type="button"
        class="flex h-7 w-full items-center gap-2 rounded px-2 text-[11px] text-surface hover:bg-hover"
        @click="insert('graph-node')"
      >
        <icon-lucide-waypoints class="size-3.5 text-muted" /> Graph node
      </button>
      <button
        data-test-id="workspace-insert-design-artifact"
        type="button"
        :disabled="!canInsertDesignArtifact"
        class="flex h-7 w-full items-center gap-2 rounded px-2 text-[11px] text-surface hover:bg-hover disabled:cursor-default disabled:opacity-35"
        @click="insert('design-artifact')"
      >
        <icon-lucide-component class="size-3.5 text-muted" /> Link selected design
      </button>
      <button
        data-test-id="workspace-insert-live-app-block"
        type="button"
        :disabled="!canInsertLiveApp"
        class="flex h-7 w-full items-center gap-2 rounded px-2 text-[11px] text-surface hover:bg-hover disabled:cursor-default disabled:opacity-35"
        @click="insert('live-app-block')"
      >
        <icon-lucide-monitor-dot class="size-3.5 text-green-400" /> Link current live app
      </button>
    </div>
  </div>
</template>
