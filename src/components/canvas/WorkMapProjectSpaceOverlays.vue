<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch, type CSSProperties } from 'vue'

import type { Rect, SceneNode } from '@open-pencil/scene-graph'
import { applyMoveReparent, applyMoveSnap } from '@open-pencil/vue'

import {
  collapsedProjectTabLayout,
  fluidProjectTerritoryAppearance,
  shouldDetachFromFluidProjectSpace,
  workMapProjectSpaceBindings
} from '@/app/agent-chat/project-space'
import { useWorkMapBoardDirectoryCollapse } from '@/app/agent-chat/project-space-collapse'
import { showAgentWorkMapProjectDirectory } from '@/app/agent-chat/panel'
import { useAgentWorkMapPersistence } from '@/app/agent-chat/work-map-persistence'
import {
  codeObjectDesignGestureDragged,
  createCodeObjectMoveDrag,
  moveCodeObjectDesignGesture,
  type CodeObjectMoveDrag
} from '@/app/code-object/interaction'
import { codeObjectScreenOverlayStyle } from '@/app/code-object/transform'
import { useEditorStore } from '@/app/editor/active-store'
import { focusCanvasSurface } from '@/app/editor/canvas/surface/focus'
import { editorViewportInsets, visibleElementRect } from '@/app/editor/viewport-insets'
import {
  sceneNodeOverlayStyle,
  useEditorOverlayGeometryVersion,
  useEditorPresentationViewport
} from '@/app/editor/presentation'
import type { AgentWorkMapProject } from '@/app/agent-chat/work-map'

const store = useEditorStore()
const { load, workMap } = useAgentWorkMapPersistence()
const boardDirectoryCollapse = useWorkMapBoardDirectoryCollapse()
const geometryVersion = useEditorOverlayGeometryVersion(store)
const presentationViewport = useEditorPresentationViewport(store)
const graphVersion = ref(0)
const moveDrag = ref<CodeObjectMoveDrag | null>(null)
const PROJECT_FRAME_GRAB_SIDES = ['top', 'right', 'bottom', 'left'] as const
const COLLAPSED_PROJECT_PRESENTATION_COORDINATE = -1_000_000
const collapsedPresentationFrameIds = new Set<string>()
let unsubscribe: Array<() => void> = []

const projectSpaceFrameIds = computed(
  () =>
    new Set(
      workMapProjectSpaceBindings(workMap.value, store.state.currentPageId).map(
        ({ frameId }) => frameId
      )
    )
)

const projectMoveMembershipPolicy = {
  shouldDetach: (child: SceneNode, parent: SceneNode) =>
    projectSpaceFrameIds.value.has(parent.id) && shouldDetachFromFluidProjectSpace(child, parent)
}

function projectConversationCount(projectId: string): number {
  const threadIds = new Set<string>()
  for (const placement of workMap.value?.placements ?? []) {
    if (placement.projectId === projectId) threadIds.add(placement.threadId)
  }
  for (const bot of workMap.value?.bots ?? []) {
    if (bot.projectId === projectId) threadIds.add(bot.threadId)
  }
  for (const todo of workMap.value?.todos ?? []) {
    if (todo.projectId === projectId && todo.threadId) threadIds.add(todo.threadId)
  }
  return threadIds.size
}

function countLabel(count: number, singular: string): string {
  return `${count} ${count === 1 ? singular : `${singular}s`}`
}

function directMovingChildren(frame: SceneNode): SceneNode[] {
  return [...store.state.selectedIds].flatMap((id) => {
    const child = store.graph.getNode(id)
    if (!child || child.parentId !== frame.id) return []
    const presented = store.graph.getPresentedNodePosition(child.id)
    if (presented.x === child.x && presented.y === child.y) return []
    return [{ ...child, x: presented.x, y: presented.y }]
  })
}

function projectHasCollapsedAncestor(
  projectId: string,
  projectById: ReadonlyMap<string, AgentWorkMapProject>,
  collapsedDirectories: Readonly<Record<string, boolean>>
): boolean {
  let parentId = projectById.get(projectId)?.parentId
  const visited = new Set<string>()
  while (parentId && !visited.has(parentId)) {
    if (collapsedDirectories[parentId] === true) return true
    visited.add(parentId)
    parentId = projectById.get(parentId)?.parentId
  }
  return false
}

