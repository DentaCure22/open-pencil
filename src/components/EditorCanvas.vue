<script setup lang="ts">
import { computed, ref, type Component } from 'vue'
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
import { isCodeObjectFrame } from '@/app/code-object/model'
import {
  isAgentConversationDragActive,
  useAgentConversationDrop
} from '@/app/agent-terminal/drag'
import { useEditorStore } from '@/app/editor/active-store'
import { useAssetVariantDrop } from '@/app/editor/assets/drag'
import { useCanvasCollaborationAwareness } from '@/app/editor/canvas/collaboration-awareness'
import { createCanvasContextSelection } from '@/app/editor/canvas/context-selection'
import { fadeOutGlobalLoader } from '@/app/editor/canvas/loader-overlay'
import { useCanvasSurfaceEntry } from '@/app/editor/canvas/surface/entry'
import {
  CANVAS_GRID_POSITION,
  CANVAS_GRID_SIZE,
  useCanvasViewportCssVariables,
  useEditorPresentationViewport
} from '@/app/editor/presentation'
import { editorViewportInsets } from '@/app/editor/viewport-insets'
import { useExternalLiveSurfaceDrop } from '@/app/external-live-surface/drop'
import { useFileIntakeDrop } from '@/app/file-intake/drop'
import IconLucidePanelBottom from '~icons/lucide/panel-bottom'
import IconLucidePanelLeft from '~icons/lucide/panel-left'
import IconLucidePanelRight from '~icons/lucide/panel-right'
import IconLucidePanelTop from '~icons/lucide/panel-top'
import BoardExperienceRuntimeHost from './canvas/BoardExperienceRuntimeHost.vue'
import AgentTerminalOverlays from './agent-terminal/AgentTerminalOverlays.vue'
import CanvasMenu from './canvas/CanvasMenu.vue'
import CodeObjectOverlays from './canvas/CodeObjectOverlays.vue'
import ContainerNavigationStatus from './canvas/ContainerNavigationStatus.vue'
import ContextCommentComposer from './context-comment/ContextCommentComposer.vue'
import ContextCommentCropOverlay from './context-comment/ContextCommentCropOverlay.vue'
import ContextCommentScreenshotEditor from './context-comment/ContextCommentScreenshotEditor.vue'
import MediaEvidenceOverlays from './canvas/MediaEvidenceOverlays.vue'
import MarkdownDocumentOverlays from './canvas/MarkdownDocumentOverlays.vue'
import MermaidSvgOverlays from './canvas/MermaidSvgOverlays.vue'
import NarratedTraceAnnotationOverlay from './narrated-trace/NarratedTraceAnnotationOverlay.vue'
import SpatialMediaOverlays from './spatial-media/SpatialMediaOverlays.vue'
import SourceObjectOverlays from './canvas/SourceObjectOverlays.vue'
import ScrubInput from './inputs/ScrubInput.vue'

const store = useEditorStore()
const collab = useCollabInjected()
const canvasAreaRef = ref<HTMLDivElement | null>(null)
const sceneCanvasRef = ref<HTMLCanvasElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)
type CanvasLayer = 'overlays' | 'scene'
const canvasLoadErrors = ref<Partial<Record<CanvasLayer, string>>>({})
const canvasRetrying = ref(false)
const presentationViewport = useEditorPresentationViewport(store)
useCanvasViewportCssVariables(store, canvasAreaRef)

const canvasGridStyle = {
  backgroundColor: 'var(--color-canvas)',
  backgroundImage: 'radial-gradient(circle, var(--color-canvas-grid) 0 1px, transparent 1.2px)',
  backgroundPosition: CANVAS_GRID_POSITION,
  backgroundSize: `${CANVAS_GRID_SIZE} ${CANVAS_GRID_SIZE}`
}

const { updateCursor } = useCanvasCollaborationAwareness(store, collab)
const { selectAtContextPoint } = createCanvasContextSelection(canvasRef, store)
useCanvasSurfaceEntry(canvasRef, store)

