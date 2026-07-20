<script setup lang="ts">
import { computed, onMounted } from 'vue'

import {
  liveInspectorRoute,
  previewLiveInspectorDraft,
  selectLiveInspectorNode
} from '@/app/smylr-live-inspector/session'
import {
  liveWorkspaceItems,
  liveWorkspaceSelectedItemId,
  restoreLiveWorkspace,
  selectLiveWorkspaceItem,
  workspaceItemPatches,
  type LiveWorkspaceItem,
  type LiveWorkspaceItemKind
} from '@/app/smylr-live-inspector/workspace'

const laneOrder: LiveWorkspaceItemKind[] = [
  'draft',
  'variant',
  'flow',
  'review',
  'change-set',
  'archived'
]

const laneLabel: Record<LiveWorkspaceItemKind, string> = {
  archived: 'Archived',
  'change-set': 'Approved',
  draft: 'Drafts',
  flow: 'Flows',
  review: 'Review',
  variant: 'Variants'
}

const routeItems = computed(() =>
  liveWorkspaceItems.value.filter((item) => item.route === liveInspectorRoute.value)
)

const activeLanes = computed(() =>
  laneOrder
    .map((kind) => ({
      items: routeItems.value.filter((item) => item.kind === kind),
      kind,
      label: laneLabel[kind]
    }))
    .filter((lane) => lane.items.length > 0)
)

function openItem(item: LiveWorkspaceItem) {
  selectLiveWorkspaceItem(item.id)
  for (const patch of workspaceItemPatches(item)) {
    previewLiveInspectorDraft(patch, { label: `Open ${item.name}` })
  }
  selectLiveInspectorNode(item.nodeId)
}

onMounted(() => void restoreLiveWorkspace())
</script>

<template>
  <aside
    v-if="activeLanes.length"
    data-test-id="smylr-live-workspace-canvas"
    class="pointer-events-auto absolute top-5 right-5 z-20 flex max-w-[70%] items-start gap-2 overflow-x-auto rounded-xl border border-border bg-panel/90 p-2 shadow-xl backdrop-blur"
    @pointerdown.stop
    @wheel.stop
  >
    <section v-for="lane in activeLanes" :key="lane.kind" class="w-40 shrink-0">
      <header class="flex items-center px-1 py-1 text-[9px] tracking-wider text-muted uppercase">
        <span class="flex-1">{{ lane.label }}</span>
        <span>{{ lane.items.length }}</span>
      </header>
      <button
        v-for="item in lane.items"
        :key="item.id"
        class="mb-1.5 block w-full rounded-lg border bg-surface/95 p-2 text-left shadow-sm transition-colors hover:border-accent"
        :class="liveWorkspaceSelectedItemId === item.id ? 'border-accent' : 'border-border'"
        @click="openItem(item)"
      >
        <span class="mb-1 flex items-center gap-1.5">
          <span
            class="size-1.5 rounded-full"
            :class="
              item.status === 'approved'
                ? 'bg-green-500'
                : item.status === 'in-review'
                  ? 'bg-amber-400'
                  : 'bg-accent'
            "
          />
          <strong class="min-w-0 flex-1 truncate text-[10px] font-medium">{{ item.name }}</strong>
        </span>
        <span class="block truncate text-[8px] text-muted">{{ item.note || item.nodeId }}</span>
      </button>
    </section>
  </aside>
</template>