function readableCanvasViewport(): Rect | undefined {
  const canvasRect = visibleElementRect('[data-test-id="canvas-area"]')
  if (!canvasRect) return undefined
  const viewportInsets = editorViewportInsets()
  return {
    height: Math.max(
      1,
      canvasRect.height - (viewportInsets.top ?? 0) - (viewportInsets.bottom ?? 0)
    ),
    width: Math.max(1, canvasRect.width - (viewportInsets.left ?? 0) - (viewportInsets.right ?? 0)),
    x: canvasRect.x + (viewportInsets.left ?? 0),
    y: canvasRect.y + (viewportInsets.top ?? 0)
  }
}

function collapsedSiblingSlotIndex(
  bindings: ReturnType<typeof workMapProjectSpaceBindings>,
  project: AgentWorkMapProject,
  collapsedDirectories: Readonly<Record<string, boolean>>
): number {
  const collapsedSiblings = bindings.filter(
    (binding) =>
      binding.project.parentId === project.parentId &&
      collapsedDirectories[binding.project.id] === true
  )
  return Math.max(
    0,
    collapsedSiblings.findIndex((binding) => binding.project.id === project.id)
  )
}

function collapsedSiblingRailY(
  bindings: ReturnType<typeof workMapProjectSpaceBindings>,
  project: AgentWorkMapProject,
  zoom: number
): number | undefined {
  const siblingTops = bindings.flatMap((binding) => {
    if (binding.project.parentId !== project.parentId) return []
    const siblingFrame = store.graph.getNode(binding.frameId)
    if (!siblingFrame || siblingFrame.type !== 'FRAME') return []
    const absolute = store.graph.getAuthoritativeAbsolutePosition(siblingFrame.id)
    return [absolute.y * zoom + presentationViewport.value.panY]
  })
  return siblingTops.length > 0 ? Math.min(...siblingTops) : undefined
}

const territories = computed(() => {
  void graphVersion.value
  void geometryVersion.value.revision
  const bindings = workMapProjectSpaceBindings(workMap.value, store.state.currentPageId)
  const bindingByProjectId = new Map(bindings.map((binding) => [binding.project.id, binding]))
  const projectById = new Map(
    (workMap.value?.projects ?? []).map((project) => [project.id, project])
  )
  const isCollapsed = (projectId: string) =>
    boardDirectoryCollapse.collapsedDirectories.value[projectId] === true
  const collapsedDirectories = boardDirectoryCollapse.collapsedDirectories.value

  return bindings.flatMap(({ frameId, project }) => {
    const frame = store.graph.getNode(frameId)
    if (!frame || frame.type !== 'FRAME' || !frame.visible) return []
    const presented = store.graph.getPresentedNodePosition(frame.id)
    const appearance = fluidProjectTerritoryAppearance(frame, directMovingChildren(frame), {
      x: presented.x - frame.x,
      y: presented.y - frame.y
    })
    const rootStyle = sceneNodeOverlayStyle(store, frame)
    const labelStyle = codeObjectScreenOverlayStyle(store, frame, presentationViewport.value)
    const zoom = Math.max(presentationViewport.value.zoom, 0.02)
    const collapsed = Boolean(project.parentId) && isCollapsed(project.id)
    const parentBinding = project.parentId ? bindingByProjectId.get(project.parentId) : undefined
    const parentFrame = parentBinding ? store.graph.getNode(parentBinding.frameId) : undefined
    const collapsedSlotIndex = collapsed
      ? collapsedSiblingSlotIndex(bindings, project, collapsedDirectories)
      : 0
    const parentAbsolute = parentFrame
      ? store.graph.getAuthoritativeAbsolutePosition(parentFrame.id)
      : store.graph.getAuthoritativeAbsolutePosition(frame.id)
    const readableViewport = readableCanvasViewport()
    const collapsedLayout = collapsedProjectTabLayout(
      {
        height: (parentFrame?.height ?? frame.height) * zoom,
        width: (parentFrame?.width ?? frame.width) * zoom,
        x: parentAbsolute.x * zoom + presentationViewport.value.panX,
        y: parentAbsolute.y * zoom + presentationViewport.value.panY
      },
      collapsedSlotIndex,
      readableViewport,
      collapsedSiblingRailY(bindings, project, zoom)
    )
    const collapsedCardStyle = {
      height: `${collapsedLayout.height}px`,
      transform: `translate3d(${collapsedLayout.x}px, ${collapsedLayout.y}px, 0)`,
      width: `${collapsedLayout.width}px`
    } satisfies CSSProperties
    const surfaceStyle = {
      borderRadius: appearance.borderRadius,
      borderWidth: `${1 / zoom}px`,
      bottom: `${-appearance.bottom}px`,
      left: `${-appearance.left}px`,
      right: `${-appearance.right}px`,
      top: `${-appearance.top}px`
    } satisfies CSSProperties
    const grabSurfaceStyle = {
      bottom: `${-appearance.bottom * zoom}px`,
      left: `${-appearance.left * zoom}px`,
      right: `${-appearance.right * zoom}px`,
      top: `${-appearance.top * zoom}px`
    } satisfies CSSProperties
    return [
      {
        appearance,
        collapsed,
        collapsedCardStyle,
        collapsedSlotIndex,
        conversationCount: projectConversationCount(project.id),
        frame,
        grabSurfaceStyle,
        hiddenByCollapsedAncestor: projectHasCollapsedAncestor(
          project.id,
          projectById,
          collapsedDirectories
        ),
        labelStyle,
        objectCount: frame.childIds.length,
        parentName: parentBinding?.project.name ?? 'Parent Bot',
        project,
        rootStyle,
        surfaceStyle
      }
    ]
  })
})

