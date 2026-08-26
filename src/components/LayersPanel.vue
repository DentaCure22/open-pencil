<script setup lang="ts">
import { useLocalStorage } from '@vueuse/core'
import { defineAsyncComponent, watch } from 'vue'

import { agentChatsPanelOpenEpoch } from '@/app/agent-chat/panel'
import { openAgentRightPanel } from '@/app/agent-chat/right-panel'
import { modelMeterPanelOpenEpoch } from '@/app/model-meter/panel'
import { tracePanelOpenEpoch } from '@/app/narrated-trace'
import BrowserInspectorSelection from './browser-inspector/BrowserInspectorSelection.vue'
import './layers-panel.css'

const AgentChatsPanel = defineAsyncComponent(() => import('./agent-chat/AgentChatsPanel.vue'))
const ModelMeterPanel = defineAsyncComponent(() => import('./model-meter/ModelMeterPanel.vue'))

type UtilityKind = 'assets' | 'cache' | 'chats' | 'layers' | 'trace'

const openUtility = useLocalStorage<UtilityKind>('open-pencil:left-panel-utility-v1', 'chats')

watch(
  openUtility,
  (utility) => {
    if (utility !== 'cache' && utility !== 'chats') openUtility.value = 'chats'
  },
  { immediate: true }
)

watch(tracePanelOpenEpoch, () => {
  openAgentRightPanel('activity')
})

watch(agentChatsPanelOpenEpoch, () => {
  openUtility.value = 'chats'
})

watch(modelMeterPanelOpenEpoch, () => {
  openUtility.value = 'cache'
})
</script>

<template>
  <aside
    data-test-id="layers-panel"
    class="layers-panel flex min-h-0 min-w-0 flex-1 flex-col overflow-clip bg-transparent"
    style="contain: paint layout style"
  >
    <div
      data-test-id="left-panel-utility-area"
      class="relative flex min-h-0 grow basis-0 flex-col overflow-clip pb-1"
    >
      <div class="min-w-0">
        <BrowserInspectorSelection />
      </div>

      <div
        v-show="openUtility === 'chats'"
        data-test-id="left-panel-chats-content"
        class="flex min-h-0 flex-1 flex-col overflow-clip outline-none"
      >
        <AgentChatsPanel />
      </div>

      <div
        v-show="openUtility === 'cache'"
        data-test-id="left-panel-cache-content"
        class="flex min-h-0 flex-1 flex-col overflow-clip outline-none"
      >
        <ModelMeterPanel />
      </div>
    </div>
  </aside>
</template>
