<script setup lang="ts">
import { computed, ref, watch, type Component } from 'vue'
import {
  AUTO_LAYOUT_PADDING_EDITOR_OFFSET_X,
  AUTO_LAYOUT_PADDING_EDITOR_OFFSET_Y
} from '@open-pencil/core/constants'
import {
  ContextMenuPortal,
  ContextMenuRoot,
  ContextMenuTrigger,
  PopoverContent,
  PopoverPortal,
  PopoverRoot
} from 'reka-ui'

import {
  toolCursor,
  useCanvas,
  useCanvasInput,
  useCanvasVirtualReference,
  useTextEdit
} from '@open-pencil/vue'
import { useCollabInjected } from '@/app/collab/use'
import { useEditorStore } from '@/app/editor/active-store'
import { useAssetVariantDrop } from '@/app/editor/assets/drag'
import { useCanvasCollaborationAwareness } from '@/app/editor/canvas/collaboration-awareness'
import { createCanvasContextSelection } from '@/app/editor/canvas/context-selection'
import { fadeOutGlobalLoader } from '@/app/editor/canvas/loader-overlay'
import { isHtmlBoardFrame } from '@/app/html-board/workspace'
import { isCodeObjectFrame } from '@/app/code-object/model'
import { useFileIntakeDrop } from '@/app/file-intake/drop'
import { mediaEvidenceSource } from '@/app/media-evidence/source'
import { sourceObjectSource } from '@/app/source-object/source'
import { spatialMediaSource } from '@/app/spatial-media/source'
import {
  clearLiveInspectorSelection,
  liveInspectorActiveFrameId,
  liveInspectorPendingSelectedId,
  liveInspectorSelectedId,
  liveInspectorSelectionEpoch
} from '@/app/smylr-live-inspector/session'
import {
  findCurrentSmylrLiveAppFrame,
  isSmylrFlowPageNode,
  isSmylrLiveAppFrameNode
} from '@/app/smylr-production/workspace'
import IconLucidePanelBottom from '~icons/lucide/panel-bottom'
import IconLucidePanelLeft from '~icons/lucide/panel-left'
import IconLucidePanelRight from '~icons/lucide/panel-right'
import IconLucidePanelTop from '~icons/lucide/panel-top'
import AnimatedDitherBackground from './canvas/AnimatedDitherBackground.vue'
import CanvasMenu from './canvas/CanvasMenu.vue'
import HtmlBoardEmbeds from './canvas/HtmlBoardEmbeds.vue'
import CodeObjectOverlays from './canvas/CodeObjectOverlays.vue'
import MediaEvidenceOverlays from './canvas/MediaEvidenceOverlays.vue'
import NarratedTraceAnnotationOverlay from './narrated-trace/NarratedTraceAnnotationOverlay.vue'
import SpatialMediaOverlays from './spatial-media/SpatialMediaOverlays.vue'
import SmylrLiveAppEmbed from './canvas/SmylrLiveAppEmbed.vue'
import SmylrPooledLiveAppEmbeds from './canvas/SmylrPooledLiveAppEmbeds.vue'
import SourceObjectOverlays from './canvas/SourceObjectOverlays.vue'
import ScrubInput from './inputs/ScrubInput.vue'

type DitherPresentation = 'overlay' | 'surface'

const { ditherPresentation = 'overlay' } = defineProps<{
  ditherPresentation?: DitherPresentation
}>()

const store = useEditorStore()
const collab = useCollabInjected()
const canvasAreaRef = ref<HTMLDivElement | null>(null)
const sceneCanvasRef = ref<HTMLCanvasElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)
const usesQuietCanvasBackground = computed(() =>
  isSmylrFlowPageNode(store.graph.getNode(store.state.currentPageId))
)

const { updateCursor } = useCanvasCollaborationAwareness(store, collab)
const { selectAtContextPoint } = createCanvasContextSelection(canvasRef, store)

useCanvas(sceneCanvasRef, store, {
  layer: 'scene',
  preserveDrawingBuffer: true,
  showRulers: false,
  onReady: fadeOutGlobalLoader
})
const { hitTestSectionTitle, hitTestComponentLabel, hitTestFrameTitle } = useCanvas(
  canvasRef,
  store,
  {
    layer: 'overlays'
  }
)
const {
  cursorOverride,
  autoLayoutPaddingEdit,
  updateAutoLayoutPaddingEdit,
  commitAutoLayoutPaddingEdit,
  cancelAutoLayoutPaddingEdit
} = useCanvasInput(
  canvasRef,
  store,
  hitTestSectionTitle,
  hitTestComponentLabel,
  hitTestFrameTitle,
  updateCursor
)

