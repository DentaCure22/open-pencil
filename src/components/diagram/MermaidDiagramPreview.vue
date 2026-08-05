<script setup lang="ts">
import { computed, type CSSProperties } from 'vue'

import type { MermaidSceneSpec } from '@open-pencil/core/diagram'

const { diagram, mode = 'readable' } = defineProps<{
  diagram: MermaidSceneSpec
  mode?: 'fit' | 'readable'
}>()

const previewStyle = computed<CSSProperties>(() => ({
  height: `${Math.ceil(Math.max(1, diagram.height))}px`,
  width: `${Math.ceil(Math.max(1, diagram.width))}px`
}))
</script>

<template>
  <div
    data-test-id="mermaid-preview"
    :class="mode === 'fit' ? 'size-full overflow-hidden' : 'block shrink-0 overflow-hidden'"
    :style="mode === 'fit' ? undefined : previewStyle"
    role="img"
    aria-label="Mermaid diagram preview"
    v-html="diagram.svg"
  />
</template>
