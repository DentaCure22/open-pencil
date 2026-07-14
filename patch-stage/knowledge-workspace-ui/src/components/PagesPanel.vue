<script setup lang="ts">
import { nextTick, onMounted, ref, watch, type ComponentPublicInstance } from 'vue'
import { templateRef } from '@vueuse/core'
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuPortal,
  ContextMenuRoot,
  ContextMenuTrigger
} from 'reka-ui'

import type { SceneNode } from '@open-pencil/scene-graph'
import { PageListRoot, useFlatReorderDrag, useI18n, useInlineRename } from '@open-pencil/vue'
import type { WorkspaceViewKind } from '@/app/workspace'

import Tip from '@/components/ui/Tip.vue'
import WorkspaceViewSwitcher from '@/components/workspace/WorkspaceViewSwitcher.vue'
import { useEditorStore } from '@/app/editor/active-store'
import { useKnowledgeWorkspaceUi } from '@/app/workspace-ui/use'
import { workspaceBasePageIdForPage } from '@/app/workspace-ui/projection'
import { useMenuUI } from '@/components/ui/menu'
import {
  SMYLR_PRODUCTION_PAGES,
  SMYLR_PRODUCTION_PAGE_GROUPS,
  type SmylrProductionPageGroup
} from '@/app/smylr-production/pages'
import { SMYLR_LIVE_COMPONENT_PAGE_KIND } from '@/app/smylr-component-library/live-component-canvas'
import {
  findCurrentSmylrLiveAppFrame,
  fitSmylrPageToViewport
} from '@/app/smylr-production/workspace'
import {
  previewLiveInspectorDraft,
  selectLiveInspectorNode
} from '@/app/smylr-live-inspector/session'
import {
  liveWorkspaceItems,
  restoreLiveWorkspace,
  selectLiveWorkspaceItem,
  workspaceItemPatches,
  type LiveWorkspaceItem,
  type LiveWorkspaceItemKind
} from '@/app/smylr-live-inspector/workspace'

type PageItem = Pick<SceneNode, 'id' | 'name' | 'childIds'>
type PageSection = {
  id: string
  label: string
  pages: PageItem[]
}

interface PageActions {
  rename: (pageId: string, name: string) => void
  delete: (pageId: string) => void
  move: (pageId: string, index: number) => void
}

const pageInput = templateRef<HTMLInputElement>('pageInput')
const store = useEditorStore()
const workspaceUi = useKnowledgeWorkspaceUi(store)
const rename = useInlineRename((id, name) => pageActions.value?.rename(id, name))
const { panels, pages: pageMessages } = useI18n()
const menuCls = useMenuUI({ content: 'min-w-36 shadow-[0_8px_30px_rgb(0_0_0/0.4)]' })

const pageActions = ref<Pick<PageActions, 'rename'> | null>(null)
const expandedSections = ref<Set<string>>(new Set(['clinical']))
const expandedPages = ref<Set<string>>(new Set())
const pageQuery = ref('')
const currentPages = ref<readonly PageItem[]>([])
const currentMovePage = ref<PageActions['move'] | null>(null)
const pageReorder = useFlatReorderDrag<PageItem>({
  items: () => currentPages.value,
  onMove: (pageId, index) => currentMovePage.value?.(pageId, index)
})

function setPageActions(renamePage: (pageId: string, name: string) => void) {
  pageActions.value = { rename: renamePage }
}

watch(pageInput, (input) => {
  if (input) void rename.focusInput(input)
})

function startRename(pg: PageItem, renamePage: (pageId: string, name: string) => void) {
  setPageActions(renamePage)
  rename.start(pg.id, pg.name)
}

function isDraggingTarget(pg: PageItem, operation: 'reorder-before' | 'reorder-after') {
  return (
    pageReorder.instructionTargetId.value === pg.id &&
    pageReorder.instruction.value?.operation === operation
  )
}

function setupPageRowRef(
  value: Element | ComponentPublicInstance | null,
  pg: PageItem,
  pages: readonly PageItem[],
  movePage: PageActions['move']
) {
  currentPages.value = pages
  currentMovePage.value = movePage
  pageReorder.setupItem(value instanceof HTMLElement ? value : null, () => ({ id: pg.id }))
}

const workspaceGroups: Array<{ kind: LiveWorkspaceItemKind; label: string }> = [
  { kind: 'draft', label: 'Drafts' },
  { kind: 'variant', label: 'Variants' },
  { kind: 'flow', label: 'Flows' },
  { kind: 'review', label: 'Review' },
  { kind: 'change-set', label: 'Approved' },
  { kind: 'archived', label: 'Archived' }
]
function pageRoute(pg: PageItem) {
  return SMYLR_PRODUCTION_PAGES.find((page) => page.label === pg.name)?.route ?? null
}