useTextEdit(canvasRef, store)
const { isDraggingOver } = useFileIntakeDrop(canvasRef, store)
const {
  isDraggingAssetVariant,
  onDragEnter: onAssetVariantDragEnter,
  onDragLeave: onAssetVariantDragLeave,
  onDragOver: onAssetVariantDragOver,
  onDrop: onAssetVariantDrop
} = useAssetVariantDrop(canvasAreaRef, store)

const paddingSideIcons = {
  top: IconLucidePanelTop,
  right: IconLucidePanelRight,
  bottom: IconLucidePanelBottom,
  left: IconLucidePanelLeft
} satisfies Record<'top' | 'right' | 'bottom' | 'left', Component>

const paddingEditorAnchor = computed(() => {
  const edit = autoLayoutPaddingEdit.value
  if (!edit) return null
  const node = store.graph.getNode(edit.nodeId)
  if (!node) return null
  const abs = store.graph.getAbsolutePosition(node.id)
  if (edit.side === 'top') return { x: abs.x + node.width / 2, y: abs.y + node.paddingTop / 2 }
  if (edit.side === 'bottom') {
    return { x: abs.x + node.width / 2, y: abs.y + node.height - node.paddingBottom / 2 }
  }
  if (edit.side === 'left') return { x: abs.x + node.paddingLeft / 2, y: abs.y + node.height / 2 }
  return { x: abs.x + node.width - node.paddingRight / 2, y: abs.y + node.height / 2 }
})
const paddingEditorReference = useCanvasVirtualReference(canvasRef, store, paddingEditorAnchor)
const paddingEditorIcon = computed(() => {
  const edit = autoLayoutPaddingEdit.value
  return edit ? paddingSideIcons[edit.side] : IconLucidePanelTop
})

const cursor = computed(() => toolCursor(store.state.activeTool, cursorOverride.value))

function clearLiveContainerHighlight() {
  if (!liveInspectorSelectedId.value && !liveInspectorPendingSelectedId.value) return
  clearLiveInspectorSelection()
}

function claimLiveFrameSelection() {
  const id = liveInspectorSelectedId.value ?? liveInspectorPendingSelectedId.value
  if (!id) return
  const activeFrameId = liveInspectorActiveFrameId.value
  const activeFrame = activeFrameId ? store.graph.getNode(activeFrameId) : null
  const liveFrame =
    activeFrame && isSmylrLiveAppFrameNode(activeFrame)
      ? activeFrame
      : findCurrentSmylrLiveAppFrame(store)
  if (!liveFrame) return
  // Always select the live frame so Design shows the live inspector even after a
  // native pasted node was selected (same live id no longer silently no-ops).
  if (store.state.selectedIds.size !== 1 || !store.state.selectedIds.has(liveFrame.id)) {
    store.select([liveFrame.id])
  }
  requestAnimationFrame(() => canvasRef.value?.focus({ preventScroll: true }))
}

watch(
  [liveInspectorSelectedId, liveInspectorPendingSelectedId, liveInspectorSelectionEpoch],
  () => {
    claimLiveFrameSelection()
  }
)

const prefersNativeHitTarget = computed(() =>
  [...store.state.selectedIds].some((id) => {
    const node = store.graph.getNode(id)
    return Boolean(
      node &&
      !isSmylrLiveAppFrameNode(node) &&
      !isHtmlBoardFrame(node) &&
      !isCodeObjectFrame(node) &&
      !mediaEvidenceSource(node) &&
      !sourceObjectSource(node) &&
      !spatialMediaSource(node)
    )
  })
)
// Interaction canvas sits under the live iframe (z-5) for live select hits falling through
// pe-none, and rises above it when a native pasted node needs hit-testing.
const interactionCanvasClass = computed(() =>
  prefersNativeHitTarget.value
    ? 'absolute inset-0 z-[6] block size-full touch-none outline-none'
    : 'absolute inset-0 z-[2] block size-full touch-none outline-none'
)
</script>

