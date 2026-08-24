<script setup lang="ts">
import { defineAsyncComponent, nextTick, ref, watch } from 'vue'
import { TabsContent, TabsList, TabsRoot, TabsTrigger } from 'reka-ui'

import { agentChatsPanelOpenEpoch } from '@/app/agent-chat/panel'
import { modelMeterPanelOpenEpoch } from '@/app/model-meter/panel'
import { tracePanelOpenEpoch } from '@/app/narrated-trace'
import BrowserInspectorSelection from './browser-inspector/BrowserInspectorSelection.vue'
import LayerTree from './LayerTree/LayerTree.vue'
import Tip from './ui/Tip.vue'
import './layers-panel.css'

const AssetsPanel = defineAsyncComponent(() => import('./AssetsPanel.vue'))
const AgentChatsPanel = defineAsyncComponent(() => import('./agent-chat/AgentChatsPanel.vue'))
const NarratedTracePanel = defineAsyncComponent(
  () => import('./narrated-trace/NarratedTracePanel.vue')
)
const ModelMeterPanel = defineAsyncComponent(() => import('./model-meter/ModelMeterPanel.vue'))
const VariablesDialog = defineAsyncComponent(() => import('./variables/VariablesDialog.vue'))

type UtilityKind = 'assets' | 'cache' | 'chats' | 'layers' | 'trace'

const openUtility = ref<UtilityKind>('layers')
const variablesOpen = ref(false)

const utilityContentClass =
  'col-span-5 row-start-3 flex min-h-0 flex-1 flex-col overflow-clip outline-none'
const utilityTabClass =
  'flex min-w-0 items-center justify-center rounded-[9px] border border-transparent px-0.5 text-[9px] leading-none font-semibold tracking-[0.025em] outline-none transition-colors focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-border'

interface LayerTreeHandle {
  closeTreeTools: () => void
  revealNode: (nodeId: string) => void
}

const layerTreeRef = ref<LayerTreeHandle | null>(null)

watch(openUtility, () => {
  layerTreeRef.value?.closeTreeTools()
})

watch(tracePanelOpenEpoch, () => {
  openUtility.value = 'trace'
})

watch(agentChatsPanelOpenEpoch, () => {
  openUtility.value = 'chats'
})

watch(modelMeterPanelOpenEpoch, () => {
  openUtility.value = 'cache'
})

function utilityTabStateClass(kind: UtilityKind) {
  return openUtility.value === kind
    ? 'border-chrome-control-border bg-chrome-control-active text-surface shadow-sm'
    : 'text-muted hover:bg-hover hover:text-surface'
}

async function revealInsertedAsset(nodeId: string) {
  openUtility.value = 'layers'
  await nextTick()
  layerTreeRef.value?.revealNode(nodeId)
}
</script>

<template>
  <aside
    data-test-id="layers-panel"
    class="layers-panel flex min-h-0 min-w-0 flex-1 flex-col overflow-clip bg-transparent"
    style="contain: paint layout style"
  >
    <TabsRoot
      v-model="openUtility"
      data-test-id="left-panel-utility-area"
      class="relative grid min-h-0 grow basis-0 grid-cols-5 grid-rows-[3.25rem_auto_minmax(0,1fr)] overflow-clip pb-1"
    >
      <TabsList
        aria-label="Sidebar utilities"
        class="bg-chrome-control ring-chrome-control-border z-10 col-span-5 row-start-1 mx-1 mt-2 mb-1 grid grid-cols-5 rounded-[12px] p-1 ring-1 ring-inset"
      >
        <TabsTrigger
          value="layers"
          data-test-id="left-panel-layers-tab"
          :class="[utilityTabClass, utilityTabStateClass('layers')]"
        >
          <span>LAYERS</span>
        </TabsTrigger>
        <TabsTrigger
          value="chats"
          data-test-id="left-panel-chats-tab"
          :class="[utilityTabClass, utilityTabStateClass('chats')]"
        >
          <span>CHATS</span>
        </TabsTrigger>
        <TabsTrigger
          value="assets"
          data-test-id="left-panel-assets-tab"
          :class="[utilityTabClass, utilityTabStateClass('assets')]"
        >
          <span>ASSETS</span>
        </TabsTrigger>
        <TabsTrigger
          value="trace"
          data-test-id="left-panel-trace-tab"
          :class="[utilityTabClass, utilityTabStateClass('trace')]"
        >
          <span>ACTIVITY</span>
        </TabsTrigger>
        <TabsTrigger
          value="cache"
          data-test-id="left-panel-cache-tab"
          :class="[utilityTabClass, utilityTabStateClass('cache')]"
        >
          <span>CACHE</span>
        </TabsTrigger>
      </TabsList>

      <div class="col-span-5 row-start-2 min-w-0">
        <BrowserInspectorSelection />
      </div>

      <TabsContent
        value="layers"
        data-test-id="left-panel-layers-content"
        :class="utilityContentClass"
      >
        <div
          class="border-border/70 relative mx-3 flex h-7 shrink-0 items-center gap-1 border-b text-[10px] text-muted/80"
        >
          <span class="min-w-0 flex-1 truncate">Document</span>
          <Tip label="Manage design tokens">
            <button
              type="button"
              data-test-id="variables-section-open"
              aria-label="Manage design tokens"
              class="flex size-6 shrink-0 items-center justify-center rounded-[5px] text-muted hover:bg-hover hover:text-surface"
              @click="variablesOpen = true"
            >
              <icon-lucide-variable class="size-3.5" />
            </button>
          </Tip>
        </div>
        <LayerTree ref="layerTreeRef" data-test-id="layers-tree" />
      </TabsContent>

      <TabsContent
        value="chats"
        data-test-id="left-panel-chats-content"
        :class="utilityContentClass"
      >
        <AgentChatsPanel />
      </TabsContent>

      <TabsContent
        value="assets"
        data-test-id="left-panel-assets-content"
        :class="utilityContentClass"
      >
        <AssetsPanel @asset-inserted="revealInsertedAsset" />
      </TabsContent>

      <TabsContent
        value="trace"
        data-test-id="left-panel-trace-content"
        :class="utilityContentClass"
      >
        <NarratedTracePanel />
      </TabsContent>

      <TabsContent
        value="cache"
        data-test-id="left-panel-cache-content"
        :class="utilityContentClass"
      >
        <ModelMeterPanel />
      </TabsContent>
    </TabsRoot>
    <VariablesDialog v-if="variablesOpen" v-model:open="variablesOpen" />
  </aside>
</template>
