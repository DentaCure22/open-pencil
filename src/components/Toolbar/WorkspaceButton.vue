<script setup lang="ts">
import { templateRef, useEventListener, useLocalStorage } from '@vueuse/core'
import { computed, defineAsyncComponent, nextTick, ref, watch } from 'vue'
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui'

import { useEditorStore } from '@/app/editor/active-store'
import { IconlyCategory as IconLibrary } from '@/components/icons/iconly'
import { switchSidebarWorkspaceBoard } from '@/app/sidebar-workspace/navigation'
import { updateRecentBoardIds } from '@/app/sidebar-workspace/recent'
import {
  orderedSidebarBoards,
  orderedSidebarPages,
  resolveSidebarWorkspace,
  type SidebarWorkspaceBoard,
  type SidebarWorkspacePage
} from '@/app/sidebar-workspace/tree'
import BoardSwitcher from '@/components/sidebar/board-switcher/BoardSwitcher.vue'
import type {
  BoardSwitcherItem,
  BoardSwitcherProject
} from '@/components/sidebar/board-switcher/types'
import ToolButton from '@/components/Toolbar/ToolButton.vue'
import { usePopoverUI } from '@/components/ui/popover'

const PagesPanel = defineAsyncComponent(() => import('@/components/PagesPanel.vue'))

type BrowserMode = 'manage' | 'switch'

type PagesPanelActions = {
  createBoard(parentPageId: string): Promise<void>
  createPage(parentId?: string | null): Promise<void>
}

type BoardSwitcherActions = {
  focusSearch(clear?: boolean): Promise<void>
}

const RECENT_BOARD_HISTORY_LIMIT = 6
const RECENT_SWITCHER_LIMIT = 3

const store = useEditorStore()
const open = ref(false)
const browserMode = ref<BrowserMode>('switch')
const pagesPanel = templateRef<PagesPanelActions>('pagesPanel')
const boardSwitcher = templateRef<BoardSwitcherActions>('boardSwitcher')
const recentBoardIds = useLocalStorage<string[]>('open-pencil:board-recents:v1', [])
const popover = usePopoverUI({
  content:
    'z-[80] flex h-[min(552px,72vh)] max-h-[min(552px,72vh)] w-[352px] flex-col overflow-hidden rounded-[14px] border-chrome-border bg-chrome-raised p-0 text-surface shadow-chrome-menu backdrop-blur-2xl'
})

const workspace = computed(() => {
  void store.state.sceneVersion
  return resolveSidebarWorkspace(store.graph).workspace
})
const boardById = computed(
  () => new Map(workspace.value.boards.map((board) => [board.pageId, board]))
)
const pageById = computed(() => new Map(workspace.value.pages.map((page) => [page.id, page])))
const currentBoard = computed(() => boardById.value.get(store.state.currentPageId) ?? null)
const currentProject = computed(() => {
  const board = currentBoard.value
  return board ? (pageById.value.get(board.parentPageId) ?? null) : null
})
const currentPath = computed(() => {
  const board = currentBoard.value
  const boardName = board?.label ?? store.graph.getNode(store.state.currentPageId)?.name
  if (!boardName) return 'Choose a board'
  return currentProject.value ? `${currentProject.value.name} / ${boardName}` : boardName
})

function boardLabel(board: SidebarWorkspaceBoard) {
  return board.label ?? store.graph.getNode(board.pageId)?.name ?? 'Untitled board'
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
  const projects = orderedSidebarPages(workspace.value, null)
  const activeRootId = rootProject(currentProject.value)?.id
  if (!activeRootId) return projects
  return [
    ...projects.filter((project) => project.id === activeRootId),
    ...projects.filter((project) => project.id !== activeRootId)
  ]
})

function switcherItem(board: SidebarWorkspaceBoard): BoardSwitcherItem {
  return {
    icon: board.icon,
    label: boardLabel(board),
    pageId: board.pageId,
    projectName: pageById.value.get(board.parentPageId)?.name ?? 'Unfiled'
  }
}

function switcherProject(page: SidebarWorkspacePage): BoardSwitcherProject {
  return {
    boards: orderedSidebarBoards(workspace.value, page.id).map(switcherItem),
    children: orderedSidebarPages(workspace.value, page.id).map(switcherProject),
    id: page.id,
    name: page.name
  }
}

const allBoards = computed(() => workspace.value.boards.map(switcherItem))
const recentBoards = computed(() =>
  recentBoardIds.value
    .flatMap((id) => {
      const board = boardById.value.get(id)
      return board ? [switcherItem(board)] : []
    })
    .slice(0, RECENT_SWITCHER_LIMIT)
)
const projects = computed(() => rootProjects.value.map(switcherProject))

watch(
  workspace,
  (nextWorkspace) => {
    const validIds = new Set(nextWorkspace.boards.map((board) => board.pageId))
    recentBoardIds.value = recentBoardIds.value.filter((id) => validIds.has(id))
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
  },
  { immediate: true }
)

function enterManageMode() {
  browserMode.value = 'manage'
}

async function createBoard() {
  const parentPageId = currentBoard.value?.parentPageId ?? rootProjects.value[0]?.id
  enterManageMode()
  await nextTick()
  if (parentPageId) await pagesPanel.value?.createBoard(parentPageId)
}

async function createProject() {
  enterManageMode()
  await nextTick()
  await pagesPanel.value?.createPage()
}

async function openBoard(boardPageId: string) {
  await switchSidebarWorkspaceBoard(store, boardPageId)
  open.value = false
}

async function openManagedBoard(board: SidebarWorkspaceBoard) {
  await openBoard(board.pageId)
}

async function openBoardSearch() {
  browserMode.value = 'switch'
  open.value = true
  await nextTick()
  await boardSwitcher.value?.focusSearch(true)
}

useEventListener(window, 'keydown', (event) => {
  if (event.code !== 'KeyK' || (!event.metaKey && !event.ctrlKey) || event.altKey || event.shiftKey)
    return

  event.preventDefault()
  event.stopPropagation()
  void openBoardSearch()
})
</script>

<template>
  <PopoverRoot v-model:open="open">
    <PopoverTrigger as-child>
      <ToolButton
        data-test-id="workspace-toolbar-button"
        aria-keyshortcuts="Meta+K Control+K"
        :icon="IconLibrary"
        label="Workspace"
        :active="open"
        variant="utility"
      />
    </PopoverTrigger>

    <PopoverPortal>
      <PopoverContent
        data-test-id="board-project-browser"
        :class="popover.content"
        side="right"
        align="center"
        :side-offset="10"
        @keydown.esc.capture.stop.prevent="open = false"
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
          ref="boardSwitcher"
          :all-boards="allBoards"
          :current-page-id="store.state.currentPageId"
          :projects="projects"
          :recent-boards="recentBoards"
          @create-board="createBoard"
          @create-project="createProject"
          @manage="enterManageMode"
          @open-board="openBoard"
        />

        <PagesPanel v-else ref="pagesPanel" dock @board-opened="openManagedBoard" />
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
