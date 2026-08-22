<script setup lang="ts">
import { vTestId } from '@open-pencil/vue'
import { ToolbarButton } from 'reka-ui'

import type { ToolbarActionItem } from '@/components/Toolbar/types'

const { actions, testPrefix } = defineProps<{
  actions: ToolbarActionItem[]
  testPrefix: string
}>()

const emit = defineEmits<{
  action: [item: ToolbarActionItem]
}>()
</script>

<template>
  <ToolbarButton v-for="item in actions" :key="item.label" as-child>
    <button
      v-test-id="`${testPrefix}-${item.label.toLowerCase()}`"
      type="button"
      :aria-label="item.label"
      class="flex size-8 cursor-pointer items-center justify-center rounded-[6px] border-none bg-transparent text-muted transition-colors select-none active:bg-hover active:text-surface"
      @click="emit('action', item)"
    >
      <component :is="item.icon" class="size-4" />
    </button>
  </ToolbarButton>
</template>
