<script setup lang="ts">
import { computed } from 'vue'

import {
  CODE_OBJECT_VIEWPORT_PRESETS,
  codeObjectViewportPresetId,
  type CodeObjectViewportPresetId
} from '@/app/code-object/transform'
import IconButton from '@/components/ui/IconButton.vue'
import Tip from '@/components/ui/Tip.vue'

const { height, label, width } = defineProps<{
  height: number
  label: string
  width: number
}>()

const emit = defineEmits<{
  duplicateObject: []
  resizeViewport: [presetId: CodeObjectViewportPresetId]
}>()

const activePresetId = computed(() => codeObjectViewportPresetId({ height, width }))
</script>

<template>
  <div
    class="pointer-events-auto flex h-8 max-w-[520px] items-center gap-1 rounded-md border border-border bg-panel p-1 text-[11px] shadow-md"
    data-test-id="code-object-header"
    @dblclick.stop
    @pointerdown.stop
    @wheel.stop
  >
    <div class="flex min-w-0 items-center gap-1.5 px-1.5">
      <icon-lucide-code-2 class="size-3 shrink-0 text-accent" />
      <span
        class="max-w-56 truncate font-medium text-surface"
        data-test-id="code-object-header-title"
      >
        {{ label }}
      </span>
    </div>

    <div class="h-5 w-px shrink-0 bg-border" />
    <div class="flex shrink-0 items-center gap-0.5" data-test-id="code-object-viewports">
      <Tip
        v-for="preset in CODE_OBJECT_VIEWPORT_PRESETS"
        :key="preset.id"
        :label="`${preset.label} · ${preset.width} × ${preset.height}`"
      >
        <button
          type="button"
          :aria-label="`Resize Code Object to ${preset.label}, ${preset.width} by ${preset.height}`"
          class="flex size-6 items-center justify-center rounded border border-transparent text-muted hover:bg-hover hover:text-surface"
          :class="activePresetId === preset.id ? 'bg-hover text-accent' : ''"
          :data-test-id="`code-object-viewport-${preset.id}`"
          @click.stop="emit('resizeViewport', preset.id)"
        >
          <icon-lucide-monitor v-if="preset.id === 'desktop'" class="size-3" />
          <icon-lucide-laptop v-else-if="preset.id === 'laptop'" class="size-3" />
          <icon-lucide-tablet v-else-if="preset.id === 'ipad'" class="size-3" />
          <icon-lucide-smartphone v-else class="size-3" />
        </button>
      </Tip>
    </div>

    <div class="h-5 w-px shrink-0 bg-border" />
    <div class="flex shrink-0 items-center gap-0.5">
      <IconButton
        label="Duplicate Code Object"
        size="sm"
        class="size-6 border-transparent bg-transparent"
        data-test-id="code-object-duplicate"
        @click.stop="emit('duplicateObject')"
      >
        <icon-lucide-copy-plus class="size-3" />
      </IconButton>
    </div>
  </div>
</template>
