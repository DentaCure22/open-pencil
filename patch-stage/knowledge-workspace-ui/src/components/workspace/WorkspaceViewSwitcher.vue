<script setup lang="ts">
import type { WorkspaceViewKind } from '@/app/workspace'

const { modelValue } = defineProps<{
  modelValue: WorkspaceViewKind
}>()

const emit = defineEmits<{
  'update:modelValue': [value: WorkspaceViewKind]
}>()

const views: Array<{ label: string; shortLabel: string; value: WorkspaceViewKind }> = [
  { label: 'Canvas', shortLabel: 'Canvas', value: 'canvas' },
  { label: 'Document', shortLabel: 'Doc', value: 'document' },
  { label: 'Graph', shortLabel: 'Graph', value: 'graph' },
  { label: 'Review', shortLabel: 'Review', value: 'review' }
]
</script>

<template>
  <div
    data-test-id="workspace-view-switcher"
    role="radiogroup"
    aria-label="Workspace view"
    class="mx-1.5 my-1 grid grid-cols-4 gap-0.5 rounded-md bg-input p-0.5"
  >
    <button
      v-for="view in views"
      :key="view.value"
      type="button"
      role="radio"
      :aria-checked="modelValue === view.value"
      :aria-label="`${view.label} view`"
      :data-test-id="`workspace-view-${view.value}`"
      class="flex h-6 min-w-0 cursor-pointer items-center justify-center rounded px-1 text-[9px] font-medium text-muted transition-colors hover:bg-hover hover:text-surface"
      :class="
        modelValue === view.value ? 'bg-accent text-white hover:bg-accent hover:text-white' : ''
      "
      @click="emit('update:modelValue', view.value)"
    >
      <icon-lucide-layout-dashboard v-if="view.value === 'canvas'" class="size-3 shrink-0" />
      <icon-lucide-file-text v-else-if="view.value === 'document'" class="size-3 shrink-0" />
      <icon-lucide-waypoints v-else-if="view.value === 'graph'" class="size-3 shrink-0" />
      <icon-lucide-message-square-check
        v-else-if="view.value === 'review'"
        class="size-3 shrink-0"
      />
      <span class="ml-1 hidden truncate min-[280px]:inline">{{ view.shortLabel }}</span>
    </button>
  </div>
</template>
