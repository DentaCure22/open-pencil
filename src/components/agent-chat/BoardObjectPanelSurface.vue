<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'

import { useEditorStore } from '@/app/editor/active-store'
import { cachedCodeObjectDocument } from '@/app/code-object/overlays'
import CodeObjectPanelSurface from '@/components/agent-chat/CodeObjectPanelSurface.vue'
import NativeObjectPanelSurface from '@/components/agent-chat/NativeObjectPanelSurface.vue'

const { objectId } = defineProps<{ objectId: string }>()

const store = useEditorStore()
const objectKind = ref<'code' | 'native' | 'missing'>('missing')
let unsubscribe: Array<() => void> = []

function refreshObjectKind() {
  const node = store.graph.getNode(objectId)
  if (!node) {
    objectKind.value = 'missing'
    return
  }
  objectKind.value = cachedCodeObjectDocument(node) ? 'code' : 'native'
}

watch(() => objectId, refreshObjectKind)

onMounted(() => {
  unsubscribe = [
    store.onEditorEvent('graph:replaced', refreshObjectKind),
    store.onEditorEvent('node:deleted', (id) => {
      if (id === objectId) refreshObjectKind()
    }),
    store.onEditorEvent('node:updated', (id, changes) => {
      if (id === objectId && 'pluginData' in changes) refreshObjectKind()
    })
  ]
  refreshObjectKind()
})

onUnmounted(() => {
  for (const stop of unsubscribe) stop()
  unsubscribe = []
})
</script>

<template>
  <CodeObjectPanelSurface v-if="objectKind === 'code'" :object-id="objectId" />
  <NativeObjectPanelSurface v-else-if="objectKind === 'native'" :object-id="objectId" />
  <div
    v-else
    class="flex min-h-0 flex-1 items-center justify-center px-8 text-center text-[12px] leading-5 text-muted"
    data-test-id="board-object-panel-missing"
  >
    This object is not available in the current workspace.
  </div>
</template>
