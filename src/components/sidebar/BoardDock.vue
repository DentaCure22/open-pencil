<script setup lang="ts">
import { templateRef, useLocalStorage, useWindowSize } from '@vueuse/core'
import { useFlatReorderDrag } from '@open-pencil/vue'
import { computed, defineAsyncComponent, nextTick, ref, watch } from 'vue'
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuPortal,
  ContextMenuRoot,
  ContextMenuSeparator,
  ContextMenuTrigger,
  PopoverAnchor,
  PopoverContent,
  PopoverPortal,
  PopoverRoot,
  PopoverTrigger
} from 'reka-ui'

import type { BoardIconKey } from '@/app/sidebar-workspace/icons'
import { switchSidebarWorkspaceBoard } from '@/app/sidebar-workspace/navigation'
import { updateRecentBoardIds, updateWarmBoardIds } from '@/app/sidebar-workspace/recent'
import {
  orderedSidebarBoards,
  orderedSidebarPages,
  resolveSidebarWorkspace,
  type SidebarWorkspaceBoard,
  type SidebarWorkspacePage
} from '@/app/sidebar-workspace/tree'
import { useEditorStore } from '@/app/editor/active-store'
import BoardIcon from '@/components/pages-panel/BoardIcon.vue'
import BoardSwitcher from '@/components/sidebar/board-dock/BoardSwitcher.vue'
import type { BoardSwitcherItem, BoardSwitcherProject } from '@/components/sidebar/board-dock/types'
import Tip from '@/components/ui/Tip.vue'
import { useMenuUI } from '@/components/ui/menu'
import { usePopoverUI } from '@/components/ui/popover'

const PagesPanel = defineAsyncComponent(() => import('@/components/PagesPanel.vue'))

const { sidebarOpen = true } = defineProps<{ sidebarOpen?: boolean }>()

type BoardDockState = {
  boardIds: string[]
  customized: boolean
}

type BrowserMode = 'manage' | 'switch'

type DockBoard = {
  icon?: BoardIconKey
  label: string
  pageId: string
}

type DockMetrics = {
  buttonRadius: number
  dividerHeight: number
  dividerMargin: number
  dotGap: number
  dotSize: number
  gap: number
  glyphSize: number
  iconRadius: number
  iconSize: number
  padding: number
  scale: number
  shellRadius: number
  tileSize: number
}

type DockSection = {
  boards: DockBoard[]
  id: 'pins' | 'recents'
}

type PagesPanelActions = {
  createBoard(parentPageId: string): Promise<void>
  createPage(parentId?: string | null): Promise<void>
}

type SwitcherBoard = DockBoard | SidebarWorkspaceBoard

const DOCK_PREFERRED_TILE_SIZE = 36
const DOCK_MINIMUM_TILE_SIZE = 16
const DOCK_PREFERRED_GAP = 8
const DOCK_PREFERRED_PADDING = 8
const DOCK_PREFERRED_DIVIDER_MARGIN = 6
const DOCK_PREFERRED_DIVIDER_WIDTH = DOCK_PREFERRED_DIVIDER_MARGIN * 2 + 1
const DOCK_VIEWPORT_MARGIN = 24
const RECENT_BOARD_HISTORY_LIMIT = 6
const RECENT_DOCK_LIMIT = 3
const PINNED_SWITCHER_LIMIT = 3
const RECENT_SWITCHER_LIMIT = 3

function scaledDockMetric(value: number, scale: number, minimum: number) {
  return Math.max(minimum, Math.round(value * scale * 10) / 10)
}

const store = useEditorStore()
const { width: viewportWidth } = useWindowSize()
const projectBrowserOpen = defineModel<boolean>('open', { default: false })
const dockState = useLocalStorage<BoardDockState>('open-pencil:board-dock:v2', {
  boardIds: [],
  customized: false
})
const recentBoardIds = useLocalStorage<string[]>('open-pencil:board-recents:v1', [])
const warmBoardIds = useLocalStorage<string[]>('open-pencil:board-warm:v1', [])
const openBoardIds = useLocalStorage<string[]>('open-pencil:board-open:v1', [])
const browserMode = ref<BrowserMode>('switch')
const pagesPanel = templateRef<PagesPanelActions>('pagesPanel')
const contextMenu = useMenuUI({ content: 'min-w-44' })
const popover = usePopoverUI({
  content:
    'z-[80] flex max-h-[min(552px,72vh)] w-[352px] flex-col overflow-hidden rounded-[14px] border-chrome-border bg-chrome-raised p-0 text-surface shadow-chrome-menu backdrop-blur-2xl'
})

