<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import BoardIcon from '@/components/pages-panel/BoardIcon.vue'
import BoardSwitcherProjectRow from '@/components/sidebar/board-dock/BoardSwitcherProjectRow.vue'
import type { BoardSwitcherItem, BoardSwitcherProject } from '@/components/sidebar/board-dock/types'
import { type BoardSwitcherUi, useBoardSwitcherUI } from '@/components/sidebar/board-dock/ui'
import Tip from '@/components/ui/Tip.vue'

const SEARCH_RESULT_LIMIT = 12

const {
  allBoards,
  currentPageId,
  pinnedBoardIds,
  pinnedBoards,
  projects,
  recentBoards,
  ui: uiOverrides
} = defineProps<{
  allBoards: BoardSwitcherItem[]
  currentPageId: string
  pinnedBoardIds: string[]
  pinnedBoards: BoardSwitcherItem[]
  projects: BoardSwitcherProject[]
  recentBoards: BoardSwitcherItem[]
  ui?: BoardSwitcherUi
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
const activeProjectPathKey = ref('')
const switcher = useBoardSwitcherUI(uiOverrides)

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

function projectPathForBoard(
  candidates: BoardSwitcherProject[],
  boardPageId: string,
  ancestors: string[] = []
): string[] {
  for (const project of candidates) {
    const path = [...ancestors, project.id]
    if (project.boards.some((board) => board.pageId === boardPageId)) return path
    const childPath = projectPathForBoard(project.children, boardPageId, path)
    if (childPath.length > 0) return childPath
  }
  return []
}

watch(
  () => [currentPageId, projects] as const,
  ([pageId, nextProjects]) => {
    const activePath = projectPathForBoard(nextProjects, pageId)
    const pathKey = `${pageId}:${activePath.join('/')}`
    if (pathKey === activeProjectPathKey.value) return
    activeProjectPathKey.value = pathKey
    if (activePath.length === 0) return
    const next = new Set(expandedProjectIds.value)
    let changed = false
    for (const projectId of activePath) {
      if (next.has(projectId)) continue
      next.add(projectId)
      changed = true
    }
    if (changed) expandedProjectIds.value = next
  },
  { immediate: true }
)

function toggleProject(pageId: string) {
  const next = new Set(expandedProjectIds.value)
  if (next.has(pageId)) next.delete(pageId)
  else next.add(pageId)
  expandedProjectIds.value = next
}
</script>

<template>
  <div :class="switcher.root">
    <div :class="switcher.scrollArea">
      <label data-test-id="board-switcher-search-field" :class="switcher.search">
        <icon-lucide-search :class="switcher.searchIcon" />
        <input
          v-model="boardQuery"
          data-test-id="board-switcher-search"
          type="search"
          placeholder="Search boards"
          :class="switcher.searchInput"
        />
        <button
          v-if="boardQuery"
          type="button"
          aria-label="Clear board search"
          :class="switcher.clearButton"
          @click="boardQuery = ''"
        >
          <icon-lucide-x class="size-3 stroke-[1.6]" />
        </button>
      </label>

      <template v-if="boardQuery.trim()">
        <div :class="`${switcher.sectionTitle} mt-3`">Search results</div>
        <button
          v-for="board in searchRows"
          :key="board.pageId"
          type="button"
          data-test-id="board-switcher-board-row"
          :data-current="board.pageId === currentPageId || undefined"
          :aria-current="board.pageId === currentPageId ? 'page' : undefined"
          :class="switcher.row(board.pageId === currentPageId)"
          @click="emit('openBoard', board.pageId)"
        >
          <BoardIcon
            :icon="board.icon"
            :data-board-icon="board.icon ?? 'canvas'"
            :class="switcher.boardIcon"
          />
          <span class="min-w-0 flex-1">
            <span class="block truncate font-medium">{{ board.label }}</span>
            <span :class="`${switcher.secondaryText} block truncate`">{{ board.projectName }}</span>
          </span>
          <span v-if="board.pageId === currentPageId" :class="switcher.activeDot" />
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
          <div :class="switcher.sectionTitle">
            <span>{{ section.label }}</span>
          </div>

          <div
            v-for="board in section.boards"
            :key="board.pageId"
            data-test-id="board-switcher-board-row"
            :data-current="board.pageId === currentPageId || undefined"
            :class="[switcher.row(board.pageId === currentPageId), 'p-0']"
          >
            <button
              type="button"
              :aria-current="board.pageId === currentPageId ? 'page' : undefined"
              class="flex min-w-0 flex-1 items-center gap-2 self-stretch px-2 text-left"
              @click="emit('openBoard', board.pageId)"
            >
              <BoardIcon
                :icon="board.icon"
                :data-board-icon="board.icon ?? 'canvas'"
                :class="switcher.boardIcon"
              />
              <span class="min-w-0 flex-1 truncate font-medium">{{ board.label }}</span>
              <span :class="`${switcher.secondaryText} max-w-24 shrink-0 truncate`">
                {{ board.projectName }}
              </span>
              <span v-if="board.pageId === currentPageId" :class="switcher.activeDot" />
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
                :class="switcher.pinButton(pinnedIdSet.has(board.pageId))"
                @click="emit('togglePinned', board.pageId)"
              >
                <icon-lucide-pin class="size-3 stroke-[1.6]" />
              </button>
            </Tip>
          </div>
        </section>

        <section :class="quickSections.length ? 'mt-2' : 'mt-3'">
          <div :class="switcher.sectionTitle">
            <span>Projects</span>
          </div>

          <BoardSwitcherProjectRow
            v-for="project in visibleProjects"
            :key="project.id"
            :current-page-id="currentPageId"
            :expanded-project-ids="expandedProjectIds"
            :project="project"
            :ui="uiOverrides"
            @open-board="emit('openBoard', $event)"
            @toggle-project="toggleProject"
          />
        </section>
      </template>
    </div>

    <div data-test-id="board-switcher-footer" :class="switcher.footer">
      <button
        type="button"
        data-test-id="board-switcher-create-board"
        :class="switcher.footerPrimaryAction"
        @click="emit('createBoard')"
      >
        <icon-lucide-plus class="size-3.5 stroke-[1.6]" />
        <span>New board</span>
      </button>
      <button
        type="button"
        data-test-id="board-switcher-create-project"
        :class="switcher.footerSecondaryAction"
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
          :class="switcher.manageAction"
          @click="emit('manage')"
        >
          <icon-lucide-settings-2 class="size-3.5 stroke-[1.6]" />
        </button>
      </Tip>
    </div>
  </div>
</template>
