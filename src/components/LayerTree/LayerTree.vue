<script setup lang="ts">
import { onUnmounted, provide, ref, useAttrs, watch } from 'vue'
import {
  TreeItem,
  TreeVirtualizer,
  ContextMenuRoot,
  ContextMenuTrigger,
  ContextMenuPortal
} from 'reka-ui'

import {
  LAYER_TREE_HOST_BRIDGE_KEY,
  LayerTreeRoot,
  LayerTreeItem,
  useInlineRename
} from '@open-pencil/vue'
import type { LayerDragInstruction, LayerNode } from '@open-pencil/vue'
import { useEditorStore } from '@/app/editor/active-store'
import {
  bumpLiveLayerTreeVersion,
  createSmylrLiveLayerTreeBridge,
  fromLiveLayerId
} from '@/app/smylr-live-inspector/layer-bridge'
import {
  liveInspectorDocument,
  liveInspectorHoveredId,
  liveInspectorPendingSelectedId,
  liveInspectorSelectedId
} from '@/app/smylr-live-inspector/session'
import CanvasMenu from '../canvas/CanvasMenu.vue'
import LayerTreeNodeRow from './LayerTreeNodeRow.vue'
import LayerTreeRenameRow from './LayerTreeRenameRow.vue'

// One layers system: design graph + live app containers (virtual children).
const liveLayerBridge = createSmylrLiveLayerTreeBridge()
provide(LAYER_TREE_HOST_BRIDGE_KEY, liveLayerBridge)
// Rebuild on stable root or selection identity changes. A selected descendant
// can replace the captured path while the page root id stays unchanged.
watch(
  () =>
    [
      liveInspectorDocument.value?.tree?.id ?? null,
      liveInspectorSelectedId.value,
      liveInspectorPendingSelectedId.value
    ] as const,
  () => bumpLiveLayerTreeVersion()
)

interface LayerTreeRootActions {
  collapseAll: () => void
  expandAll: () => void
  select: (id: string, additive: boolean) => void
  toggleExpand: (id: string) => void
}

interface LayerTreeSlotScope {
  actions: LayerTreeRootActions
  draggingId: string | null
  instruction: LayerDragInstruction | null
  instructionTargetId: string | null
}

defineOptions({ inheritAttrs: false })

const INDENT = 16
const VISIBLE_BASELINE_LEVEL = 4
const attrs = useAttrs()
const emit = defineEmits<{ toolsOpened: [] }>()
const store = useEditorStore()
const layerFilter = ref('')
const showTreeTools = ref(false)
const layersScrollRef = ref<HTMLElement | null>(null)
const indentRebaseLevel = ref(0)
let indentRebaseFrame = 0
const rename = useInlineRename((id, name) => store.renameNode(id, name))
const renameControls = {
  commit: rename.commit,
  onKeydown: rename.onKeydown,
  focusInput: rename.focusInput
}

function onLayerRightClick(e: MouseEvent) {
  const row = (e.target as HTMLElement).closest<HTMLElement>('[data-node-id]')
  if (!row?.dataset.nodeId) return
  // Live (virtual) rows use their own selection path — skip scene select.
  if (row.dataset.nodeId.startsWith('live:')) return
  if (!store.state.selectedIds.has(row.dataset.nodeId)) store.select([row.dataset.nodeId])
}

function isAdditiveSelect(e: CustomEvent): boolean {
  const mouseEvent = e.detail?.originalEvent as MouseEvent | undefined
  return !!(mouseEvent?.shiftKey || mouseEvent?.metaKey || mouseEvent?.ctrlKey)
}

function onTreeSelect(e: CustomEvent, id: string, select: (id: string, additive: boolean) => void) {
  e.preventDefault()
  select(id, isAdditiveSelect(e))
}

function hoverLayer(layerId: string) {
  const liveId = fromLiveLayerId(layerId)
  if (liveId) {
    liveInspectorHoveredId.value = liveId
    return
  }
  if (store.graph.getNode(layerId)) store.setHoveredNode(layerId)
}