const FLOW_PAGE_SUFFIX = ' — Flow'
const WORKSPACE_PROJECTION_PAGE_SUFFIXES = [
  FLOW_PAGE_SUFFIX,
  ' — Document',
  ' — Review',
  ' — Atlas'
]
const FOUNDATION_PAGE_NAMES = new Set(['Design System', 'Brand Guidelines'])

function sectionId(label: string) {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-')
}

function productionGroupFor(pg: PageItem): SmylrProductionPageGroup | null {
  return SMYLR_PRODUCTION_PAGES.find((page) => page.label === pg.name)?.group ?? null
}

function isComponentPage(pg: PageItem) {
  const page = store.graph.getNode(pg.id)
  return page?.pluginData.some(
    (entry) =>
      entry.pluginId === 'smylr-production' &&
      entry.key === 'kind' &&
      (entry.value === SMYLR_LIVE_COMPONENT_PAGE_KIND || entry.value === 'smylr-component-page')
  )
}

function visiblePageItems(pages: readonly PageItem[]) {
  return pages.filter(
    (page) => !WORKSPACE_PROJECTION_PAGE_SUFFIXES.some((suffix) => page.name.endsWith(suffix))
  )
}

function pageSections(pages: readonly PageItem[], query = ''): PageSection[] {
  const visible = visiblePageItems(pages)
  const grouped = SMYLR_PRODUCTION_PAGE_GROUPS.map((group) => ({
    id: sectionId(group),
    label: group,
    pages: visible.filter((page) => productionGroupFor(page) === group)
  }))
  const foundations = visible.filter((page) => FOUNDATION_PAGE_NAMES.has(page.name))
  const components = visible.filter(isComponentPage)
  const boards = visible.filter(
    (page) =>
      productionGroupFor(page) === null &&
      !FOUNDATION_PAGE_NAMES.has(page.name) &&
      !isComponentPage(page)
  )
  const sections = [
    ...grouped,
    { id: 'foundations', label: 'Foundations', pages: foundations },
    { id: 'components', label: 'Components', pages: components },
    { id: 'boards', label: 'Boards', pages: boards }
  ].filter((section) => section.pages.length > 0)

  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery) return sections
  return sections
    .map((section) => ({
      ...section,
      pages: section.pages.filter((page) => page.name.toLocaleLowerCase().includes(normalizedQuery))
    }))
    .filter((section) => section.pages.length > 0)
}

function displayedPageSections(pages: readonly PageItem[]) {
  return pageSections(pages, pageQuery.value)
}

function sectionIsExpanded(section: PageSection) {
  return Boolean(pageQuery.value.trim()) || expandedSections.value.has(section.id)
}

function pageInitial(pg: PageItem) {
  return pg.name.trim().charAt(0).toLocaleUpperCase() || '•'
}

function toggleSection(section: PageSection) {
  const next = new Set(expandedSections.value)
  if (next.has(section.id)) next.delete(section.id)
  else next.add(section.id)
  expandedSections.value = next
}

function sectionIsActive(section: PageSection, currentPageId: string, pages: readonly PageItem[]) {
  return section.pages.some((page) => pageFolderIsActive(page, currentPageId, pages))
}

function revealCurrentPage(currentPageId: string) {
  const pages = store.graph.getPages()
  const section = pageSections(pages).find((candidate) =>
    sectionIsActive(candidate, currentPageId, pages)
  )
  if (!section) return
  expandedSections.value = new Set([section.id])
  const page = section.pages.find((candidate) =>
    pageFolderIsActive(candidate, currentPageId, pages)
  )
  expandedPages.value = page ? new Set([page.id]) : new Set()
}

watch(() => store.state.currentPageId, revealCurrentPage, { immediate: true })

function flowPageFor(pg: PageItem, pages: readonly PageItem[]) {
  return pages.find((page) => page.name === `${pg.name}${FLOW_PAGE_SUFFIX}`) ?? null
}

function pageFolderIsActive(pg: PageItem, currentPageId: string, pages: readonly PageItem[]) {
  const currentPage = store.graph.getNode(currentPageId)
  return (
    pg.id === currentPageId ||
    flowPageFor(pg, pages)?.id === currentPageId ||
    Boolean(currentPage && workspaceBasePageIdForPage(currentPage) === pg.id)
  )
}

function pageWorkspaceItems(pg: PageItem, kind?: LiveWorkspaceItemKind) {
  const route = pageRoute(pg)
  if (!route) return []
  return liveWorkspaceItems.value.filter(
    (item) => item.route === route && (!kind || item.kind === kind)
  )
}

