<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { templateRef } from '@vueuse/core'
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from 'reka-ui'

import { useInlineRename } from '@open-pencil/vue'

import {
  createSidebarBoard,
  createSidebarPage,
  moveSidebarBoard,
  moveSidebarPage,
  orderedSidebarBoards,
  orderedSidebarPages,
  removeSidebarBoard,
  removeSidebarPage,
  renameSidebarBoard,
  renameSidebarPage,
  resolveSidebarWorkspace,
  setSidebarBoardIcon,
  sidebarWorkspacePluginData,
  type SidebarPageId,
  type SidebarWorkspace,
  type SidebarWorkspaceBoard,
  type SidebarWorkspacePage
} from '@/app/sidebar-workspace/tree'
import type { BoardIconKey } from '@/app/sidebar-workspace/icons'
import { switchSidebarWorkspaceBoard } from '@/app/sidebar-workspace/navigation'
import { useEditorStore } from '@/app/editor/active-store'
import BoardDeleteDialog from '@/components/pages-panel/BoardDeleteDialog.vue'
import BoardIcon from '@/components/pages-panel/BoardIcon.vue'
import BoardIconMenu from '@/components/pages-panel/BoardIconMenu.vue'
import BoardIdentityDialog from '@/components/pages-panel/BoardIdentityDialog.vue'

type PageRow = {
  depth: number
  id: SidebarPageId
  itemType: 'page'
  page: SidebarWorkspacePage
}

type BoardRow = {
  board: SidebarWorkspaceBoard
  depth: number
  id: string
  itemType: 'board'
  label: string
  parentPageId: SidebarPageId
}

type TreeRow = PageRow | BoardRow
type DraggableRow = PageRow | BoardRow
type DragIntent = 'before' | 'after' | 'inside'
type DragState = {
  id: string
  itemType: 'board' | 'page'
}
type BoardDeletionTarget = {
  label: string
  pageId: string
}
type BoardIdentityRequest =
  | {
      initialIcon: BoardIconKey
      mode: 'create'
      parentPageId: SidebarPageId
    }
  | {
      boardLabel: string
      boardPageId: string
      initialIcon: BoardIconKey
      mode: 'icon'
    }
type DropState = {
  id: string
  intent: DragIntent
}

const { dock = false } = defineProps<{ dock?: boolean }>()
const emit = defineEmits<{ boardOpened: [board: SidebarWorkspaceBoard] }>()
defineSlots<{
  'board-action'(props: { board: SidebarWorkspaceBoard; label: string }): unknown
}>()

const store = useEditorStore()
const pageQuery = ref('')
const expandedPages = ref<Set<SidebarPageId>>(new Set())
const dragState = ref<DragState | null>(null)
const dropState = ref<DropState | null>(null)
const pageRenameInput = templateRef<HTMLInputElement | HTMLInputElement[]>('pageRenameInput')
const boardRenameInput = templateRef<HTMLInputElement | HTMLInputElement[]>('boardRenameInput')
const renamingBoardId = ref<string | null>(null)
const renamingBoardName = ref('')
const boardRenameIconMenuOpen = ref(false)
const pendingBoardDeletion = ref<BoardDeletionTarget | null>(null)
const boardIdentityRequest = ref<BoardIdentityRequest | null>(null)
const boardDeleteDialogOpen = computed({
  get: () => pendingBoardDeletion.value !== null,
  set: (open) => {
    if (!open) pendingBoardDeletion.value = null
  }
})
const boardIdentityDialogOpen = computed({
  get: () => boardIdentityRequest.value !== null,
  set: (open) => {
    if (!open) boardIdentityRequest.value = null
  }
})

const workspaceResolution = computed(() => {
  void store.state.sceneVersion
  return resolveSidebarWorkspace(store.graph)
})
const workspace = computed(() => workspaceResolution.value.workspace)

function boardLabel(board: SidebarWorkspaceBoard): string {
  return board.label ?? store.graph.getNode(board.pageId)?.name ?? 'Untitled board'
}

function commitWorkspace(next: SidebarWorkspace, label: string, undo = true) {
  const root = store.graph.getNode(store.graph.rootId)
  if (!root) return
  const pluginData = sidebarWorkspacePluginData(root, next)
  if (undo) store.updateNodeWithUndo(root.id, { pluginData }, label)
  else store.updateNode(root.id, { pluginData })
}

