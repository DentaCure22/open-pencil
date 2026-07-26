<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { TabsContent, TabsList, TabsRoot, TabsTrigger } from 'reka-ui'

import { objectGraphConnectionForSelection } from '@open-pencil/scene-graph'
import { useSelectionState } from '@open-pencil/vue'

import AppMenu from '@/components/Shell/AppMenu.vue'
import { useAIChat } from '@/app/ai/chat/use'
import { useEditorStore } from '@/app/editor/active-store'
import { tracePanelOpenEpoch } from '@/app/narrated-trace'
import {
  clearLiveInspectorSelection,
  liveInspectorActiveFrameId,
  liveInspectorDocument,
  liveInspectorInteractionMode,
  selectLiveInspectorNode,
  selectedLiveInspectorNode,
  setLiveInspectorActiveFrame,
  setLiveInspectorInteractionMode
} from '@/app/smylr-live-inspector/session'
import { isSmylrProductionAppCodeObjectFrame } from '@/app/smylr-production/workspace'
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
const { selectedCount, selectedIds, selectedNode } = useSelectionState()

type UtilityKind = 'assets' | 'layers' | 'trace'

const openUtility = ref<UtilityKind>('layers')
const contextOpen = ref(false)
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

const hasNativeDesignContext = computed(() => {
  void store.state.sceneVersion
  return (
    selectedCount.value > 1 ||
    Boolean(selectedNode.value) ||
    Boolean(
      objectGraphConnectionForSelection(store.graph, store.state.currentPageId, selectedIds.value)
    )
  )
})
const hasDesignContext = computed(() => hasNativeDesignContext.value)
const sourceDocumentSelected = computed(() => {
  void store.state.sceneVersion
  return Boolean(selectedSourceDocument(store))
})
const selectedSmylrProductionFrame = computed(() => {
  void store.state.sceneVersion
  const node = selectedNode.value
  return isSmylrProductionAppCodeObjectFrame(node) ? node : null
})
const liveContainerModeActive = computed(() => {
  const frame = selectedSmylrProductionFrame.value
  return (
    Boolean(frame) &&
    liveInspectorActiveFrameId.value === frame?.id &&
    liveInspectorInteractionMode.value === 'select'
  )
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
  hasDesignContext,
  (hasContext) => {
    if (hasContext) contextOpen.value = true
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
  layerTreeRef.value?.closeTreeTools()
})

watch(tracePanelOpenEpoch, () => {
  openUtility.value = 'trace'
})

watch(liveInspectorDocument, (document) => {
  if (liveContainerModeActive.value && document?.tree.id && !selectedLiveInspectorNode.value) {
    selectLiveInspectorNode(document.tree.id)
  }
})

watch(selectedSmylrProductionFrame, (frame, previousFrame) => {
  if (
    frame ||
    !previousFrame ||
    liveInspectorActiveFrameId.value !== previousFrame.id ||
    liveInspectorInteractionMode.value !== 'select'
  ) {
    return
  }
  clearLiveInspectorSelection()
  setLiveInspectorInteractionMode('frame')
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

function toggleLiveContainerMode() {
  const frame = selectedSmylrProductionFrame.value
  if (!frame) return
  if (liveContainerModeActive.value) {
    clearLiveInspectorSelection()
    setLiveInspectorInteractionMode('frame')
    return
  }

  setLiveInspectorActiveFrame(frame.id)
  setLiveInspectorInteractionMode('select')
  const rootId = liveInspectorDocument.value?.tree.id
  if (rootId) selectLiveInspectorNode(rootId)
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
          <span class="min-w-0 flex-1 truncate">Document</span>
          <Tip
            v-if="selectedSmylrProductionFrame"
            :label="liveContainerModeActive ? 'Stop selecting containers' : 'Select containers'"
          >
            <button
              type="button"
              data-test-id="smylr-containers-tool"
              aria-label="Select containers"
              :aria-pressed="liveContainerModeActive"
              class="flex h-6 shrink-0 items-center gap-1 rounded-[5px] px-1.5 text-[10px] font-medium transition-colors"
              :class="
                liveContainerModeActive
                  ? 'bg-accent text-white'
                  : 'text-muted hover:bg-hover hover:text-surface'
              "
              @click="toggleLiveContainerMode"
            >
              <icon-lucide-scan-search class="size-3.5" />
              <span>Containers</span>
            </button>
          </Tip>
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
