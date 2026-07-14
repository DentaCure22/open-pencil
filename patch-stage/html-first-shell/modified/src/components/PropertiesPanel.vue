<script setup lang="ts">
import { watch } from 'vue'
import { TabsContent, TabsList, TabsRoot, TabsTrigger } from 'reka-ui'

import { useI18n } from '@open-pencil/vue'
import { useAIChat } from '@/app/ai/chat/use'
import { liveInspectorSelectionEpoch } from '@/app/smylr-live-inspector/session'

import ChatPanel from './ChatPanel.vue'
import CodePanel from './CodePanel.vue'
import DesignPanel from './DesignPanel.vue'
import NarratedTracePanel from './narrated-trace/NarratedTracePanel.vue'
import ZoomDropdown from './editor/ZoomDropdown.vue'
import './properties-panel.css'

const { activeTab } = useAIChat()
const { panels } = useI18n()

watch(liveInspectorSelectionEpoch, () => {
  if (activeTab.value !== 'trace') activeTab.value = 'design'
})
</script>

<template>
  <aside
    data-test-id="properties-panel"
    class="properties-panel flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-transparent"
    style="contain: paint layout style"
  >
    <TabsRoot v-model="activeTab" class="flex min-h-0 flex-1 flex-col">
      <TabsList
        class="properties-tabs mx-2.5 mt-2 mb-1 flex h-9 shrink-0 gap-1 rounded-[10px] border border-white/[0.055] bg-black/20 p-1 shadow-[inset_0_1px_2px_rgba(0,0,0,0.24)]"
      >
        <TabsTrigger
          value="design"
          data-test-id="properties-tab-design"
          aria-label="Design"
          class="properties-tab flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[7px] px-1.5 text-[10px] font-medium text-muted transition-all hover:bg-white/[0.055] hover:text-surface data-[state=active]:bg-white/[0.095] data-[state=active]:text-surface data-[state=active]:shadow-[0_1px_2px_rgba(0,0,0,0.28),inset_0_1px_0_rgba(255,255,255,0.055)]"
        >
          <icon-lucide-palette class="size-3" />
          <span class="properties-tab__label">{{ panels.design }}</span>
        </TabsTrigger>
        <TabsTrigger
          value="code"
          data-test-id="properties-tab-code"
          aria-label="HTML"
          class="properties-tab flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[7px] px-1.5 text-[10px] font-medium text-muted transition-all hover:bg-white/[0.055] hover:text-surface data-[state=active]:bg-white/[0.095] data-[state=active]:text-surface data-[state=active]:shadow-[0_1px_2px_rgba(0,0,0,0.28),inset_0_1px_0_rgba(255,255,255,0.055)]"
        >
          <icon-lucide-code-xml class="size-3" />
          <span class="properties-tab__label">HTML</span>
        </TabsTrigger>
        <TabsTrigger
          value="trace"
          data-test-id="properties-tab-trace"
          aria-label="Trace"
          class="properties-tab flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[7px] px-1.5 text-[10px] font-medium text-muted transition-all hover:bg-white/[0.055] hover:text-surface data-[state=active]:bg-white/[0.095] data-[state=active]:text-surface data-[state=active]:shadow-[0_1px_2px_rgba(0,0,0,0.28),inset_0_1px_0_rgba(255,255,255,0.055)]"
        >
          <icon-lucide-audio-lines class="size-3" />
          <span class="properties-tab__label">Trace</span>
        </TabsTrigger>
        <TabsTrigger
          value="ai"
          data-test-id="properties-tab-ai"
          aria-label="AI"
          class="properties-tab flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[7px] px-1.5 text-[10px] font-medium text-muted transition-all hover:bg-white/[0.055] hover:text-surface data-[state=active]:bg-white/[0.095] data-[state=active]:text-surface data-[state=active]:shadow-[0_1px_2px_rgba(0,0,0,0.28),inset_0_1px_0_rgba(255,255,255,0.055)]"
        >
          <icon-lucide-sparkles class="size-3" />
          <span class="properties-tab__label">{{ panels.ai }}</span>
        </TabsTrigger>
        <div class="properties-tabs__actions ml-auto flex items-center gap-1">
          <ZoomDropdown v-if="activeTab === 'design'" />
        </div>
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

      <TabsContent
        value="ai"
        class="flex min-h-0 flex-1 flex-col"
        :force-mount="true"
        :hidden="activeTab !== 'ai'"
      >
        <ChatPanel />
      </TabsContent>
    </TabsRoot>
  </aside>
</template>