function togglePage(pg: PageItem) {
  const next = new Set(expandedPages.value)
  if (next.has(pg.id)) next.delete(pg.id)
  else next.add(pg.id)
  expandedPages.value = next
}

function openWorkspaceItem(item: LiveWorkspaceItem) {
  selectLiveWorkspaceItem(item.id)
  for (const patch of workspaceItemPatches(item)) {
    previewLiveInspectorDraft(patch, { label: `Open ${item.name}` })
  }
  selectLiveInspectorNode(item.nodeId)
}

async function openFlowCanvas(
  pg: PageItem,
  pages: readonly PageItem[],
  switchPage: (pageId: string) => void
) {
  const flowPage = flowPageFor(pg, pages)
  if (!flowPage) return
  switchPage(flowPage.id)
  await nextTick()
  store.select([])
  await fitSmylrPageToViewport(store)
}

async function openCurrentCanvas(pg: PageItem, switchPage: (pageId: string) => void) {
  switchPage(pg.id)
  await nextTick()
  const currentFrame = findCurrentSmylrLiveAppFrame(store)
  await fitSmylrPageToViewport(store, currentFrame ? [currentFrame.id] : [])
}

function workspaceViewForPage(pg: PageItem, pages: readonly PageItem[]) {
  return workspaceUi.activeViewForPage(pg.id, {
    canvasPageId: pg.id,
    graphPageId: flowPageFor(pg, pages)?.id
  })
}

async function openWorkspaceView(
  pg: PageItem,
  pages: readonly PageItem[],
  kind: WorkspaceViewKind
) {
  await workspaceUi.openView({
    basePageId: pg.id,
    basePageName: pg.name,
    graphPageId: flowPageFor(pg, pages)?.id,
    kind,
    route: pageRoute(pg)
  })
}

onMounted(() => void restoreLiveWorkspace())
</script>

