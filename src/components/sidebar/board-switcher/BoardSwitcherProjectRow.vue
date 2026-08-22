<script setup lang="ts">
import BoardIcon from '@/components/pages-panel/BoardIcon.vue'
import type { BoardSwitcherProject } from '@/components/sidebar/board-switcher/types'
import { type BoardSwitcherUi, useBoardSwitcherUI } from '@/components/sidebar/board-switcher/ui'

defineOptions({ name: 'BoardSwitcherProjectRow' })

const { currentPageId, expandedProjectIds, project, ui } = defineProps<{
  currentPageId: string
  expandedProjectIds: Set<string>
  project: BoardSwitcherProject
  ui?: BoardSwitcherUi
}>()
const emit = defineEmits<{
  openBoard: [boardPageId: string]
  toggleProject: [projectId: string]
}>()

const switcher = useBoardSwitcherUI(ui)

function isExpanded() {
  return expandedProjectIds.has(project.id)
}
</script>

<template>
  <button
    type="button"
    data-test-id="board-switcher-project-row"
    :aria-label="isExpanded() ? `Collapse ${project.name}` : `Expand ${project.name}`"
    :class="switcher.row(false)"
    @click="emit('toggleProject', project.id)"
  >
    <icon-lucide-chevron-right
      :class="[switcher.projectChevron, isExpanded() ? 'rotate-90' : '']"
    />
    <icon-lucide-folder :class="switcher.projectIcon" />
    <span class="min-w-0 flex-1 truncate font-medium">{{ project.name }}</span>
  </button>

  <div v-if="isExpanded()" :class="switcher.projectChildren">
    <button
      v-for="board in project.boards"
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
      <span class="min-w-0 flex-1 truncate font-medium">{{ board.label }}</span>
      <span v-if="board.pageId === currentPageId" :class="switcher.activeDot" />
    </button>

    <BoardSwitcherProjectRow
      v-for="child in project.children"
      :key="child.id"
      :current-page-id="currentPageId"
      :expanded-project-ids="expandedProjectIds"
      :project="child"
      :ui="ui"
      @open-board="emit('openBoard', $event)"
      @toggle-project="emit('toggleProject', $event)"
    />
  </div>
</template>