function persistReconciledWorkspace() {
  const resolution = resolveSidebarWorkspace(store.graph)
  if (resolution.changed) commitWorkspace(resolution.workspace, 'Sync sidebar hierarchy', false)
}

onMounted(persistReconciledWorkspace)
watch(
  () => store.state.sceneVersion,
  () => persistReconciledWorkspace(),
  { flush: 'post' }
)

const pageRename = useInlineRename((id, name) => {
  commitWorkspace(
    renameSidebarPage(workspace.value, id, name.trim() || 'Untitled project'),
    'Rename project'
  )
})
const pendingPageRename = ref<SidebarWorkspacePage | null>(null)

function firstRenameInput(input: HTMLInputElement | HTMLInputElement[] | null) {
  return Array.isArray(input) ? (input[0] ?? null) : input
}

watch(pageRenameInput, (input) => {
  const element = firstRenameInput(input)
  if (element) void pageRename.focusInput(element)
})

function beginPageRename(page: SidebarWorkspacePage) {
  pageRename.start(page.id, page.name)
}

function beginPendingPageRename(event: Event) {
  const page = pendingPageRename.value
  if (!page) return
  event.preventDefault()
  pendingPageRename.value = null
  beginPageRename(page)
}

async function beginBoardRename(board: SidebarWorkspaceBoard) {
  renamingBoardId.value = board.pageId
  renamingBoardName.value = boardLabel(board)
  boardRenameIconMenuOpen.value = false
  await nextTick()
  const input = firstRenameInput(boardRenameInput.value)
  input?.focus()
  input?.select()
}

function cancelBoardRename() {
  renamingBoardId.value = null
  renamingBoardName.value = ''
  boardRenameIconMenuOpen.value = false
}

function commitBoardRename() {
  const boardPageId = renamingBoardId.value
  if (!boardPageId) return
  const board = workspace.value.boards.find((candidate) => candidate.pageId === boardPageId)
  if (!board) return cancelBoardRename()
  const cleanName = renamingBoardName.value.trim() || 'Untitled board'
  if (cleanName !== boardLabel(board)) {
    store.renamePage(boardPageId, cleanName)
    commitWorkspace(renameSidebarBoard(workspace.value, boardPageId, cleanName), 'Rename board')
  }
  cancelBoardRename()
}

function onBoardRenameBlur(event: FocusEvent) {
  if (boardRenameIconMenuOpen.value) return
  const relatedTarget = event.relatedTarget
  if (
    relatedTarget instanceof HTMLElement &&
    relatedTarget.dataset.testId === 'board-rename-icon-trigger'
  ) {
    return
  }
  commitBoardRename()
}

function onBoardRenameKeydown(event: KeyboardEvent) {
  if (event.code === 'Enter') {
    event.preventDefault()
    commitBoardRename()
    return
  }
  if (event.code === 'Escape') {
    event.preventDefault()
    cancelBoardRename()
  }
}

function updateBoardRenameIconMenu(open: boolean) {
  boardRenameIconMenuOpen.value = open
}

function focusBoardRenameInput() {
  firstRenameInput(boardRenameInput.value)?.focus()
}

function changeBoardIcon(board: SidebarWorkspaceBoard, icon: BoardIconKey) {
  if ((board.icon ?? 'canvas') === icon) return
  commitWorkspace(setSidebarBoardIcon(workspace.value, board.pageId, icon), 'Change board icon')
}

function pageMatches(page: SidebarWorkspacePage, query: string): boolean {
  if (page.name.toLocaleLowerCase().includes(query)) return true
  if (
    orderedSidebarBoards(workspace.value, page.id).some((board) =>
      boardLabel(board).toLocaleLowerCase().includes(query)
    )
  ) {
    return true
  }
  return orderedSidebarPages(workspace.value, page.id).some((child) => pageMatches(child, query))
}

function appendPageRows(rows: TreeRow[], page: SidebarWorkspacePage, depth: number, query: string) {
  if (query && !pageMatches(page, query)) return
  rows.push({ depth, id: page.id, itemType: 'page', page })
  if (!query && !expandedPages.value.has(page.id)) return

  for (const board of orderedSidebarBoards(workspace.value, page.id)) {
    const label = boardLabel(board)
    if (
      !query ||
      label.toLocaleLowerCase().includes(query) ||
      page.name.toLocaleLowerCase().includes(query)
    ) {
      rows.push({
        board,
        depth: depth + 1,
        id: board.pageId,
        itemType: 'board',
        label,
        parentPageId: page.id
      })
    }
  }
  for (const child of orderedSidebarPages(workspace.value, page.id)) {
    appendPageRows(rows, child, depth + 1, query)
  }
}

