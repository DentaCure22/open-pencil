<script setup lang="ts">
import { computed, watch } from 'vue'
import { TabsContent, TabsList, TabsRoot, TabsTrigger } from 'reka-ui'

import { useI18n, useSceneComputed } from '@open-pencil/vue'
import { useAIChat } from '@/app/ai/chat/use'
import { isMermaidDiagramNode } from '@/app/diagram/mermaid/selection'
import { useEditorStore } from '@/app/editor/active-store'
import { liveInspectorSelectionEpoch } from '@/app/smylr-live-inspector/session'
import Tip from '@/components/ui/Tip.vue'

import CodePanel from './CodePanel.vue'
import DesignPanel from './DesignPanel.vue'
import './properties-panel.css'

const { activeTab } = useAIChat()
const { panels } = useI18n()
const store = useEditorStore()
const { showCodeTab = true } = defineProps<{ showCodeTab?: boolean }>()
const emit = defineEmits<{
  close: []
}>()

const mermaidDiagramSelected = useSceneComputed(() => {
  void store.state.sceneVersion
  const ids = [...store.state.selectedIds]
  return ids.length > 0 && ids.every((id) => isMermaidDiagramNode(store.graph.getNode(id)))
})
const codeTabVisible = computed(() => showCodeTab && !mermaidDiagramSelected.value)

watch(liveInspectorSelectionEpoch, () => {
  activeTab.value = 'design'
})

watch(
  mermaidDiagramSelected,
  (selected) => {
    if (selected) activeTab.value = 'design'
  },
  { immediate: true }
)

watch(
  [activeTab, codeTabVisible],
  ([tab, codeTabVisible]) => {
    if (tab === 'ai' || (tab === 'code' && !codeTabVisible)) activeTab.value = 'design'
  },
  { immediate: true }
)
</script>

<template>
  <aside
    data-test-id="properties-panel"
    class="properties-panel flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-transparent"
    style="contain: paint layout style"
  >
    <TabsRoot v-model="activeTab" class="flex min-h-0 flex-1 flex-col">
      <div
        class="properties-tabs mx-2.5 mt-2 mb-1 flex h-10 shrink-0 items-stretch gap-1 border-b border-white/[0.055] pb-1"
      >
        <Tip label="Close inspector">
          <button
            type="button"
            data-test-id="close-properties-panel"
            aria-label="Close inspector"
            class="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-[7px] text-muted/80 transition-all hover:bg-hover hover:text-surface"
            @click="emit('close')"
          >
            <icon-lucide-panel-right-close class="size-3.5" />
          </button>
        </Tip>
        <span class="my-1 mr-0.5 w-px shrink-0 bg-white/[0.055]" aria-hidden="true" />
        <TabsList aria-label="Inspector views" class="flex min-w-0 flex-1 items-stretch gap-1">
          <TabsTrigger
            value="design"
            data-test-id="properties-tab-design"
            aria-label="Design"
            class="properties-tab flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[7px] px-2 text-[11px] font-medium text-muted transition-all hover:bg-white/[0.055] hover:text-surface data-[state=active]:bg-white/[0.085] data-[state=active]:text-surface data-[state=active]:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
          >
            <icon-lucide-palette class="size-3" />
            <span class="properties-tab__label">{{ panels.design }}</span>
          </TabsTrigger>
          <TabsTrigger
            v-if="codeTabVisible"
            value="code"
            data-test-id="properties-tab-code"
            aria-label="Code"
            class="properties-tab flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[7px] px-2 text-[11px] font-medium text-muted transition-all hover:bg-white/[0.055] hover:text-surface data-[state=active]:bg-white/[0.085] data-[state=active]:text-surface data-[state=active]:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
          >
            <icon-lucide-code-xml class="size-3" />
            <span class="properties-tab__label">Code</span>
          </TabsTrigger>
        </TabsList>
      </div>

      <TabsContent
        value="design"
        class="flex min-h-0 flex-1 flex-col"
        :force-mount="true"
        :hidden="activeTab !== 'design'"
      >
        <DesignPanel />
      </TabsContent>

      <TabsContent
        v-if="codeTabVisible"
        value="code"
        class="flex min-h-0 flex-1 flex-col"
        :force-mount="true"
        :hidden="activeTab !== 'code'"
      >
        <CodePanel />
      </TabsContent>
    </TabsRoot>
  </aside>
</template>
