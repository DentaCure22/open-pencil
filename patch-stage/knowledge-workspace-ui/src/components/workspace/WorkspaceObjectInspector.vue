<script setup lang="ts">
import { computed } from 'vue'

import type { WorkspaceObject, WorkspaceViewKind } from '@/app/workspace'
import AppInput from '@/components/ui/AppInput.vue'
import AppTextButton from '@/components/ui/AppTextButton.vue'
import PanelSection from '@/components/ui/PanelSection.vue'

import WorkspaceStatusBadge from './WorkspaceStatusBadge.vue'

const { object, viewKind } = defineProps<{
  object: WorkspaceObject
  viewKind: WorkspaceViewKind
}>()

const emit = defineEmits<{
  activateLive: []
  archive: []
  connect: []
  createRecord: []
  sendReview: []
  updateLabel: [value: string]
}>()

const title = computed(() => {
  if (object.type === 'document-block') return object.text || 'Untitled block'
  if (object.type === 'collection' || object.type === 'saved-view') return object.name
  if (object.type === 'collection-record') return object.title
  if (object.type === 'graph-node' || object.type === 'design-artifact') return object.label
  if (object.type === 'graph-edge') return object.label || object.relationshipType
  if (object.type === 'live-app-block') return object.route
  if (object.type === 'review-object') return object.body || object.reviewKind
  if (object.type === 'canvas-object') return object.label || object.canvasKind
  return 'Workspace object'
})

const editableLabel = computed({
  get: () => title.value,
  set: (value: string) => emit('updateLabel', value)
})
</script>

<template>
  <div
    data-test-id="workspace-object-inspector"
    class="scrollbar-thin min-h-0 flex-1 overflow-x-hidden overflow-y-auto pb-4"
  >
    <header class="flex items-start gap-2 border-b border-border px-3 py-2.5">
      <span
        class="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-hover text-muted"
      >
        <icon-lucide-file-text v-if="object.type === 'document-block'" class="size-3.5" />
        <icon-lucide-table-2
          v-else-if="object.type === 'collection' || object.type === 'collection-record'"
          class="size-3.5"
        />
        <icon-lucide-waypoints
          v-else-if="object.type === 'graph-node' || object.type === 'graph-edge'"
          class="size-3.5"
        />
        <icon-lucide-monitor-dot v-else-if="object.type === 'live-app-block'" class="size-3.5" />
        <icon-lucide-message-square-check
          v-else-if="object.type === 'review-object'"
          class="size-3.5"
        />
        <icon-lucide-component v-else class="size-3.5" />
      </span>
      <span class="min-w-0 flex-1">
        <strong class="block truncate text-[11px] font-semibold text-surface">{{ title }}</strong>
        <span class="block truncate text-[9px] text-muted">{{ object.type }} · {{ viewKind }}</span>
      </span>
      <WorkspaceStatusBadge
        v-if="object.type === 'live-app-block'"
        :status="object.runtime.status"
      />
      <WorkspaceStatusBadge
        v-else-if="object.type === 'review-object'"
        :status="object.reviewStatus"
      />
    </header>

    <PanelSection label="Content">
      <AppInput v-model="editableLabel" size="sm" data-test-id="workspace-object-label" />
      <div class="mt-2 flex items-center justify-between text-[9px] text-muted">
        <span>Stable ID</span>
        <code class="max-w-40 truncate">{{ object.id }}</code>
      </div>
    </PanelSection>

    <PanelSection v-if="object.type === 'collection'" label="Collection">
      <div class="space-y-1 text-[10px] text-muted">
        <div class="flex justify-between">
          <span>Properties</span><span>{{ object.properties.length }}</span>
        </div>
        <div class="flex justify-between">
          <span>Records</span><span>{{ object.recordIds.length }}</span>
        </div>
      </div>
      <button
        data-test-id="workspace-collection-new-record"
        type="button"
        class="mt-2 h-7 w-full rounded-md bg-hover text-[10px] text-surface hover:bg-accent hover:text-white"
        @click="emit('createRecord')"
      >
        + New record
      </button>
    </PanelSection>

    <PanelSection
      v-if="object.type === 'graph-node' || object.type === 'graph-edge'"
      label="Relationships"
    >
      <AppTextButton data-test-id="workspace-connect-relation" @click="emit('connect')">
        Connect to…
      </AppTextButton>
    </PanelSection>

    <PanelSection v-if="object.type === 'live-app-block'" label="Live application">
      <dl class="grid grid-cols-[72px_1fr] gap-x-2 gap-y-1 text-[9px]">
        <dt class="text-muted">Route</dt>
        <dd class="truncate text-surface">{{ object.route }}</dd>
        <dt class="text-muted">Environment</dt>
        <dd class="truncate text-surface">{{ object.environment }}</dd>
        <dt class="text-muted">Revision</dt>
        <dd class="truncate text-surface">{{ object.sourceRevision }}</dd>
        <dt class="text-muted">Viewport</dt>
        <dd class="text-surface">{{ object.viewport.width }} × {{ object.viewport.height }}</dd>
      </dl>
      <button
        data-test-id="workspace-activate-live-app"
        type="button"
        class="mt-2 h-7 w-full rounded-md bg-accent text-[10px] text-white hover:bg-accent/90"
        @click="emit('activateLive')"
      >
        {{ object.runtime.status === 'live' ? 'Live now' : 'Open live on Canvas' }}
      </button>
    </PanelSection>

    <PanelSection label="Review">
      <button
        data-test-id="workspace-send-review"
        type="button"
        class="h-7 w-full rounded-md bg-hover text-[10px] text-surface hover:bg-accent hover:text-white"
        @click="emit('sendReview')"
      >
        Send to Review
      </button>
    </PanelSection>

    <div class="px-3 pt-3">
      <AppTextButton size="xs" @click="emit('archive')">Archive object</AppTextButton>
    </div>
  </div>
</template>
