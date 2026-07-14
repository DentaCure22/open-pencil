<script setup lang="ts">
import { watch } from 'vue'
import { TabsContent, TabsList, TabsRoot, TabsTrigger } from 'reka-ui'

import { useI18n, useSceneComputed } from '@open-pencil/vue'
import { useAIChat } from '@/app/ai/chat/use'
import { useEditorStore } from '@/app/editor/active-store'
import { isHtmlBoardFrame } from '@/app/html-board/workspace'
import { liveInspectorSelectionEpoch } from '@/app/smylr-live-inspector/session'

import CodePanel from './CodePanel.vue'
import DesignPanel from './DesignPanel.vue'
import NarratedTracePanel from './narrated-trace/NarratedTracePanel.vue'
import './properties-panel.css'

const { activeTab } = useAIChat()
const { panels } = useI18n()
const store = useEditorStore()

const htmlBoardSelected = useSceneComputed(() => {
  void store.state.sceneVersion
  const ids = [...store.state.selectedIds]
  return ids.length === 1 && isHtmlBoardFrame(store.graph.getNode(ids[0]))
})

watch(
  htmlBoardSelected,
  (selected) => {
    if (selected && activeTab.value !== 'trace') activeTab.value = 'code'
  },
  { immediate: true }
)

watch(liveInspectorSelectionEpoch, () => {
  if (activeTab.value !== 'trace') activeTab.value = 'design'
})

watch(
  activeTab,
  (tab) => {
    if (tab === 'ai') activeTab.value = 'design'
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
      <TabsList
        aria-label="Inspector views"
        class="properties-tabs mx-2.5 mt-2 mb-1 flex h-10 shrink-0 items-stretch gap-1 border-b border-white/[0.055] pb-1"
      >
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
          value="code"
          data-test-id="properties-tab-code"
          aria-label="HTML"
          class="properties-tab flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[7px] px-2 text-[11px] font-medium text-muted transition-all hover:bg-white/[0.055] hover:text-surface data-[state=active]:bg-white/[0.085] data-[state=active]:text-surface data-[state=active]:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
        >
          <icon-lucide-code-xml class="size-3" />
          <span class="properties-tab__label">HTML</span>
        </TabsTrigger>
        <TabsTrigger
          value="trace"
          data-test-id="properties-tab-trace"
          aria-label="Trace"
          class="properties-tab flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[7px] px-2 text-[11px] font-medium text-muted transition-all hover:bg-white/[0.055] hover:text-surface data-[state=active]:bg-white/[0.085] data-[state=active]:text-surface data-[state=active]:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
        >
          <icon-lucide-audio-lines class="size-3" />
          <span class="properties-tab__label">Trace</span>
        </TabsTrigger>
      </TabsList>

      <TabsContent
        value="design"
        class="flex min-h-0 flex-1 flex-col"
        :force-mount="true"
        :hidden="activeTab !== 'design'"
      >
        <DesignPanel />
      </TabsContent>

      <TabsContent
        value="code"
        class="flex min-h-0 flex-1 flex-col"
        :force-mount="true"
        :hidden="activeTab !== 'code'"
      >
        <CodePanel />
      </TabsContent>

      <TabsContent
        value="trace"
        class="flex min-h-0 flex-1 flex-col"
        :force-mount="true"
        :hidden="activeTab !== 'trace'"
      >
        <NarratedTracePanel />
      </TabsContent>
    </TabsRoot>
  </aside>
</template>