function selectProjectFrame(frameId: string) {
  if (!store.state.selectedIds.has(frameId)) store.select([frameId])
}

function focusProjectFrame(frameId: string) {
  selectProjectFrame(frameId)
  focusCanvasSurface(store, frameId)
}

function openProjectDirectory(projectId: string) {
  showAgentWorkMapProjectDirectory(projectId)
}

function syncCollapsedProjectPresentations() {
  const nextCollapsedFrameIds = new Set<string>()
  for (const { frameId, project } of workMapProjectSpaceBindings(
    workMap.value,
    store.state.currentPageId
  )) {
    if (
      !project.parentId ||
      boardDirectoryCollapse.collapsedDirectories.value[project.id] !== true
    ) {
      continue
    }
    const frame = store.graph.getNode(frameId)
    if (!frame) continue
    nextCollapsedFrameIds.add(frame.id)
    store.graph.setNodePositionPresentation(frame.id, {
      x: COLLAPSED_PROJECT_PRESENTATION_COORDINATE - frame.width,
      y: COLLAPSED_PROJECT_PRESENTATION_COORDINATE - frame.height
    })
  }

  for (const frameId of collapsedPresentationFrameIds) {
    if (!nextCollapsedFrameIds.has(frameId)) store.graph.clearNodePositionPresentation(frameId)
  }
  collapsedPresentationFrameIds.clear()
  for (const frameId of nextCollapsedFrameIds) collapsedPresentationFrameIds.add(frameId)
}

function toggleProjectDirectory(projectId: string) {
  boardDirectoryCollapse.toggle(projectId)
  syncCollapsedProjectPresentations()
  store.requestRender()
}

function beginProjectFrameMove(frame: SceneNode, event: PointerEvent) {
  if (store.state.activeTool !== 'SELECT' || event.button !== 0) return
  selectProjectFrame(frame.id)
  store.setSnapGuides([])
  moveDrag.value = createCodeObjectMoveDrag({
    frame,
    pageId: store.state.currentPageId,
    pointerId: event.pointerId,
    startClientX: event.clientX,
    startClientY: event.clientY
  })
  const target = event.currentTarget
  if (target instanceof HTMLElement) target.setPointerCapture(event.pointerId)
}

function moveProjectFrame(event: PointerEvent) {
  const drag = moveDrag.value
  if (!drag || drag.pointerId !== event.pointerId) return
  const movement = moveCodeObjectDesignGesture(drag, event.clientX, event.clientY)
  moveDrag.value = { ...drag, ...movement.gesture }
  if (!codeObjectDesignGestureDragged(movement.gesture)) return
  const zoom = Math.max(store.state.zoom, 0.01)
  const snapped = applyMoveSnap(drag.snapInput, movement.dx / zoom, movement.dy / zoom, store)
  store.graph.updateNodePositionPreview(
    drag.frameId,
    drag.startX + snapped.dx,
    drag.startY + snapped.dy
  )
  store.requestRepaint()
}

