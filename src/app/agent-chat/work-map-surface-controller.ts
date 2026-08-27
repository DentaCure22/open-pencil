import { useEventListener } from '@vueuse/core'
import { computed, ref, type ComputedRef, type Ref } from 'vue'

import { useEditorStore } from '@/app/editor/active-store'
import { toast } from '@/app/shell/ui'
import {
  summarizeT3ThreadStatuses,
  type T3ThreadStatus
} from '@/components/ai-elements/t3-chat-chrome.logic'

import { useConversationAttachmentDrop } from './conversation-attachment-drop'
import type { AgentConversationThread } from './conversations'
import { useAgentConversationHistory } from './history-store'
import { agentChatsPanelSelectedId, agentChatsPanelView } from './panel'
import { openAgentPanelTodoObject as openTodoObject } from './panel-object-navigation'
import {
  agentConversationDisplayTitle,
  isAgentConversationArchived,
  isAgentConversationPinned,
  setAgentConversationArchived
} from './thread-preferences'
import {
  setAgentWorkMapTodosArchivedForThread,
  type AgentWorkMapTodo,
  type AgentWorkMapTodoStatus
} from './work-map'
import { useWorkMapCreation } from './work-map-creation'
import { useWorkMapDrag } from './work-map-drag'
import { useWorkMapNavigation } from './work-map-navigation'
import { useAgentWorkMapPersistence } from './work-map-persistence'
import { formatWorkMapRoutineTime } from './work-map-routines'
import {
  useWorkMapSurfaceState,
  WORK_MAP_IN_MOTION_PAGE_SIZE,
  WORK_MAP_MISC_PAGE_SIZE,
  WORK_MAP_STATUS_PAGE_SIZE
} from './work-map-surface-state'
import { useWorkMapTodoContentDrop } from './work-map-todo-content-drop'
import type { WorkMapViewEntry } from './work-map-view'

export type AgentWorkMapSurfaceControllerOptions = {
  attachments: Ref<File[]>
  modelScope: ComputedRef<string>
  openThreadChapter?: (thread: AgentConversationThread, chapterId: string) => Promise<void>
  selectThread: (thread: AgentConversationThread) => Promise<void>
  startConversation: (projectId?: string | null, botProjectId?: string | null) => Promise<void>
  threadStatus: (thread: AgentConversationThread) => T3ThreadStatus | undefined
}

export type AgentWorkMapSurfaceController = ReturnType<typeof useAgentWorkMapSurfaceController>