const treeRows = computed<TreeRow[]>(() => {
  const rows: TreeRow[] = []
  const query = pageQuery.value.trim().toLocaleLowerCase()
  for (const page of orderedSidebarPages(workspace.value, null))
    appendPageRows(rows, page, 0, query)
  return rows
})

function togglePage(pageId: SidebarPageId) {
  const next = new Set(expandedPages.value)
  if (next.has(pageId)) next.delete(pageId)
  else next.add(pageId)
  expandedPages.value = next
}

function revealBoard(boardPageId: string) {
  const board = workspace.value.boards.find((candidate) => candidate.pageId === boardPageId)
  if (!board) return
  const next = new Set(expandedPages.value)
  let page = workspace.value.pages.find((candidate) => candidate.id === board.parentPageId)
  while (page) {
    next.add(page.id)
    const parentId = page.parentId
    page = parentId
      ? workspace.value.pages.find((candidate) => candidate.id === parentId)
      : undefined
  }
  expandedPages.value = next
}

watch(() => store.state.currentPageId, revealBoard, { immediate: true })

async function createPage(parentId: SidebarPageId | null = null) {
  const result = createSidebarPage(workspace.value, { name: 'Untitled project', parentId })
  commitWorkspace(result.workspace, parentId ? 'Create subproject' : 'Create project')
  if (parentId) expandedPages.value = new Set([...expandedPages.value, parentId])
  await nextTick()
  if (parentId) {
    pendingPageRename.value = result.page
    return
  }
  beginPageRename(result.page)
}

function requestBoardCreation(parentPageId: SidebarPageId) {
  boardIdentityRequest.value = {
    initialIcon: 'canvas',
    mode: 'create',
    parentPageId
  }
}

async function createBoard(parentPageId: SidebarPageId, label: string, icon: BoardIconKey) {
  // Snapshot the hierarchy before addPage mutates sceneVersion. Otherwise the
  // reconciliation watcher can briefly adopt the new scene page as a separate
  // logical project before we attach it as a board to the requested parent.
  const currentWorkspace = workspace.value
  const boardPageId = store.addPage(label)
  const next = createSidebarBoard(currentWorkspace, {
    icon,
    label,
    pageId: boardPageId,
    parentPageId
  })
  commitWorkspace(next, 'Create board')
  expandedPages.value = new Set([...expandedPages.value, parentPageId])
  await nextTick()
}

async function saveBoardIdentity(name: string, icon: BoardIconKey) {
  const request = boardIdentityRequest.value
  if (!request) return
  boardIdentityRequest.value = null
  if (request.mode === 'create') {
    await createBoard(request.parentPageId, name, icon)
    return
  }
  commitWorkspace(
    setSidebarBoardIcon(workspace.value, request.boardPageId, icon),
    'Change board icon'
  )
}

function requestBoardDeletion(board: SidebarWorkspaceBoard) {
  if (store.graph.getPages().length <= 1) return
  pendingBoardDeletion.value = {
    label: boardLabel(board),
    pageId: board.pageId
  }
}

function confirmBoardDeletion(boardPageId: string) {
  pendingBoardDeletion.value = null
  if (store.graph.getPages().length <= 1) return
  const board = workspace.value.boards.find((candidate) => candidate.pageId === boardPageId)
  if (!board) return
  commitWorkspace(removeSidebarBoard(workspace.value, board.pageId), 'Remove board')
  store.deletePage(board.pageId)
}

function pageIsEmpty(pageId: SidebarPageId) {
  return (
    !workspace.value.boards.some((board) => board.parentPageId === pageId) &&
    !workspace.value.pages.some((page) => page.parentId === pageId)
  )
}

function deletePage(page: SidebarWorkspacePage) {
  if (!pageIsEmpty(page.id)) return
  commitWorkspace(removeSidebarPage(workspace.value, page.id), 'Delete page')
  const next = new Set(expandedPages.value)
  next.delete(page.id)
  expandedPages.value = next
}

async function openBoard(board: SidebarWorkspaceBoard) {
  await switchSidebarWorkspaceBoard(store, board.pageId)
  emit('boardOpened', board)
}

