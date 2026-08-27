<script setup lang="ts">
import { useI18n } from '@open-pencil/vue'
import Tip from '../ui/Tip.vue'

import type { LayerNode } from '@open-pencil/vue'

const { node } = defineProps<{
  node: LayerNode
  selected: boolean
}>()

const emit = defineEmits<{
  openObject: []
  toggleLock: []
  toggleVisibility: []
}>()

const { menu: t } = useI18n()
</script>

<template>
  <span
    class="flex shrink-0 items-center gap-0.5"
    :class="!node.locked && node.visible ? 'opacity-0 group-hover/row:opacity-100' : ''"
  >
    <Tip label="Open object">
      <button
        type="button"
        data-test-id="layer-open-object"
        :aria-label="`Open ${node.name} in Object panel`"
        class="flex size-4 items-center justify-center rounded hover:bg-hover"
        @pointerdown.stop
        @click.stop="emit('openObject')"
      >
        <icon-lucide-panel-right-open class="size-3 text-surface/70" />
      </button>
    </Tip>
    <Tip :label="node.locked ? t.unlock : t.lock">
      <button
        type="button"
        class="flex size-4 items-center justify-center rounded hover:bg-hover"
        @pointerdown.stop
        @click.stop="emit('toggleLock')"
      >
        <IconlyIcon name="lock" v-if="node.locked" class="size-3 text-surface" />
        <IconlyIcon
          name="unlock"
          v-else
          class="size-3 text-surface/70 opacity-0 group-hover/row:opacity-100"
        />
      </button>
    </Tip>
    <Tip :label="node.visible ? t.hide : t.show">
      <button
        type="button"
        class="flex size-4 items-center justify-center rounded hover:bg-hover"
        @pointerdown.stop
        @click.stop="emit('toggleVisibility')"
      >
        <icon-lucide-eye-off v-if="!node.visible" class="size-3 text-surface" />
        <icon-lucide-eye
          v-else
          class="size-3 text-surface/70 opacity-0 group-hover/row:opacity-100"
        />
      </button>
    </Tip>
  </span>
</template>