<template>
  <PageListRoot v-slot="{ pages, currentPageId, isDivider, actions }">
    <div data-test-id="pages-panel" class="flex min-h-0 flex-1 flex-col bg-transparent">
      <div class="shrink-0 px-3 pt-2.5 pb-1.5">
        <div class="flex items-center gap-1.5">
          <label
            class="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-[9px] border border-white/[0.055] bg-black/20 px-2.5 text-muted shadow-[inset_0_1px_2px_rgba(0,0,0,0.22)] transition-all focus-within:border-accent/35 focus-within:bg-black/25 focus-within:text-surface focus-within:ring-2 focus-within:ring-accent/10"
          >
            <icon-lucide-search class="size-3.5 shrink-0 opacity-70" />
            <input
              v-model="pageQuery"
              data-test-id="pages-search"
              type="search"
              placeholder="Search workspace"
              class="min-w-0 flex-1 border-none bg-transparent p-0 text-[11px] text-surface outline-none placeholder:text-muted/70"
            />
            <button
              v-if="pageQuery"
              type="button"
              aria-label="Clear workspace search"
              class="flex size-4 items-center justify-center rounded hover:bg-panel"
              @click="pageQuery = ''"
            >
              <icon-lucide-x class="size-3" />
            </button>
          </label>
          <Tip :label="panels.addPage">
            <button
              data-test-id="pages-add"
              type="button"
              aria-label="New page"
              class="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-[9px] border border-white/[0.055] bg-white/[0.045] text-muted shadow-[0_1px_2px_rgba(0,0,0,0.22)] transition-all hover:bg-white/[0.075] hover:text-surface"
              @click="actions.add()"
            >
              <icon-lucide-plus class="size-3.5" />
            </button>
          </Tip>
        </div>
      </div>
      <div class="min-h-0 flex-1 overflow-hidden">
        <div
          data-test-id="pages-scroll"
          class="scrollbar-thin h-full overflow-x-hidden overflow-y-auto px-2.5 pb-4"
        >
          <template v-for="section in displayedPageSections(pages)" :key="section.id">
            <button
              data-test-id="pages-section"
              class="group mt-2 flex h-8 w-full items-center gap-1.5 rounded-[7px] px-1.5 text-left text-[10.5px] font-semibold tracking-[-0.005em] transition-colors"
              :class="
                sectionIsActive(section, currentPageId, pages)
                  ? 'text-surface'
                  : 'text-muted hover:bg-hover hover:text-surface'
              "
              :aria-expanded="sectionIsExpanded(section)"
              @click="toggleSection(section)"
            >
              <icon-lucide-chevron-right
                class="size-3 shrink-0 opacity-55 transition-transform group-hover:opacity-100"
                :class="sectionIsExpanded(section) ? 'rotate-90' : ''"
              />
              <icon-lucide-heart-pulse
                v-if="section.id === 'clinical'"
                class="size-3.5 shrink-0 opacity-70"
              />
              <icon-lucide-calendar-days
                v-else-if="section.id === 'front-desk'"
                class="size-3.5 shrink-0 opacity-70"
              />
              <icon-lucide-panels-top-left
                v-else-if="section.id === 'operations'"
                class="size-3.5 shrink-0 opacity-70"
              />
              <icon-lucide-settings-2
                v-else-if="section.id === 'system'"
                class="size-3.5 shrink-0 opacity-70"
              />
              <icon-lucide-palette
                v-else-if="section.id === 'foundations'"
                class="size-3.5 shrink-0 opacity-70"
              />
              <icon-lucide-boxes
                v-else-if="section.id === 'components'"
                class="size-3.5 shrink-0 opacity-70"
              />
              <icon-lucide-layout-dashboard v-else class="size-3.5 shrink-0 opacity-70" />
              <span class="min-w-0 flex-1 truncate">{{ section.label }}</span>
              <span
                class="rounded-md bg-white/[0.035] px-1.5 py-0.5 text-[9px] leading-3 font-normal tabular-nums text-muted/65"
              >
                {{ section.pages.length }}
              </span>
            </button>
            <ContextMenuRoot
              v-for="pg in sectionIsExpanded(section) ? section.pages : []"
              :key="pg.id"
              :modal="false"
            >
              <ContextMenuTrigger as-child>
                <div
                  data-test-id="pages-row"
                  :ref="(value) => setupPageRowRef(value, pg, pages, actions.move)"
                  class="relative ml-2 cursor-grab active:cursor-grabbing"
                  :class="pageReorder.draggingId.value === pg.id ? 'opacity-60' : ''"
                  :data-page-id="pg.id"
                >
                  <div
                    v-if="isDraggingTarget(pg, 'reorder-before')"
                    data-test-id="pages-drop-indicator"
                    class="pointer-events-none absolute inset-x-1 top-0 z-10 h-0.5 rounded-full bg-accent"
                  />
                  <div
                    v-if="rename.editingId.value === pg.id"
                    class="flex h-8 w-full items-center gap-2 rounded-[7px] bg-white/[0.045] px-2"
                  >
                    <span
                      class="flex size-4 shrink-0 items-center justify-center rounded-md bg-white/[0.055] text-[9px] font-semibold text-muted"
                      >{{ pageInitial(pg) }}</span
                    >
                    <input
                      ref="pageInput"
                      data-test-id="pages-item-input"
                      class="min-w-0 flex-1 rounded border border-accent bg-input px-1 py-0.5 text-[11px] text-surface outline-none"
                      :value="pg.name"
                      @blur="rename.commit(pg.id, $event)"
                      @keydown.stop="rename.onKeydown"
                    />
                  </div>
                  <div
                    v-else-if="isDivider(pg)"
                    data-test-id="pages-divider"
                    class="my-1 flex cursor-pointer items-center px-2"
                    @dblclick="startRename(pg, actions.rename)"
                  >
                    <div class="h-px flex-1 bg-border" />
                  </div>
                  <button
                    v-else
                    data-test-id="pages-item"
                    class="group/page relative flex h-8 w-full cursor-pointer items-center gap-2 rounded-[7px] border-none px-2 text-left text-[10.5px] tracking-[-0.005em] transition-all"
                    :class="
                      pageFolderIsActive(pg, currentPageId, pages)
                        ? 'bg-white/[0.085] text-surface font-medium shadow-[inset_0_0_0_1px_rgba(255,255,255,0.045),0_1px_2px_rgba(0,0,0,0.18)]'
                        : 'bg-transparent text-muted hover:bg-white/[0.055] hover:text-surface'
                    "
                    @click="togglePage(pg)"
                    @dblclick="startRename(pg, actions.rename)"
                  >
                    <icon-lucide-chevron-right
                      class="size-3 shrink-0 opacity-50 transition-all group-hover/page:opacity-100"
                      :class="expandedPages.has(pg.id) ? 'rotate-90' : ''"
                    />
                    <span class="flex size-4 shrink-0 items-center justify-center">
                      <icon-lucide-file-text
                        class="size-3.5"
                        :class="
                          pageFolderIsActive(pg, currentPageId, pages)
                            ? 'text-accent'
                            : 'text-muted/75 group-hover/page:text-muted'
                        "
                      />
                    </span>
                    <span class="min-w-0 flex-1 truncate">{{ pg.name }}</span>
                    <span
                      v-if="pageWorkspaceItems(pg).length"
                      class="rounded-md bg-white/[0.035] px-1.5 py-0.5 text-[9px] leading-3 font-normal tabular-nums text-muted/65"
                    >
                      {{ pageWorkspaceItems(pg).length }}
                    </span>
                  </button>
                  <div
                    v-if="expandedPages.has(pg.id) && pageRoute(pg)"
                    data-test-id="page-workspace-tree"
                    class="relative ml-[17px] pl-2.5 before:absolute before:inset-y-1 before:left-0 before:w-px before:bg-white/[0.075]"
                  >
                    <WorkspaceViewSwitcher
                      :model-value="workspaceViewForPage(pg, pages)"
                      @update:model-value="openWorkspaceView(pg, pages, $event)"
                    />
                    <button
                      class="flex h-[30px] w-full items-center gap-2 rounded-[7px] px-2 text-left text-[10px] text-muted transition-colors hover:bg-white/[0.055] hover:text-surface"
                      @click="openCurrentCanvas(pg, actions.switch)"
                    >
                      <icon-lucide-monitor-dot class="size-3.5 text-emerald-300" />
                      <span>Current</span>
                      <span
                        class="ml-auto rounded-full bg-emerald-400/10 px-1.5 py-0.5 text-[8px] tracking-wide text-emerald-300/80 uppercase"
                        >Live</span
                      >
                    </button>
                    <button
                      v-if="flowPageFor(pg, pages)"
                      data-test-id="page-flow-canvas"
                      class="flex h-[30px] w-full items-center gap-2 rounded-[7px] px-2 text-left text-[10px] text-muted transition-colors hover:bg-white/[0.055] hover:text-surface"
                      :class="
                        flowPageFor(pg, pages)?.id === currentPageId ? 'bg-hover text-surface' : ''
                      "
                      @click="openFlowCanvas(pg, pages, actions.switch)"
                    >
                      <icon-lucide-waypoints class="size-3.5" />
                      <span>Flow canvas</span>
                      <span
                        v-if="pg.name === 'Dental Chart'"
                        class="ml-auto rounded bg-accent/15 px-1 text-[8px] text-accent"
                      >
                        4
                      </span>
                    </button>
                    <template v-for="group in workspaceGroups" :key="group.kind">
                      <div v-if="pageWorkspaceItems(pg, group.kind).length">
                        <div
                          class="flex h-6 items-center gap-1.5 px-2 text-[8.5px] font-semibold tracking-[0.035em] text-muted/65 uppercase"
                        >
                          <icon-lucide-layers-2 class="size-2.5" />
                          <span class="flex-1">{{ group.label }}</span>
                          <span>{{ pageWorkspaceItems(pg, group.kind).length }}</span>
                        </div>
                        <button
                          v-for="item in pageWorkspaceItems(pg, group.kind)"
                          :key="item.id"
                          class="flex min-h-7 w-full items-center gap-1.5 rounded-[7px] py-1 pr-1 pl-5 text-left text-[9.5px] text-muted transition-colors hover:bg-white/[0.055] hover:text-surface"
                          @click="openWorkspaceItem(item)"
                        >
                          <icon-lucide-file-text class="size-3 shrink-0 opacity-65" />
                          <span class="truncate">{{ item.name }}</span>
                        </button>
                      </div>
                    </template>
                  </div>
                  <div
                    v-if="isDraggingTarget(pg, 'reorder-after')"
                    data-test-id="pages-drop-indicator"
                    class="pointer-events-none absolute inset-x-1 bottom-0 z-10 h-0.5 rounded-full bg-accent"
                  />
                </div>
              </ContextMenuTrigger>
              <ContextMenuPortal>
                <ContextMenuContent :class="menuCls.content" :side-offset="2" align="start">
                  <ContextMenuItem
                    data-test-id="pages-context-rename"
                    :class="menuCls.item"
                    @select="startRename(pg, actions.rename)"
                  >
                    <icon-lucide-pencil :class="menuCls.icon" />
                    <span>{{ pageMessages.rename }}</span>
                  </ContextMenuItem>
                  <ContextMenuItem
                    data-test-id="pages-context-delete"
                    :class="menuCls.item"
                    :disabled="pages.length <= 1"
                    @select="actions.delete(pg.id)"
                  >
                    <icon-lucide-trash-2 :class="menuCls.icon" />
                    <span>{{ pageMessages.delete }}</span>
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenuPortal>
            </ContextMenuRoot>
          </template>
        </div>
      </div>
    </div>
  </PageListRoot>
</template>