function endProjectFrameMove(event: PointerEvent) {
  const drag = moveDrag.value
  if (!drag || drag.pointerId !== event.pointerId) return
  moveDrag.value = null
  store.setSnapGuides([])
  if (!codeObjectDesignGestureDragged(drag)) return
  const frame = store.graph.getNode(drag.frameId)
  if (!frame) return
  const next = store.graph.getPresentedNodePosition(frame.id)
  store.graph.clearNodePositionPresentation(frame.id)
  if (next.x === drag.startX && next.y === drag.startY) return
  store.updateNode(frame.id, next)
  applyMoveReparent(store, projectMoveMembershipPolicy)
  store.commitMoveWithReparent(drag.snapInput.originals)
}

function cancelProjectFrameMove(event: PointerEvent) {
  const drag = moveDrag.value
  if (!drag || drag.pointerId !== event.pointerId) return
  moveDrag.value = null
  store.setSnapGuides([])
  if (!codeObjectDesignGestureDragged(drag)) return
  store.graph.clearNodePositionPresentation(drag.frameId)
  store.requestRepaint()
}

function refresh() {
  graphVersion.value += 1
}

onMounted(() => {
  if (!workMap.value) void load()
  unsubscribe = [
    store.onEditorEvent('graph:replaced', refresh),
    store.onEditorEvent('page:changed', refresh),
    store.onEditorEvent('selection:changed', refresh),
    store.onEditorEvent('node:created', refresh),
    store.onEditorEvent('node:deleted', refresh),
    store.onEditorEvent('node:reparented', refresh),
    store.onEditorEvent('node:updated', refresh),
    store.onEditorEvent('repaint:requested', refresh)
  ]
})

watch(
  [workMap, boardDirectoryCollapse.collapsedDirectories, () => store.state.currentPageId],
  syncCollapsedProjectPresentations,
  { immediate: true }
)

onUnmounted(() => {
  for (const stop of unsubscribe) stop()
  unsubscribe = []
  for (const frameId of collapsedPresentationFrameIds) {
    store.graph.clearNodePositionPresentation(frameId)
  }
  collapsedPresentationFrameIds.clear()
})
</script>

