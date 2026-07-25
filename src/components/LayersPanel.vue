<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { TabsContent, TabsList, TabsRoot, TabsTrigger } from 'reka-ui'

import { useSelectionState } from '@open-pencil/vue'

import AppMenu from '@/components/Shell/AppMenu.vue'
import { useAIChat } from '@/app/ai/chat/use'
import { useEditorStore } from '@/app/editor/active-store'
import { tracePanelOpenEpoch } from '@/app/narrated-trace'
import {
  liveInspectorDocument,
  liveInspectorFrameSrc,
  liveInspectorInteractionMode,
  liveInspectorRoute,
  liveInspectorSelectionEpoch,
  liveInspectorStatus,
  reloadLiveInspectorFrame,
  selectedLiveInspectorNode,
  setLiveInspectorInteractionMode
} from '@/app/smylr-live-inspector/session'
import { isSmylrLiveAppFrameNode } from '@/app/smylr-production/workspace'
import { selectedSourceDocument } from '@/app/source-document/workspace'
import AssetsPanel from './AssetsPanel.vue'
import LayerTree from './LayerTree/LayerTree.vue'
import NarratedTracePanel from './narrated-trace/NarratedTracePanel.vue'
import ContextInspector from './sidebar/ContextInspector.vue'
import Tip from './ui/Tip.vue'
import VariablesDialog from './variables/VariablesDialog.vue'
import './layers-panel.css'

const { showCodeTab = true } = defineProps<{ showCodeTab?: boolean }>()
const emit = defineEmits<{ close: [] }>()
const { activeTab } = useAIChat()
const store = useEditorStore()
const { selectedCount, selectedNode } = useSelectionState()

type UtilityKind = 'assets' | 'layers' | 'trace'

const openUtility = ref<UtilityKind>('layers')
const contextOpen = ref(false)
const showLiveTools = ref(false)
const variablesOpen = ref(false)

const railMotionClass =
  'duration-200 ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none'
const utilityContentClass =
  'col-span-3 row-start-2 flex min-h-0 flex-1 flex-col overflow-hidden outline-none'
const utilityTabClass =
  'flex min-w-0 items-center justify-center rounded-[9px] border border-transparent px-1 text-[10px] leading-none font-semibold tracking-[0.04em] outline-none transition-colors focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-border'

interface LayerTreeHandle {
  closeTreeTools: () => void
  revealNode: (nodeId: string) => void
}

const layerTreeRef = ref<LayerTreeHandle | null>(null)

const liveStatusLabel = computed(() => {
  if (liveInspectorStatus.value === 'connected') return 'Live'
  if (liveInspectorStatus.value === 'loading') return 'Loading'
  if (liveInspectorStatus.value === 'unavailable') return 'Reconnect'
  return ''
})
const liveStatusDot = computed(() => {
  if (liveInspectorStatus.value === 'connected') return 'bg-emerald-500'
  if (liveInspectorStatus.value === 'loading') return 'bg-sky-500'
  if (liveInspectorStatus.value === 'unavailable') return 'bg-amber-500'
  return ''
})
const currentPageHasLiveApp = computed(() => {
  void store.state.sceneVersion
  return store.graph.getChildren(store.state.currentPageId).some(isSmylrLiveAppFrameNode)
})
const showLiveChrome = computed(
  () =>
    currentPageHasLiveApp.value &&
    (liveInspectorStatus.value !== 'idle' ||
      Boolean(liveInspectorDocument.value) ||
      Boolean(liveInspectorFrameSrc.value))
)

const hasNativeDesignContext = computed(
  () => selectedCount.value > 1 || Boolean(selectedNode.value)
)
const hasDesignContext = computed(
  () =>
    hasNativeDesignContext.value ||
    Boolean(liveInspectorDocument.value && selectedLiveInspectorNode.value)
)
const sourceDocumentSelected = computed(() => {
  void store.state.sceneVersion
  return Boolean(selectedSourceDocument(store))
})
const showContextInspector = computed(
  () =>
    (contextOpen.value || (!showCodeTab && hasDesignContext.value)) &&
    (hasDesignContext.value || activeTab.value === 'code')
)
const showContextRail = computed(() => showContextInspector.value)
const contextRailStateClass = computed(() => {
  if (!showContextRail.value) return 'grow-0 opacity-0'
  if (sourceDocumentSelected.value) return 'grow-[1.65] opacity-100'
  return 'grow opacity-100'
})

watch(
  [hasDesignContext, liveInspectorSelectionEpoch],
  () => {
    if (hasDesignContext.value) contextOpen.value = true
  },
  { immediate: true }
)

watch(
  activeTab,
  (tab) => {
    if (tab === 'code' && !showCodeTab && !sourceDocumentSelected.value) {
      activeTab.value = 'design'
      return
    }
    if (tab === 'code' || (tab === 'design' && hasDesignContext.value)) {
      contextOpen.value = true
    }
  },
  { immediate: true }
)

watch(openUtility, () => {
  showLiveTools.value = false
  layerTreeRef.value?.closeTreeTools()
})