const workspace = computed(() => {
  void store.state.sceneVersion
  return resolveSidebarWorkspace(store.graph).workspace
})

function boardLabel(board: SwitcherBoard) {
  return board.label ?? store.graph.getNode(board.pageId)?.name ?? 'Untitled board'
}

const boardById = computed(
  () => new Map(workspace.value.boards.map((board) => [board.pageId, board]))
)
const pageById = computed(() => new Map(workspace.value.pages.map((page) => [page.id, page])))
const pinnedBoards = computed(() =>
  dockState.value.boardIds.flatMap((id) => {
    const board = boardById.value.get(id)
    return board ? [board] : []
  })
)
const currentBoard = computed<SwitcherBoard | null>(() => {
  const current = boardById.value.get(store.state.currentPageId)
  if (current) return current
  const page = store.graph.getNode(store.state.currentPageId)
  return page ? { label: page.name || 'Current board', pageId: page.id } : null
})
const currentWorkspaceBoard = computed(() => boardById.value.get(store.state.currentPageId) ?? null)
const currentProject = computed(() => {
  const current = currentWorkspaceBoard.value
  return current ? (pageById.value.get(current.parentPageId) ?? null) : null
})
const currentPath = computed(() => {
  const board = currentBoard.value
  if (!board) return 'Choose a board'
  const projectName = currentProject.value?.name
  return projectName ? `${projectName} / ${boardLabel(board)}` : boardLabel(board)
})
function dockBoard(board: SwitcherBoard): DockBoard {
  return {
    icon: boardById.value.get(board.pageId)?.icon,
    label: boardLabel(board),
    pageId: board.pageId
  }
}

const visiblePinnedBoards = computed<DockBoard[]>(() => pinnedBoards.value.map(dockBoard))
const pinnedDragItems = computed(() =>
  visiblePinnedBoards.value.map((board) => ({ id: board.pageId }))
)
const visibleRecentBoards = computed<DockBoard[]>(() => {
  const pinnedIds = new Set(pinnedBoards.value.map((board) => board.pageId))
  return warmBoardIds.value.flatMap((id) => {
    if (pinnedIds.has(id)) return []
    const board = boardById.value.get(id)
    return board ? [dockBoard(board)] : []
  })
})
const dockSections = computed<DockSection[]>(() => {
  const sections: DockSection[] = []
  if (visiblePinnedBoards.value.length) {
    sections.push({ boards: visiblePinnedBoards.value, id: 'pins' })
  }
  if (visibleRecentBoards.value.length) {
    sections.push({ boards: visibleRecentBoards.value, id: 'recents' })
  }
  return sections
})
const visibleDockBoards = computed(() => dockSections.value.flatMap((section) => section.boards))

function reorderPinnedBoard(sourceId: string, targetIndex: number) {
  const sourceIndex = dockState.value.boardIds.indexOf(sourceId)
  if (sourceIndex === -1 || targetIndex === -1 || targetIndex >= dockState.value.boardIds.length)
    return
  const nextBoardIds = [...dockState.value.boardIds]
  const [sourceBoardId] = nextBoardIds.splice(sourceIndex, 1)
  if (!sourceBoardId) return
  nextBoardIds.splice(targetIndex, 0, sourceBoardId)
  dockState.value = { boardIds: nextBoardIds, customized: true }
}

const {
  draggingId: draggingPinnedBoardId,
  instruction: pinnedDropInstruction,
  instructionTargetId: pinnedDropTargetId,
  setupItem: setupPinnedBoardItem
} = useFlatReorderDrag({
  axis: 'horizontal',
  items: () => pinnedDragItems.value,
  onMove: reorderPinnedBoard
})

function setPinnedBoardElement(value: unknown, boardPageId: string) {
  setupPinnedBoardItem(value instanceof HTMLElement ? value : null, () => ({ id: boardPageId }))
}

