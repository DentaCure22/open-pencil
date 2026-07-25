<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { useEditorStore } from '@/app/editor/active-store'
import {
  codeObjectViewportInsets,
  codeObjectPresetsForQuery,
  createCodeObjectFromPreset,
  type CodeObjectPresetId
} from '@/app/code-object/model'
import { toast } from '@/app/shell/ui'

const { query } = defineProps<{ query: string }>()
const emit = defineEmits<{ assetInserted: [nodeId: string] }>()
const editor = useEditorStore()
const presets = computed(() => codeObjectPresetsForQuery(query))
const expanded = ref(true)
const folderIsOpen = computed(() => query.trim().length > 0 || expanded.value)

watch(
  () => query,
  (value) => {
    if (value.trim()) expanded.value = true
  }
)

function toggleFolder() {
  if (!query.trim()) expanded.value = !expanded.value
}

function insertPreset(id: CodeObjectPresetId) {
  const preset = presets.value.find((candidate) => candidate.id === id)
  if (!preset) return
  const canvasCenter = editor.viewportCanvasCenter()
  const center = editor.screenToCanvas(canvasCenter.x, canvasCenter.y)
  const created = createCodeObjectFromPreset(editor, id, {
    x: center.x - preset.width / 2,
    y: center.y - preset.height / 2
  })
  if (!created) return
  emit('assetInserted', created.id)
  requestAnimationFrame(() => editor.zoomToSelection(codeObjectViewportInsets()))
  toast.info(`${preset.label} added to the board`)
}
</script>

<template>
  <section v-if="presets.length > 0" class="mb-1">
    <button
      type="button"
      data-test-id="asset-group-trigger"
      data-asset-group="interactive"
      :aria-expanded="folderIsOpen"
      class="text-muted hover:text-surface flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-[9.5px] font-semibold tracking-wide uppercase"
      @click="toggleFolder"
    >
      <icon-lucide-chevron-right
        class="size-3 transition-transform"
        :class="folderIsOpen ? 'rotate-90' : ''"
      />
      <icon-lucide-folder-open v-if="folderIsOpen" class="text-component size-3" />
      <icon-lucide-folder v-else class="text-component size-3" />
      <span class="flex-1">Code Object presets</span>
      <span class="font-normal tracking-normal text-muted/70">{{ presets.length }}</span>
    </button>
    <div v-if="folderIsOpen" data-test-id="asset-group-content" class="grid grid-cols-3 gap-1 px-1">
      <button
        v-for="preset in presets"
        :key="preset.id"
        type="button"
        :data-test-id="`code-object-asset-${preset.id}`"
        class="group flex min-h-16 flex-col items-center justify-center gap-1.5 rounded-[7px] border border-transparent bg-input/35 px-1.5 py-2 text-center transition hover:border-component/20 hover:bg-hover/80"
        @click="insertPreset(preset.id)"
      >
        <span
          class="grid size-7 place-items-center rounded-full bg-component/10 text-component transition group-hover:bg-component/15"
        >
          <icon-lucide-code-2 v-if="preset.id === 'user-code'" class="size-3.5" />
          <icon-lucide-globe-2 v-else-if="preset.id === 'earth-signals'" class="size-3.5" />
          <icon-lucide-orbit v-else-if="preset.id === 'orbit-lab'" class="size-3.5" />
          <icon-lucide-flower-2 v-else-if="preset.id === 'signal-bloom'" class="size-3.5" />
          <icon-lucide-file-text v-else-if="preset.id === 'office-document'" class="size-3.5" />
          <icon-lucide-table-2 v-else-if="preset.id === 'office-spreadsheet'" class="size-3.5" />
          <icon-lucide-chart-no-axes-column-increasing
            v-else-if="preset.id === 'analytics-chart'"
            class="size-3.5"
          />
          <icon-lucide-clipboard-pen-line
            v-else-if="preset.id === 'interactive-form'"
            class="size-3.5"
          />
          <icon-lucide-network v-else class="size-3.5" />
        </span>
        <span class="text-surface line-clamp-2 text-[9px] leading-3 font-medium">
          {{ preset.label }}
        </span>
      </button>
    </div>
  </section>
</template>
