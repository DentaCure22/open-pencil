<script setup lang="ts">
import IconMessageSquarePlus from '~icons/lucide/message-square-plus'

import { useEditorStore } from '@/app/editor/active-store'
import { openContextCommentForSelection } from '@/app/context-comment'
import ToolButton from '@/components/Toolbar/ToolButton.vue'
import Tip from '@/components/ui/Tip.vue'

const store = useEditorStore()
</script>

<template>
  <Tip label="Add contextual comment" side="right">
    <span @pointerdown.stop>
      <ToolButton
        :icon="IconMessageSquarePlus"
        label="Add contextual comment"
        variant="utility"
        data-test-id="context-comment-tool"
        @click="openContextCommentForSelection(store)"
      />
    </span>
  </Tip>
</template>
