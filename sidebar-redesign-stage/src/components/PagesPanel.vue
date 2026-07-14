<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { templateRef } from "@vueuse/core";
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "reka-ui";

import { useInlineRename } from "@open-pencil/vue";

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
  sidebarWorkspacePluginData,
  type SidebarPageId,
  type SidebarWorkspace,
  type SidebarWorkspaceBoard,
  type SidebarWorkspacePage,
} from "@/app/sidebar-workspace/tree";
import { useEditorStore } from "@/app/editor/active-store";

type PageRow = {
  depth: number;
  id: SidebarPageId;
  itemType: "page";
  page: SidebarWorkspacePage;
};

type BoardRow = {
  board: SidebarWorkspaceBoard;
  depth: number;
  id: string;
  itemType: "board";
  label: string;
  parentPageId: SidebarPageId;
};

type NewBoardRow = {
  depth: number;
  id: string;
  itemType: "new-board";
  parentPageId: SidebarPageId;
};

type TreeRow = PageRow | BoardRow | NewBoardRow;
type DraggableRow = PageRow | BoardRow;
type DragIntent = "before" | "after" | "inside";
type DragState = {
  id: string;
  itemType: "board" | "page";
};
type DropState = {
  id: string;
  intent: DragIntent;
};

const store = useEditorStore();
const pageQuery = ref("");
const expandedPages = ref<Set<SidebarPageId>>(new Set());
const dragState = ref<DragState | null>(null);
const dropState = ref<DropState | null>(null);
const renameType = ref<"board" | "page">("page");
const renameInput = templateRef<HTMLInputElement>("renameInput");

const workspaceResolution = computed(() => {
  void store.state.sceneVersion;
  return resolveSidebarWorkspace(store.graph);
});
const workspace = computed(() => workspaceResolution.value.workspace);

function boardLabel(board: SidebarWorkspaceBoard): string {
  return board.label ?? store.graph.getNode(board.pageId)?.name ?? "Untitled board";
}

function commitWorkspace(next: SidebarWorkspace, label: string, undo = true) {
  const root = store.graph.getNode(store.graph.rootId);
  if (!root) return;
  const pluginData = sidebarWorkspacePluginData(root, next);
  if (undo) store.updateNodeWithUndo(root.id, { pluginData }, label);
  else store.updateNode(root.id, { pluginData });
}

function persistReconciledWorkspace() {
  const resolution = resolveSidebarWorkspace(store.graph);
  if (resolution.changed) commitWorkspace(resolution.workspace, "Sync sidebar hierarchy", false);
}

onMounted(persistReconciledWorkspace);
watch(
  () => store.state.sceneVersion,
  () => persistReconciledWorkspace(),
  { flush: "post" },
);

const rename = useInlineRename((id, name) => {
  const cleanName =
    name.trim() || (renameType.value === "page" ? "Untitled page" : "Untitled board");
  if (renameType.value === "page") {
    commitWorkspace(renameSidebarPage(workspace.value, id, cleanName), "Rename page");
    return;
  }
  store.renamePage(id, cleanName);
  commitWorkspace(renameSidebarBoard(workspace.value, id, cleanName), "Rename board");
});

watch(renameInput, (input) => {
  if (input) void rename.focusInput(input);
});

function beginPageRename(page: SidebarWorkspacePage) {
  renameType.value = "page";
  rename.start(page.id, page.name);
}

function beginBoardRename(board: SidebarWorkspaceBoard) {
  renameType.value = "board";
  rename.start(board.pageId, boardLabel(board));
}

function pageMatches(page: SidebarWorkspacePage, query: string): boolean {
  if (page.name.toLocaleLowerCase().includes(query)) return true;
  if (
    orderedSidebarBoards(workspace.value, page.id).some((board) =>
      boardLabel(board).toLocaleLowerCase().includes(query),
    )
  ) {
    return true;
  }
  return orderedSidebarPages(workspace.value, page.id).some((child) => pageMatches(child, query));
}

