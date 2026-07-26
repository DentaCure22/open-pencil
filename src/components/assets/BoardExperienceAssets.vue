<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import {
  activateBoardExperience,
  boardExperienceDefinitionsForQuery,
  type BoardExperienceId
} from '@/app/board-experience'
import { useEditorStore } from '@/app/editor/active-store'
import { editorViewportInsets } from '@/app/editor/viewport-insets'
import { toast } from '@/app/shell/ui'

const { query } = defineProps<{ query: string }>()
const editor = useEditorStore()
const definitions = computed(() => boardExperienceDefinitionsForQuery(query))
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

function activate(id: BoardExperienceId) {
  const session = activateBoardExperience(editor, id)
  if (!session) return
  editor.setTool('SELECT')
  editor.select([])
  requestAnimationFrame(() => {
    const bounds = session.runtime.getSnapshot().bounds
    editor.zoomToBounds(
      bounds.x,
      bounds.y,
      bounds.x + bounds.width,
      bounds.y + bounds.height,
      editorViewportInsets()
    )
  })
  toast.info(`${session.definition.label} activated on this Board`)
}
</script>

<template>
  <section v-if="definitions.length > 0" class="mb-1">
    <button
      type="button"
      data-test-id="asset-group-trigger"
      data-asset-group="board-experiences"
      :aria-expanded="folderIsOpen"
      class="text-muted hover:text-surface flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-[9.5px] font-semibold tracking-wide uppercase"
      @click="toggleFolder"
    >
      <icon-lucide-chevron-right
        class="size-3 transition-transform"
        :class="folderIsOpen ? 'rotate-90' : ''"
      />
      <icon-lucide-sparkles class="size-3 text-emerald-400" />
      <span class="flex-1">Board experiences</span>
      <span class="font-normal tracking-normal text-muted/70">{{ definitions.length }}</span>
    </button>

    <div v-if="folderIsOpen" data-test-id="asset-group-content" class="grid grid-cols-3 gap-1 px-1">
      <button
        v-for="definition in definitions"
        :key="definition.id"
        type="button"
        :data-test-id="`board-experience-asset-${definition.id}`"
        class="group flex min-h-16 flex-col items-center justify-center gap-1.5 rounded-[7px] border border-transparent bg-input/35 px-1.5 py-2 text-center transition hover:border-emerald-400/25 hover:bg-hover/80"
        @click="activate(definition.id)"
      >
        <span
          class="grid size-7 place-items-center rounded-full bg-emerald-400/10 text-emerald-400 transition group-hover:bg-emerald-400/15"
        >
          <icon-lucide-castle class="size-3.5" />
        </span>
        <span class="text-surface line-clamp-2 text-[9px] leading-3 font-medium">
          {{ definition.label }}
        </span>
      </button>
    </div>
  </section>
</template>