<template>
  <div class="pointer-events-none contents">
    <template v-for="territory in territories" :key="territory.project.id">
      <div
        v-if="!territory.hiddenByCollapsedAncestor"
        class="absolute top-0 left-0 overflow-visible"
        :class="
          territory.collapsed
            ? 'work-map-project-frame--collapsed pointer-events-auto z-[24]'
            : 'pointer-events-none z-0'
        "
        :style="territory.rootStyle"
        :data-project-id="territory.project.id"
        :data-project-frame-id="territory.frame.id"
        :data-collapsed="territory.collapsed || undefined"
        :data-detach-ready="territory.appearance.detachReady || undefined"
        data-test-id="work-map-project-frame"
        @pointerdown.stop
        @dblclick.stop
        @click.stop
      >
        <span
          class="hidden"
          :data-test-id="`work-map-project-frame-marker-${territory.project.id}`"
        />
        <div
          class="work-map-project-frame__surface absolute transition-[inset,border-radius] duration-150 ease-out"
          :class="territory.collapsed && 'work-map-project-frame__surface--collapsed'"
          :style="territory.surfaceStyle"
        />
      </div>

      <div
        v-if="!territory.hiddenByCollapsedAncestor && !territory.collapsed"
        class="pointer-events-none absolute top-0 left-0 z-[10] overflow-visible"
        :style="territory.labelStyle"
        :data-test-id="`work-map-project-frame-chrome-${territory.project.id}`"
      >
        <div class="pointer-events-none absolute" :style="territory.grabSurfaceStyle">
          <span
            v-for="side in PROJECT_FRAME_GRAB_SIDES"
            :key="side"
            aria-hidden="true"
            class="work-map-project-frame__grab-rail absolute touch-none"
            :class="[
              `work-map-project-frame__grab-rail--${side}`,
              store.state.activeTool === 'SELECT'
                ? 'pointer-events-auto cursor-move'
                : 'pointer-events-none'
            ]"
            :data-grab-side="side"
            @dblclick.stop.prevent="focusProjectFrame(territory.frame.id)"
            @pointerdown.stop.prevent="beginProjectFrameMove(territory.frame, $event)"
            @pointermove.stop.prevent="moveProjectFrame"
            @pointerup.stop.prevent="endProjectFrameMove"
            @pointercancel.stop.prevent="cancelProjectFrameMove"
            @lostpointercapture="cancelProjectFrameMove"
          />
        </div>

        <div
          class="work-map-project-frame__label-group pointer-events-none absolute top-0 left-5 flex -translate-y-1/2 items-center rounded-[6px]"
        >
          <button
            v-if="territory.project.parentId"
            type="button"
            class="work-map-project-frame__collapse-action pointer-events-auto flex size-6 items-center justify-center rounded-[5px] border-0 bg-transparent text-muted transition-colors hover:bg-hover hover:text-surface active:bg-chrome-control active:text-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-component/30"
            :aria-expanded="!territory.collapsed"
            :aria-label="`${territory.collapsed ? 'Open' : 'Close'} ${territory.project.name} sub-bot on Board`"
            :title="`${territory.collapsed ? 'Open' : 'Close'} ${territory.project.name}`"
            :data-test-id="`toggle-work-map-project-${territory.project.id}`"
            @pointerdown.stop
            @dblclick.stop
            @click.stop="toggleProjectDirectory(territory.project.id)"
          >
            <icon-lucide-chevron-right
              class="size-3.5 stroke-[1.8] transition-transform duration-150"
              :class="!territory.collapsed && 'rotate-90'"
            />
          </button>
          <button
            type="button"
            class="work-map-project-frame__label flex h-6 touch-none items-center border-0 bg-transparent px-2 text-[11px] leading-none font-medium tracking-[-0.01em] whitespace-nowrap"
            :class="
              store.state.activeTool === 'SELECT'
                ? 'pointer-events-auto cursor-move'
                : 'pointer-events-none'
            "
            :aria-label="`Select and move ${territory.project.name} project frame`"
            :data-test-id="`work-map-project-frame-label-${territory.project.id}`"
            @click.stop="selectProjectFrame(territory.frame.id)"
            @dblclick.stop.prevent="focusProjectFrame(territory.frame.id)"
            @pointerdown.stop.prevent="beginProjectFrameMove(territory.frame, $event)"
            @pointermove.stop.prevent="moveProjectFrame"
            @pointerup.stop.prevent="endProjectFrameMove"
            @pointercancel.stop.prevent="cancelProjectFrameMove"
            @lostpointercapture="cancelProjectFrameMove"
          >
            <span>{{ territory.project.name }}</span>
          </button>
          <button
            type="button"
            class="work-map-project-frame__directory-action pointer-events-auto flex size-6 items-center justify-center rounded-[5px] border-0 bg-transparent text-muted transition-[background-color,color,opacity] hover:bg-hover hover:text-surface active:bg-chrome-control active:text-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-component/30"
            :aria-label="`Open ${territory.project.name} directory in sidebar`"
            :title="`Open ${territory.project.name} directory`"
            :data-test-id="`open-work-map-project-${territory.project.id}`"
            @pointerdown.stop
            @dblclick.stop
            @click.stop="openProjectDirectory(territory.project.id)"
          >
            <icon-lucide-panel-left-open class="size-3.5 stroke-[1.7]" />
          </button>
        </div>
      </div>

      <div
        v-if="!territory.hiddenByCollapsedAncestor && territory.collapsed"
        class="work-map-project-folder pointer-events-auto absolute top-0 left-0 z-[26] flex items-stretch overflow-hidden rounded-[9px]"
        :style="territory.collapsedCardStyle"
        :data-parent-project-id="territory.project.parentId"
        :data-folder-index="territory.collapsedSlotIndex"
        :data-test-id="`work-map-project-folder-${territory.project.id}`"
      >
        <button
          type="button"
          class="work-map-project-folder__open flex min-w-0 flex-1 items-center gap-2 border-0 bg-transparent px-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-component/30"
          :aria-expanded="false"
          :aria-label="`Open ${territory.project.name} sub-bot on Board`"
          :title="`Open ${territory.project.name}`"
          :data-test-id="`toggle-work-map-project-${territory.project.id}`"
          @pointerdown.stop
          @dblclick.stop
          @click.stop="toggleProjectDirectory(territory.project.id)"
        >
          <icon-lucide-panels-top-left
            aria-hidden="true"
            class="size-4 shrink-0 stroke-[1.6] text-component"
          />
          <span class="min-w-0 flex-1">
            <span
              class="block truncate text-[11px] leading-4 font-medium tracking-[-0.01em] text-surface/90"
            >
              {{ territory.project.name }}
            </span>
            <span
              class="block truncate text-[9px] leading-3 text-muted"
              data-test-id="work-map-project-closed-summary"
            >
              {{ territory.parentName }} · {{ countLabel(territory.objectCount, 'object') }} ·
              {{ countLabel(territory.conversationCount, 'chat') }}
            </span>
          </span>
          <icon-lucide-chevron-right
            aria-hidden="true"
            class="size-3.5 shrink-0 stroke-[1.8] text-muted"
          />
        </button>
        <button
          type="button"
          class="work-map-project-folder__directory-action flex w-8 shrink-0 items-center justify-center border-0 border-l border-chrome-border/60 bg-transparent text-muted transition-[background-color,color,opacity] hover:bg-hover hover:text-surface active:bg-chrome-control active:text-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-component/30"
          :aria-label="`Open ${territory.project.name} directory in sidebar`"
          :title="`Open ${territory.project.name} directory`"
          :data-test-id="`open-work-map-project-${territory.project.id}`"
          @pointerdown.stop
          @dblclick.stop
          @click.stop="openProjectDirectory(territory.project.id)"
        >
          <icon-lucide-panel-left-open class="size-3.5 stroke-[1.7]" />
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.work-map-project-frame__surface {
  border: 1px dashed color-mix(in srgb, var(--color-accent) 28%, var(--color-border));
  background: transparent;
}