<template>
  <ContextMenuRoot :modal="false" class="relative flex h-full min-h-0 w-full min-w-0 flex-1">
    <ContextMenuTrigger
      as-child
      class="relative flex h-full min-h-0 w-full min-w-0 flex-1"
      @contextmenu="selectAtContextPoint"
    >
      <div
        ref="canvasAreaRef"
        data-test-id="canvas-area"
        class="canvas-area relative isolate h-full min-h-0 w-full min-w-0 flex-1 overflow-hidden overscroll-none"
        @dragenter="onAssetVariantDragEnter"
        @dragleave="onAssetVariantDragLeave"
        @dragover="onAssetVariantDragOver"
        @drop="onAssetVariantDrop"
      >
        <!-- Scene stays transparent so the dither can sit behind native objects; live iframe is z-[5]. -->
        <canvas
          ref="sceneCanvasRef"
          data-test-id="scene-canvas-element"
          aria-hidden="true"
          class="pointer-events-none absolute inset-0 z-[1] size-full outline-none"
        />
        <AnimatedDitherBackground
          :presentation="ditherPresentation"
          :quiet="usesQuietCanvasBackground"
        />
        <canvas
          ref="canvasRef"
          data-test-id="canvas-element"
          tabindex="-1"
          :style="{ cursor }"
          :class="interactionCanvasClass"
          @pointerdown="clearLiveContainerHighlight"
        />
        <MediaEvidenceOverlays />
        <SourceObjectOverlays />
        <CodeObjectOverlays />
        <SmylrLiveAppEmbed />
        <SmylrPooledLiveAppEmbeds />
        <SpatialMediaOverlays />
        <HtmlBoardEmbeds />
        <NarratedTraceAnnotationOverlay />
        <Transition
          enter-active-class="transition-opacity duration-150"
          enter-from-class="opacity-0"
          leave-active-class="transition-opacity duration-150"
          leave-to-class="opacity-0"
        >
          <div
            v-if="isDraggingOver || isDraggingAssetVariant"
            data-test-id="canvas-drop-overlay"
            class="absolute inset-0 z-40 border-2 border-dashed border-accent/60 bg-accent/5"
            :class="isDraggingAssetVariant ? 'pointer-events-auto' : 'pointer-events-none'"
          />
        </Transition>
        <PopoverRoot :open="!!autoLayoutPaddingEdit">
          <PopoverPortal>
            <PopoverContent
              v-if="autoLayoutPaddingEdit && paddingEditorReference"
              :reference="paddingEditorReference"
              side="top"
              align="center"
              :side-offset="AUTO_LAYOUT_PADDING_EDITOR_OFFSET_Y"
              :align-offset="AUTO_LAYOUT_PADDING_EDITOR_OFFSET_X"
              :collision-padding="8"
              class="z-50 w-20 rounded-md bg-panel p-1 shadow-lg"
              data-test-id="auto-layout-padding-editor"
              @keydown.escape.prevent="cancelAutoLayoutPaddingEdit"
              @open-auto-focus.prevent
            >
              <ScrubInput
                :model-value="autoLayoutPaddingEdit.value"
                :min="0"
                :step="1"
                data-test-id="auto-layout-padding-input"
                @update:model-value="updateAutoLayoutPaddingEdit"
                @commit="(value: number) => commitAutoLayoutPaddingEdit(value)"
                @editing-change="
                  (editing: boolean) =>
                    !editing &&
                    autoLayoutPaddingEdit &&
                    commitAutoLayoutPaddingEdit(autoLayoutPaddingEdit.value)
                "
              >
                <template #icon>
                  <component :is="paddingEditorIcon" class="size-3.5" />
                </template>
              </ScrubInput>
            </PopoverContent>
          </PopoverPortal>
        </PopoverRoot>
        <Transition leave-active-class="transition-opacity duration-300" leave-to-class="opacity-0">
          <div
            v-if="store.state.loading"
            data-test-id="canvas-loading"
            class="absolute inset-0 z-50 flex items-center justify-center bg-canvas"
          >
            <icon-lucide-pencil-line class="size-8 text-surface opacity-45" />
            <div
              class="absolute bottom-1/2 left-1/2 h-0.5 w-25 -translate-x-1/2 translate-y-10 overflow-hidden rounded-full bg-surface/8"
            >
              <div
                class="h-full w-2/5 animate-[slide_1s_ease-in-out_infinite] rounded-full bg-surface/25"
              />
            </div>
          </div>
        </Transition>
      </div>
    </ContextMenuTrigger>

    <ContextMenuPortal>
      <CanvasMenu />
    </ContextMenuPortal>
  </ContextMenuRoot>
</template>
