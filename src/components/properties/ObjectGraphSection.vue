<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'

import {
  objectGraphConnectionForSelection,
  type ObjectGraphConnectionKind
} from '@open-pencil/scene-graph'
import { useSelectionState } from '@open-pencil/vue'

import { useEditorStore } from '@/app/editor/active-store'
import {
  connectObjects,
  disconnectObjects,
  objectConnectionsForNode,
  objectGraphConnectionName,
  objectGraphNodesOnPage
} from '@/app/object-graph'
import AppSelect from '@/components/ui/AppSelect.vue'
import PanelSection from '@/components/ui/PanelSection.vue'

const store = useEditorStore()
const { selectedIds, selectedNode } = useSelectionState()
const revision = ref(0)
const kind = ref<ObjectGraphConnectionKind>('action')
const targetId = ref('')

const selectedId = computed(() => selectedNode.value?.id ?? '')
const selectedConnection = computed(() => {
  void revision.value
  return objectGraphConnectionForSelection(
    store.graph,
    store.state.currentPageId,
    selectedIds.value
  )
})
const selectedConnectionName = computed(() =>
  selectedConnection.value ? objectGraphConnectionName(store.graph, selectedConnection.value) : ''
)
const targetOptions = computed(() => {
  void revision.value
  const id = selectedId.value
  if (!id || selectedConnection.value) return []
  return objectGraphNodesOnPage(store.graph, store.state.currentPageId)
    .filter((node) => node.id !== id)
    .map((node) => ({ label: node.name, value: node.id }))
    .sort((left, right) => left.label.localeCompare(right.label))
})
const connections = computed(() => {
  void revision.value
  return selectedId.value && !selectedConnection.value
    ? objectConnectionsForNode(store, selectedId.value)
    : []
})

watch(
  targetOptions,
  (options) => {
    if (!options.some((option) => option.value === targetId.value)) {
      targetId.value = options[0]?.value ?? ''
    }
  },
  { immediate: true }
)

function bumpRevision(): void {
  revision.value += 1
}

function connect(): void {
  if (!selectedId.value || !targetId.value) return
  if (
    connectObjects(store, {
      kind: kind.value,
      sourceNodeId: selectedId.value,
      targetNodeId: targetId.value
    })
  ) {
    bumpRevision()
  }
}

function disconnect(connectionId: string): void {
  if (disconnectObjects(store, connectionId)) bumpRevision()
}

const unsubscribe = store.objectGraph.subscribe(bumpRevision)

onUnmounted(() => {
  unsubscribe()
})
</script>

<template>
  <PanelSection v-if="selectedConnection" label="Connection" data-test-id="object-graph-section">
    <button
      class="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-[11px] text-muted hover:bg-hover hover:text-surface"
      data-test-id="object-graph-remove-selected"
      @click="disconnect(selectedConnection.id)"
    >
      <span class="truncate">{{ selectedConnectionName }}</span>
      <icon-lucide-unlink class="size-3.5 shrink-0" />
    </button>
  </PanelSection>

  <PanelSection v-else-if="selectedNode" label="Connections" data-test-id="object-graph-section">
    <div class="flex flex-col gap-2">
      <div class="text-[9px] leading-3.5 text-muted/70">
        Every object can connect. Hover it on the Board to reveal its ports.
      </div>

      <div v-if="targetOptions.length > 0" class="flex flex-col gap-1">
        <div class="text-[9px] font-medium text-muted/70">Add connection</div>
        <div class="flex gap-1">
          <AppSelect
            v-model="kind"
            class="w-24"
            data-test-id="object-graph-kind"
            label="Connection kind"
            :options="[
              { label: 'Action', value: 'action' },
              { label: 'Data', value: 'data' },
              { label: 'Visual', value: 'visual' }
            ]"
          />
          <AppSelect
            v-model="targetId"
            class="min-w-0 flex-1"
            data-test-id="object-graph-target"
            label="Target object"
            :options="targetOptions"
          />
          <button
            class="grid size-7 shrink-0 place-items-center rounded bg-accent text-white hover:bg-accent/90"
            data-test-id="object-graph-connect"
            @click="connect"
          >
            <icon-lucide-link-2 class="size-3.5" />
          </button>
        </div>
      </div>

      <div v-if="connections.length > 0" class="flex flex-col gap-1">
        <div
          v-for="item in connections"
          :key="item.nodeId"
          class="flex items-center gap-1.5 rounded bg-white/[0.035] px-2 py-1.5 text-[10px]"
          :data-test-id="`object-graph-connection-${item.nodeId}`"
        >
          <span
            class="rounded px-1 py-0.5 font-semibold uppercase"
            :class="
              item.connection.kind === 'action'
                ? 'bg-violet-400/15 text-violet-300'
                : item.connection.kind === 'data'
                  ? 'bg-cyan-400/15 text-cyan-300'
                  : 'bg-white/10 text-muted'
            "
          >
            {{ item.connection.kind }}
          </span>
          <span class="min-w-0 flex-1 truncate text-muted">
            {{ item.outgoing ? 'to' : 'from' }} {{ item.peerName }}
          </span>
          <button
            class="grid size-5 shrink-0 place-items-center rounded text-muted hover:bg-hover hover:text-surface"
            :data-test-id="`object-graph-disconnect-${item.nodeId}`"
            @click="disconnect(item.nodeId)"
          >
            <icon-lucide-x class="size-3" />
          </button>
        </div>
      </div>
    </div>
  </PanelSection>
</template>