function pinnedDropEdge(boardPageId: string) {
  if (pinnedDropTargetId.value !== boardPageId) return null
  const operation = pinnedDropInstruction.value?.operation
  if (operation === 'reorder-before') return 'before'
  if (operation === 'reorder-after') return 'after'
  return null
}
function rootProject(page: SidebarWorkspacePage | null): SidebarWorkspacePage | null {
  let current = page
  const seen = new Set<string>()
  while (current?.parentId && !seen.has(current.id)) {
    seen.add(current.id)
    current = pageById.value.get(current.parentId) ?? null
  }
  return current
}

const rootProjects = computed(() => {
  const pages = orderedSidebarPages(workspace.value, null)
  const activeRootId = rootProject(currentProject.value)?.id
  if (!activeRootId) return pages
  return [
    ...pages.filter((page) => page.id === activeRootId),
    ...pages.filter((page) => page.id !== activeRootId)
  ]
})

function projectNameForBoard(board: SwitcherBoard) {
  const workspaceBoard = boardById.value.get(board.pageId)
  return workspaceBoard ? pageById.value.get(workspaceBoard.parentPageId)?.name : undefined
}

function switcherItem(board: SwitcherBoard): BoardSwitcherItem {
  return {
    icon: boardById.value.get(board.pageId)?.icon,
    label: boardLabel(board),
    pageId: board.pageId,
    projectName: projectNameForBoard(board) ?? 'Unfiled'
  }
}

const allSwitcherItems = computed(() => workspace.value.boards.map(switcherItem))
const switcherPinnedBoards = computed(() =>
  pinnedBoards.value.slice(0, PINNED_SWITCHER_LIMIT).map(switcherItem)
)
const switcherRecentBoards = computed(() => {
  const pinnedIds = new Set(dockState.value.boardIds)
  return recentBoardIds.value
    .filter((id) => !pinnedIds.has(id))
    .flatMap((id) => {
      const board = boardById.value.get(id)
      return board ? [switcherItem(board)] : []
    })
    .slice(0, RECENT_SWITCHER_LIMIT)
})
function switcherProject(page: SidebarWorkspacePage): BoardSwitcherProject {
  return {
    boards: orderedSidebarBoards(workspace.value, page.id).map(switcherItem),
    children: orderedSidebarPages(workspace.value, page.id).map(switcherProject),
    id: page.id,
    name: page.name
  }
}

const switcherProjects = computed<BoardSwitcherProject[]>(() =>
  rootProjects.value.map(switcherProject)
)
const dockMetrics = computed<DockMetrics>(() => {
  const shellItemCount = visibleDockBoards.value.length + 1
  const gapCount = Math.max(visibleDockBoards.value.length - 1, 0)
  const dividerCount =
    (dockSections.value.length > 1 ? 1 : 0) + (visibleDockBoards.value.length > 0 ? 1 : 0)
  const dividerWidth = dividerCount * DOCK_PREFERRED_DIVIDER_WIDTH
  const preferredWidth =
    shellItemCount * DOCK_PREFERRED_TILE_SIZE +
    gapCount * DOCK_PREFERRED_GAP +
    DOCK_PREFERRED_PADDING * 2 +
    dividerWidth
  const availableWidth = Math.max(viewportWidth.value - DOCK_VIEWPORT_MARGIN, 1)
  const fitScale = Math.min(1, availableWidth / preferredWidth)
  const minimumScale = DOCK_MINIMUM_TILE_SIZE / DOCK_PREFERRED_TILE_SIZE
  const scale = Math.max(minimumScale, fitScale)
  const tileSize = scaledDockMetric(DOCK_PREFERRED_TILE_SIZE, scale, DOCK_MINIMUM_TILE_SIZE)

  return {
    buttonRadius: scaledDockMetric(8, scale, 4),
    dividerHeight: scaledDockMetric(28, scale, 10),
    dividerMargin: scaledDockMetric(DOCK_PREFERRED_DIVIDER_MARGIN, scale, 2),
    dotGap: scaledDockMetric(3, scale, 1.5),
    dotSize: scaledDockMetric(4, scale, 2),
    gap: scaledDockMetric(DOCK_PREFERRED_GAP, scale, 1),
    glyphSize: scaledDockMetric(18, scale, 8),
    iconRadius: scaledDockMetric(8, scale, 4),
    iconSize: scaledDockMetric(36, scale, 13),
    padding: scaledDockMetric(DOCK_PREFERRED_PADDING, scale, 2),
    scale,
    shellRadius: scaledDockMetric(14, scale, 7),
    tileSize
  }
})
const dockStyle = computed(() => ({
  '--dock-button-radius': `${dockMetrics.value.buttonRadius}px`,
  '--dock-divider-height': `${dockMetrics.value.dividerHeight}px`,
  '--dock-divider-margin': `${dockMetrics.value.dividerMargin}px`,
  '--dock-dot-gap': `${dockMetrics.value.dotGap}px`,
  '--dock-dot-size': `${dockMetrics.value.dotSize}px`,
  '--dock-gap': `${dockMetrics.value.gap}px`,
  '--dock-glyph-size': `${dockMetrics.value.glyphSize}px`,
  '--dock-icon-radius': `${dockMetrics.value.iconRadius}px`,
  '--dock-icon-size': `${dockMetrics.value.iconSize}px`,
  '--dock-padding': `${dockMetrics.value.padding}px`,
  '--dock-shell-radius': `${dockMetrics.value.shellRadius}px`,
  '--dock-tile-size': `${dockMetrics.value.tileSize}px`
}))

