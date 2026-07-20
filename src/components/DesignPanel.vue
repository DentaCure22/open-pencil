<script setup lang="ts">
import { computed, ref } from 'vue'

import { useI18n, useSelectionState } from '@open-pencil/vue'

import { useEditorStore } from '@/app/editor/active-store'
import {
  liveInspectorDocument,
  selectedLiveInspectorNode
} from '@/app/smylr-live-inspector/session'
import { isSmylrLiveAppFrameNode } from '@/app/smylr-production/workspace'
import { useKnowledgeWorkspaceUi } from '@/app/workspace-ui/use'

import MermaidSourceStatus from './diagram/MermaidSourceStatus.vue'
import AppearanceSection from './properties/AppearanceSection.vue'
import BooleanOperationsControl from './properties/BooleanOperationsControl.vue'
import EffectsSection from './properties/EffectsSection.vue'
import ExportSection from './properties/ExportSection.vue'
import FillSection from './properties/FillSection.vue'
import PageSection from './properties/PageSection.vue'
import PositionSection from './properties/PositionSection.vue'
import StrokeSection from './properties/StrokeSection.vue'
import VariablesSection from './properties/VariablesSection.vue'
import NativeSelectionInspector from './properties/NativeSelectionInspector.vue'
import SmylrLiveNativeInspectorHost from './properties/SmylrLiveNativeInspectorHost.vue'
import VariablesDialog from './variables/VariablesDialog.vue'
import WorkspaceObjectInspector from './workspace/WorkspaceObjectInspector.vue'

const store = useEditorStore()
const workspaceUi = useKnowledgeWorkspaceUi(store)
const variablesOpen = ref(false)
const liveInspectorRevision = ref(0)
const { selectedNode: node, selectedCount: multiCount } = useSelectionState()
const showBooleanOperations = computed(() => multiCount.value >= 2)
const isSmylrLiveFrame = computed(() => isSmylrLiveAppFrameNode(node.value))
const showLiveInspector = computed(
  () =>
    multiCount.value <= 1 &&
    Boolean(liveInspectorDocument.value && selectedLiveInspectorNode.value) &&
    (!node.value || isSmylrLiveFrame.value)
)
const workspaceObject = computed(() => {
  void workspaceUi.revision.value
  return node.value ? workspaceUi.objectForSceneNode(node.value.id) : null
})
const showWorkspaceInspector = computed(
  () => multiCount.value <= 1 && Boolean(workspaceObject.value) && !showLiveInspector.value
)
const { panels } = useI18n()

function remountLiveInspector() {
  liveInspectorRevision.value += 1
}

function updateWorkspaceLabel(value: string) {
  const object = workspaceObject.value
  if (object) void workspaceUi.updateLabel(object, value)
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

  <!-- Single selection -->
  <KeepAlive>
    <SmylrLiveNativeInspectorHost
      v-if="showLiveInspector && liveInspectorDocument && selectedLiveInspectorNode"
      :key="`${selectedLiveInspectorNode.id}:${liveInspectorRevision}`"
      :document="liveInspectorDocument"
      :node="selectedLiveInspectorNode"
      @reset="remountLiveInspector"
    />
  </KeepAlive>

  <WorkspaceObjectInspector
    v-if="showWorkspaceInspector && workspaceObject"
    :object="workspaceObject"
    :view-kind="workspaceUi.activeViewKind.value"
    @activate-live="workspaceUi.activateLive(workspaceObject)"
    @archive="workspaceUi.archive(workspaceObject)"
    @connect="workspaceUi.beginRelation(workspaceObject)"
    @create-record="workspaceUi.createRecord(workspaceObject)"
    @send-review="workspaceUi.sendToReview(workspaceObject)"
    @update-label="updateWorkspaceLabel"
  />

  <NativeSelectionInspector
    v-if="multiCount <= 1 && node && !showLiveInspector && !showWorkspaceInspector"
    :compact-header="isSmylrLiveFrame"
  >
    <template #sections-footer>
      <MermaidSourceStatus />
    </template>
  </NativeSelectionInspector>

  <div
    v-if="multiCount <= 1 && !node && !showLiveInspector && !showWorkspaceInspector"
    data-test-id="design-panel-empty"
    class="scrollbar-thin flex-1 overflow-x-hidden overflow-y-auto pb-4"
  >
    <PageSection />
    <VariablesSection @open-dialog="variablesOpen = true" />
    <ExportSection />
  </div>

  <VariablesDialog v-model:open="variablesOpen" />
</template>
