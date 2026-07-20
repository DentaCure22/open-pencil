<script setup lang="ts">
import { computed, onMounted } from 'vue'

import {
  liveInspectorRoute,
  previewLiveInspectorDraft,
  selectLiveInspectorNode
} from '@/app/smylr-live-inspector/session'
import {
  archiveLiveWorkspaceItem,
  liveWorkspaceLifecycleLabel,
  liveWorkspaceItems,
  liveWorkspaceSelectedItemId,
  restoreLiveWorkspace,
  selectLiveWorkspaceItem,
  workspaceItemPatches,
  type LiveWorkspaceItem,
  type LiveWorkspaceItemKind
} from '@/app/smylr-live-inspector/workspace'
import Tip from '@/components/ui/Tip.vue'

const groups: Array<{ kind: LiveWorkspaceItemKind; label: string }> = [
  { kind: 'draft', label: 'Drafts' },
  { kind: 'variant', label: 'Variants' },
  { kind: 'flow', label: 'Flows' },
  { kind: 'review', label: 'Review' },
  { kind: 'change-set', label: 'Change Sets' },
  { kind: 'archived', label: 'Archived' }
]

const routeItems = computed(() =>
  liveWorkspaceItems.value.filter((item) => item.route === liveInspectorRoute.value)
)

function itemsFor(kind: LiveWorkspaceItemKind) {
  return routeItems.value.filter((item) => item.kind === kind)
}

function openItem(item: LiveWorkspaceItem) {
  selectLiveWorkspaceItem(item.id)
  for (const patch of workspaceItemPatches(item)) {
    previewLiveInspectorDraft(patch, { label: `Open ${item.name}` })
  }
  selectLiveInspectorNode(item.nodeId)
}

function archiveItem(item: LiveWorkspaceItem) {
  archiveLiveWorkspaceItem(item.id)
}

onMounted(() => void restoreLiveWorkspace())
</script>

<template>
  <div data-test-id="smylr-live-workspaces" class="min-h-0 overflow-y-auto px-2 pb-2">
    <div class="flex items-center px-1 py-1.5">
      <span class="flex-1 text-[10px] tracking-wider text-muted uppercase">Workspaces</span>
      <span class="text-[9px] text-muted">{{ routeItems.length }}</span>
    </div>
    <p v-if="routeItems.length === 0" class="px-1 py-2 text-[10px] leading-relaxed text-muted">
      Edit a live container, then use its header Save menu to preserve a draft, variant, flow state,
      or change set.
    </p>
    <template v-for="group in groups" :key="group.kind">
      <section v-if="itemsFor(group.kind).length" class="mb-2">
        <header class="px-1 py-1 text-[9px] font-medium text-muted">{{ group.label }}</header>
        <div
          v-for="item in itemsFor(group.kind)"
          :key="item.id"
          role="button"
          tabindex="0"
          class="group flex w-full cursor-pointer items-center gap-2 rounded px-1.5 py-1.5 text-left hover:bg-hover"
          :class="liveWorkspaceSelectedItemId === item.id ? 'bg-hover' : ''"
          @click="openItem(item)"
          @keydown.enter="openItem(item)"
        >
          <span
            class="size-1.5 shrink-0 rounded-full"
            :class="
              item.status === 'approved'
                ? 'bg-green-500'
                : item.status === 'in-review'
                  ? 'bg-amber-400'
                  : 'bg-accent'
            "
          />
          <span class="min-w-0 flex-1">
            <span class="block truncate text-[10px] text-surface">{{ item.name }}</span>
            <span class="block truncate text-[8px] text-muted"
              >{{ liveWorkspaceLifecycleLabel(item) }} · {{ item.nodeId }}</span
            >
          </span>
          <Tip v-if="item.kind !== 'archived'" label="Archive">
            <button
              class="hidden rounded p-1 text-muted hover:text-surface group-hover:block"
              aria-label="Archive"
              @click.stop="archiveItem(item)"
            >
              <icon-lucide-archive class="size-3" />
            </button>
          </Tip>
        </div>
      </section>
    </template>
  </div>
</template>