function uniqueBoardIds(boardIds: string[]) {
  return boardIds.filter((id, index) => boardIds.indexOf(id) === index)
}

function setOpenBoardIds(nextIds: string[]) {
  const next = uniqueBoardIds(nextIds)
  if (
    next.length === openBoardIds.value.length &&
    next.every((id, index) => openBoardIds.value[index] === id)
  )
    return
  openBoardIds.value = next
}

function reconcileOpenBoardIds() {
  const validIds = new Set(boardById.value.keys())
  const pinnedIds = new Set(dockState.value.boardIds)
  const warmIds = new Set(warmBoardIds.value)
  const currentId = store.state.currentPageId
  setOpenBoardIds(
    uniqueBoardIds([currentId, ...openBoardIds.value, ...warmBoardIds.value]).filter(
      (id) => validIds.has(id) && (id === currentId || pinnedIds.has(id) || warmIds.has(id))
    )
  )
}

watch(
  workspace,
  (nextWorkspace) => {
    const validIds = new Set(nextWorkspace.boards.map((board) => board.pageId))
    if (!dockState.value.customized && dockState.value.boardIds.length === 0 && validIds.size > 0) {
      const defaults = [store.state.currentPageId, ...validIds]
        .filter((id, index, ids) => validIds.has(id) && ids.indexOf(id) === index)
        .slice(0, 5)
      dockState.value = { boardIds: defaults, customized: false }
    } else {
      const validPinnedIds = dockState.value.boardIds.filter((id) => validIds.has(id))
      if (validPinnedIds.length !== dockState.value.boardIds.length) {
        dockState.value = { ...dockState.value, boardIds: validPinnedIds }
      }
    }
    recentBoardIds.value = recentBoardIds.value.filter((id) => validIds.has(id))
    warmBoardIds.value = warmBoardIds.value.filter(
      (id) => validIds.has(id) && !dockState.value.boardIds.includes(id)
    )
    reconcileOpenBoardIds()
  },
  { immediate: true }
)

watch(
  () => store.state.currentPageId,
  (currentId) => {
    recentBoardIds.value = updateRecentBoardIds({
      boardIds: recentBoardIds.value,
      currentId,
      limit: RECENT_BOARD_HISTORY_LIMIT,
      validIds: boardById.value.keys()
    })
    warmBoardIds.value = updateWarmBoardIds({
      boardIds: warmBoardIds.value,
      currentId,
      limit: RECENT_DOCK_LIMIT,
      pinnedIds: dockState.value.boardIds,
      recentIds: recentBoardIds.value,
      validIds: boardById.value.keys()
    })
    reconcileOpenBoardIds()
  },
  { immediate: true }
)

function isPinned(boardPageId: string) {
  return dockState.value.boardIds.includes(boardPageId)
}

function isBoardOpen(boardPageId: string) {
  return openBoardIds.value.includes(boardPageId)
}

