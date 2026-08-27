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
import type { AgentTodoDraft } from '@/app/agent-chat/conversations'
import type { AgentWorkMapInboxItem, AgentWorkMapTodo } from '@/app/agent-chat/work-map'
import BoardObjectPanelSurface from '@/components/agent-chat/BoardObjectPanelSurface.vue'
import InboxBriefingObjectSurface from '@/components/agent-chat/InboxBriefingObjectSurface.vue'
import TodoObjectSurface from '@/components/agent-chat/TodoObjectSurface.vue'
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
  inboxBriefing,
  inboxTitle,
  open,
  objectId,
  projectId,
  projectName,
  requestedSurface,
  selectedPath,
  showReopen,
  threadId,
  todo,
  todoDraft,
  todoThreadId
} = defineProps<{
  activationNonce: number
  changes: AiTurnChanges | null
  comments: T3DiffReviewComment[]
  inboxBriefing?: NonNullable<AgentWorkMapInboxItem['briefing']>
  inboxTitle?: string
  open: boolean
  objectId?: string
  projectId?: string
  projectName?: string
  requestedSurface: AgentRightPanelSurface
  selectedPath?: string
  showReopen: boolean
  threadId: string
  todo: AgentWorkMapTodo | null
  todoDraft: AgentTodoDraft | null
  todoThreadId: string
}>()

const emit = defineEmits<{
  'add-comment': [comment: Omit<T3DiffReviewComment, 'id'>]
  close: []
  'delete-comment': [commentId: string]
  'open-related-chat': []
  'todo-saved': []
  'surface-change': [surface: AgentRightPanelSurface]
  'select-file': [path: string]
  open: []
}>()

const host = useTemplateRef<HTMLDivElement>('host')
const root = shallowRef<Root>()
const layersHost = shallowRef<HTMLElement | null>(null)
const assetsHost = shallowRef<HTMLElement | null>(null)
const activityHost = shallowRef<HTMLElement | null>(null)
const objectHost = shallowRef<HTMLElement | null>(null)
const assetScope = ref<'global' | 'project'>('project')
const assetQuery = ref('')
const layerTreeRef = ref<InstanceType<typeof LayerTree> | null>(null)

function setSurfaceHost(
  surface: 'activity' | 'assets' | 'layers' | 'object',
  element: HTMLDivElement | null
) {
  if (surface === 'layers') layersHost.value = element
  else if (surface === 'assets') assetsHost.value = element
  else if (surface === 'activity') activityHost.value = element
  else objectHost.value = element
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
      showReopen,
      requestedSurface,
      selectedPath,
      threadId,
      onAddComment: (comment) => emit('add-comment', comment),
      onClose: () => emit('close'),
      onOpen: () => emit('open'),
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
      <LayerTree ref="layerTreeRef" data-test-id="workspace-layers-tree" />
    </section>
  </Teleport>

  <Teleport v-if="assetsHost" :to="assetsHost">
    <section
      data-test-id="workspace-assets-surface"
      class="flex min-h-0 flex-1 flex-col overflow-hidden bg-agent-surface"
    >
      <div class="flex h-10 shrink-0 items-center gap-2 px-3 py-1.5">
        <label class="relative min-w-0 flex-1">
          <icon-lucide-search
            class="pointer-events-none absolute top-1/2 left-2.5 size-3 -translate-y-1/2 text-muted/65"
          />
          <input
            v-model="assetQuery"
            type="search"
            :data-test-id="assetScope === 'project' ? 'project-assets-search' : 'assets-search'"
            :aria-label="assetScope === 'project' ? 'Search project assets' : 'Search assets'"
            placeholder="Search assets"
            class="border-chrome-control-border h-7 w-full rounded-[7px] border bg-transparent pr-2.5 pl-7 text-[10.5px] text-surface outline-none transition-colors placeholder:text-muted/65 focus:border-accent/40"
          />
        </label>
        <div class="bg-chrome-control flex h-7 shrink-0 items-center gap-0.5 rounded-[8px] p-0.5">
          <button
            type="button"
            data-test-id="assets-scope-project"
            :aria-pressed="assetScope === 'project'"
            class="h-6 rounded-[6px] px-2.5 text-[10.5px] font-medium transition-[background-color,color,box-shadow] outline-none focus-visible:ring-2 focus-visible:ring-accent/20"
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
            class="h-6 rounded-[6px] px-2.5 text-[10.5px] font-medium transition-[background-color,color,box-shadow] outline-none focus-visible:ring-2 focus-visible:ring-accent/20"
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
      </div>
      <WorkspaceProjectAssets v-if="assetScope === 'project'" v-model:query="assetQuery" />
      <AssetsPanel
        v-else
        v-model:query="assetQuery"
        workspace
        scope="global"
        @asset-inserted="revealInsertedAsset"
      />
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

  <Teleport v-if="objectHost" :to="objectHost">
    <InboxBriefingObjectSurface
      v-if="inboxBriefing"
      :briefing="inboxBriefing"
      :title="inboxTitle || inboxBriefing.title"
      @open-related-chat="emit('open-related-chat')"
    />
    <BoardObjectPanelSurface v-else-if="objectId" :object-id="objectId" />
    <TodoObjectSurface
      v-else
      :draft="todoDraft"
      :thread-id="todoThreadId"
      :todo="todo"
      @open-related-chat="emit('open-related-chat')"
      @saved="emit('todo-saved')"
    />
  </Teleport>
</template>