watch(tracePanelOpenEpoch, () => {
  openUtility.value = 'trace'
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

function useLiveApp() {
  setLiveInspectorInteractionMode('interact')
}

function useLiveAppFromMenu() {
  useLiveApp()
  showLiveTools.value = false
}

function reloadLiveLayersFromMenu() {
  reloadLiveInspectorFrame()
  showLiveTools.value = false
}

function openLiveApp() {
  if (!liveInspectorFrameSrc.value) return
  window.open(liveInspectorFrameSrc.value, '_blank', 'noopener,noreferrer')
}

function openLiveAppFromMenu() {
  openLiveApp()
  showLiveTools.value = false
}

function toggleLiveTools() {
  const next = !showLiveTools.value
  showLiveTools.value = next
  if (next) layerTreeRef.value?.closeTreeTools()
}
</script>

<template>
  <aside
    data-test-id="layers-panel"
    class="layers-panel flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-transparent"
    style="contain: paint layout style"
  >
    <AppMenu closable @close-panel="emit('close')" />
    <div
      data-test-id="sidebar-context-slot"
      :data-state="showContextRail ? 'open' : 'closed'"
      class="min-h-0 basis-0 overflow-hidden transition-[flex-grow,opacity]"
      :class="[railMotionClass, contextRailStateClass]"
    >
      <Transition
        enter-active-class="transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none"
        enter-from-class="-translate-y-1 opacity-0"
        leave-active-class="transition-[opacity,transform] duration-150 ease-in motion-reduce:transition-none"
        leave-to-class="-translate-y-1 opacity-0"
      >
        <ContextInspector
          v-if="showContextRail"
          :show-code-tab="showCodeTab"
          split
          @close="contextOpen = false"
        />
      </Transition>
    </div>

    <TabsRoot
      v-model="openUtility"
      data-test-id="left-panel-utility-area"
      class="relative grid min-h-0 grow basis-0 grid-cols-3 grid-rows-[3rem_minmax(0,1fr)] overflow-hidden pb-1"
    >
      <TabsList
        aria-label="Sidebar utilities"
        class="bg-chrome-control ring-chrome-control-border z-10 col-span-3 row-start-1 m-1 grid grid-cols-3 rounded-[12px] p-1 ring-1 ring-inset"
      >
        <TabsTrigger
          value="layers"
          data-test-id="left-panel-layers-tab"
          :class="[utilityTabClass, utilityTabStateClass('layers')]"
        >
          <span>LAYERS</span>
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
          <span>TRACE</span>
        </TabsTrigger>
      </TabsList>

      <TabsContent
        value="layers"
        data-test-id="left-panel-layers-content"
        :class="utilityContentClass"
      >
        <div
          class="border-border/70 relative mx-3 flex h-7 shrink-0 items-center gap-1 border-b text-[10px] text-muted/80"
        >
          <span
            v-if="showLiveChrome && liveStatusDot"
            class="size-1.5 shrink-0 rounded-full"
            :class="liveStatusDot"
          />
          <span class="min-w-0 flex-1 truncate">
            {{ showLiveChrome ? liveInspectorRoute || liveStatusLabel : 'Document' }}
          </span>
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
          <Tip v-if="showLiveChrome" label="Live layer controls">
            <button
              type="button"
              data-test-id="smylr-live-tools-toggle"
              aria-label="Live layer controls"
              class="flex size-6 shrink-0 items-center justify-center rounded-[5px] text-muted hover:bg-hover hover:text-surface"
              :class="showLiveTools ? 'bg-hover text-surface' : ''"
              :aria-expanded="showLiveTools"
              @click="toggleLiveTools"
            >
              <icon-lucide-more-horizontal class="size-3.5" />
            </button>
          </Tip>
          <div
            v-if="showLiveChrome && showLiveTools"
            class="border-chrome-border bg-chrome-raised shadow-chrome-menu absolute top-7 right-0 z-30 w-40 rounded-[9px] border p-1 backdrop-blur-xl"
          >
            <button
              type="button"
              data-test-id="smylr-live-interact"
              class="flex h-8 w-full items-center gap-2 rounded-[5px] px-2 text-left text-[12px] text-muted hover:bg-hover hover:text-surface"
              :class="liveInspectorInteractionMode === 'interact' ? 'bg-hover text-surface' : ''"
              @click="useLiveAppFromMenu"
            >
              <icon-lucide-mouse-pointer-click class="size-3.5" />
              <span>Use live app</span>
            </button>
            <button
              type="button"
              data-test-id="smylr-auth-reload-frame"
              class="flex h-8 w-full items-center gap-2 rounded-[5px] px-2 text-left text-[12px] text-muted hover:bg-hover hover:text-surface"
              @click="reloadLiveLayersFromMenu"
            >
              <icon-lucide-refresh-cw class="size-3.5" />
              <span>Reload layers</span>
            </button>
            <button
              type="button"
              data-test-id="smylr-open-live-app"
              class="flex h-8 w-full items-center gap-2 rounded-[5px] px-2 text-left text-[12px] text-muted hover:bg-hover hover:text-surface disabled:cursor-default disabled:opacity-40"
              :disabled="!liveInspectorFrameSrc"
              @click="openLiveAppFromMenu"
            >
              <icon-lucide-external-link class="size-3.5" />
              <span>Open Smylr</span>
            </button>
          </div>
        </div>
        <LayerTree
          ref="layerTreeRef"
          data-test-id="layers-tree"
          @tools-opened="showLiveTools = false"
        />
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
    </TabsRoot>
    <VariablesDialog v-model:open="variablesOpen" />
  </aside>
</template>
