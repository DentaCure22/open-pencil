import { onClickOutside } from '@vueuse/core'
import { computed, nextTick, ref, type Ref } from 'vue'

import type { AgentConversationHistory } from './conversations'
import type { AgentWorkMapTodoStatus } from './work-map'
import { useAgentWorkMapPersistence } from './work-map-persistence'
import { buildAgentWorkMapView, type WorkMapViewEntry } from './work-map-view'

const WORK_MAP_MISC_ID = '__misc__'
const WORK_MAP_MISC_INITIAL_COUNT = 15
export const WORK_MAP_MISC_PAGE_SIZE = 10
const WORK_MAP_IN_MOTION_INITIAL_COUNT = 5
export const WORK_MAP_IN_MOTION_PAGE_SIZE = 5
const WORK_MAP_STATUS_INITIAL_COUNT = 5
export const WORK_MAP_STATUS_PAGE_SIZE = 5

export function useWorkMapSurfaceState(history: Readonly<Ref<AgentConversationHistory | null>>) {
  const { openProjects, workMap } = useAgentWorkMapPersistence()
  const search = ref('')
  const workMapSearchOpen = ref(false)
  const workMapSearchField = ref<HTMLElement | null>(null)
  const workMapSearchInput = ref<HTMLInputElement | null>(null)
  const workMapSearchToggle = ref<HTMLButtonElement | null>(null)
  const workMapMiscVisibleCount = ref(WORK_MAP_MISC_INITIAL_COUNT)
  const workMapInboxOpen = ref(false)
  const workMapInMotionVisibleCounts = ref<Record<string, number>>({})
  const workMapOpenStatuses = ref<Record<string, boolean>>({})
  const workMapVisibleCounts = ref<Record<string, number>>({})
  const workMapTodoStatuses = ['todo', 'in_motion'] as const
  const workMapStatusIconNames = { in_motion: 'activity', todo: 'time-circle' } as const
  const workMapStatusIconClasses = {
    in_motion: 'text-[#6e2ffc]',
    todo: 'text-[#f59e0b]'
  } as const
  const workMapStatusLabels = { in_motion: 'In motion', todo: 'Todo' } as const
  const workMapView = computed(() =>
    buildAgentWorkMapView({
      initialMiscCount: WORK_MAP_MISC_INITIAL_COUNT,
      initialProjectInMotionCount: WORK_MAP_IN_MOTION_INITIAL_COUNT,
      initialTodoCount: WORK_MAP_STATUS_INITIAL_COUNT,
      miscVisibleCount: workMapMiscVisibleCount.value,
      query: search.value,
      projectInMotionVisibleCounts: workMapInMotionVisibleCounts.value,
      threads: history.value?.threads ?? [],
      todoVisibleCounts: workMapVisibleCounts.value,
      workMap: workMap.value
    })
  )

  function workMapTodoGroup(entry: WorkMapViewEntry, status: AgentWorkMapTodoStatus) {
    return entry.todos[status]
  }

  function workMapSectionKey(projectId: string, section: AgentWorkMapTodoStatus | 'scheduled') {
    return `${projectId}:${section}`
  }

  function isWorkMapSectionOpen(
    projectId: string,
    section: AgentWorkMapTodoStatus | 'scheduled'
  ): boolean {
    if (search.value.trim()) return true
    return workMapOpenStatuses.value[workMapSectionKey(projectId, section)] ?? true
  }

  function openWorkMapSection(projectId: string, section: AgentWorkMapTodoStatus | 'scheduled') {
    workMapOpenStatuses.value = {
      ...workMapOpenStatuses.value,
      [workMapSectionKey(projectId, section)]: true
    }
  }

  function toggleWorkMapSection(projectId: string, section: AgentWorkMapTodoStatus | 'scheduled') {
    workMapOpenStatuses.value = {
      ...workMapOpenStatuses.value,
      [workMapSectionKey(projectId, section)]: !isWorkMapSectionOpen(projectId, section)
    }
  }

  function isWorkMapScheduledOpen(projectId: string): boolean {
    return isWorkMapSectionOpen(projectId, 'scheduled')
  }

  function openWorkMapScheduled(projectId: string) {
    openWorkMapSection(projectId, 'scheduled')
  }

  function toggleWorkMapScheduled(projectId: string) {
    toggleWorkMapSection(projectId, 'scheduled')
  }

  function isWorkMapStatusOpen(projectId: string, status: AgentWorkMapTodoStatus): boolean {
    if (search.value.trim()) return true
    return workMapOpenStatuses.value[workMapSectionKey(projectId, status)] ?? true
  }

  function openWorkMapStatus(projectId: string, status: AgentWorkMapTodoStatus) {
    openWorkMapSection(projectId, status)
  }

  function toggleWorkMapStatus(projectId: string, status: AgentWorkMapTodoStatus) {
    toggleWorkMapSection(projectId, status)
  }

  function showMoreProjectTodos(projectId: string, status: AgentWorkMapTodoStatus) {
    const key = `${projectId}:${status}`
    workMapVisibleCounts.value = {
      ...workMapVisibleCounts.value,
      [key]:
        (workMapVisibleCounts.value[key] ?? WORK_MAP_STATUS_INITIAL_COUNT) +
        WORK_MAP_STATUS_PAGE_SIZE
    }
  }

  function showMoreProjectInMotion(projectId: string) {
    workMapInMotionVisibleCounts.value = {
      ...workMapInMotionVisibleCounts.value,
      [projectId]:
        (workMapInMotionVisibleCounts.value[projectId] ?? WORK_MAP_IN_MOTION_INITIAL_COUNT) +
        WORK_MAP_IN_MOTION_PAGE_SIZE
    }
  }

  function showMoreMiscChats() {
    workMapMiscVisibleCount.value += WORK_MAP_MISC_PAGE_SIZE
  }

  function isWorkMapProjectOpen(projectId: string): boolean {
    if (search.value.trim()) return true
    return openProjects.value[projectId]
  }

  function isWorkMapMiscOpen(): boolean {
    if (search.value.trim()) return true
    return Boolean(openProjects.value[WORK_MAP_MISC_ID])
  }

  function isWorkMapInboxOpen(): boolean {
    if (search.value.trim()) return true
    return workMapInboxOpen.value
  }

  function isWorkMapEntryVisible(entry: {
    depth: number
    project: { parentId?: string }
  }): boolean {
    return (
      entry.depth === 0 || !entry.project.parentId || isWorkMapProjectOpen(entry.project.parentId)
    )
  }

  function openWorkMapSearch() {
    workMapSearchOpen.value = true
    void nextTick(() => workMapSearchInput.value?.focus())
  }

  function closeWorkMapSearch(restoreToggleFocus = true) {
    search.value = ''
    workMapSearchOpen.value = false
    if (restoreToggleFocus) void nextTick(() => workMapSearchToggle.value?.focus())
  }

  function toggleWorkMapSearch() {
    if (workMapSearchOpen.value) {
      closeWorkMapSearch()
      return
    }
    openWorkMapSearch()
  }

  onClickOutside(
    workMapSearchField,
    () => {
      if (workMapSearchOpen.value) closeWorkMapSearch(false)
    },
    { ignore: [workMapSearchToggle] }
  )

  function toggleWorkMapProject(projectId: string) {
    openProjects.value = {
      ...openProjects.value,
      [projectId]: !isWorkMapProjectOpen(projectId)
    }
  }

  function toggleWorkMapMisc() {
    openProjects.value = {
      ...openProjects.value,
      [WORK_MAP_MISC_ID]: !isWorkMapMiscOpen()
    }
  }

  function toggleWorkMapInbox() {
    workMapInboxOpen.value = !isWorkMapInboxOpen()
  }

  function setWorkMapSearchField(element: unknown) {
    workMapSearchField.value = element instanceof HTMLElement ? element : null
  }

  function setWorkMapSearchInput(element: unknown) {
    workMapSearchInput.value = element instanceof HTMLInputElement ? element : null
  }

  function setWorkMapSearchToggle(element: unknown) {
    workMapSearchToggle.value = element instanceof HTMLButtonElement ? element : null
  }

  return {
    closeWorkMapSearch,
    isWorkMapEntryVisible,
    isWorkMapInboxOpen,
    isWorkMapMiscOpen,
    isWorkMapProjectOpen,
    isWorkMapScheduledOpen,
    isWorkMapStatusOpen,
    openWorkMapScheduled,
    openWorkMapStatus,
    search,
    setWorkMapSearchField,
    setWorkMapSearchInput,
    setWorkMapSearchToggle,
    showMoreMiscChats,
    showMoreProjectInMotion,
    showMoreProjectTodos,
    toggleWorkMapInbox,
    toggleWorkMapMisc,
    toggleWorkMapProject,
    toggleWorkMapScheduled,
    toggleWorkMapSearch,
    toggleWorkMapStatus,
    workMapSearchOpen,
    workMapStatusIconClasses,
    workMapStatusIconNames,
    workMapStatusLabels,
    workMapTodoGroup,
    workMapTodoStatuses,
    workMapView
  }
}