function unhoverLayer(layerId: string) {
  const liveId = fromLiveLayerId(layerId)
  if (liveId) {
    if (liveInspectorHoveredId.value === liveId) liveInspectorHoveredId.value = null
    return
  }
  if (store.state.hoveredNodeId === layerId) store.setHoveredNode(null)
}

function isLayerNode(value: unknown): value is LayerNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'name' in value &&
    'type' in value &&
    'layoutMode' in value &&
    'visible' in value &&
    'locked' in value &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.type === 'string' &&
    typeof value.layoutMode === 'string' &&
    typeof value.visible === 'boolean' &&
    typeof value.locked === 'boolean'
    // virtual is optional
  )
}

function toLayerNode(value: unknown): LayerNode {
  if (isLayerNode(value)) return value
  throw new Error('[open-pencil] Invalid layer tree item')
}

function layerTextContent(value: unknown): string {
  return toLayerNode(value).name
}

function runTreeTool(action: () => void) {
  action()
  showTreeTools.value = false
}

function toggleTreeTools() {
  showTreeTools.value = !showTreeTools.value
  if (showTreeTools.value) emit('toolsOpened')
}

function closeTreeTools() {
  showTreeTools.value = false
}

defineExpose({ closeTreeTools })

function chrome(scope: Omit<LayerTreeSlotScope, 'actions'>) {
  return {
    draggingId: scope.draggingId,
    instruction: scope.instruction,
    instructionTargetId: scope.instructionTargetId,
    indent: INDENT,
    indentRebaseLevel: indentRebaseLevel.value
  }
}

function visualPadLeft(level: number) {
  const visualLevel = Math.max(1, level - indentRebaseLevel.value)
  return `${8 + (visualLevel - 1) * INDENT}px`
}

function updateIndentRebase() {
  indentRebaseFrame = 0
  const scroller = layersScrollRef.value
  if (!scroller) return
  if (scroller.scrollTop <= 8) {
    indentRebaseLevel.value = 0
    return
  }

  const viewportTop = scroller.getBoundingClientRect().top + 4
  const visibleRows = [...scroller.querySelectorAll<HTMLElement>('[data-layer-level]')]
    .filter((row) => row.getBoundingClientRect().bottom > viewportTop)
    .slice(0, 6)
  const visibleLevels = visibleRows.map((row) => Number(row.dataset.layerLevel ?? 1))
  const branchBaseline = visibleLevels.length > 0 ? Math.min(...visibleLevels) : 1
  indentRebaseLevel.value = Math.max(0, branchBaseline - VISIBLE_BASELINE_LEVEL)
}

function onLayersScroll() {
  if (indentRebaseFrame) cancelAnimationFrame(indentRebaseFrame)
  // Follow the scroll in real time. The shallowest of the first six visible
  // rows provides a stable branch baseline, avoiding the old row-edge bounce.
  indentRebaseFrame = requestAnimationFrame(updateIndentRebase)
}

onUnmounted(() => {
  if (indentRebaseFrame) cancelAnimationFrame(indentRebaseFrame)
})
</script>

