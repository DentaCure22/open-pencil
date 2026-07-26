<script setup lang="ts">
import { useSceneComputed } from '@open-pencil/vue'

import { isCodeObjectFrame } from '@/app/code-object/model'
import { useEditorStore } from '@/app/editor/active-store'
import { selectedSourceDocument } from '@/app/source-document/workspace'
import CodeObjectCodePanel from '@/components/CodeObjectCodePanel.vue'
import SourceDocumentCodePanel from '@/components/SourceDocumentCodePanel.vue'

const store = useEditorStore()

const selectedNode = useSceneComputed(() => {
  void store.state.sceneVersion
  const ids = [...store.state.selectedIds]
  return ids.length === 1 ? store.graph.getNode(ids[0]) : undefined
})

const isCodeObjectSelected = useSceneComputed(() => isCodeObjectFrame(selectedNode.value))
const isSourceDocumentSelected = useSceneComputed(() => Boolean(selectedSourceDocument(store)))
</script>

<template>
  <CodeObjectCodePanel v-if="isCodeObjectSelected" />
  <SourceDocumentCodePanel v-else-if="isSourceDocumentSelected" />
</template>