function draggableRow(row: TreeRow): row is DraggableRow {
  return row.itemType === 'page' || row.itemType === 'board'
}

function startDrag(event: DragEvent, row: DraggableRow) {
  dragState.value = { id: row.id, itemType: row.itemType }
  if (!event.dataTransfer) return
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('text/plain', `${row.itemType}:${row.id}`)
}

function endDrag() {
  dragState.value = null
  dropState.value = null
}

function dragIntent(event: DragEvent, row: DraggableRow): DragIntent | null {
  const dragging = dragState.value
  if (!dragging || dragging.id === row.id) return null
  if (row.itemType === 'board' && dragging.itemType !== 'board') return null
  const target = event.currentTarget
  if (!(target instanceof HTMLElement)) return null
  const bounds = target.getBoundingClientRect()
  const ratio = (event.clientY - bounds.top) / Math.max(bounds.height, 1)
  if (row.itemType === 'page' && ratio > 0.26 && ratio < 0.74) return 'inside'
  return ratio < 0.5 ? 'before' : 'after'
}

function onDragOver(event: DragEvent, row: TreeRow) {
  if (!draggableRow(row)) return
  const intent = dragIntent(event, row)
  if (!intent) return
  event.preventDefault()
  dropState.value = { id: row.id, intent }
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
}

function moveRelativeToPage(
  current: SidebarWorkspace,
  dragging: DragState,
  target: PageRow,
  intent: DragIntent
): SidebarWorkspace {
  if (intent === 'inside') {
    if (dragging.itemType === 'page') {
      return moveSidebarPage(
        current,
        dragging.id,
        target.page.id,
        orderedSidebarPages(current, target.page.id).length
      )
    }
    return moveSidebarBoard(
      current,
      dragging.id,
      target.page.id,
      orderedSidebarBoards(current, target.page.id).length
    )
  }
  if (dragging.itemType !== 'page') return current
  const siblings = orderedSidebarPages(current, target.page.parentId).filter(
    (page) => page.id !== dragging.id
  )
  const targetIndex = siblings.findIndex((page) => page.id === target.page.id)
  return moveSidebarPage(
    current,
    dragging.id,
    target.page.parentId,
    targetIndex + (intent === 'after' ? 1 : 0)
  )
}

function moveRelativeToBoard(
  current: SidebarWorkspace,
  dragging: DragState,
  target: BoardRow,
  intent: DragIntent
): SidebarWorkspace {
  if (dragging.itemType !== 'board') return current
  const siblings = orderedSidebarBoards(current, target.parentPageId).filter(
    (board) => board.pageId !== dragging.id
  )
  const targetIndex = siblings.findIndex((board) => board.pageId === target.board.pageId)
  return moveSidebarBoard(
    current,
    dragging.id,
    target.parentPageId,
    targetIndex + (intent === 'after' ? 1 : 0)
  )
}

function onDrop(event: DragEvent, row: TreeRow) {
  if (!draggableRow(row)) return
  const dragging = dragState.value
  const intent = dropState.value?.id === row.id ? dropState.value.intent : dragIntent(event, row)
  if (!dragging || !intent) return endDrag()
  event.preventDefault()
  try {
    const next =
      row.itemType === 'page'
        ? moveRelativeToPage(workspace.value, dragging, row, intent)
        : moveRelativeToBoard(workspace.value, dragging, row, intent)
    if (next !== workspace.value) commitWorkspace(next, 'Move sidebar item')
    if (intent === 'inside' && row.itemType === 'page') {
      expandedPages.value = new Set([...expandedPages.value, row.page.id])
    }
  } finally {
    endDrag()
  }
}

function onRootDragOver(event: DragEvent) {
  if (dragState.value?.itemType !== 'page') return
  event.preventDefault()
  dropState.value = { id: 'pages-root', intent: 'inside' }
}

function onRootDrop(event: DragEvent) {
  const dragging = dragState.value
  if (!dragging || dragging.itemType !== 'page') return endDrag()
  event.preventDefault()
  const roots = orderedSidebarPages(workspace.value, null).filter((page) => page.id !== dragging.id)
  commitWorkspace(moveSidebarPage(workspace.value, dragging.id, null, roots.length), 'Move page')
  endDrag()
}