const canvasLoadError = computed(
  () => canvasLoadErrors.value.scene ?? canvasLoadErrors.value.overlays ?? null
)

function canvasErrorMessage(error: unknown) {
  return error instanceof Error && error.message.trim()
    ? error.message
    : 'The rendering engine could not be initialized.'
}

function markCanvasReady(layer: CanvasLayer) {
  const { [layer]: _removed, ...remaining } = canvasLoadErrors.value
  canvasLoadErrors.value = remaining
  if (layer === 'scene') fadeOutGlobalLoader()
}

function markCanvasError(layer: CanvasLayer, error: unknown) {
  canvasLoadErrors.value = { ...canvasLoadErrors.value, [layer]: canvasErrorMessage(error) }
  fadeOutGlobalLoader()
}

const { retryCanvasKit: retrySceneCanvasKit } = useCanvas(sceneCanvasRef, store, {
  layer: 'scene',
  maxDevicePixelRatio: 1.5,
  preserveDrawingBuffer: true,
  showRulers: false,
  onError: (error) => markCanvasError('scene', error),
  onReady: () => markCanvasReady('scene')
})
const {
  hitTestSectionTitle,
  hitTestComponentLabel,
  hitTestFrameTitle,
  retryCanvasKit: retryOverlayCanvasKit
} = useCanvas(canvasRef, store, {
  layer: 'overlays',
  maxDevicePixelRatio: 1.25,
  ownsSelectionChrome: (nodeId) => isCodeObjectFrame(store.graph.getNode(nodeId)),
  onError: (error) => markCanvasError('overlays', error),
  onReady: () => markCanvasReady('overlays')
})

async function retryCanvasKit() {
  if (canvasRetrying.value) return
  canvasRetrying.value = true
  canvasLoadErrors.value = {}
  await Promise.all([retrySceneCanvasKit(), retryOverlayCanvasKit()])
  canvasRetrying.value = false
}
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
  updateCursor,
  editorViewportInsets,
  isAgentConversationDragActive
)

useTextEdit(canvasRef, store)
const { isDraggingOver } = useFileIntakeDrop(canvasAreaRef, store)
const {
  isDraggingAssetVariant,
  onDragEnter: onAssetVariantDragEnter,
  onDragLeave: onAssetVariantDragLeave,
  onDragOver: onAssetVariantDragOver,
  onDrop: onAssetVariantDrop
} = useAssetVariantDrop(canvasAreaRef, store)
const {
  onDragEnter: onAgentConversationDragEnter,
  onDragLeave: onAgentConversationDragLeave,
  onDragOver: onAgentConversationDragOver,
  onDrop: onAgentConversationDrop
} = useAgentConversationDrop(canvasAreaRef, store)
const {
  isDraggingExternalLiveSurface,
  onDragEnter: onExternalLiveSurfaceDragEnter,
  onDragLeave: onExternalLiveSurfaceDragLeave,
  onDragOver: onExternalLiveSurfaceDragOver,
  onDrop: onExternalLiveSurfaceDrop
} = useExternalLiveSurfaceDrop(canvasAreaRef, store)

function onCanvasDragEnter(event: DragEvent) {
  onAssetVariantDragEnter(event)
  onAgentConversationDragEnter(event)
  onExternalLiveSurfaceDragEnter(event)
}

function onCanvasDragLeave(event: DragEvent) {
  onAssetVariantDragLeave(event)
  onAgentConversationDragLeave(event)
  onExternalLiveSurfaceDragLeave(event)
}

function onCanvasDragOver(event: DragEvent) {
  onAssetVariantDragOver(event)
  onAgentConversationDragOver(event)
  onExternalLiveSurfaceDragOver(event)
}

function onCanvasDrop(event: DragEvent) {
  void onAssetVariantDrop(event)
  onAgentConversationDrop(event)
  onExternalLiveSurfaceDrop(event)
}