function togglePinned(boardPageId: string) {
  const wasPinned = isPinned(boardPageId)
  const boardIds = wasPinned
    ? dockState.value.boardIds.filter((id) => id !== boardPageId)
    : [...dockState.value.boardIds, boardPageId]
  dockState.value = { boardIds, customized: true }
  if (wasPinned) {
    warmBoardIds.value = isBoardOpen(boardPageId)
      ? updateWarmBoardIds({
          boardIds: warmBoardIds.value,
          currentId: boardPageId,
          limit: RECENT_DOCK_LIMIT,
          pinnedIds: boardIds,
          recentIds: recentBoardIds.value,
          validIds: boardById.value.keys()
        })
      : warmBoardIds.value.filter((id) => id !== boardPageId)
  } else {
    warmBoardIds.value = warmBoardIds.value.filter((id) => id !== boardPageId)
  }
  reconcileOpenBoardIds()
}

function fallbackOpenBoardId(closingBoardPageId: string) {
  const candidates = uniqueBoardIds([
    ...recentBoardIds.value,
    ...dockState.value.boardIds,
    ...openBoardIds.value
  ])
  return (
    candidates.find(
      (id) => id !== closingBoardPageId && isBoardOpen(id) && Boolean(boardById.value.get(id))
    ) ?? null
  )
}

function canCloseBoard(boardPageId: string) {
  if (!isBoardOpen(boardPageId)) return false
  return boardPageId !== store.state.currentPageId || Boolean(fallbackOpenBoardId(boardPageId))
}

async function closeBoard(boardPageId: string) {
  if (!canCloseBoard(boardPageId)) return
  if (boardPageId === store.state.currentPageId) {
    const fallbackId = fallbackOpenBoardId(boardPageId)
    if (!fallbackId) return
    await switchSidebarWorkspaceBoard(store, fallbackId)
  }
  warmBoardIds.value = warmBoardIds.value.filter((id) => id !== boardPageId)
  setOpenBoardIds(openBoardIds.value.filter((id) => id !== boardPageId))
}

function enterManageMode() {
  browserMode.value = 'manage'
}

function closeProjectBrowser() {
  projectBrowserOpen.value = false
}

async function createBoardFromSwitcher() {
  const parentPageId = currentWorkspaceBoard.value?.parentPageId ?? rootProjects.value[0]?.id
  enterManageMode()
  await nextTick()
  if (parentPageId) await pagesPanel.value?.createBoard(parentPageId)
}

async function createProjectFromSwitcher() {
  enterManageMode()
  await nextTick()
  await pagesPanel.value?.createPage()
}

async function openBoard(board: SwitcherBoard) {
  await switchSidebarWorkspaceBoard(store, board.pageId)
}

async function openBoardById(boardPageId: string) {
  await switchSidebarWorkspaceBoard(store, boardPageId)
}
</script>

