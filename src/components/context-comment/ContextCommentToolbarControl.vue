<script setup lang="ts">
import IconScan from '~icons/lucide/scan'

import { useEditorStore } from '@/app/editor/active-store'
import { startContextCommentScreenshot } from '@/app/context-comment'
import ToolButton from '@/components/Toolbar/ToolButton.vue'
import Tip from '@/components/ui/Tip.vue'

const store = useEditorStore()
const { side = 'right' } = defineProps<{
  side?: 'right' | 'top'
}>()
</script>

<template>
  <Tip label="Screenshot and comment" :side="side">
    <span @pointerdown.stop>
      <ToolButton
        :icon="IconScan"
        label="Screenshot and comment"
        variant="utility"
        data-test-id="context-comment-tool"
        @click="startContextCommentScreenshot(store)"
      />
    </span>
  </Tip>
</template>
