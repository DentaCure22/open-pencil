<script setup lang="ts">
import { computed, ref } from 'vue'

import { objectGraphConnectionForSelection } from '@open-pencil/scene-graph'
import { useI18n, useSelectionState } from '@open-pencil/vue'

import { useEditorStore } from '@/app/editor/active-store'
import { codeObjectInspectorSelection } from '@/app/code-object/inspector'
import { objectGraphConnectionName } from '@/app/object-graph'
import {
  liveInspectorActiveFrameId,
  liveInspectorDocument,
  selectedLiveInspectorNode
} from '@/app/smylr-live-inspector/session'
import { isSmylrProductionAppCodeObjectFrame } from '@/app/smylr-production/workspace'

import CodeObjectDomInspector from './code-object/DomInspector.vue'
import MermaidSourceStatus from './diagram/MermaidSourceStatus.vue'
import AppearanceSection from './properties/AppearanceSection.vue'
import BooleanOperationsControl from './properties/BooleanOperationsControl.vue'
import EffectsSection from './properties/EffectsSection.vue'
import ExportSection from './properties/ExportSection.vue'
import FillSection from './properties/FillSection.vue'
import ObjectGraphSection from './properties/ObjectGraphSection.vue'
import PageSection from './properties/PageSection.vue'
import PositionSection from './properties/PositionSection.vue'
import StrokeSection from './properties/StrokeSection.vue'
import VariablesSection from './properties/VariablesSection.vue'
import NativeSelectionInspector from './properties/NativeSelectionInspector.vue'
import SmylrLiveNativeInspectorHost from './properties/SmylrLiveNativeInspectorHost.vue'
import VariablesDialog from './variables/VariablesDialog.vue'

const store = useEditorStore()
const variablesOpen = ref(false)
const liveInspectorRevision = ref(0)
const { selectedIds, selectedNode: node, selectedCount: multiCount } = useSelectionState()
const selectedConnection = computed(() => {
  void store.state.sceneVersion
  return objectGraphConnectionForSelection(
    store.graph,
    store.state.currentPageId,
    selectedIds.value
  )
})
const selectedConnectionName = computed(() =>
  selectedConnection.value ? objectGraphConnectionName(store.graph, selectedConnection.value) : ''
)
const showBooleanOperations = computed(() => multiCount.value >= 2)
const smylrProductionSelected = computed(() =>
  Boolean(node.value && isSmylrProductionAppCodeObjectFrame(node.value))
)
const showLiveInspector = computed(
  () =>
    multiCount.value <= 1 &&
    smylrProductionSelected.value &&
    liveInspectorActiveFrameId.value === node.value?.id &&
    Boolean(liveInspectorDocument.value && selectedLiveInspectorNode.value)
)
const inspectCodeObjectLayer = computed(
  () =>
    multiCount.value <= 1 &&
    Boolean(node.value) &&
    codeObjectInspectorSelection.value?.frameId === node.value?.id
)
const { panels } = useI18n()

function remountLiveInspector() {
  liveInspectorRevision.value += 1
}
</script>

<template>
  <!-- Multi-select summary -->
  <div
    v-if="multiCount > 1"
    data-test-id="design-panel-multi"
    class="scrollbar-thin flex-1 overflow-x-hidden overflow-y-auto pb-4"
  >
    <div
      data-test-id="design-multi-header"
      class="flex items-center gap-1.5 border-b border-border px-3 py-2"
    >
      <span class="text-[11px] text-muted">{{ panels.mixed }}</span>
      <span class="text-xs font-semibold">{{
        panels.layersCount({ count: String(multiCount) })
      }}</span>
      <div class="ml-auto flex items-center">
        <BooleanOperationsControl v-if="showBooleanOperations" />
      </div>
    </div>
    <PositionSection />
    <AppearanceSection />
    <FillSection />
    <StrokeSection />
    <EffectsSection />
    <ExportSection />
  </div>

  <KeepAlive>
    <SmylrLiveNativeInspectorHost
      v-if="showLiveInspector && liveInspectorDocument && selectedLiveInspectorNode"
      :key="`${selectedLiveInspectorNode.id}:${liveInspectorRevision}`"
      :document="liveInspectorDocument"
      :node="selectedLiveInspectorNode"
      @reset="remountLiveInspector"
    />
  </KeepAlive>

  <CodeObjectDomInspector v-if="!showLiveInspector && inspectCodeObjectLayer" />

  <NativeSelectionInspector
    v-else-if="multiCount <= 1 && node && !showLiveInspector"
    :show-object-graph="!smylrProductionSelected"
  >
    <template #sections-footer>
      <MermaidSourceStatus />
    </template>
  </NativeSelectionInspector>

  <div
    v-if="multiCount <= 1 && selectedConnection"
    data-test-id="design-panel-single"
    class="scrollbar-thin flex-1 overflow-x-hidden overflow-y-auto pb-4"
  >
    <div
      data-test-id="design-node-header"
      class="flex min-h-16 items-center gap-2.5 border-b border-white/[0.055] px-3 py-2.5"
    >
      <icon-lucide-git-branch class="size-4 shrink-0 text-muted" />
      <div class="min-w-0 flex-1">
        <div
          data-test-id="design-node-type"
          class="truncate text-[9px] leading-3.5 font-medium tracking-[0.04em] text-muted uppercase"
        >
          Connection
        </div>
        <div
          data-test-id="design-node-name"
          class="truncate text-[12px] leading-4 font-semibold text-surface"
        >
          {{ selectedConnectionName }}
        </div>
      </div>
    </div>
    <ObjectGraphSection />
  </div>

  <div
    v-if="multiCount <= 1 && !node && !selectedConnection"
    data-test-id="design-panel-empty"
    class="scrollbar-thin flex-1 overflow-x-hidden overflow-y-auto pb-4"
  >
    <PageSection />
    <VariablesSection @open-dialog="variablesOpen = true" />
    <ExportSection />
  </div>

  <VariablesDialog v-model:open="variablesOpen" />
</template>