function appendPageRows(rows: TreeRow[], page: SidebarWorkspacePage, depth: number, query: string) {
  if (query && !pageMatches(page, query)) return;
  rows.push({ depth, id: page.id, itemType: "page", page });
  if (!query && !expandedPages.value.has(page.id)) return;

  for (const board of orderedSidebarBoards(workspace.value, page.id)) {
    const label = boardLabel(board);
    if (
      !query ||
      label.toLocaleLowerCase().includes(query) ||
      page.name.toLocaleLowerCase().includes(query)
    ) {
      rows.push({
        board,
        depth: depth + 1,
        id: board.pageId,
        itemType: "board",
        label,
        parentPageId: page.id,
      });
    }
  }
  if (!query) {
    rows.push({
      depth: depth + 1,
      id: `new-board:${page.id}`,
      itemType: "new-board",
      parentPageId: page.id,
    });
  }
  for (const child of orderedSidebarPages(workspace.value, page.id)) {
    appendPageRows(rows, child, depth + 1, query);
  }
}

const treeRows = computed<TreeRow[]>(() => {
  const rows: TreeRow[] = [];
  const query = pageQuery.value.trim().toLocaleLowerCase();
  for (const page of orderedSidebarPages(workspace.value, null))
    appendPageRows(rows, page, 0, query);
  return rows;
});

function togglePage(pageId: SidebarPageId) {
  const next = new Set(expandedPages.value);
  if (next.has(pageId)) next.delete(pageId);
  else next.add(pageId);
  expandedPages.value = next;
}

function revealBoard(boardPageId: string) {
  const board = workspace.value.boards.find((candidate) => candidate.pageId === boardPageId);
  if (!board) return;
  const next = new Set(expandedPages.value);
  let page = workspace.value.pages.find((candidate) => candidate.id === board.parentPageId);
  while (page) {
    next.add(page.id);
    page = page.parentId
      ? workspace.value.pages.find((candidate) => candidate.id === page?.parentId)
      : undefined;
  }
  expandedPages.value = next;
}

watch(() => store.state.currentPageId, revealBoard, { immediate: true });

async function createPage(parentId: SidebarPageId | null = null) {
  const result = createSidebarPage(workspace.value, { name: "Untitled page", parentId });
  commitWorkspace(result.workspace, parentId ? "Create subpage" : "Create page");
  if (parentId) expandedPages.value = new Set([...expandedPages.value, parentId]);
  await nextTick();
  beginPageRename(result.page);
}

async function createBoard(parentPageId: SidebarPageId) {
  // Snapshot the hierarchy before addPage mutates sceneVersion. Otherwise the
  // reconciliation watcher can briefly adopt the new scene page as a separate
  // logical Page before we attach it as a Board to the requested parent.
  const currentWorkspace = workspace.value;
  const boardPageId = store.addPage("Untitled board");
  const next = createSidebarBoard(currentWorkspace, {
    pageId: boardPageId,
    parentPageId,
  });
  commitWorkspace(next, "Create board");
  expandedPages.value = new Set([...expandedPages.value, parentPageId]);
  await nextTick();
  const board = next.boards.find((candidate) => candidate.pageId === boardPageId);
  if (board) beginBoardRename(board);
}

function deleteBoard(board: SidebarWorkspaceBoard) {
  if (store.graph.getPages().length <= 1) return;
  commitWorkspace(removeSidebarBoard(workspace.value, board.pageId), "Remove board");
  store.deletePage(board.pageId);
}

function pageIsEmpty(pageId: SidebarPageId) {
  return (
    !workspace.value.boards.some((board) => board.parentPageId === pageId) &&
    !workspace.value.pages.some((page) => page.parentId === pageId)
  );
}

function deletePage(page: SidebarWorkspacePage) {
  if (!pageIsEmpty(page.id)) return;
  commitWorkspace(removeSidebarPage(workspace.value, page.id), "Delete page");
  const next = new Set(expandedPages.value);
  next.delete(page.id);
  expandedPages.value = next;
}