.work-map-project-frame__surface--collapsed {
  border-style: solid;
  border-color: color-mix(in srgb, var(--color-accent) 20%, var(--color-border));
  background: color-mix(in srgb, var(--color-canvas) 99%, var(--color-chrome-raised));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-surface) 3%, transparent);
}

.work-map-project-folder {
  border: 1px solid color-mix(in srgb, var(--color-accent) 18%, var(--color-border));
  background: color-mix(in srgb, var(--color-chrome) 96%, var(--color-chrome-raised));
  box-shadow:
    0 5px 14px color-mix(in srgb, black 16%, transparent),
    0 1px 0 color-mix(in srgb, var(--color-surface) 5%, transparent) inset;
}

.work-map-project-folder__open:hover {
  background: color-mix(in srgb, var(--color-hover) 76%, transparent);
}

.work-map-project-folder__directory-action {
  pointer-events: none;
  opacity: 0;
}

.work-map-project-folder:hover .work-map-project-folder__directory-action,
.work-map-project-folder:focus-within .work-map-project-folder__directory-action,
.work-map-project-folder__directory-action:focus-visible {
  pointer-events: auto;
  opacity: 1;
}

.work-map-project-frame__label-group {
  background: color-mix(in srgb, var(--color-canvas) 94%, transparent);
  backdrop-filter: blur(5px);
}

.work-map-project-frame__label {
  appearance: none;
  color: color-mix(in srgb, var(--color-surface) 88%, var(--color-muted));
  user-select: none;
}

.work-map-project-frame__directory-action {
  opacity: 0;
}

.work-map-project-frame__label-group:hover .work-map-project-frame__directory-action,
.work-map-project-frame__label-group:focus-within .work-map-project-frame__directory-action,
.work-map-project-frame__directory-action:focus-visible {
  opacity: 1;
}

.work-map-project-frame__grab-rail--top,
.work-map-project-frame__grab-rail--bottom {
  right: -6px;
  left: -6px;
  height: 12px;
}

.work-map-project-frame__grab-rail--top {
  top: -6px;
}

.work-map-project-frame__grab-rail--bottom {
  bottom: -6px;
}

.work-map-project-frame__grab-rail--right,
.work-map-project-frame__grab-rail--left {
  top: 6px;
  bottom: 6px;
  width: 12px;
}

.work-map-project-frame__grab-rail--right {
  right: -6px;
}

.work-map-project-frame__grab-rail--left {
  left: -6px;
}
</style>
