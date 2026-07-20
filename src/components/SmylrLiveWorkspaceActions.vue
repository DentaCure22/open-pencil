<script setup lang="ts">
import { computed, ref } from 'vue'

import type { SmylrLiveContainerNode } from '@/app/smylr-live-container/types'
import type { LiveInspectorPatchDraft } from '@/app/smylr-live-inspector/patch'
import { liveInspectorRoute } from '@/app/smylr-live-inspector/session'
import {
  liveWorkspaceLifecycleLabel,
  liveWorkspaceItems,
  requestLiveWorkspacePreview,
  saveLiveWorkspaceItem
} from '@/app/smylr-live-inspector/workspace'
import IconButton from '@/components/ui/IconButton.vue'

const { draft, node } = defineProps<{
  draft: LiveInspectorPatchDraft | null
  node: SmylrLiveContainerNode
}>()

const open = ref(false)
type LiveWorkspaceSaveKind = 'draft' | 'variant'

const saveActions: Array<{ kind: LiveWorkspaceSaveKind; label: string }> = [
  { kind: 'draft', label: 'Save Draft' },
  { kind: 'variant', label: 'Save as Alternate' }
]

const createKind = ref<LiveWorkspaceSaveKind | null>(null)
const name = ref('')

const savedItems = computed(() =>
  liveWorkspaceItems.value.filter(
    (item) => item.nodeId === node.id && item.route === liveInspectorRoute.value
  )
)

const statusLabel = computed(() => {
  const latest = savedItems.value.at(-1)
  if (draft) return latest ? `${latest.kind} · changed` : 'Draft · changed'
  return latest ? `${liveWorkspaceLifecycleLabel(latest)} · saved` : 'Production'
})

function start(kind: LiveWorkspaceSaveKind) {
  if (!draft || !liveInspectorRoute.value) return
  createKind.value = kind
  name.value = kind === 'draft' ? `${node.label} draft` : `${node.label} alternate`
}

function save() {
  if (!createKind.value || !draft || !liveInspectorRoute.value || !name.value.trim()) return
  const item = saveLiveWorkspaceItem({
    kind: createKind.value,
    name: name.value.trim(),
    nodeId: node.id,
    note: node.label,
    patch: draft,
    route: liveInspectorRoute.value,
    status: createKind.value === 'variant' ? 'unmerged' : 'active'
  })
  requestLiveWorkspacePreview(item.id)
  createKind.value = null
  open.value = false
}
</script>

<template>
  <span data-test-id="smylr-live-workspace-status" class="max-w-28 truncate text-[9px] text-muted">
    {{ statusLabel }}
  </span>
  <div class="relative">
    <IconButton
      label="Save and organize this container"
      data-test-id="smylr-live-workspace-menu"
      @click="open = !open"
    >
      <icon-lucide-save class="size-3.5" />
    </IconButton>
    <div
      v-if="open"
      data-test-id="smylr-live-workspace-popover"
      class="bg-panel absolute top-7 right-0 z-50 w-56 rounded-lg border border-border p-1.5 shadow-xl"
      @pointerdown.stop
    >
      <template v-if="createKind">
        <label class="block px-1 pb-1 text-[9px] tracking-wide text-muted uppercase">
          {{ createKind }} name
        </label>
        <input
          v-model="name"
          data-test-id="smylr-live-workspace-name"
          class="bg-surface mb-1.5 w-full rounded border border-border px-2 py-1.5 text-[11px] outline-none focus:border-accent"
          @keydown.enter.prevent="save"
          @keydown.esc="createKind = null"
        />
        <div class="flex justify-end gap-1">
          <button
            class="rounded px-2 py-1 text-[10px] text-muted hover:bg-hover"
            @click="createKind = null"
          >
            Back
          </button>
          <button
            data-test-id="smylr-live-workspace-confirm"
            class="rounded bg-accent px-2 py-1 text-[10px] text-white disabled:opacity-40"
            :disabled="!name.trim()"
            @click="save"
          >
            Save
          </button>
        </div>
      </template>
      <template v-else>
        <p v-if="!draft" class="px-2 py-1.5 text-[10px] leading-relaxed text-muted">
          Make an edit first. Live edits stay immediate; these actions preserve and organize a
          snapshot.
        </p>
        <button
          v-for="action in saveActions"
          :key="action.kind"
          class="flex w-full items-center rounded px-2 py-1.5 text-left text-[11px] hover:bg-hover disabled:cursor-default disabled:opacity-35"
          :disabled="!draft"
          :data-test-id="`smylr-live-${action.kind}`"
          @click="start(action.kind)"
        >
          {{ action.label }}
        </button>
      </template>
    </div>
  </div>
</template>
