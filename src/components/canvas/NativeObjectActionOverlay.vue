<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

import type { SceneNode } from '@open-pencil/scene-graph'

import { openAgentRightPanel } from '@/app/agent-chat/right-panel'
import { cachedCodeObjectDocument } from '@/app/code-object/overlays'
import { codeObjectScreenOverlayStyle } from '@/app/code-object/transform'
import { useEditorStore } from '@/app/editor/active-store'
import {
  useEditorOverlayGeometryVersion,
  useEditorPresentationViewport
} from '@/app/editor/presentation'

const HOVER_GRACE_MS = 180

const store = useEditorStore()
const presentationViewport = useEditorPresentationViewport(store)
const geometryVersion = useEditorOverlayGeometryVersion(store)
const hoveredId = ref<string | null>(null)
const selectedId = ref<string | null>(null)
const pointerInsideAction = ref(false)
const syncTick = ref(0)
let clearHoverTimer: ReturnType<typeof setTimeout> | null = null
let unsubscribe: Array<() => void> = []

function nativeObject(id: string | null): SceneNode | null {
  if (!id) return null
  const node = store.graph.getNode(id)
  if (!node || node.type === 'CANVAS' || cachedCodeObjectDocument(node) || !node.visible)
    return null
  return node
}

function cancelClearHover() {
  if (clearHoverTimer === null) return
  clearTimeout(clearHoverTimer)
  clearHoverTimer = null
}

function clearHoverAfterGrace() {
  cancelClearHover()
  clearHoverTimer = setTimeout(() => {
    clearHoverTimer = null
    if (!pointerInsideAction.value) hoveredId.value = null
  }, HOVER_GRACE_MS)
}

function syncSelection() {
  selectedId.value =
    store.state.selectedIds.size === 1 ? ([...store.state.selectedIds][0] ?? null) : null
}

function syncHover(nodeId: string | null) {
  if (nativeObject(nodeId)) {
    cancelClearHover()
    hoveredId.value = nodeId
    return
  }
  if (!pointerInsideAction.value) clearHoverAfterGrace()
}

function refresh() {
  syncTick.value += 1
  syncSelection()
  if (hoveredId.value && !nativeObject(hoveredId.value)) hoveredId.value = null
}

function holdAction() {
  pointerInsideAction.value = true
  cancelClearHover()
}

function releaseAction() {
  pointerInsideAction.value = false
  if (store.state.hoveredNodeId !== hoveredId.value) clearHoverAfterGrace()
}

const node = computed(() => {
  void syncTick.value
  return nativeObject(hoveredId.value) ?? nativeObject(selectedId.value)
})

const overlayStyle = computed(() => {
  void geometryVersion.value.revision
  const current = node.value
  return current
    ? codeObjectScreenOverlayStyle(store, current, presentationViewport.value)
    : undefined
})

function openObject() {
  const current = node.value
  if (!current) return
  openAgentRightPanel('object', { objectId: current.id })
}

onMounted(() => {
  syncSelection()
  syncHover(store.state.hoveredNodeId)
  unsubscribe = [
    store.onEditorEvent('selection:changed', syncSelection),
    store.onEditorEvent('hover:changed', syncHover),
    store.onEditorEvent('graph:replaced', refresh),
    store.onEditorEvent('page:changed', refresh),
    store.onEditorEvent('node:created', refresh),
    store.onEditorEvent('node:deleted', refresh),
    store.onEditorEvent('node:reparented', refresh),
    store.onEditorEvent('node:updated', refresh)
  ]
})

onUnmounted(() => {
  cancelClearHover()
  for (const stop of unsubscribe) stop()
  unsubscribe = []
})
</script>

<template>
  <div
    v-if="node && overlayStyle"
    class="pointer-events-none absolute top-0 left-0 z-[12]"
    :style="overlayStyle"
    :data-object-action-node-id="node.id"
    data-test-id="native-object-action-overlay"
  >
    <button
      type="button"
      class="border-chrome-control-border bg-chrome-raised/95 pointer-events-auto absolute -top-5 left-0 flex size-6 items-center justify-center rounded-[6px] border text-muted shadow-md backdrop-blur-sm transition-colors hover:bg-hover hover:text-surface focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-component"
      :aria-label="`Open ${node.name} in Object panel`"
      :title="`Open ${node.name}`"
      data-test-id="open-native-object"
      @pointerenter="holdAction"
      @pointerleave="releaseAction"
      @pointerdown.stop
      @click.stop="openObject"
    >
      <icon-lucide-panel-right-open class="size-3.5 stroke-[1.7]" />
    </button>
  </div>
</template>
