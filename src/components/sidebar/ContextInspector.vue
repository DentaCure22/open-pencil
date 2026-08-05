<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { TabsContent, TabsList, TabsRoot, TabsTrigger } from 'reka-ui'

import { objectGraphConnectionForSelection } from '@open-pencil/scene-graph'
import { useSceneComputed, useSelectionState } from '@open-pencil/vue'

import { useAIChat } from '@/app/ai/chat/use'
import { isCodeObjectFrame } from '@/app/code-object/model'
import { isMermaidDiagramNode } from '@/app/diagram/mermaid/selection'
import { useEditorStore } from '@/app/editor/active-store'
import { objectGraphConnectionName } from '@/app/object-graph'
import { isSmylrProductionAppCodeObjectFrame } from '@/app/smylr-production/workspace'
import { selectedSourceDocument } from '@/app/source-document/workspace'
import CodePanel from '@/components/CodePanel.vue'
import DesignPanel from '@/components/DesignPanel.vue'
import Tip from '@/components/ui/Tip.vue'

type ContextTab = 'code' | 'design'

const { showCodeTab = true, split = false } = defineProps<{
  showCodeTab?: boolean
  split?: boolean
}>()
const emit = defineEmits<{ close: [] }>()

const store = useEditorStore()
const { activeTab } = useAIChat()
const { selectedIds, selectedNode, selectedCount } = useSelectionState()
const contextTab = ref<ContextTab>('design')

const sourceDocumentSelected = useSceneComputed(() => {
  void store.state.sceneVersion
  return Boolean(selectedSourceDocument(store))
})
const codeSelectionVisible = useSceneComputed(() => {
  const ids = [...store.state.selectedIds]
  if (ids.length !== 1) return false
  const node = store.graph.getNode(ids[0])
  return isCodeObjectFrame(node) || Boolean(selectedSourceDocument(store))
})
const mermaidDiagramSelected = useSceneComputed(() => {
  void store.state.sceneVersion
  const ids = [...store.state.selectedIds]
  return ids.length > 0 && ids.every((id) => isMermaidDiagramNode(store.graph.getNode(id)))
})
const smylrProductionSelected = useSceneComputed(() => {
  void store.state.sceneVersion
  const ids = [...store.state.selectedIds]
  return ids.length === 1 && isSmylrProductionAppCodeObjectFrame(store.graph.getNode(ids[0]))
})
const codeTabVisible = computed(
  () =>
    showCodeTab &&
    codeSelectionVisible.value &&
    !mermaidDiagramSelected.value &&
    !smylrProductionSelected.value
)
const contextHeaderVisible = computed(
  () => !smylrProductionSelected.value && (showCodeTab || sourceDocumentSelected.value)
)
const codeTabLabel = computed(() => (sourceDocumentSelected.value ? 'Source' : 'Code'))
const selectedConnection = useSceneComputed(() => {
  void store.state.sceneVersion
  return objectGraphConnectionForSelection(
    store.graph,
    store.state.currentPageId,
    selectedIds.value
  )
})

const selectionLabel = computed(() => {
  if (selectedCount.value > 1) return `${selectedCount.value} selected`
  if (selectedConnection.value) {
    return objectGraphConnectionName(store.graph, selectedConnection.value)
  }
  return selectedNode.value?.name || selectedNode.value?.type || 'Design'
})
function setContextTab(tab: ContextTab) {
  if (tab === 'code' && !codeTabVisible.value) return
  contextTab.value = tab
  activeTab.value = tab
}

watch(
  activeTab,
  (tab) => {
    if (tab === 'design') contextTab.value = 'design'
    if (tab === 'code' && codeTabVisible.value) contextTab.value = 'code'
  },
  { immediate: true }
)

watch(
  mermaidDiagramSelected,
  (selected) => {
    if (selected) setContextTab('design')
  },
  { immediate: true }
)

watch(
  codeTabVisible,
  (visible) => {
    if (!visible && contextTab.value === 'code') setContextTab('design')
  },
  { immediate: true }
)

watch(
  sourceDocumentSelected,
  (selected) => {
    if (!selected) return
    setContextTab('code')
  },
  { immediate: true }
)
</script>

<template>
  <section
    data-test-id="sidebar-context-inspector"
    :data-split="split ? 'true' : 'false'"
    class="flex h-full min-h-0 flex-col overflow-hidden border-b border-white/[0.055]"
  >
    <TabsRoot v-model="contextTab" class="flex min-h-0 flex-1 flex-col">
      <div
        v-if="contextHeaderVisible"
        data-test-id="sidebar-context-header"
        class="flex h-10 shrink-0 items-center gap-1 px-2"
      >
        <div class="min-w-0 flex-1 px-1">
          <div class="truncate text-[11px] font-medium text-surface">{{ selectionLabel }}</div>
        </div>

        <TabsList
          v-if="codeTabVisible"
          aria-label="Context inspector views"
          class="flex items-center rounded-[7px] bg-white/[0.035] p-0.5"
        >
          <TabsTrigger
            value="design"
            data-test-id="sidebar-context-design"
            aria-label="Design"
            class="flex h-6 items-center gap-1 rounded-[5px] px-2 text-[10px] font-medium text-muted transition-colors hover:text-surface data-[state=active]:bg-white/[0.08] data-[state=active]:text-surface"
            @click="setContextTab('design')"
          >
            <icon-lucide-palette class="size-3" />
            <span>Design</span>
          </TabsTrigger>
          <TabsTrigger
            value="code"
            data-test-id="sidebar-context-code"
            :aria-label="codeTabLabel"
            class="flex h-6 items-center gap-1 rounded-[5px] px-2 text-[10px] font-medium text-muted transition-colors hover:text-surface data-[state=active]:bg-white/[0.08] data-[state=active]:text-surface"
            @click="setContextTab('code')"
          >
            <icon-lucide-code-xml class="size-3" />
            <span>{{ codeTabLabel }}</span>
          </TabsTrigger>
        </TabsList>

        <Tip label="Close design details">
          <button
            type="button"
            data-test-id="close-sidebar-context"
            aria-label="Close design details"
            class="flex size-7 shrink-0 items-center justify-center rounded-[6px] text-muted transition-colors hover:bg-hover hover:text-surface"
            @click="emit('close')"
          >
            <icon-lucide-x class="size-3.5" />
          </button>
        </Tip>
      </div>

      <TabsContent
        value="design"
        class="flex min-h-0 flex-1 flex-col"
        :force-mount="true"
        :hidden="contextTab !== 'design'"
      >
        <DesignPanel />
      </TabsContent>

      <TabsContent
        v-if="codeTabVisible"
        value="code"
        class="flex min-h-0 flex-1 flex-col"
        :force-mount="true"
        :hidden="contextTab !== 'code'"
      >
        <CodePanel />
      </TabsContent>
    </TabsRoot>
  </section>
</template>