export function useAgentWorkMapSurfaceController(options: AgentWorkMapSurfaceControllerOptions) {
  const editorStore = useEditorStore()
  const surface = ref<HTMLElement | null>(null)
  const archiveConfirmationThread = ref<AgentConversationThread | null>(null)
  const archiveConfirmationTitle = computed(() =>
    archiveConfirmationThread.value
      ? agentConversationDisplayTitle(archiveConfirmationThread.value)
      : 'Chat'
  )
  const selectedId = agentChatsPanelSelectedId
  const view = agentChatsPanelView
  const { history, refresh } = useAgentConversationHistory()
  const {
    applyOperations: applyWorkMapOperations,
    busy: workMapBusy,
    placeChat: placeChatInWorkMap,
    workMap
  } = useAgentWorkMapPersistence()
  const {
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
  } = useWorkMapSurfaceState(history)
  const { dropContentOnTodo, hideTodoContentDrop, showTodoContentDrop, todoContentDropTargetId } =
    useWorkMapTodoContentDrop({ history, openTodoObject, refresh })
  const {
    addWorkMapProject,
    addWorkMapTodo,
    closeWorkMapCreateDialog,
    closeWorkMapTodoComposer,
    setWorkMapCreateInput,
    submitWorkMapCreate,
    submitWorkMapTodo,
    workMapCreateDialog,
    workMapCreateDraft,
    workMapCreateTitle,
    workMapTodoComposerAttachments,
    workMapTodoComposerProjectId,
    workMapTodoComposerText
  } = useWorkMapCreation({
    history,
    modelScope: options.modelScope,
    openTodoObject,
    refresh,
    root: surface,
    store: editorStore
  })
  const {
    armNewThreadPointerDrag,
    armThreadPointerDrag,
    armWorkMapTodoPointerDrag,
    beginWorkMapCreationDrag,
    beginThreadDrag,
    beginWorkMapTodoDrag,
    draggedWorkMapThreadId,
    draggedWorkMapCreationKind,
    draggedWorkMapTodoId,
    dropWorkMapThread,
    dropWorkMapTodo,
    endWorkMapDrag,
    pressedWorkMapThreadId,
    pressedWorkMapTodoId,
    releaseThreadPointerDrag,
    showWorkMapProjectDrop,
    showWorkMapTodoDrop,
    workMapDropProjectId,
    workMapDropTodoStatus
  } = useWorkMapDrag({
    clearContentDrop: () => {
      todoContentDropTargetId.value = null
    },
    createChat: startNewConversation,
    createProject: addWorkMapProject,
    placeChat: placeChatInWorkMap,
    setTodoStatus: setWorkMapTodoStatus,
    workMap
  })
  const {
    archiveInboxItem,
    botThread,
    botTitle,
    openBot,
    openInboxItem,
    openInboxBriefing,
    openWorkMapTodo,
    openWorkMapTodoObject,
    refreshWorkMap,
    revealWorkMapProject,
    showProjectLayers,
    updateWorkMap,
    workMapProjectPageId
  } = useWorkMapNavigation({
    history,
    openThreadChapter: options.openThreadChapter,
    openTodoObject,
    refresh,
    selectThread: options.selectThread
  })

  async function startNewConversation(
    projectId: string | null = null,
    botProjectId?: string | null
  ) {
    search.value = ''
    await options.startConversation(projectId, botProjectId)
  }

  async function startNewBot(projectId: string | null) {
    await startNewConversation(projectId, projectId)
  }

  const {
    browserCaptureDragEnter,
    browserCaptureDragLeave,
    captureDropTargetId,
    dropBrowserCaptureOnThread,
    dropOnList,
    listDragDepth,
    listDragEnter,
    listDragLeave
  } = useConversationAttachmentDrop({
    attachments: options.attachments,
    selectThread: options.selectThread,
    startNewConversation
  })

  function workMapTodoThread(todo: AgentWorkMapTodo): AgentConversationThread | undefined {
    if (!todo.threadId) return undefined
    return history.value?.threads.find((candidate) => candidate.nativeThreadId === todo.threadId)
  }

  function workMapTodoThreadStatus(todo: AgentWorkMapTodo): T3ThreadStatus | undefined {
    const thread = workMapTodoThread(todo)
    return thread ? options.threadStatus(thread) : undefined
  }

  function workMapInMotionActivityStatus(entry: WorkMapViewEntry): T3ThreadStatus | undefined {
    for (const thread of entry.threads.allItems) {
      const status = options.threadStatus(thread)
      if (status?.pulse) return status
    }
    for (const todo of entry.todos.in_motion.allItems) {
      const status = workMapTodoThreadStatus(todo)
      if (status?.pulse) return status
    }
    return undefined
  }

  function workMapMiscActivityStatus(): T3ThreadStatus | undefined {
    return summarizeT3ThreadStatuses(
      workMapView.value.misc.allItems.map((thread) => options.threadStatus(thread))
    )
  }

  function workMapTodoTitle(todo: AgentWorkMapTodo): string {
    return todo.title
  }

  async function handleConversationBotChange() {
    await refreshWorkMap()
  }

  async function handleConversationArchivedChange() {
    await refreshWorkMap()
  }

  async function archiveConversation(thread: AgentConversationThread | undefined) {
    if (!thread) {
      toast.info('Chat unavailable')
      return
    }
    if (isAgentConversationArchived(thread)) return
    setAgentConversationArchived(thread, true)
    try {
      updateWorkMap(await setAgentWorkMapTodosArchivedForThread(thread.nativeThreadId, true))
      toast.info('Chat archived')
    } catch (cause) {
      setAgentConversationArchived(thread, false)
      toast.error(cause instanceof Error ? cause.message : 'Chat archive failed')
    }
  }

  function closeArchiveConfirmation() {
    archiveConfirmationThread.value = null
  }

  function requestArchiveConversation(thread: AgentConversationThread | undefined) {
    if (!thread) {
      toast.info('Chat unavailable')
      return
    }
    archiveConfirmationThread.value = thread
  }

  function requestArchiveWorkMapTodo(todo: AgentWorkMapTodo) {
    requestArchiveConversation(workMapTodoThread(todo))
  }

  async function confirmArchiveConversation() {
    const thread = archiveConfirmationThread.value
    closeArchiveConfirmation()
    await archiveConversation(thread ?? undefined)
  }

  async function setWorkMapTodoStatus(todoId: string, status: AgentWorkMapTodoStatus) {
    await applyWorkMapOperations([{ op: 'update_todo', status, todo_id: todoId }])
  }

  function setSurface(element: unknown) {
    surface.value = element instanceof HTMLElement ? element : null
  }

  useEventListener(window, 'pointerup', releaseThreadPointerDrag)
  useEventListener(window, 'pointercancel', releaseThreadPointerDrag)

  return {
    WORK_MAP_MISC_PAGE_SIZE,
    WORK_MAP_IN_MOTION_PAGE_SIZE,
    WORK_MAP_STATUS_PAGE_SIZE,
    addWorkMapProject,
    addWorkMapTodo,
    agentConversationDisplayTitle,
    archiveInboxItem,
    archiveConfirmationThread,
    archiveConfirmationTitle,
    armNewThreadPointerDrag,
    armThreadPointerDrag,
    armWorkMapTodoPointerDrag,
    beginWorkMapCreationDrag,
    beginThreadDrag,
    beginWorkMapTodoDrag,
    botThread,
    botTitle,
    browserCaptureDragEnter,
    browserCaptureDragLeave,
    captureDropTargetId,
    closeArchiveConfirmation,
    closeWorkMapCreateDialog,
    closeWorkMapSearch,
    closeWorkMapTodoComposer,
    draggedWorkMapThreadId,
    draggedWorkMapCreationKind,
    draggedWorkMapTodoId,
    dropBrowserCaptureOnThread,
    dropContentOnTodo,
    dropOnList,
    dropWorkMapThread,
    dropWorkMapTodo,
    endWorkMapDrag,
    formatWorkMapRoutineTime,
    handleConversationArchivedChange,
    handleConversationBotChange,
    hideTodoContentDrop,
    isAgentConversationPinned,
    isWorkMapEntryVisible,
    isWorkMapInboxOpen,
    isWorkMapMiscOpen,
    isWorkMapProjectOpen,
    isWorkMapScheduledOpen,
    isWorkMapStatusOpen,
    listDragDepth,
    listDragEnter,
    listDragLeave,
    modelScope: options.modelScope,
    openBot,
    openInboxBriefing,
    openInboxItem,
    openWorkMapScheduled,
    openWorkMapStatus,
    openWorkMapTodo,
    openWorkMapTodoObject,
    pressedWorkMapThreadId,
    pressedWorkMapTodoId,
    requestArchiveConversation,
    requestArchiveWorkMapTodo,
    revealWorkMapProject,
    search,
    selectedId,
    selectThread: options.selectThread,
    setSurface,
    setWorkMapCreateInput,
    setWorkMapSearchField,
    setWorkMapSearchInput,
    setWorkMapSearchToggle,
    showMoreMiscChats,
    showMoreProjectInMotion,
    showMoreProjectTodos,
    showProjectLayers,
    showTodoContentDrop,
    showWorkMapProjectDrop,
    showWorkMapTodoDrop,
    startNewBot,
    startNewConversation,
    submitWorkMapCreate,
    submitWorkMapTodo,
    confirmArchiveConversation,
    todoContentDropTargetId,
    toggleWorkMapInbox,
    toggleWorkMapMisc,
    toggleWorkMapProject,
    toggleWorkMapScheduled,
    toggleWorkMapSearch,
    toggleWorkMapStatus,
    threadStatus: options.threadStatus,
    updateWorkMap,
    view,
    workMap,
    workMapBusy,
    workMapCreateDialog,
    workMapCreateDraft,
    workMapCreateTitle,
    workMapDropProjectId,
    workMapDropTodoStatus,
    workMapProjectPageId,
    workMapSearchOpen,
    workMapStatusIconClasses,
    workMapStatusIconNames,
    workMapStatusLabels,
    workMapInMotionActivityStatus,
    workMapMiscActivityStatus,
    workMapTodoComposerAttachments,
    workMapTodoComposerProjectId,
    workMapTodoComposerText,
    workMapTodoGroup,
    workMapTodoStatuses,
    workMapTodoThreadStatus,
    workMapTodoTitle,
    workMapView
  }
}