async function openBoard(board: SidebarWorkspaceBoard) {
  await store.switchPage(board.pageId);
}

function boardIcon(label: string): "flow" | "review" | "board" {
  if (/flow|journey|map/i.test(label)) return "flow";
  if (/review|version|compare/i.test(label)) return "review";
  return "board";
}

function draggableRow(row: TreeRow): row is DraggableRow {
  return row.itemType === "page" || row.itemType === "board";
}

function startDrag(event: DragEvent, row: DraggableRow) {
  dragState.value = { id: row.id, itemType: row.itemType };
  if (!event.dataTransfer) return;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", `${row.itemType}:${row.id}`);
}

function endDrag() {
  dragState.value = null;
  dropState.value = null;
}

function dragIntent(event: DragEvent, row: DraggableRow): DragIntent | null {
  const dragging = dragState.value;
  if (!dragging || dragging.id === row.id) return null;
  if (row.itemType === "board" && dragging.itemType !== "board") return null;
  const target = event.currentTarget;
  if (!(target instanceof HTMLElement)) return null;
  const bounds = target.getBoundingClientRect();
  const ratio = (event.clientY - bounds.top) / Math.max(bounds.height, 1);
  if (row.itemType === "page" && ratio > 0.26 && ratio < 0.74) return "inside";
  return ratio < 0.5 ? "before" : "after";
}

function onDragOver(event: DragEvent, row: TreeRow) {
  if (!draggableRow(row)) return;
  const intent = dragIntent(event, row);
  if (!intent) return;
  event.preventDefault();
  dropState.value = { id: row.id, intent };
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
}

function moveRelativeToPage(
  current: SidebarWorkspace,
  dragging: DragState,
  target: PageRow,
  intent: DragIntent,
): SidebarWorkspace {
  if (intent === "inside") {
    if (dragging.itemType === "page") {
      return moveSidebarPage(
        current,
        dragging.id,
        target.page.id,
        orderedSidebarPages(current, target.page.id).length,
      );
    }
    return moveSidebarBoard(
      current,
      dragging.id,
      target.page.id,
      orderedSidebarBoards(current, target.page.id).length,
    );
  }
  if (dragging.itemType !== "page") return current;
  const siblings = orderedSidebarPages(current, target.page.parentId).filter(
    (page) => page.id !== dragging.id,
  );
  const targetIndex = siblings.findIndex((page) => page.id === target.page.id);
  return moveSidebarPage(
    current,
    dragging.id,
    target.page.parentId,
    targetIndex + (intent === "after" ? 1 : 0),
  );
}

function moveRelativeToBoard(
  current: SidebarWorkspace,
  dragging: DragState,
  target: BoardRow,
  intent: DragIntent,
): SidebarWorkspace {
  if (dragging.itemType !== "board") return current;
  const siblings = orderedSidebarBoards(current, target.parentPageId).filter(
    (board) => board.pageId !== dragging.id,
  );
  const targetIndex = siblings.findIndex((board) => board.pageId === target.board.pageId);
  return moveSidebarBoard(
    current,
    dragging.id,
    target.parentPageId,
    targetIndex + (intent === "after" ? 1 : 0),
  );
}

function onDrop(event: DragEvent, row: TreeRow) {
  if (!draggableRow(row)) return;
  const dragging = dragState.value;
  const intent = dropState.value?.id === row.id ? dropState.value.intent : dragIntent(event, row);
  if (!dragging || !intent) return endDrag();
  event.preventDefault();
  try {
    const next =
      row.itemType === "page"
        ? moveRelativeToPage(workspace.value, dragging, row, intent)
        : moveRelativeToBoard(workspace.value, dragging, row, intent);
    if (next !== workspace.value) commitWorkspace(next, "Move sidebar item");
    if (intent === "inside" && row.itemType === "page") {
      expandedPages.value = new Set([...expandedPages.value, row.page.id]);
    }
  } finally {
    endDrag();
  }
}