function rowDropClass(row: TreeRow): string {
  if (!draggableRow(row) || dropState.value?.id !== row.id) return ''
  if (dropState.value.intent === 'inside') return 'bg-accent/10 ring-1 ring-inset ring-accent/25'
  return dropState.value.intent === 'before'
    ? 'before:absolute before:inset-x-2 before:top-0 before:h-px before:bg-accent'
    : 'after:absolute after:inset-x-2 after:bottom-0 after:h-px after:bg-accent'
}

const menuContentClass =
  'z-[110] min-w-40 rounded-[9px] border border-white/[0.085] bg-[#202126]/[.98] p-1 text-[12px] text-[#f1f1f3] shadow-[0_12px_34px_rgba(0,0,0,0.42)] backdrop-blur-xl outline-none'
const menuItemClass =
  'flex h-8 cursor-default items-center gap-2 rounded-[5px] px-2 outline-none data-[highlighted]:bg-white/[0.07]'

defineExpose({ createBoard: requestBoardCreation, createPage })
</script>

<template>
  <section
    data-test-id="pages-panel"
    class="flex flex-col bg-transparent"
    :class="dock ? 'min-h-0 flex-1' : 'min-h-[172px] max-h-[64%] shrink-0'"
  >
    <div class="shrink-0 px-2 pt-1.5">
      <label
        class="group/search flex h-7 items-center gap-2 rounded-[5px] px-2 text-muted transition-colors focus-within:bg-white/[0.055] focus-within:text-surface hover:bg-white/[0.035]"
      >
        <IconlyIcon name="search" class="size-[17px] shrink-0 stroke-[1.6]" />
        <input
          v-model="pageQuery"
          data-test-id="pages-search"
          type="search"
          placeholder="Search"
          class="min-w-0 flex-1 border-none bg-transparent p-0 text-[13px] leading-none text-surface outline-none placeholder:text-muted"
        />
        <button
          v-if="pageQuery"
          type="button"
          aria-label="Clear page search"
          class="flex size-5 items-center justify-center rounded-[4px] hover:bg-hover"
          @click="pageQuery = ''"
        >
          <icon-lucide-x class="size-3" />
        </button>
      </label>
    </div>

    <div
      data-test-id="pages-header"
      class="mt-2 flex h-7 shrink-0 items-center px-3 text-[11px] font-medium text-muted/75"
      :class="dropState?.id === 'pages-root' ? 'bg-accent/10' : ''"
      @dragover="onRootDragOver"
      @drop="onRootDrop"
    >
      <span>Projects</span>
    </div>

    <div
      data-test-id="pages-scroll"
      class="scrollbar-thin min-h-0 overflow-x-hidden overflow-y-auto px-2 pb-1.5"
    >
      <div
        v-for="row in treeRows"
        :key="row.id"
        class="relative"
        :class="rowDropClass(row)"
        @dragover="onDragOver($event, row)"
        @drop="onDrop($event, row)"
      >
        <div
          v-if="row.itemType === 'page'"
          data-test-id="pages-row"
          :data-page-id="row.page.id"
          class="group/page flex h-7 items-center rounded-[5px] pr-1 text-[12.5px] text-muted transition-colors hover:bg-white/[0.045] hover:text-surface"
          :style="{ paddingLeft: `${2 + row.depth * 16}px` }"
        >
          <span class="relative flex size-5 shrink-0 items-center justify-center">
            <button
              type="button"
              :aria-label="
                expandedPages.has(row.page.id)
                  ? `Collapse ${row.page.name}`
                  : `Expand ${row.page.name}`
              "
              class="absolute inset-0 flex items-center justify-center rounded-[4px] transition-opacity group-hover/page:opacity-0"
              @click="togglePage(row.page.id)"
            >
              <IconlyIcon
                name="arrow-right"
                class="size-3 stroke-[1.6] text-muted/65 transition-transform"
                :class="expandedPages.has(row.page.id) ? 'rotate-90' : ''"
              />
            </button>
            <button
              type="button"
              draggable="true"
              aria-label="Drag page"
              class="absolute inset-0 flex cursor-grab items-center justify-center rounded-[4px] text-muted/65 opacity-0 transition-opacity hover:bg-white/[0.06] group-hover/page:opacity-100 active:cursor-grabbing"
              @dragstart="startDrag($event, row)"
              @dragend="endDrag"
            >
              <icon-lucide-grip-vertical class="size-3.5 stroke-[1.5]" />
            </button>
          </span>
          <IconlyIcon
            name="folder"
            class="mr-1.5 size-[15px] shrink-0 stroke-[1.45] text-muted/75"
          />
          <div v-if="pageRename.editingId.value === row.page.id" class="min-w-0 flex-1 pr-1">
            <input
              ref="pageRenameInput"
              data-test-id="pages-item-input"
              class="h-6 w-full rounded-[4px] border border-accent/55 bg-input px-1.5 text-[13px] text-surface outline-none ring-2 ring-accent/15"
              :value="row.page.name"
              @blur="pageRename.commit(row.page.id, $event)"
              @keydown.stop="pageRename.onKeydown"
            />
          </div>
          <button
            v-else
            data-test-id="pages-item"
            type="button"
            class="min-w-0 flex-1 truncate text-left"
            @click="togglePage(row.page.id)"
            @dblclick="beginPageRename(row.page)"
          >
            {{ row.page.name }}
          </button>

          <DropdownMenuRoot :modal="false">
            <DropdownMenuTrigger as-child>
              <button
                type="button"
                :aria-label="`Add to ${row.page.name}`"
                class="flex size-5 shrink-0 items-center justify-center rounded-[4px] text-muted opacity-0 transition-opacity hover:bg-white/[0.06] hover:text-surface group-hover/page:opacity-100 data-[state=open]:opacity-100"
                @click.stop
              >
                <IconlyIcon name="plus" class="size-[15px] stroke-[1.6]" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuPortal>
              <DropdownMenuContent
                :class="menuContentClass"
                :side-offset="4"
                align="end"
                @close-auto-focus="beginPendingPageRename"
              >
                <DropdownMenuItem
                  :class="menuItemClass"
                  @select="requestBoardCreation(row.page.id)"
                >
                  <icon-lucide-layout-grid class="size-3.5 text-[#999ca6]" />
                  <span>New board</span>
                </DropdownMenuItem>
                <DropdownMenuItem :class="menuItemClass" @select="createPage(row.page.id)">
                  <icon-lucide-file-plus-2 class="size-3.5 text-[#999ca6]" />
                  <span>New subproject</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenuPortal>
          </DropdownMenuRoot>

          <DropdownMenuRoot :modal="false">
            <DropdownMenuTrigger as-child>
              <button
                type="button"
                :aria-label="`${row.page.name} actions`"
                class="flex size-5 shrink-0 items-center justify-center rounded-[4px] text-muted opacity-0 transition-opacity hover:bg-white/[0.06] hover:text-surface group-hover/page:opacity-100 data-[state=open]:opacity-100"
                @click.stop
              >
                <IconlyIcon name="more" class="size-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuPortal>
              <DropdownMenuContent :class="menuContentClass" :side-offset="4" align="end">
                <DropdownMenuItem :class="menuItemClass" @select="beginPageRename(row.page)">
                  <IconlyIcon name="edit" class="size-3.5 text-[#999ca6]" />
                  <span>Rename</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator class="my-1 h-px bg-white/[0.07]" />
                <DropdownMenuItem
                  data-test-id="pages-delete-page"
                  :class="`${menuItemClass} text-red-300 data-[highlighted]:bg-red-400/10 data-[disabled]:text-muted/45`"
                  :disabled="!pageIsEmpty(row.page.id)"
                  @select="deletePage(row.page)"
                >
                  <IconlyIcon name="delete" class="size-3.5" />
                  <span>Delete project</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenuPortal>
          </DropdownMenuRoot>
        </div>

        <div
          v-else-if="row.itemType === 'board'"
          data-test-id="pages-board-row"
          :data-board-page-id="row.board.pageId"
          class="group/board flex h-7 items-center rounded-[5px] pr-1 text-[12.5px] transition-colors"
          :class="
            row.board.pageId === store.state.currentPageId
              ? 'bg-white/[0.065] font-medium text-surface'
              : 'text-muted hover:bg-white/[0.045] hover:text-surface'
          "
          :style="{ paddingLeft: `${2 + row.depth * 16}px` }"
        >
          <BoardIconMenu
            v-if="renamingBoardId === row.board.pageId"
            :model-value="row.board.icon ?? 'canvas'"
            :open="boardRenameIconMenuOpen"
            :board-label="row.label"
            @closed="focusBoardRenameInput"
            @update:model-value="changeBoardIcon(row.board, $event)"
            @update:open="updateBoardRenameIconMenu"
          />
          <span
            v-else
            class="relative mr-1.5 flex size-5 shrink-0 items-center justify-center text-muted/75"
          >
            <BoardIcon
              :icon="row.board.icon"
              :data-board-icon="row.board.icon"
              class="size-[14px] stroke-[1.45] transition-opacity group-hover/board:opacity-0"
            />
            <button
              type="button"
              draggable="true"
              aria-label="Drag board"
              class="absolute inset-0 flex cursor-grab items-center justify-center rounded-[4px] text-muted/65 opacity-0 transition-opacity hover:bg-white/[0.06] group-hover/board:opacity-100 active:cursor-grabbing"
              @dragstart="startDrag($event, row)"
              @dragend="endDrag"
            >
              <icon-lucide-grip-vertical class="size-3.5 stroke-[1.5]" />
            </button>
          </span>
          <div v-if="renamingBoardId === row.board.pageId" class="min-w-0 flex-1 pr-1">
            <input
              ref="boardRenameInput"
              data-test-id="pages-item-input"
              class="h-6 w-full rounded-[4px] border border-accent/55 bg-input px-1.5 text-[13px] text-surface outline-none ring-2 ring-accent/15"
              v-model="renamingBoardName"
              :aria-label="`Rename ${row.label}`"
              @blur="onBoardRenameBlur"
              @keydown.stop="onBoardRenameKeydown"
            />
          </div>
          <button
            v-else
            data-test-id="pages-board-item"
            type="button"
            class="min-w-0 flex-1 truncate text-left"
            @click="openBoard(row.board)"
            @dblclick="beginBoardRename(row.board)"
          >
            {{ row.label }}
          </button>
          <slot name="board-action" :board="row.board" :label="row.label" />
          <DropdownMenuRoot :modal="false">
            <DropdownMenuTrigger as-child>
              <button
                type="button"
                :aria-label="`${row.label} actions`"
                class="flex size-5 shrink-0 items-center justify-center rounded-[4px] text-muted opacity-0 transition-opacity hover:bg-white/[0.06] hover:text-surface group-hover/board:opacity-100 data-[state=open]:opacity-100"
                @click.stop
              >
                <IconlyIcon name="more" class="size-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuPortal>
              <DropdownMenuContent :class="menuContentClass" :side-offset="4" align="end">
                <DropdownMenuItem :class="menuItemClass" @select="beginBoardRename(row.board)">
                  <IconlyIcon name="edit" class="size-3.5 text-[#999ca6]" />
                  <span>Rename</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator class="my-1 h-px bg-white/[0.07]" />
                <DropdownMenuItem
                  :class="`${menuItemClass} text-red-300 data-[highlighted]:bg-red-400/10`"
                  :disabled="store.graph.getPages().length <= 1"
                  @select="requestBoardDeletion(row.board)"
                >
                  <IconlyIcon name="delete" class="size-3.5" />
                  <span>Delete board</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenuPortal>
          </DropdownMenuRoot>
        </div>
      </div>

      <div v-if="treeRows.length === 0" class="px-4 py-3 text-[12px] text-muted">
        No projects found
      </div>

      <button
        data-test-id="pages-new-page"
        type="button"
        class="mt-1 flex h-7 w-full items-center gap-1.5 rounded-[5px] px-2 text-left text-[12px] text-muted/80 transition-colors hover:bg-white/[0.045] hover:text-surface"
        @click="createPage()"
      >
        <IconlyIcon name="plus" class="size-[14px] stroke-[1.6]" />
        <span>New project</span>
      </button>
    </div>

    <BoardDeleteDialog
      v-if="pendingBoardDeletion"
      v-model:open="boardDeleteDialogOpen"
      :board-label="pendingBoardDeletion.label"
      :board-page-id="pendingBoardDeletion.pageId"
      @confirm="confirmBoardDeletion"
    />
    <BoardIdentityDialog
      v-if="boardIdentityRequest"
      v-model:open="boardIdentityDialogOpen"
      :mode="boardIdentityRequest.mode"
      :board-label="
        boardIdentityRequest.mode === 'icon' ? boardIdentityRequest.boardLabel : undefined
      "
      :initial-icon="boardIdentityRequest.initialIcon"
      @submit="saveBoardIdentity"
    />
  </section>
</template>