<template>
  <div
    data-test-id="board-dock"
    :data-sidebar-open="sidebarOpen"
    class="pointer-events-auto absolute bottom-3 left-1/2 z-30 flex -translate-x-1/2 transform-gpu items-center transition-transform duration-200 ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none"
  >
    <div
      data-test-id="board-dock-shell"
      data-dock-layout="unified"
      :data-dock-icon-radius="dockMetrics.iconRadius"
      :data-dock-padding="dockMetrics.padding"
      :data-dock-scale="dockMetrics.scale.toFixed(3)"
      :data-dock-shell-radius="dockMetrics.shellRadius"
      :data-dock-tile-size="dockMetrics.tileSize"
      :style="dockStyle"
      class="dock-shell border-chrome-border bg-chrome flex max-w-[calc(100vw-24px)] items-center rounded-[var(--dock-shell-radius)] border p-[var(--dock-padding)] backdrop-blur-2xl transition-[padding,border-radius] duration-150"
    >
      <template v-for="(section, sectionIndex) in dockSections" :key="section.id">
        <span
          v-if="sectionIndex > 0"
          data-test-id="board-dock-section-divider"
          class="bg-border/70 mx-[var(--dock-divider-margin)] h-[var(--dock-divider-height)] w-px"
        />
        <div
          class="flex min-w-0 items-center gap-[var(--dock-gap)] transition-[gap] duration-150"
          :data-test-id="`board-dock-${section.id}`"
        >
          <ContextMenuRoot v-for="board in section.boards" :key="board.pageId" :modal="false">
            <Tip :label="boardLabel(board)" :delay="0">
              <ContextMenuTrigger as-child>
                <button
                  :ref="
                    (value) =>
                      setPinnedBoardElement(section.id === 'pins' ? value : null, board.pageId)
                  "
                  type="button"
                  :data-test-id="`board-dock-board-${board.pageId}`"
                  :data-dock-group="section.id"
                  :data-dragging="draggingPinnedBoardId === board.pageId || undefined"
                  :data-drop-edge="pinnedDropEdge(board.pageId) ?? undefined"
                  :aria-label="`Open ${boardLabel(board)}`"
                  class="group/dock-item relative flex size-[var(--dock-tile-size)] shrink-0 items-center justify-center rounded-[var(--dock-button-radius)] text-muted transition-[width,height,color,border-radius,opacity,transform] duration-150 hover:text-surface"
                  :class="[
                    section.id === 'pins' ? 'cursor-grab active:cursor-grabbing' : '',
                    draggingPinnedBoardId === board.pageId ? 'scale-110 opacity-60' : ''
                  ]"
                  @click="openBoard(board)"
                >
                  <span
                    v-if="pinnedDropEdge(board.pageId)"
                    aria-hidden="true"
                    class="absolute inset-y-1 z-10 w-0.5 rounded-full bg-violet-300 shadow-[0_0_8px_rgba(196,181,253,0.7)]"
                    :class="pinnedDropEdge(board.pageId) === 'before' ? '-left-1' : '-right-1'"
                  />
                  <span
                    data-test-id="board-dock-board-tile"
                    class="group-hover/dock-item:border-border/70 group-hover/dock-item:bg-hover flex size-[var(--dock-icon-size)] items-center justify-center rounded-[var(--dock-icon-radius)] border border-transparent bg-transparent transition-[width,height,border-color,background-color,border-radius] duration-150"
                  >
                    <BoardIcon
                      :icon="board.icon"
                      :data-board-icon="board.icon ?? 'canvas'"
                      class="size-[var(--dock-glyph-size)] stroke-[1.6] opacity-80"
                    />
                  </span>
                  <span
                    v-if="isBoardOpen(board.pageId) && visibleDockBoards.length > 1"
                    class="absolute bottom-0 left-1/2 size-[var(--dock-dot-size)] -translate-x-1/2 translate-y-[calc(100%+var(--dock-dot-gap))] rounded-full bg-violet-300"
                    aria-hidden="true"
                  />
                </button>
              </ContextMenuTrigger>
            </Tip>
            <ContextMenuPortal>
              <ContextMenuContent
                :data-test-id="`board-dock-context-${board.pageId}`"
                :class="contextMenu.content"
                :side-offset="4"
              >
                <ContextMenuItem
                  :data-test-id="`board-dock-open-${board.pageId}`"
                  :class="contextMenu.item"
                  @select="openBoard(board)"
                >
                  <icon-lucide-folder-open :class="contextMenu.icon" />
                  <span>Open Board</span>
                </ContextMenuItem>
                <ContextMenuSeparator :class="contextMenu.separator" />
                <ContextMenuItem
                  :data-test-id="`board-dock-pin-${board.pageId}`"
                  :class="contextMenu.item"
                  @select="togglePinned(board.pageId)"
                >
                  <icon-lucide-pin-off v-if="isPinned(board.pageId)" :class="contextMenu.icon" />
                  <icon-lucide-pin v-else :class="contextMenu.icon" />
                  <span>{{ isPinned(board.pageId) ? 'Unpin from Dock' : 'Pin to Dock' }}</span>
                </ContextMenuItem>
                <ContextMenuItem
                  v-if="isBoardOpen(board.pageId)"
                  :data-test-id="`board-dock-close-${board.pageId}`"
                  :class="contextMenu.item"
                  :disabled="!canCloseBoard(board.pageId)"
                  @select="closeBoard(board.pageId)"
                >
                  <icon-lucide-x :class="contextMenu.icon" />
                  <span>Close Board</span>
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenuPortal>
          </ContextMenuRoot>
        </div>
      </template>

      <span
        v-if="visibleDockBoards.length"
        data-test-id="board-dock-utility-divider"
        aria-hidden="true"
        class="bg-border/60 mx-[var(--dock-divider-margin)] h-[var(--dock-divider-height)] w-px self-center"
      />

      <PopoverRoot v-model:open="projectBrowserOpen">
        <PopoverTrigger as-child>
          <button
            type="button"
            data-test-id="board-dock-more"
            data-dock-group="workspace"
            aria-label="Workspace"
            class="group/dock-item flex size-[var(--dock-tile-size)] shrink-0 items-center justify-center rounded-[var(--dock-button-radius)] text-muted transition-[width,height,color,border-radius] duration-150 hover:text-surface"
          >
            <Tip label="Workspace" :delay="0">
              <span
                data-test-id="board-dock-more-tile"
                class="group-hover/dock-item:border-border/70 group-hover/dock-item:bg-hover flex size-[var(--dock-icon-size)] items-center justify-center rounded-[var(--dock-icon-radius)] border border-transparent bg-transparent transition-[width,height,border-color,background-color,border-radius] duration-150"
              >
                <icon-lucide-library
                  class="size-[var(--dock-glyph-size)] stroke-[1.55] opacity-80"
                />
              </span>
            </Tip>
          </button>
        </PopoverTrigger>

        <PopoverAnchor as-child>
          <span
            data-test-id="board-project-browser-anchor"
            aria-hidden="true"
            class="pointer-events-none absolute top-0 left-1/2 size-px -translate-x-1/2"
          />
        </PopoverAnchor>

        <PopoverPortal>
          <PopoverContent
            data-test-id="board-project-browser"
            :class="[popover.content, 'h-[min(552px,72vh)]']"
            side="top"
            align="center"
            :side-offset="10"
            @keydown.esc.capture.stop.prevent="closeProjectBrowser"
          >
            <div
              data-test-id="board-switcher-header"
              class="border-border/70 flex h-12 shrink-0 items-center gap-2 border-b px-3.5"
            >
              <button
                v-if="browserMode === 'manage'"
                type="button"
                data-test-id="board-switcher-back"
                aria-label="Back to board switcher"
                class="flex size-7 shrink-0 items-center justify-center rounded-[7px] text-muted transition-colors hover:bg-hover hover:text-surface"
                @click="browserMode = 'switch'"
              >
                <icon-lucide-arrow-left class="size-3.5 stroke-[1.6]" />
              </button>

              <div class="min-w-0 flex-1">
                <div class="text-[12.5px] font-medium tracking-[-0.005em] text-surface">
                  {{ browserMode === 'switch' ? 'Workspace' : 'Organize workspace' }}
                </div>
                <div class="mt-0.5 truncate text-[9.5px] text-muted/70">
                  {{ browserMode === 'switch' ? currentPath : 'Rename, reorder, add, or delete' }}
                </div>
              </div>
            </div>

            <BoardSwitcher
              v-if="browserMode === 'switch'"
              :all-boards="allSwitcherItems"
              :current-page-id="store.state.currentPageId"
              :pinned-board-ids="dockState.boardIds"
              :pinned-boards="switcherPinnedBoards"
              :projects="switcherProjects"
              :recent-boards="switcherRecentBoards"
              @create-board="createBoardFromSwitcher"
              @create-project="createProjectFromSwitcher"
              @manage="enterManageMode"
              @open-board="openBoardById"
              @toggle-pinned="togglePinned"
            />

            <PagesPanel v-else ref="pagesPanel" dock @board-opened="openBoard">
              <template #board-action="{ board, label }">
                <Tip
                  :label="
                    isPinned(board.pageId) ? `Remove ${label} from dock` : `Keep ${label} in dock`
                  "
                >
                  <button
                    type="button"
                    :data-test-id="`board-pin-${board.pageId}`"
                    :aria-label="
                      isPinned(board.pageId) ? `Remove ${label} from dock` : `Keep ${label} in dock`
                    "
                    class="flex size-5 shrink-0 items-center justify-center rounded-[4px] text-muted opacity-0 transition-all hover:bg-hover hover:text-surface group-hover/board:opacity-100"
                    :class="isPinned(board.pageId) ? 'text-violet-200 opacity-100' : ''"
                    @click.stop="togglePinned(board.pageId)"
                  >
                    <icon-lucide-pin class="size-3 stroke-[1.6]" />
                  </button>
                </Tip>
              </template>
            </PagesPanel>
          </PopoverContent>
        </PopoverPortal>
      </PopoverRoot>
    </div>
  </div>
</template>

<style scoped>
.dock-shell {
  filter: drop-shadow(0 12px 28px rgb(0 0 0 / 0.28));
}
</style>