function onRootDragOver(event: DragEvent) {
  if (dragState.value?.itemType !== "page") return;
  event.preventDefault();
  dropState.value = { id: "pages-root", intent: "inside" };
}

function onRootDrop(event: DragEvent) {
  const dragging = dragState.value;
  if (!dragging || dragging.itemType !== "page") return endDrag();
  event.preventDefault();
  const roots = orderedSidebarPages(workspace.value, null).filter(
    (page) => page.id !== dragging.id,
  );
  commitWorkspace(moveSidebarPage(workspace.value, dragging.id, null, roots.length), "Move page");
  endDrag();
}

function rowDropClass(row: TreeRow): string {
  if (!draggableRow(row) || dropState.value?.id !== row.id) return "";
  if (dropState.value.intent === "inside") return "bg-accent/10 ring-1 ring-inset ring-accent/25";
  return dropState.value.intent === "before"
    ? "before:absolute before:inset-x-2 before:top-0 before:h-px before:bg-accent"
    : "after:absolute after:inset-x-2 after:bottom-0 after:h-px after:bg-accent";
}

const menuContentClass =
  "z-50 min-w-40 rounded-[9px] border border-white/[0.085] bg-[#202126]/[.98] p-1 text-[12px] text-[#f1f1f3] shadow-[0_12px_34px_rgba(0,0,0,0.42)] backdrop-blur-xl outline-none";
const menuItemClass =
  "flex h-8 cursor-default items-center gap-2 rounded-[5px] px-2 outline-none data-[highlighted]:bg-white/[0.07]";
</script>