function keepCanvasAreaPinned(event: Event) {
  const area = event.currentTarget
  if (!(area instanceof HTMLElement) || (!area.scrollLeft && !area.scrollTop)) return
  area.scrollLeft = 0
  area.scrollTop = 0
}

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
const paddingEditorReference = useCanvasVirtualReference(
  canvasRef,
  paddingEditorAnchor,
  presentationViewport
)
const paddingEditorIcon = computed(() => {
  const edit = autoLayoutPaddingEdit.value
  return edit ? paddingSideIcons[edit.side] : IconLucidePanelTop
})

const cursor = computed(() => toolCursor(store.state.activeTool, cursorOverride.value))
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
        :style="canvasGridStyle"
        class="canvas-area relative isolate h-full min-h-0 w-full min-w-0 flex-1 overflow-hidden overscroll-none"
        @dragenter="onCanvasDragEnter"
        @dragleave="onCanvasDragLeave"
        @dragover="onCanvasDragOver"
        @drop="onCanvasDrop"
        @scroll.passive="keepCanvasAreaPinned"
      >
        <canvas
          ref="sceneCanvasRef"
          data-test-id="scene-canvas-element"
          aria-hidden="true"
          class="pointer-events-none absolute inset-0 z-[1] size-full outline-none"
        />
        <canvas
          ref="canvasRef"
          data-test-id="canvas-element"
          tabindex="-1"
          :style="{ cursor }"
          class="absolute inset-0 z-[2] block size-full touch-none outline-none"
        />
        <MediaEvidenceOverlays />
        <SourceObjectOverlays />
        <MarkdownDocumentOverlays />
        <MermaidSvgOverlays />
        <CodeObjectOverlays />
        <BoardExperienceRuntimeHost />
        <AgentTerminalOverlays />
        <ContainerNavigationStatus />
        <SpatialMediaOverlays />
        <NarratedTraceAnnotationOverlay />
        <ContextCommentCropOverlay />
        <ContextCommentScreenshotEditor />
        <ContextCommentComposer />
        <Transition
          enter-active-class="transition-opacity duration-150"
          enter-from-class="opacity-0"
          leave-active-class="transition-opacity duration-150"
          leave-to-class="opacity-0"
        >
          <div
            v-if="isDraggingOver || isDraggingAssetVariant || isDraggingExternalLiveSurface"
            data-test-id="canvas-drop-overlay"
            class="absolute inset-0 z-40 border-2 border-dashed border-accent/60 bg-accent/5"
            :class="
              isDraggingAssetVariant || isDraggingExternalLiveSurface
                ? 'pointer-events-auto'
                : 'pointer-events-none'
            "
            @dragenter="onCanvasDragEnter"
            @dragover="onCanvasDragOver"
            @drop="onCanvasDrop"
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
            class="pointer-events-none absolute inset-0 z-50 flex items-center justify-center bg-canvas"
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
        <div
          v-if="canvasLoadError"
          data-test-id="canvas-error"
          role="alert"
          class="bg-canvas/95 absolute inset-0 z-[60] flex items-center justify-center px-6 backdrop-blur-sm"
        >
          <div
            class="border-border/70 bg-panel max-w-sm rounded-xl border p-5 text-center shadow-xl"
          >
            <icon-lucide-triangle-alert class="mx-auto size-6 text-[var(--color-warning-text)]" />
            <h2 class="mt-3 text-sm font-semibold text-surface">Canvas didn’t start</h2>
            <p class="mt-1.5 text-[11px] leading-4 text-muted">{{ canvasLoadError }}</p>
            <button
              type="button"
              data-test-id="canvas-error-retry"
              class="bg-accent mt-4 h-8 rounded-md px-3 text-[11px] font-medium text-white disabled:cursor-wait disabled:opacity-60"
              :disabled="canvasRetrying"
              @click="retryCanvasKit"
            >
              {{ canvasRetrying ? 'Retrying…' : 'Retry canvas' }}
            </button>
          </div>
        </div>
      </div>
    </ContextMenuTrigger>

    <ContextMenuPortal>
      <CanvasMenu />
    </ContextMenuPortal>
  </ContextMenuRoot>
</template>
