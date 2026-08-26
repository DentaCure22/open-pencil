<script setup lang="ts">
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import {
  defineAsyncComponent,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  useTemplateRef,
  watchEffect
} from 'vue'

import { openAgentRightPanel, type AgentRightPanelSurface } from '@/app/agent-chat/right-panel'
import LayerTree from '@/components/LayerTree/LayerTree.vue'

import T3RightPanelWorkspace from './T3RightPanelWorkspace'
import type { T3DiffReviewComment } from './t3-right-panel.logic'
import type { AiTurnChanges } from './types'

const AssetsPanel = defineAsyncComponent(() => import('@/components/AssetsPanel.vue'))
const WorkspaceProjectAssets = defineAsyncComponent(
  () => import('@/components/assets/WorkspaceProjectAssets.vue')
)
const NarratedTracePanel = defineAsyncComponent(
  () => import('@/components/narrated-trace/NarratedTracePanel.vue')
)

const {
  activationNonce,
  changes,
  comments,
  open,
  projectId,
  projectName,
  requestedSurface,
  selectedPath,
  threadId
} = defineProps<{
  activationNonce: number
  changes: AiTurnChanges | null
  comments: T3DiffReviewComment[]
  open: boolean
  projectId?: string
  projectName?: string
  requestedSurface: AgentRightPanelSurface
  selectedPath?: string
  threadId: string
}>()

const emit = defineEmits<{
  'add-comment': [comment: Omit<T3DiffReviewComment, 'id'>]
  close: []
  'delete-comment': [commentId: string]
  'surface-change': [surface: AgentRightPanelSurface]
  'select-file': [path: string]
}>()

const host = useTemplateRef<HTMLDivElement>('host')
const root = shallowRef<Root>()
const layersHost = shallowRef<HTMLElement | null>(null)
const assetsHost = shallowRef<HTMLElement | null>(null)
const activityHost = shallowRef<HTMLElement | null>(null)
const assetScope = ref<'global' | 'project'>('project')
const layerTreeRef = ref<InstanceType<typeof LayerTree> | null>(null)

function setSurfaceHost(surface: 'activity' | 'assets' | 'layers', element: HTMLDivElement | null) {
  if (surface === 'layers') layersHost.value = element
  else if (surface === 'assets') assetsHost.value = element
  else activityHost.value = element
}

async function revealInsertedAsset(nodeId: string) {
  openAgentRightPanel('layers', { projectId, projectName })
  await nextTick()
  layerTreeRef.value?.revealNode(nodeId)
}

function renderWorkspace() {
  root.value?.render(
    createElement(T3RightPanelWorkspace, {
      changes,
      comments,
      activationNonce,
      open,
      requestedSurface,
      selectedPath,
      threadId,
      onAddComment: (comment) => emit('add-comment', comment),
      onClose: () => emit('close'),
      onDeleteComment: (commentId) => emit('delete-comment', commentId),
      onSurfaceHostChange: setSurfaceHost,
      onSurfaceChange: (surface) => emit('surface-change', surface),
      onSelectFile: (path) => emit('select-file', path)
    })
  )
}

onMounted(() => {
  const element = host.value
  if (!element) return
  root.value = createRoot(element)
  renderWorkspace()
})

watchEffect(renderWorkspace)

onBeforeUnmount(() => {
  root.value?.unmount()
  root.value = undefined
})
</script>

<template>
  <Teleport to="body">
    <div ref="host" class="contents" data-test-id="t3-right-panel-island" />
  </Teleport>

  <Teleport v-if="layersHost" :to="layersHost">
    <section
      data-test-id="workspace-layers-surface"
      class="flex min-h-0 flex-1 flex-col overflow-hidden bg-agent-surface"
    >
      <header class="border-border/55 flex h-11 shrink-0 items-center gap-2 border-b px-4">
        <icon-lucide-layers-3 class="size-4 shrink-0 text-muted" />
        <div class="min-w-0 flex-1">
          <div class="truncate text-[12px] font-medium text-surface">
            {{ projectName || 'Current workspace' }}
          </div>
          <div class="truncate text-[9.5px] text-muted">Board layers</div>
        </div>
      </header>
      <LayerTree ref="layerTreeRef" data-test-id="workspace-layers-tree" />
    </section>
  </Teleport>

  <Teleport v-if="assetsHost" :to="assetsHost">
    <section
      data-test-id="workspace-assets-surface"
      class="flex min-h-0 flex-1 flex-col overflow-hidden bg-agent-surface"
    >
      <header class="border-border/55 flex h-11 shrink-0 items-center gap-2 border-b px-4">
        <icon-lucide-package-open class="size-4 shrink-0 text-muted" />
        <div class="min-w-0 flex-1">
          <div class="truncate text-[12px] font-medium text-surface">
            {{ projectName || 'Assets' }}
          </div>
          <div class="truncate text-[9.5px] text-muted">Reusable workspace items</div>
        </div>
      </header>
      <div
        class="bg-chrome-control mx-3 my-2 grid h-8 shrink-0 grid-cols-2 gap-0.5 rounded-[8px] p-0.5"
      >
        <button
          type="button"
          data-test-id="assets-scope-project"
          :aria-pressed="assetScope === 'project'"
          class="rounded-[6px] text-[11px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/20"
          :class="
            assetScope === 'project'
              ? 'bg-chrome-control-active text-surface shadow-sm'
              : 'text-muted hover:bg-hover hover:text-surface'
          "
          @click="assetScope = 'project'"
        >
          Project
        </button>
        <button
          type="button"
          data-test-id="assets-scope-global"
          :aria-pressed="assetScope === 'global'"
          class="rounded-[6px] text-[11px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/20"
          :class="
            assetScope === 'global'
              ? 'bg-chrome-control-active text-surface shadow-sm'
              : 'text-muted hover:bg-hover hover:text-surface'
          "
          @click="assetScope = 'global'"
        >
          Global
        </button>
      </div>
      <WorkspaceProjectAssets v-if="assetScope === 'project'" />
      <AssetsPanel v-else workspace scope="global" @asset-inserted="revealInsertedAsset" />
    </section>
  </Teleport>

  <Teleport v-if="activityHost" :to="activityHost">
    <section
      data-test-id="workspace-activity-surface"
      class="flex min-h-0 flex-1 flex-col overflow-hidden bg-agent-surface"
    >
      <header class="border-border/55 flex h-11 shrink-0 items-center gap-2 border-b px-4">
        <icon-lucide-activity class="size-4 shrink-0 text-muted" />
        <div class="min-w-0 flex-1">
          <div class="truncate text-[12px] font-medium text-surface">Activity</div>
          <div class="truncate text-[9.5px] text-muted">Workspace changes and agent events</div>
        </div>
      </header>
      <NarratedTracePanel />
    </section>
  </Teleport>
</template>
