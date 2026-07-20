<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import BoardIcon from '@/components/pages-panel/BoardIcon.vue'
import type { BoardSwitcherItem, BoardSwitcherProject } from '@/components/sidebar/board-dock/types'
import Tip from '@/components/ui/Tip.vue'

const SEARCH_RESULT_LIMIT = 12

const browserRowClass =
  'group/browser-row relative flex min-h-8 w-full items-center gap-2 rounded-[7px] border border-transparent px-2 text-left text-[12px] text-[#b7b9c1] transition-colors hover:bg-white/[0.055] hover:text-surface'
const browserSectionClass =
  'flex h-[22px] items-center px-1 text-[9.5px] font-semibold uppercase tracking-[0.02em] text-[#777a84]'

const { allBoards, currentPageId, pinnedBoardIds, pinnedBoards, projects, recentBoards } =
  defineProps<{
    allBoards: BoardSwitcherItem[]
    currentPageId: string
    pinnedBoardIds: string[]
    pinnedBoards: BoardSwitcherItem[]
    projects: BoardSwitcherProject[]
    recentBoards: BoardSwitcherItem[]
  }>()
const emit = defineEmits<{
  createBoard: []
  createProject: []
  manage: []
  openBoard: [boardPageId: string]
  togglePinned: [boardPageId: string]
}>()

const boardQuery = ref('')
const expandedProjectIds = ref<Set<string>>(new Set())

const searchRows = computed(() => {
  const query = boardQuery.value.trim().toLocaleLowerCase()
  if (!query) return []
  return allBoards
    .filter(
      (board) =>
        board.label.toLocaleLowerCase().includes(query) ||
        board.projectName.toLocaleLowerCase().includes(query)
    )
    .slice(0, SEARCH_RESULT_LIMIT)
})
const visibleProjects = computed(() => projects)
const pinnedIdSet = computed(() => new Set(pinnedBoardIds))
const quickSections = computed(() =>
  [
    { boards: pinnedBoards, id: 'pinned', label: 'Pinned' },
    { boards: recentBoards, id: 'recent', label: 'Recent' }
  ].filter((section) => section.boards.length > 0)
)

watch(
  () => [currentPageId, projects] as const,
  () => {
    const currentProject = projects.find((project) =>
      project.boards.some((board) => board.pageId === currentPageId)
    )
    if (!currentProject || expandedProjectIds.value.has(currentProject.id)) return
    expandedProjectIds.value = new Set([...expandedProjectIds.value, currentProject.id])
  },
  { immediate: true }
)

function isProjectExpanded(pageId: string) {
  return expandedProjectIds.value.has(pageId)
}