<template>
  <LayerTreeRoot
    v-slot="scope"
    :filter-text="layerFilter"
    :indent-per-level="INDENT"
    :initial-expansion-depth="0"
  >
    <ContextMenuRoot :modal="false">
      <div v-bind="attrs" class="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        <div
          data-test-id="layers-utilities"
          class="flex shrink-0 items-center gap-1 px-3 pt-1 pb-1.5"
        >
          <label class="relative min-w-0 flex-1">
            <icon-lucide-search
              class="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted/75"
            />
            <input
              v-model="layerFilter"
              data-test-id="layers-filter"
              aria-label="Filter layers"
              class="h-8 w-full rounded-[6px] border-none bg-transparent pr-7 pl-7 text-[12px] text-surface outline-none placeholder:text-muted/80 hover:bg-hover/70 focus:bg-hover focus:ring-1 focus:ring-accent/25"
              placeholder="Find a layer…"
            />
            <button
              v-if="layerFilter"
              type="button"
              aria-label="Clear layer filter"
              class="absolute top-1/2 right-1 flex size-5 -translate-y-1/2 items-center justify-center rounded text-muted hover:bg-hover hover:text-surface"
              @click="layerFilter = ''"
            >
              <icon-lucide-x class="size-3" />
            </button>
          </label>
          <div class="relative shrink-0">
            <Tip label="Layer view options">
              <button
                type="button"
                data-test-id="layers-view-options"
                aria-label="Layer view options"
                class="flex size-8 items-center justify-center rounded-[5px] border-none bg-transparent text-muted transition-all hover:bg-hover hover:text-surface"
                :class="showTreeTools ? 'bg-hover text-surface' : ''"
                :aria-expanded="showTreeTools"
                @click="toggleTreeTools"
              >
                <icon-lucide-sliders-horizontal class="size-3.5" />
              </button>
            </Tip>
            <div
              v-if="showTreeTools"
              class="border-chrome-border bg-chrome-raised shadow-chrome-menu absolute top-9 right-0 z-30 w-36 rounded-[9px] border p-1 backdrop-blur-xl"
            >
              <button
                type="button"
                data-test-id="layers-collapse-all"
                class="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[11px] text-muted hover:bg-hover hover:text-surface"
                @click="runTreeTool(scope.actions.collapseAll)"
              >
                <icon-lucide-chevrons-up class="size-3.5" />
                <span>Collapse all</span>
              </button>
              <button
                type="button"
                data-test-id="layers-expand-all"
                class="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[11px] text-muted hover:bg-hover hover:text-surface"
                @click="runTreeTool(scope.actions.expandAll)"
              >
                <icon-lucide-chevrons-down class="size-3.5" />
                <span>Expand all</span>
              </button>
            </div>
          </div>
        </div>
        <ContextMenuTrigger as-child @contextmenu="onLayerRightClick">
          <div
            ref="layersScrollRef"
            data-test-id="layers-scroll"
            class="scrollbar-thin h-full overflow-y-auto px-2.5 py-1.5"
            @scroll.passive="onLayersScroll"
          >
            <div
              v-if="layerFilter && scope.flattenItems.length === 0"
              data-test-id="layers-filter-empty"
              class="px-3 py-8 text-center text-[10px] leading-4 text-muted"
            >
              No layers match “{{ layerFilter }}”.
            </div>
            <TreeVirtualizer v-slot="{ item }" :estimate-size="32" :text-content="layerTextContent">
              <TreeItem
                v-slot="{ isExpanded }"
                v-bind="item.bind"
                as-child
                @select="
                  (e: CustomEvent) =>
                    onTreeSelect(e, toLayerNode(item.value).id, scope.actions.select)
                "
                @toggle="
                  (e: CustomEvent) => {
                    if (e.detail.originalEvent?.type === 'click') e.preventDefault()
                  }
                "
              >
                <LayerTreeItem
                  v-slot="{ node, isSelected, actions }"
                  :node="toLayerNode(item.value)"
                  :level="item.level"
                  :has-children="item.hasChildren"
                >
                  <LayerTreeRenameRow
                    v-if="rename.editingId.value === node.id"
                    :node="node"
                    :level="item.level"
                    :has-children="item.hasChildren"
                    :pad-left="visualPadLeft(item.level)"
                    :expanded="isExpanded"
                    :actions="actions"
                    :rename-controls="renameControls"
                  />

                  <LayerTreeNodeRow
                    v-else
                    :node="node"
                    :level="item.level"
                    :has-children="item.hasChildren"
                    :selected="isSelected"
                    :pad-left="visualPadLeft(item.level)"
                    :expanded="isExpanded"
                    :actions="actions"
                    :chrome="chrome(scope)"
                    @hover-end="unhoverLayer"
                    @hover-start="hoverLayer"
                    @rename-start="rename.start"
                  />
                </LayerTreeItem>
              </TreeItem>
            </TreeVirtualizer>
          </div>
        </ContextMenuTrigger>
      </div>
      <ContextMenuPortal>
        <CanvasMenu />
      </ContextMenuPortal>
    </ContextMenuRoot>
  </LayerTreeRoot>
</template>