<template>
  <section
    data-test-id="pages-panel"
    class="flex min-h-[172px] max-h-[64%] shrink-0 flex-col bg-transparent"
  >
    <div class="shrink-0 px-2 pt-2">
      <label
        class="group/search flex h-8 items-center gap-2 rounded-[6px] px-2 text-muted transition-colors focus-within:bg-hover focus-within:text-surface hover:bg-white/[0.04]"
      >
        <icon-lucide-search class="size-[17px] shrink-0 stroke-[1.6]" />
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
      class="mt-2 flex h-8 shrink-0 items-center gap-1 px-4 text-[11px] font-semibold tracking-[0.01em] text-muted"
      :class="dropState?.id === 'pages-root' ? 'bg-accent/10' : ''"
      @dragover="onRootDragOver"
      @drop="onRootDrop"
    >
      <span>Pages</span>
      <icon-lucide-chevron-down class="size-3 stroke-[1.6] opacity-60" />
      <button
        data-test-id="pages-add"
        type="button"
        aria-label="New page"
        class="ml-auto flex size-6 items-center justify-center rounded-[5px] text-muted transition-colors hover:bg-hover hover:text-surface"
        @click="createPage()"
      >
        <icon-lucide-plus class="size-[15px] stroke-[1.6]" />
      </button>
    </div>

    <div
      data-test-id="pages-scroll"
      class="scrollbar-thin min-h-0 overflow-x-hidden overflow-y-auto px-2 pb-1"
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
          class="group/page flex h-8 items-center rounded-[6px] text-[13px] text-muted transition-colors hover:bg-hover hover:text-surface"
          :style="{ paddingLeft: `${4 + row.depth * 18}px` }"
        >
          <button
            type="button"
            draggable="true"
            aria-label="Drag page"
            class="flex size-5 shrink-0 cursor-grab items-center justify-center rounded-[4px] text-muted/60 opacity-0 transition-opacity group-hover/page:opacity-100 active:cursor-grabbing"
            @dragstart="startDrag($event, row)"
            @dragend="endDrag"
          >
            <icon-lucide-grip-vertical class="size-3.5 stroke-[1.5]" />
          </button>
          <icon-lucide-file class="mr-2 size-[16px] shrink-0 stroke-[1.55] text-muted/80" />
          <div v-if="rename.editingId.value === row.page.id" class="min-w-0 flex-1 pr-1">
            <input
              ref="renameInput"
              data-test-id="pages-item-input"
              class="h-6 w-full rounded-[4px] border border-accent/55 bg-input px-1.5 text-[13px] text-surface outline-none ring-2 ring-accent/15"
              :value="row.page.name"
              @blur="rename.commit(row.page.id, $event)"
              @keydown.stop="rename.onKeydown"
            />
          </div>
          <button
            v-else
            data-test-id="pages-item"
            type="button"
            class="flex min-w-0 flex-1 items-center gap-1 text-left"
            @click="togglePage(row.page.id)"
            @dblclick="beginPageRename(row.page)"
          >
            <span class="truncate">{{ row.page.name }}</span>
            <icon-lucide-chevron-right
              class="size-3 shrink-0 stroke-[1.6] text-muted/65 transition-transform"
              :class="expandedPages.has(row.page.id) ? 'rotate-90' : ''"
            />
          </button>

          <DropdownMenuRoot :modal="false">
            <DropdownMenuTrigger as-child>
              <button
                type="button"
                :aria-label="`Add to ${row.page.name}`"
                class="flex size-6 shrink-0 items-center justify-center rounded-[5px] text-muted opacity-55 transition-all hover:bg-hover hover:text-surface hover:opacity-100"
                @click.stop
              >
                <icon-lucide-plus class="size-[15px] stroke-[1.6]" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuPortal>
              <DropdownMenuContent :class="menuContentClass" :side-offset="4" align="end">
                <DropdownMenuItem :class="menuItemClass" @select="createBoard(row.page.id)">
                  <icon-lucide-layout-grid class="size-3.5 text-[#999ca6]" />
                  <span>New board</span>
                </DropdownMenuItem>
                <DropdownMenuItem :class="menuItemClass" @select="createPage(row.page.id)">
                  <icon-lucide-file-plus-2 class="size-3.5 text-[#999ca6]" />
                  <span>New subpage</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenuPortal>
          </DropdownMenuRoot>

          <DropdownMenuRoot :modal="false">
            <DropdownMenuTrigger as-child>
              <button
                type="button"
                :aria-label="`${row.page.name} actions`"
                class="mr-1 flex size-6 shrink-0 items-center justify-center rounded-[5px] text-muted opacity-0 transition-all hover:bg-hover hover:text-surface group-hover/page:opacity-100 data-[state=open]:opacity-100"
                @click.stop
              >
                <icon-lucide-more-horizontal class="size-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuPortal>
              <DropdownMenuContent :class="menuContentClass" :side-offset="4" align="end">
                <DropdownMenuItem :class="menuItemClass" @select="beginPageRename(row.page)">
                  <icon-lucide-pencil class="size-3.5 text-[#999ca6]" />
                  <span>Rename</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator class="my-1 h-px bg-white/[0.07]" />
                <DropdownMenuItem :class="menuItemClass" @select="createBoard(row.page.id)">
                  <icon-lucide-layout-grid class="size-3.5 text-[#999ca6]" />
                  <span>New board</span>
                </DropdownMenuItem>
                <DropdownMenuItem :class="menuItemClass" @select="createPage(row.page.id)">
                  <icon-lucide-file-plus-2 class="size-3.5 text-[#999ca6]" />
                  <span>New subpage</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator class="my-1 h-px bg-white/[0.07]" />
                <DropdownMenuItem
                  data-test-id="pages-delete-page"
                  :class="`${menuItemClass} text-red-300 data-[highlighted]:bg-red-400/10 data-[disabled]:text-muted/45`"
                  :disabled="!pageIsEmpty(row.page.id)"
                  @select="deletePage(row.page)"
                >
                  <icon-lucide-trash-2 class="size-3.5" />
                  <span>Delete page</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenuPortal>
          </DropdownMenuRoot>
        </div>

        <div
          v-else-if="row.itemType === 'board'"
          data-test-id="pages-board-row"
          :data-board-page-id="row.board.pageId"
          class="group/board flex h-8 items-center rounded-[5px] text-[13px] transition-colors"
          :class="
            row.board.pageId === store.state.currentPageId
              ? 'bg-white/[0.095] font-medium text-surface shadow-[inset_0_1px_0_rgba(255,255,255,0.025)]'
              : 'text-muted hover:bg-hover hover:text-surface'
          "
          :style="{ paddingLeft: `${4 + row.depth * 18}px` }"
        >
          <button
            type="button"
            draggable="true"
            aria-label="Drag board"
            class="flex size-5 shrink-0 cursor-grab items-center justify-center rounded-[4px] text-muted/60 opacity-0 transition-opacity group-hover/board:opacity-100 active:cursor-grabbing"
            @dragstart="startDrag($event, row)"
            @dragend="endDrag"
          >
            <icon-lucide-grip-vertical class="size-3.5 stroke-[1.5]" />
          </button>
          <span class="mr-2 flex size-[16px] shrink-0 items-center justify-center text-muted/80">
            <icon-lucide-workflow
              v-if="boardIcon(row.label) === 'flow'"
              class="size-[15px] stroke-[1.55]"
            />
            <icon-lucide-history
              v-else-if="boardIcon(row.label) === 'review'"
              class="size-[15px] stroke-[1.55]"
            />
            <icon-lucide-layout-grid v-else class="size-[15px] stroke-[1.55]" />
          </span>
          <div v-if="rename.editingId.value === row.board.pageId" class="min-w-0 flex-1 pr-1">
            <input
              ref="renameInput"
              data-test-id="pages-item-input"
              class="h-6 w-full rounded-[4px] border border-accent/55 bg-input px-1.5 text-[13px] text-surface outline-none ring-2 ring-accent/15"
              :value="row.label"
              @blur="rename.commit(row.board.pageId, $event)"
              @keydown.stop="rename.onKeydown"
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
          <DropdownMenuRoot :modal="false">
            <DropdownMenuTrigger as-child>
              <button
                type="button"
                :aria-label="`${row.label} actions`"
                class="mr-1 flex size-6 shrink-0 items-center justify-center rounded-[5px] text-muted opacity-0 transition-all hover:bg-hover hover:text-surface group-hover/board:opacity-100 data-[state=open]:opacity-100"
                @click.stop
              >
                <icon-lucide-more-horizontal class="size-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuPortal>
              <DropdownMenuContent :class="menuContentClass" :side-offset="4" align="end">
                <DropdownMenuItem :class="menuItemClass" @select="beginBoardRename(row.board)">
                  <icon-lucide-pencil class="size-3.5 text-[#999ca6]" />
                  <span>Rename</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator class="my-1 h-px bg-white/[0.07]" />
                <DropdownMenuItem
                  :class="`${menuItemClass} text-red-300 data-[highlighted]:bg-red-400/10`"
                  :disabled="store.graph.getPages().length <= 1"
                  @select="deleteBoard(row.board)"
                >
                  <icon-lucide-trash-2 class="size-3.5" />
                  <span>Delete board</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenuPortal>
          </DropdownMenuRoot>
        </div>

        <button
          v-else
          data-test-id="pages-new-board"
          type="button"
          class="flex h-7 w-full items-center gap-2 rounded-[5px] text-left text-[12px] text-muted/80 transition-colors hover:bg-hover hover:text-surface"
          :style="{ paddingLeft: `${9 + row.depth * 18}px` }"
          @click="createBoard(row.parentPageId)"
        >
          <icon-lucide-plus class="size-[14px] stroke-[1.6]" />
          <span>New board</span>
        </button>
      </div>

      <div v-if="treeRows.length === 0" class="px-4 py-3 text-[12px] text-muted">
        No pages found
      </div>

      <button
        data-test-id="pages-new-page"
        type="button"
        class="mt-1 flex h-8 w-full items-center gap-2 rounded-[6px] px-2 text-left text-[12.5px] text-muted transition-colors hover:bg-hover hover:text-surface"
        @click="createPage()"
      >
        <icon-lucide-plus class="size-[16px] stroke-[1.6]" />
        <span>New page</span>
      </button>
    </div>
  </section>
</template>