function toggleProject(pageId: string) {
  const next = new Set(expandedProjectIds.value)
  if (next.has(pageId)) next.delete(pageId)
  else next.add(pageId)
  expandedProjectIds.value = next
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div class="scrollbar-thin min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-2.5 pb-2">
      <label
        class="mt-2.5 flex h-9 items-center gap-2.5 rounded-[9px] border border-white/[0.055] bg-[#0d0e11]/85 px-2.5 text-muted shadow-[inset_0_1px_2px_rgba(0,0,0,0.2)] transition-colors focus-within:border-violet-300/25 focus-within:text-surface"
      >
        <icon-lucide-search class="size-[15px] shrink-0 stroke-[1.6]" />
        <input
          v-model="boardQuery"
          data-test-id="board-switcher-search"
          type="search"
          placeholder="Search boards"
          class="min-w-0 flex-1 border-none bg-transparent p-0 text-[12.5px] leading-none text-surface outline-none placeholder:text-muted"
        />
        <button
          v-if="boardQuery"
          type="button"
          aria-label="Clear board search"
          class="flex size-5 items-center justify-center rounded-[5px] hover:bg-hover"
          @click="boardQuery = ''"
        >
          <icon-lucide-x class="size-3 stroke-[1.6]" />
        </button>
      </label>

      <template v-if="boardQuery.trim()">
        <div :class="`${browserSectionClass} mt-3`">Search results</div>
        <button
          v-for="board in searchRows"
          :key="board.pageId"
          type="button"
          :class="[
            browserRowClass,
            board.pageId === currentPageId
              ? 'border-white/[0.035] bg-white/[0.087] text-surface'
              : ''
          ]"
          @click="emit('openBoard', board.pageId)"
        >
          <BoardIcon
            :icon="board.icon"
            :data-board-icon="board.icon ?? 'canvas'"
            class="size-[14px] shrink-0 stroke-[1.5] text-muted"
          />
          <span class="min-w-0 flex-1">
            <span class="block truncate font-medium">{{ board.label }}</span>
            <span class="block truncate text-[9.5px] text-muted/75">{{ board.projectName }}</span>
          </span>
          <span
            v-if="board.pageId === currentPageId"
            class="size-[5px] shrink-0 rounded-full bg-violet-300 shadow-[0_0_0_3px_rgba(155,130,243,0.1)]"
          />
        </button>
        <div v-if="searchRows.length === 0" class="px-2 py-4 text-[11px] text-muted">
          No boards found
        </div>
      </template>

      <template v-else>
        <section
          v-for="(section, sectionIndex) in quickSections"
          :key="section.id"
          :data-test-id="`board-switcher-${section.id}`"
          :class="sectionIndex === 0 ? 'mt-3' : 'mt-1.5'"
        >
          <div :class="browserSectionClass">
            <span>{{ section.label }}</span>
          </div>

          <div
            v-for="board in section.boards"
            :key="board.pageId"
            :class="[
              browserRowClass,
              'p-0',
              board.pageId === currentPageId
                ? 'border-white/[0.035] bg-white/[0.087] text-surface'
                : ''
            ]"
          >
            <button
              type="button"
              class="flex min-w-0 flex-1 items-center gap-2 self-stretch px-2 text-left"
              @click="emit('openBoard', board.pageId)"
            >
              <BoardIcon
                :icon="board.icon"
                :data-board-icon="board.icon ?? 'canvas'"
                class="size-[14px] shrink-0 stroke-[1.5] text-muted"
              />
              <span class="min-w-0 flex-1 truncate font-medium">{{ board.label }}</span>
              <span class="max-w-24 shrink-0 truncate text-[9.5px] text-muted/70">
                {{ board.projectName }}
              </span>
              <span
                v-if="board.pageId === currentPageId"
                class="size-[5px] shrink-0 rounded-full bg-violet-300 shadow-[0_0_0_3px_rgba(155,130,243,0.1)]"
              />
            </button>

            <Tip
              :label="
                pinnedIdSet.has(board.pageId)
                  ? `Remove ${board.label} from dock`
                  : `Keep ${board.label} in dock`
              "
            >
              <button
                type="button"
                :data-test-id="`board-switcher-pin-${board.pageId}`"
                :aria-label="
                  pinnedIdSet.has(board.pageId)
                    ? `Remove ${board.label} from dock`
                    : `Keep ${board.label} in dock`
                "
                class="mr-1 flex size-6 shrink-0 items-center justify-center rounded-[6px] text-muted opacity-0 transition-all hover:bg-white/[0.06] hover:text-surface group-hover/browser-row:opacity-100 focus-visible:opacity-100"
                :class="pinnedIdSet.has(board.pageId) ? 'text-violet-200 opacity-100' : ''"
                @click="emit('togglePinned', board.pageId)"
              >
                <icon-lucide-pin class="size-3 stroke-[1.6]" />
              </button>
            </Tip>
          </div>
        </section>

        <section :class="quickSections.length ? 'mt-2' : 'mt-3'">
          <div :class="browserSectionClass">
            <span>All projects</span>
          </div>

          <template v-for="project in visibleProjects" :key="project.id">
            <button
              type="button"
              data-test-id="board-switcher-project-row"
              :aria-label="
                isProjectExpanded(project.id)
                  ? `Collapse ${project.name}`
                  : `Expand ${project.name}`
              "
              :class="browserRowClass"
              @click="toggleProject(project.id)"
            >
              <icon-lucide-chevron-right
                class="size-3 shrink-0 stroke-[1.6] text-muted/65 transition-transform"
                :class="isProjectExpanded(project.id) ? 'rotate-90' : ''"
              />
              <icon-lucide-folder class="size-[15px] shrink-0 stroke-[1.45] text-muted/80" />
              <span class="min-w-0 flex-1 truncate font-medium">{{ project.name }}</span>
            </button>

            <div
              v-if="isProjectExpanded(project.id)"
              class="relative ml-[21px] border-l border-white/[0.075] pl-3"
            >
              <button
                v-for="board in project.boards"
                :key="board.pageId"
                type="button"
                :class="[
                  browserRowClass,
                  board.pageId === currentPageId
                    ? 'border-white/[0.035] bg-white/[0.087] text-surface'
                    : ''
                ]"
                @click="emit('openBoard', board.pageId)"
              >
                <BoardIcon
                  :icon="board.icon"
                  :data-board-icon="board.icon ?? 'canvas'"
                  class="size-[14px] shrink-0 stroke-[1.5] text-muted"
                />
                <span class="min-w-0 flex-1 truncate font-medium">{{ board.label }}</span>
                <span
                  v-if="board.pageId === currentPageId"
                  class="size-[5px] shrink-0 rounded-full bg-violet-300 shadow-[0_0_0_3px_rgba(155,130,243,0.1)]"
                />
              </button>
            </div>
          </template>
        </section>
      </template>
    </div>

    <div class="flex h-12 shrink-0 items-center gap-1.5 border-t border-white/[0.055] px-2.5">
      <button
        type="button"
        class="flex h-8 items-center gap-1.5 rounded-[7px] px-2.5 text-[11px] font-medium text-[#cacbd0] transition-colors hover:bg-hover hover:text-surface"
        @click="emit('createBoard')"
      >
        <icon-lucide-plus class="size-3.5 stroke-[1.6]" />
        <span>New board</span>
      </button>
      <button
        type="button"
        class="flex h-8 items-center gap-1.5 rounded-[7px] px-2.5 text-[11px] font-medium text-muted transition-colors hover:bg-hover hover:text-surface"
        @click="emit('createProject')"
      >
        <icon-lucide-folder-plus class="size-3.5 stroke-[1.6]" />
        <span>New project</span>
      </button>
      <Tip label="Manage projects">
        <button
          type="button"
          data-test-id="board-switcher-manage"
          aria-label="Manage projects"
          class="ml-auto flex size-8 items-center justify-center rounded-[7px] text-muted transition-colors hover:bg-hover hover:text-surface"
          @click="emit('manage')"
        >
          <icon-lucide-settings-2 class="size-3.5 stroke-[1.6]" />
        </button>
      </Tip>
    </div>
  </div>
</template>
