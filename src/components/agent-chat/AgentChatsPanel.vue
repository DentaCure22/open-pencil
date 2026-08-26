<script setup lang="ts">
import { onClickOutside, useEventListener, useLocalStorage } from '@vueuse/core'
import {
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
  ScrollAreaRoot,
  ScrollAreaViewport
} from 'reka-ui'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

import { stopAgentConversation, submitAgentConversation } from '@/app/agent-chat/actions'
import {
  messageApprovalPreview,
  messageToolPreview,
  respondToAgentUiRequest,
  type AgentExtensionUiResponse,
  type MessageApprovalPreview,
  type MessageApprovalState
} from '@/app/agent-chat/approval'
import {
  ensureAgentConversationTitle,
  type AgentConversationThread
} from '@/app/agent-chat/conversations'
import {
  applyAgentWorkMap,
  createAgentTodoChat,
  getAgentWorkMap,
  openAgentTodoPlan,
  type AgentWorkMap,
  type AgentWorkMapOperation,
  type AgentWorkMapProject,
  type AgentWorkMapTodo,
  type AgentWorkMapTodoStatus
} from '@/app/agent-chat/work-map'
import {
  agentConversationScope,
  conversationSelection,
  seedConversationModel,
  type AgentPromptAnnotation,
  type AgentPromptSubmission
} from '@/app/agent-chat/models'
import {
  loadOlderAgentConversationTranscript,
  releaseAgentConversationTranscript,
  retainAgentConversationTranscript,
  revealAgentConversationChapter,
  useAgentConversationHistory
} from '@/app/agent-chat/history-store'
import {
  clearAgentComposerDraft,
  NEW_AGENT_CHAT_COMPOSER_DRAFT_ID,
  useAgentComposerDraft
} from '@/app/agent-chat/composer-drafts'
import {
  abandonAgentChatsNewTask,
  acceptAgentChatsNewTask,
  agentChatsPanelCreating,
  agentChatsPanelDraftId,
  agentChatsPanelPendingThreadId,
  agentChatsPanelSelectedId,
  agentChatsPanelView,
  beginAgentChatsNewTask,
  claimAgentChatsNewTaskReceipt,
  isAgentChatsNewTaskDraftId
} from '@/app/agent-chat/panel'
import {
  clearOptimisticConversation,
  mergeOptimisticMessages,
  moveOptimisticConversation,
  optimisticConversation
} from '@/app/agent-chat/optimistic'
import {
  agentRightPanelState,
  closeAgentRightPanel,
  openAgentRightPanel,
  setAgentRightPanelSurface,
  type AgentRightPanelSurface
} from '@/app/agent-chat/right-panel'
import { plainConversationPreview } from '@/app/agent-chat/presentation'
import {
  agentConversationDisplayTitle,
  isAgentConversationArchived,
  isAgentConversationPinned,
  isAgentConversationUnread,
  setAgentConversationTitle,
  setAgentConversationUnread,
  shouldMarkFinishedConversationUnread,
  sortAgentConversationThreads
} from '@/app/agent-chat/thread-preferences'
import { toast } from '@/app/shell/ui'
import {
  appendDraftAttachments,
  carriesAttachmentDrag,
  readAttachmentDrag
} from '@/app/agent-chat/attachments'
import { resolveBrowserCaptureAttachments } from '@/app/browser-inspector/attachment'
import workMapProjectClosedIcon from '@/assets/work-map-project/workspace-tray-closed@3x.png'
import workMapProjectOpenIcon from '@/assets/work-map-project/workspace-tray-open@3x.png'
import {
  armAgentConversationPointerDrag,
  newAgentConversationDragPayload,
  shouldSuppressAgentConversationClick,
  writeAgentConversationDrag,
  type AgentConversationDragPayload
} from '@/app/agent-terminal/drag'
import { AiConversationSurface, conversationStatus } from '@/components/ai-elements'
import type { AiTurnChanges } from '@/app/agent-chat/types'
import AiRightPanelWorkspace from '@/components/ai-elements/AiRightPanelWorkspace.vue'
import type { T3ComposerBannerItem } from '@/components/ai-elements/T3ComposerBannerStack'
import {
  resolveT3ThreadStatus,
  type T3ThreadStatus
} from '@/components/ai-elements/t3-chat-chrome.logic'
import {
  parseT3DiffAnnotationSourceId,
  t3DiffAnnotationSourceId,
  type T3DiffReviewComment
} from '@/components/ai-elements/t3-right-panel.logic'
import AgentConversationApproval from '@/components/agent-chat/AgentConversationApproval.vue'
import AgentConversationContextMenu from '@/components/agent-chat/AgentConversationContextMenu.vue'
import AgentThreadStatusIndicator from '@/components/agent-chat/AgentThreadStatusIndicator.vue'
import type { IconlyIconName } from '@/components/icons/iconly-types'
import AppScrollAreaScrollbar from '@/components/ui/AppScrollAreaScrollbar.vue'
import Tip from '@/components/ui/Tip.vue'
import { useDialogUI } from '@/components/ui/dialog'

const { error: historyError, history, refresh } = useAgentConversationHistory()
const search = ref('')
const workMapSearchOpen = ref(false)
const workMapSearchField = ref<HTMLElement | null>(null)
const workMapSearchInput = ref<HTMLInputElement | null>(null)
const workMapSearchToggle = ref<HTMLButtonElement | null>(null)
const workMap = ref<AgentWorkMap | null>(null)
const workMapBusy = ref(false)
const workMapOpenProjects = useLocalStorage<Record<string, boolean>>(
  'open-pencil:work-map-open-projects-v1',
  {}
)
const workMapOpenFinished = useLocalStorage<Record<string, boolean>>(
  'open-pencil:work-map-open-finished-v1',
  {}
)
const WORK_MAP_STATUS_INITIAL_COUNT = 5
const WORK_MAP_STATUS_PAGE_SIZE = 5
const WORK_MAP_MISC_INITIAL_COUNT = 15
const WORK_MAP_MISC_PAGE_SIZE = 10
const workMapVisibleCounts = ref<Record<string, number>>({})
const miscVisibleCount = ref(WORK_MAP_MISC_INITIAL_COUNT)
const pendingNewChatProjectId = ref<string | null>(null)
const draggedWorkMapThreadId = ref<string | null>(null)
const pressedWorkMapThreadId = ref<string | null>(null)
const draggedWorkMapTodoId = ref<string | null>(null)
const workMapDropProjectId = ref<string | null | undefined>(undefined)
const workMapDropTodoStatus = ref<string | null>(null)
const workMapTodoStatuses = ['todo', 'in_motion'] as const
const workMapStatusIconNames: Record<AgentWorkMapTodoStatus, IconlyIconName> = {
  finished: 'tick-square',
  in_motion: 'activity',
  todo: 'time-circle'
}
const workMapStatusIconClasses: Record<AgentWorkMapTodoStatus, string> = {
  finished: 'text-[var(--color-success)]',
  in_motion: 'text-[#6e2ffc]',
  todo: 'text-[#f59e0b]'
}
const workMapStatusLabels: Record<AgentWorkMapTodoStatus, string> = {
  finished: 'Finished',
  in_motion: 'In motion',
  todo: 'Todo'
}
type WorkMapCreateDraft =
  | { kind: 'project'; parentId?: string; parentName?: string }
  | { kind: 'todo'; projectId: string; projectName: string }
const workMapCreateDraft = ref<WorkMapCreateDraft | null>(null)
const workMapCreateTitle = ref('')
const workMapCreateInput = ref<HTMLInputElement | null>(null)
const workMapCreateDialog = useDialogUI({ content: 'w-[min(420px,calc(100vw-2rem))]' })
const selectedId = agentChatsPanelSelectedId
const creating = agentChatsPanelCreating
const pendingThreadId = agentChatsPanelPendingThreadId
const draftId = agentChatsPanelDraftId
const followUp = ref('')
const annotations = ref<AgentPromptAnnotation[]>([])
const attachments = ref<File[]>([])
const submitting = ref(false)
const error = ref('')
const respondingUiRequests = ref<string[]>([])
type MessageApprovalFeedback = {
  preview: MessageApprovalPreview
  requestId: string
  requestedAt: string
  state: Exclude<MessageApprovalState, 'pending'>
  threadId: string
}
type MessageApprovalCard = {
  key: string
  preview: MessageApprovalPreview
  request?: AgentConversationThread['pendingUiRequests'][number]
  runId: string
  state: MessageApprovalState
}
const messageApprovalFeedback = ref<MessageApprovalFeedback[]>([])
const lastFollowUp = ref('')
const lastAnnotations = ref<AgentPromptAnnotation[]>([])
const lastAttachments = ref<File[]>([])
const panel = ref<HTMLElement | null>(null)
const view = agentChatsPanelView
const showArchived = ref(false)
const captureDropTargetId = ref<string | null>(null)
const transcriptScrollTop = new Map<string, number>()
const knownThreadStates = new Map<string, AgentConversationThread['state']>()
let threadStatesInitialized = false
const conversationSurfaceKey = ref('conversation')
type DiffPanelState = {
  capturedAt: string
  open: boolean
  selectedPath?: string
}
const diffPanelByThread = useLocalStorage<Record<string, DiffPanelState>>(
  'open-pencil:t3-right-panel-state-v1',
  {}
)

const selectedThread = computed(
  () => history.value?.threads.find((thread) => thread.id === selectedId.value) ?? null
)
const selectedTodoDraft = computed(() =>
  selectedThread.value?.todoDraft && !selectedThread.value.messages.length
    ? selectedThread.value.todoDraft
    : null
)
const selectedWorkMapTodo = computed(() =>
  selectedThread.value?.todoDraft
    ? (workMap.value?.todos.find((todo) => todo.id === selectedThread.value?.todoDraft?.todoId) ??
      null)
    : null
)
let requestedGeneratedTitleFor = ''
watch(
  () =>
    selectedThread.value && !selectedThread.value.title ? selectedThread.value.nativeThreadId : '',
  (threadId) => {
    if (!threadId || requestedGeneratedTitleFor === threadId) return
    requestedGeneratedTitleFor = threadId
    void ensureAgentConversationTitle(threadId).catch(() => {
      if (requestedGeneratedTitleFor === threadId) requestedGeneratedTitleFor = ''
    })
  },
  { immediate: true }
)
const steeringSelectedThread = computed(() => selectedThread.value?.state === 'running')
const composerPlaceholder = computed(() => {
  if (steeringSelectedThread.value) return 'Add instructions…'
  if (selectedTodoDraft.value) return 'Add a thought to start shaping this…'
  return creating.value ? 'Describe a task…' : 'Follow up…'
})
const selectedModelScope = computed(() =>
  selectedThread.value
    ? agentConversationScope({ threadId: selectedThread.value.nativeThreadId })
    : agentConversationScope({ threadId: 'new' })
)
const filteredThreads = computed(() => {
  const query = search.value.trim().toLowerCase()
  const threads = (history.value?.threads ?? []).filter(
    (thread) => isAgentConversationArchived(thread) === showArchived.value
  )
  if (!query) return threads
  return threads.filter((thread) =>
    [agentConversationDisplayTitle(thread), thread.task, thread.recentUpdate]
      .join(' ')
      .toLowerCase()
      .includes(query)
  )
})
const archivedCount = computed(
  () => history.value?.threads.filter(isAgentConversationArchived).length ?? 0
)
const validWorkMapProjectIds = computed(
  () => new Set((workMap.value?.projects ?? []).map((project) => project.id))
)
const workMapPlacementByThread = computed(
  () =>
    new Map(
      (workMap.value?.placements ?? []).map((placement) => [placement.threadId, placement] as const)
    )
)
const workMapProjectEntries = computed(() => {
  const projects = workMap.value?.projects ?? []
  const byId = new Map(projects.map((project) => [project.id, project] as const))
  const roots = projects.filter((project) => !project.parentId || !byId.has(project.parentId))
  return roots.flatMap((project) => [
    { depth: 0, project },
    ...projects
      .filter((candidate) => candidate.parentId === project.id)
      .map((candidate) => ({ depth: 1, project: candidate }))
  ])
})
const visibleWorkMapProjectEntries = computed(() => {
  const query = search.value.trim().toLowerCase()
  if (!query) {
    return workMapProjectEntries.value.filter(
      (entry) =>
        entry.depth === 0 ||
        (entry.project.parentId !== undefined && isWorkMapProjectOpen(entry.project.parentId))
    )
  }
  const matchingProjectIds = new Set<string>()
  for (const entry of workMapProjectEntries.value) {
    const project = entry.project
    if (
      project.name.toLowerCase().includes(query) ||
      projectThreads(project.id).length ||
      projectTodos(project.id).length
    ) {
      matchingProjectIds.add(project.id)
      if (project.parentId) matchingProjectIds.add(project.parentId)
    }
  }
  return workMapProjectEntries.value.filter((entry) => matchingProjectIds.has(entry.project.id))
})
const miscThreads = computed(() =>
  sortAgentConversationThreads(
    filteredThreads.value.filter((thread) => {
      const placement = workMapPlacementByThread.value.get(thread.nativeThreadId)
      return !placement?.projectId || !validWorkMapProjectIds.value.has(placement.projectId)
    })
  )
)
const visibleMiscThreads = computed(() => miscThreads.value.slice(0, miscVisibleCount.value))
const workMapDisplayEntries = computed(() => {
  const projects = visibleWorkMapProjectEntries.value.map((entry) => ({ ...entry, misc: false }))
  if (miscThreads.value.length || !workMapProjectEntries.value.length) {
    projects.push({
      depth: 0,
      misc: true,
      project: {
        createdAt: '',
        id: '__misc__',
        name: 'Misc chats',
        updatedAt: ''
      }
    })
  }
  return projects
})
const conversationThreadId = computed(
  () => selectedThread.value?.id ?? (creating.value ? (draftId.value ?? '') : '')
)
const composerDraftIdentity = computed(
  () => selectedThread.value?.id ?? (creating.value ? NEW_AGENT_CHAT_COMPOSER_DRAFT_ID : '')
)
const composerDraft = useAgentComposerDraft({
  annotations,
  attachments,
  identity: composerDraftIdentity,
  text: followUp
})
const optimistic = computed(() => optimisticConversation(conversationThreadId.value))
const optimisticSending = computed(
  () =>
    optimistic.value?.state === 'submitted' ||
    (optimistic.value?.state === 'thinking' && selectedThread.value?.state !== 'running')
)
const conversationState = computed(() => {
  if (selectedThread.value?.state === 'running') return 'running'
  if (optimistic.value?.state === 'completed') return 'completed'
  return selectedThread.value?.state
})
const uiStatus = computed(() =>
  conversationStatus({
    error: optimistic.value?.error || error.value,
    sending: optimisticSending.value,
    state: conversationState.value
  })
)
const canStopSelected = computed(
  () =>
    Boolean(
      selectedThread.value?.canFollowUp &&
      (selectedThread.value.state === 'running' || selectedThread.value.pendingUiRequests.length)
    ) ||
    Boolean(
      selectedThread.value &&
      optimistic.value &&
      ['submitted', 'thinking'].includes(optimistic.value.state)
    )
)
const visibleMessages = computed(() =>
  mergeOptimisticMessages(conversationThreadId.value, selectedThread.value?.messages ?? [])
)
const latestAvailableChanges = computed<AiTurnChanges | null>(
  () => [...visibleMessages.value].reverse().find((message) => message.changes)?.changes ?? null
)
const activeDiffState = computed(() => diffPanelByThread.value[conversationThreadId.value] ?? null)
const activeDiffChanges = computed<AiTurnChanges | null>(() => {
  const capturedAt = activeDiffState.value?.capturedAt
  if (!capturedAt) return null
  return (
    [...visibleMessages.value]
      .reverse()
      .find((message) => message.changes?.capturedAt === capturedAt)?.changes ?? null
  )
})
const activeDiffComments = computed<T3DiffReviewComment[]>(() => {
  const capturedAt = activeDiffState.value?.capturedAt
  if (!capturedAt) return []
  return annotations.value.flatMap((annotation) => {
    const target = parseT3DiffAnnotationSourceId(annotation.sourceMessageId)
    if (!target || target.capturedAt !== capturedAt) return []
    return [
      {
        ...target,
        id: annotation.id,
        quote: annotation.quote,
        rangeLabel: annotation.quote.split('\n')[1] || 'selected lines',
        text: annotation.comment
      }
    ]
  })
})

function saveDiffPanelState(state: DiffPanelState) {
  const threadId = conversationThreadId.value
  if (!threadId) return
  diffPanelByThread.value = { ...diffPanelByThread.value, [threadId]: state }
}

function openTurnDiff(changes: AiTurnChanges, selectedPath?: string) {
  openAgentRightPanel('diff')
  saveDiffPanelState({
    capturedAt: changes.capturedAt,
    open: true,
    selectedPath: selectedPath ?? changes.files[0]?.path
  })
}

function openLatestTurnDiff() {
  const changes = latestAvailableChanges.value
  if (changes) {
    openTurnDiff(changes)
    return
  }
  openAgentRightPanel('diff')
  saveDiffPanelState({ capturedAt: '', open: true })
}

function closeTurnDiff() {
  closeAgentRightPanel()
  const state = activeDiffState.value
  if (state) saveDiffPanelState({ ...state, open: false })
}

function showProjectLayers(project: AgentWorkMapProject) {
  openAgentRightPanel('layers', { projectId: project.id, projectName: project.name })
}

function selectRightPanelSurface(surface: AgentRightPanelSurface) {
  setAgentRightPanelSurface(surface)
}

function selectDiffFile(path: string) {
  const state = activeDiffState.value
  if (state) saveDiffPanelState({ ...state, selectedPath: path })
}

function createDiffAnnotationId(): string {
  const values = crypto.getRandomValues(new Uint32Array(2))
  return `diff-${String(values[0] ?? 0)}-${String(values[1] ?? 0)}`
}

function addDiffComment(comment: Omit<T3DiffReviewComment, 'id'>) {
  annotations.value = [
    ...annotations.value,
    {
      comment: comment.text,
      endOffset: comment.quote.length,
      id: createDiffAnnotationId(),
      quote: comment.quote,
      sourceMessageId: t3DiffAnnotationSourceId(comment),
      startOffset: 0
    }
  ]
}

function deleteDiffComment(commentId: string) {
  annotations.value = annotations.value.filter((annotation) => annotation.id !== commentId)
}

function openDiffAnnotation(annotation: AgentPromptAnnotation) {
  const target = parseT3DiffAnnotationSourceId(annotation.sourceMessageId)
  if (!target) return
  const changes = [...visibleMessages.value]
    .reverse()
    .find((message) => message.changes?.capturedAt === target.capturedAt)?.changes
  if (changes) openTurnDiff(changes, target.path)
}
const draftHeaderTitle = computed(() => {
  const prompt = visibleMessages.value.find((message) => message.role === 'user')?.text
  return prompt?.trim().replace(/\s+/g, ' ') || 'New chat'
})
function sameMessageApprovalPreview(
  left: MessageApprovalPreview,
  right: MessageApprovalPreview
): boolean {
  return (
    left.recipient === right.recipient &&
    left.texts.length === right.texts.length &&
    left.texts.every((text, index) => text === right.texts[index])
  )
}

function feedbackState(
  feedback: MessageApprovalFeedback
): Exclude<MessageApprovalState, 'pending'> {
  if (feedback.state !== 'sending') return feedback.state
  for (const message of [...(selectedThread.value?.messages ?? [])].reverse()) {
    for (const part of [...(message.parts ?? [])].reverse()) {
      if (part.type !== 'tool') continue
      const preview = messageToolPreview(part)
      if (!preview || !sameMessageApprovalPreview(preview, feedback.preview)) continue
      if (part.state === 'success') return 'sent'
      if (part.state === 'error') return 'failed'
      return feedback.state
    }
  }
  return feedback.state
}

function approvalRunId(requestedAt: string): string {
  const requestedTime = Date.parse(requestedAt)
  const first = visibleMessages.value[0]
  let runId = first ? (first.role === 'user' ? first.id : `run:${first.id}`) : 'unattached'
  for (const message of visibleMessages.value) {
    if (message.role !== 'user') continue
    if (Number.isFinite(requestedTime) && Date.parse(message.createdAt) > requestedTime) break
    runId = message.id
  }
  return runId
}

function hasNewerUserMessage(requestedAt: string): boolean {
  const requestedTime = Date.parse(requestedAt)
  if (!Number.isFinite(requestedTime)) return false
  return visibleMessages.value.some(
    (message) => message.role === 'user' && Date.parse(message.createdAt) > requestedTime
  )
}

const messageApprovalCards = computed<MessageApprovalCard[]>(() => {
  const thread = selectedThread.value
  if (!thread) return []
  const toolCards: MessageApprovalCard[] = []
  for (const message of visibleMessages.value) {
    for (const [partIndex, part] of (message.parts ?? []).entries()) {
      if (part.type !== 'tool') continue
      const preview = messageToolPreview(part)
      if (!preview) continue
      let state: MessageApprovalState = 'sending'
      if (part.state === 'success') state = 'sent'
      else if (part.state === 'error') state = 'failed'
      toolCards.push({
        key: `tool:${message.id}:${String(partIndex)}`,
        preview,
        runId: approvalRunId(message.createdAt),
        state
      })
    }
  }

  const feedback = messageApprovalFeedback.value.filter((item) => item.threadId === thread.id)
  const cards: MessageApprovalCard[] = feedback
    .filter((item) => {
      const runId = approvalRunId(item.requestedAt)
      return !toolCards.some(
        (card) => card.runId === runId && sameMessageApprovalPreview(card.preview, item.preview)
      )
    })
    .map((item) => ({
      key: `feedback:${item.requestId}`,
      preview: item.preview,
      runId: approvalRunId(item.requestedAt),
      state: feedbackState(item)
    }))
  cards.push(...toolCards)

  const feedbackIds = new Set(feedback.map((item) => item.requestId))
  for (const request of thread.pendingUiRequests) {
    if (feedbackIds.has(request.id)) continue
    const preview = messageApprovalPreview(request)
    if (!preview) continue
    const runId = approvalRunId(request.requestedAt)
    if (
      toolCards.some(
        (card) => card.runId === runId && sameMessageApprovalPreview(card.preview, preview)
      )
    ) {
      continue
    }
    const superseded = hasNewerUserMessage(request.requestedAt)
    cards.push({
      key: `request:${request.id}`,
      preview,
      ...(superseded ? {} : { request }),
      runId,
      state: superseded ? 'cancelled' : 'pending'
    })
  }
  return cards
})
const latestConversationRunId = computed(() => {
  const latestUser = [...visibleMessages.value].reverse().find((message) => message.role === 'user')
  if (latestUser) return latestUser.id
  const first = visibleMessages.value[0]
  return first ? `run:${first.id}` : 'unattached'
})
const hasApprovalSurface = computed(() =>
  messageApprovalCards.value.some((card) => card.runId === latestConversationRunId.value)
)
const selectedStatusMessage = computed(() => {
  const immediate = optimistic.value?.error || error.value || historyError.value
  if (immediate) return immediate
  if (hasApprovalSurface.value) return undefined
  if (selectedThread.value?.state !== 'needs_attention') return undefined
  return plainConversationPreview(selectedThread.value.recentUpdate, 140) || undefined
})
const selectedComposerBanners = computed<T3ComposerBannerItem[]>(() => {
  const banners: T3ComposerBannerItem[] = []
  const sendError = optimistic.value?.error || error.value
  if (sendError) {
    banners.push({
      action: 'retry',
      actionLabel: 'Retry',
      description: sendError,
      dismissible: true,
      id: 'send-error',
      title: 'Message not sent',
      variant: 'error'
    })
  }
  if (historyError.value) {
    banners.push({
      description: historyError.value,
      dismissible: true,
      id: 'history-connection',
      title: 'Connection issue',
      variant: 'warning'
    })
  }
  if (submitting.value && !selectedThread.value) {
    banners.push({
      description: 'Starting the agent and opening the live stream.',
      id: 'thread-connecting',
      title: 'Connecting',
      variant: 'info'
    })
  }
  return banners
})

function messageApprovalCardsForRun(runId: string): MessageApprovalCard[] {
  return messageApprovalCards.value.filter((card) => card.runId === runId)
}

function setMessageApprovalFeedback(feedback: MessageApprovalFeedback) {
  const index = messageApprovalFeedback.value.findIndex(
    (item) => item.threadId === feedback.threadId && item.requestId === feedback.requestId
  )
  if (index === -1) {
    messageApprovalFeedback.value = [...messageApprovalFeedback.value, feedback]
    return
  }
  messageApprovalFeedback.value = messageApprovalFeedback.value.map((item, itemIndex) =>
    itemIndex === index ? feedback : item
  )
}

function removeMessageApprovalFeedback(threadId: string, requestId: string) {
  messageApprovalFeedback.value = messageApprovalFeedback.value.filter(
    (item) => item.threadId !== threadId || item.requestId !== requestId
  )
}

function threadStatus(thread: AgentConversationThread): T3ThreadStatus | undefined {
  return (
    resolveT3ThreadStatus(thread, {
      connecting: selectedId.value === thread.id && submitting.value && thread.state !== 'running',
      unread: isAgentConversationUnread(thread)
    }) ?? undefined
  )
}

function threadStateLabel(thread: AgentConversationThread): string {
  if (thread.state === 'completed') return 'Settled'
  if (thread.state === 'stopped') return 'Stopped'
  return thread.state === 'needs_attention' ? 'Needs you' : 'In motion'
}

function projectThreads(projectId: string): AgentConversationThread[] {
  return sortAgentConversationThreads(
    filteredThreads.value.filter(
      (thread) => workMapPlacementByThread.value.get(thread.nativeThreadId)?.projectId === projectId
    )
  )
}

function projectTodos(projectId: string, status?: AgentWorkMapTodoStatus): AgentWorkMapTodo[] {
  const query = search.value.trim().toLowerCase()
  return (workMap.value?.todos ?? [])
    .filter((todo) => todo.projectId === projectId && (!status || todo.status === status))
    .filter(
      (todo) =>
        !query || [todo.title, todo.description ?? ''].join(' ').toLowerCase().includes(query)
    )
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
}

function workMapListKey(projectId: string, status: AgentWorkMapTodoStatus): string {
  return `${projectId}:${status}`
}

function workMapVisibleCount(projectId: string, status: AgentWorkMapTodoStatus): number {
  return (
    workMapVisibleCounts.value[workMapListKey(projectId, status)] ?? WORK_MAP_STATUS_INITIAL_COUNT
  )
}

function visibleProjectTodos(
  projectId: string,
  status: AgentWorkMapTodoStatus
): AgentWorkMapTodo[] {
  return projectTodos(projectId, status).slice(0, workMapVisibleCount(projectId, status))
}

function hasMoreProjectTodos(projectId: string, status: AgentWorkMapTodoStatus): boolean {
  return projectTodos(projectId, status).length > workMapVisibleCount(projectId, status)
}

function showMoreProjectTodos(projectId: string, status: AgentWorkMapTodoStatus) {
  const key = workMapListKey(projectId, status)
  workMapVisibleCounts.value = {
    ...workMapVisibleCounts.value,
    [key]: workMapVisibleCount(projectId, status) + WORK_MAP_STATUS_PAGE_SIZE
  }
}

function showMoreMiscThreads() {
  miscVisibleCount.value += WORK_MAP_MISC_PAGE_SIZE
}

function isWorkMapProjectOpen(projectId: string): boolean {
  if (search.value.trim()) return true
  return workMapOpenProjects.value[projectId] === true
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
  workMapOpenProjects.value = {
    ...workMapOpenProjects.value,
    [projectId]: !isWorkMapProjectOpen(projectId)
  }
}

function isWorkMapFinishedOpen(projectId: string): boolean {
  return workMapOpenFinished.value[projectId] === true
}

function toggleWorkMapFinished(projectId: string) {
  workMapOpenFinished.value = {
    ...workMapOpenFinished.value,
    [projectId]: !isWorkMapFinishedOpen(projectId)
  }
}

async function loadWorkMap() {
  try {
    const next = await getAgentWorkMap()
    workMap.value = next
    if (
      next.projects.length &&
      !Object.values(workMapOpenProjects.value).some((open) => open === true)
    ) {
      const firstRoot = next.projects.find((project) => !project.parentId) ?? next.projects[0]
      if (firstRoot) workMapOpenProjects.value = { [firstRoot.id]: true }
    }
  } catch {
    workMap.value = null
  }
}

function workMapRequestId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const values = crypto.getRandomValues(new Uint32Array(2))
  return `work-map-${String(Date.now())}-${String(values[0] ?? 0)}-${String(values[1] ?? 0)}`
}

async function applyWorkMapOperations(operations: AgentWorkMapOperation[]) {
  if (!operations.length || workMapBusy.value) return
  workMapBusy.value = true
  try {
    workMap.value = await applyAgentWorkMap({
      expectedRevision: workMap.value?.revision ?? 0,
      operations,
      requestId: workMapRequestId()
    })
  } catch (cause) {
    toast.error(cause instanceof Error ? cause.message : 'Work map update failed')
    await loadWorkMap()
  } finally {
    workMapBusy.value = false
  }
}

async function placeChatInWorkMap(threadId: string, projectId: string | null) {
  await applyWorkMapOperations([{ op: 'place_chat', project_id: projectId, thread_id: threadId }])
}

function addWorkMapProject(parentId?: string) {
  const parent = parentId
    ? workMap.value?.projects.find((project) => project.id === parentId)
    : undefined
  workMapCreateTitle.value = ''
  workMapCreateDraft.value = {
    kind: 'project',
    ...(parentId ? { parentId, parentName: parent?.name ?? 'project' } : {})
  }
  void nextTick(() => workMapCreateInput.value?.focus())
}

function addWorkMapTodo(project: AgentWorkMapProject) {
  workMapCreateTitle.value = ''
  workMapCreateDraft.value = {
    kind: 'todo',
    projectId: project.id,
    projectName: project.name
  }
  void nextTick(() => workMapCreateInput.value?.focus())
}

function closeWorkMapCreateDialog() {
  workMapCreateDraft.value = null
  workMapCreateTitle.value = ''
}

async function submitWorkMapCreate() {
  const draft = workMapCreateDraft.value
  const title = workMapCreateTitle.value.trim()
  if (!draft || !title) return
  closeWorkMapCreateDialog()
  if (draft.kind === 'project') {
    await applyWorkMapOperations([
      {
        name: title,
        op: 'create_project',
        ...(draft.parentId ? { parent_id: draft.parentId } : {})
      }
    ])
    return
  }
  workMapBusy.value = true
  try {
    const selection = conversationSelection(selectedModelScope.value)
    const result = await createAgentTodoChat({
      brief: { goal: title, suggestedNextStep: 'Clarify the outcome and shape the plan.' },
      effort: selection.effort,
      expectedRevision: workMap.value?.revision ?? 0,
      model: selection.model,
      projectId: draft.projectId,
      requestId: workMapRequestId(),
      title
    })
    workMap.value = result.workMap
    await refresh(true)
    const thread = history.value?.threads.find(
      (candidate) => candidate.nativeThreadId === result.threadId
    )
    if (thread) await selectThread(thread)
  } catch (cause) {
    toast.error(cause instanceof Error ? cause.message : 'Todo chat creation failed')
    await loadWorkMap()
  } finally {
    workMapBusy.value = false
  }
}

async function setWorkMapTodoStatus(todoId: string, status: AgentWorkMapTodoStatus) {
  await applyWorkMapOperations([{ op: 'update_todo', status, todo_id: todoId }])
}

async function openWorkMapTodo(todo: AgentWorkMapTodo) {
  if (!todo.threadId) {
    toast.info('This older todo has no chat yet.')
    return
  }
  let thread = history.value?.threads.find(
    (candidate) => candidate.nativeThreadId === todo.threadId
  )
  if (!thread) {
    await refresh(true)
    thread = history.value?.threads.find((candidate) => candidate.nativeThreadId === todo.threadId)
  }
  if (!thread) {
    toast.error('Todo chat unavailable')
    return
  }
  await selectThread(thread)
}

async function openTodoPlan(todo: AgentWorkMapTodo) {
  try {
    await openAgentTodoPlan(todo)
  } catch (cause) {
    toast.error(cause instanceof Error ? cause.message : 'Plan could not be opened')
  }
}

function beginWorkMapTodoDrag(event: DragEvent, todo: AgentWorkMapTodo) {
  draggedWorkMapTodoId.value = todo.id
  event.dataTransfer?.setData('application/x-openpencil-work-map-todo', todo.id)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}

function endWorkMapDrag() {
  draggedWorkMapThreadId.value = null
  pressedWorkMapThreadId.value = null
  draggedWorkMapTodoId.value = null
  workMapDropProjectId.value = undefined
  workMapDropTodoStatus.value = null
}

function showWorkMapProjectDrop(event: DragEvent, projectId: string | null) {
  if (!draggedWorkMapThreadId.value) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  workMapDropProjectId.value = projectId
}

async function dropWorkMapThread(event: DragEvent, projectId: string | null) {
  const threadId = draggedWorkMapThreadId.value
  if (!threadId) return
  event.preventDefault()
  event.stopPropagation()
  endWorkMapDrag()
  await placeChatInWorkMap(threadId, projectId)
}

function showWorkMapTodoDrop(event: DragEvent, projectId: string, status: AgentWorkMapTodoStatus) {
  const todoId = draggedWorkMapTodoId.value
  const todo = workMap.value?.todos.find((candidate) => candidate.id === todoId)
  if (!todo || todo.projectId !== projectId) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  workMapDropTodoStatus.value = `${projectId}:${status}`
}

async function dropWorkMapTodo(
  event: DragEvent,
  projectId: string,
  status: AgentWorkMapTodoStatus
) {
  const todoId = draggedWorkMapTodoId.value
  const todo = workMap.value?.todos.find((candidate) => candidate.id === todoId)
  if (!todo || todo.projectId !== projectId) return
  event.preventDefault()
  event.stopPropagation()
  endWorkMapDrag()
  await setWorkMapTodoStatus(todo.id, status)
}

function threadDragPayload(thread: AgentConversationThread): AgentConversationDragPayload {
  return {
    conversationId: thread.nativeThreadId,
    threadId: thread.id,
    title: agentConversationDisplayTitle(thread)
  }
}

function beginThreadDrag(event: DragEvent, thread: AgentConversationThread) {
  draggedWorkMapThreadId.value = thread.nativeThreadId
  writeAgentConversationDrag(event, threadDragPayload(thread))
}

function armThreadPointerDrag(event: PointerEvent, thread: AgentConversationThread) {
  pressedWorkMapThreadId.value = thread.id
  armAgentConversationPointerDrag(event, threadDragPayload(thread))
}

function releaseThreadPointerDrag() {
  pressedWorkMapThreadId.value = null
}

useEventListener(window, 'pointerup', releaseThreadPointerDrag)
useEventListener(window, 'pointercancel', releaseThreadPointerDrag)

function armNewThreadPointerDrag(event: PointerEvent) {
  armAgentConversationPointerDrag(event, newAgentConversationDragPayload())
}

function armSelectedThreadPointerDrag(event: PointerEvent) {
  if (selectedThread.value) {
    armThreadPointerDrag(event, selectedThread.value)
    return
  }
  if (creating.value) armNewThreadPointerDrag(event)
}

const renamingTitle = ref(false)
const renamingTitleDraft = ref('')
const titleRenameInput = ref<HTMLInputElement | null>(null)

function beginTitleRename() {
  if (!selectedThread.value) return
  renamingTitleDraft.value = agentConversationDisplayTitle(selectedThread.value)
  renamingTitle.value = true
  void nextTick(() => {
    titleRenameInput.value?.focus()
    titleRenameInput.value?.select()
  })
}

function commitTitleRename() {
  if (!renamingTitle.value) return
  const thread = selectedThread.value
  const next = renamingTitleDraft.value.trim()
  if (thread && next && next !== agentConversationDisplayTitle(thread)) {
    setAgentConversationTitle(thread, next)
    toast.info('Task renamed')
  }
  renamingTitle.value = false
}

function cancelTitleRename() {
  renamingTitle.value = false
}

function conversationViewport(): HTMLElement | null {
  return (
    panel.value?.querySelector<HTMLElement>('[data-test-id="ai-conversation-viewport"]') ?? null
  )
}

function retainTranscriptScroll() {
  const id = conversationThreadId.value
  const viewport = conversationViewport()
  if (id && viewport) transcriptScrollTop.set(id, viewport.scrollTop)
}

async function restoreTranscriptScroll(id: string) {
  const scrollTop = transcriptScrollTop.get(id)
  if (scrollTop === undefined) return
  await nextTick()
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve())
  })
  if (conversationThreadId.value !== id) return
  const viewport = conversationViewport()
  if (viewport) viewport.scrollTop = scrollTop
}

async function selectThread(thread: AgentConversationThread) {
  if (shouldSuppressAgentConversationClick()) return
  renamingTitle.value = false
  conversationSurfaceKey.value = thread.id
  selectedId.value = thread.id
  if (creating.value) {
    pendingNewChatProjectId.value = null
    abandonAgentChatsNewTask()
  }
  creating.value = false
  pendingThreadId.value = null
  setAgentConversationUnread(thread, false)
  view.value = 'conversation'
  await restoreTranscriptScroll(thread.id)
  await nextTick()
  panel.value
    ?.querySelector<HTMLTextAreaElement>('[data-test-id="ai-prompt-input"] textarea')
    ?.focus({ preventScroll: true })
}

function browserCaptureDragEnter(event: DragEvent, thread: AgentConversationThread) {
  if (!carriesAttachmentDrag(event.dataTransfer)) return
  event.preventDefault()
  event.stopPropagation()
  captureDropTargetId.value = thread.id
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
}

function browserCaptureDragLeave(event: DragEvent, thread: AgentConversationThread) {
  if (captureDropTargetId.value !== thread.id) return
  const current = event.currentTarget
  const related = event.relatedTarget
  if (current instanceof HTMLElement && related instanceof Node && current.contains(related)) return
  captureDropTargetId.value = null
}

async function dropBrowserCaptureOnThread(event: DragEvent, thread: AgentConversationThread) {
  if (!carriesAttachmentDrag(event.dataTransfer)) return
  captureDropTargetId.value = null
  event.preventDefault()
  event.stopPropagation()
  const files = readAttachmentDrag(event.dataTransfer)
  if (!files.length) return
  await selectThread(thread)
  const result = appendDraftAttachments(attachments.value, files)
  attachments.value = result.attachments
}

const listDragDepth = ref(0)

function listDragEnter(event: DragEvent) {
  if (!carriesAttachmentDrag(event.dataTransfer)) return
  event.preventDefault()
  event.stopPropagation()
  listDragDepth.value += 1
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
}

function listDragLeave(event: DragEvent) {
  if (listDragDepth.value === 0) return
  const current = event.currentTarget
  const related = event.relatedTarget
  if (current instanceof HTMLElement && related instanceof Node && current.contains(related)) return
  listDragDepth.value = Math.max(0, listDragDepth.value - 1)
}

async function dropOnList(event: DragEvent) {
  if (!carriesAttachmentDrag(event.dataTransfer)) return
  listDragDepth.value = 0
  event.preventDefault()
  event.stopPropagation()
  const files = readAttachmentDrag(event.dataTransfer)
  if (!files.length) return
  await startNewConversation()
  const result = appendDraftAttachments(attachments.value, files)
  attachments.value = result.attachments
}

async function showThreadList() {
  renamingTitle.value = false
  retainTranscriptScroll()
  view.value = 'list'
  await loadWorkMap()
  await nextTick()
  panel.value
    ?.querySelector<HTMLElement>(`[data-agent-thread-id="${CSS.escape(selectedId.value ?? '')}"]`)
    ?.focus({ preventScroll: true })
}

function discardNewConversationDraft(id = draftId.value) {
  if (id) clearOptimisticConversation(id)
  clearOptimisticConversation('new-task')
  void clearAgentComposerDraft(NEW_AGENT_CHAT_COMPOSER_DRAFT_ID)
  if (!creating.value) return
  composerDraft.clear()
  lastFollowUp.value = ''
  lastAnnotations.value = []
  lastAttachments.value = []
  error.value = ''
  pendingNewChatProjectId.value = null
  abandonAgentChatsNewTask()
}

async function startNewConversation(projectId: string | null = null) {
  if (shouldSuppressAgentConversationClick()) return
  renamingTitle.value = false
  retainTranscriptScroll()
  if (view.value === 'conversation') discardNewConversationDraft()
  pendingNewChatProjectId.value = projectId
  if (!creating.value) conversationSurfaceKey.value = beginAgentChatsNewTask()
  else {
    conversationSurfaceKey.value = draftId.value ?? 'new-task'
    view.value = 'conversation'
  }
  search.value = ''
  await nextTick()
  const input = panel.value?.querySelector<HTMLTextAreaElement>(
    '[data-test-id="ai-prompt-input"] textarea'
  )
  input?.focus({ preventScroll: true })
}

function containWheel(event: WheelEvent) {
  event.stopPropagation()
  if (event.ctrlKey || event.metaKey) event.preventDefault()
}

function containScrollKey(event: KeyboardEvent) {
  event.stopPropagation()
}

const loadingOlder = ref(false)
let retainedTranscriptId: string | null = null
async function loadOlderSelectedTranscript() {
  const threadId = selectedId.value
  if (!threadId || loadingOlder.value) return
  loadingOlder.value = true
  try {
    await loadOlderAgentConversationTranscript(threadId)
  } finally {
    loadingOlder.value = false
  }
}
async function revealSelectedChapter(chapterId: string) {
  const threadId = selectedId.value
  if (!threadId) return
  loadingOlder.value = true
  try {
    await revealAgentConversationChapter(threadId, chapterId)
  } finally {
    loadingOlder.value = false
  }
}
function syncRetainedTranscript(threadId: string | null) {
  if (retainedTranscriptId === threadId) return
  if (retainedTranscriptId) releaseAgentConversationTranscript(retainedTranscriptId)
  retainedTranscriptId = threadId
  if (retainedTranscriptId) retainAgentConversationTranscript(retainedTranscriptId)
}
watch(
  selectedId,
  (threadId) => {
    syncRetainedTranscript(threadId)
  },
  { immediate: true }
)
onMounted(() => {
  void loadWorkMap()
})
onUnmounted(() => {
  syncRetainedTranscript(null)
})
watch(
  selectedThread,
  (thread) => {
    if (!thread) return
    seedConversationModel(selectedModelScope.value, thread.model, thread.effort)
  },
  { immediate: true }
)
function restorePersistedPanelLocation(threads: readonly AgentConversationThread[] | undefined) {
  if (!threads) return
  const selectedThreadStillExists = threads.some((thread) => thread.id === selectedId.value)
  if (selectedThreadStillExists) return
  selectedId.value = threads[0]?.id ?? null
  if (view.value === 'conversation' && !selectedId.value) view.value = 'list'
}

watch(
  history,
  (nextHistory) => {
    const nextStates = new Map<string, AgentConversationThread['state']>()
    for (const thread of nextHistory?.threads ?? []) {
      nextStates.set(thread.id, thread.state)
      const finishedInBackground =
        threadStatesInitialized &&
        shouldMarkFinishedConversationUnread({
          open: view.value === 'conversation' && selectedId.value === thread.id,
          previousState: knownThreadStates.get(thread.id),
          state: thread.state
        })
      if (finishedInBackground) setAgentConversationUnread(thread, true)
    }
    knownThreadStates.clear()
    for (const [threadId, state] of nextStates) knownThreadStates.set(threadId, state)
    threadStatesInitialized = true

    if (creating.value && pendingThreadId.value) {
      const pending = nextHistory?.threads.find((thread) => thread.id === pendingThreadId.value)
      if (pending) {
        const acceptedDraftId = acceptAgentChatsNewTask(pending.id)
        if (acceptedDraftId) moveOptimisticConversation(acceptedDraftId, pending.id)
        clearOptimisticConversation('new-task')
      }
      return
    }
    if (creating.value) return
    restorePersistedPanelLocation(nextHistory?.threads)
  },
  { immediate: true }
)

function supersedePendingMessageApprovals(thread: AgentConversationThread): string[] {
  const requestIds: string[] = []
  for (const request of thread.pendingUiRequests) {
    const preview = messageApprovalPreview(request)
    if (!preview) continue
    requestIds.push(request.id)
    setMessageApprovalFeedback({
      preview,
      requestId: request.id,
      requestedAt: request.requestedAt,
      state: 'cancelled',
      threadId: thread.id
    })
  }
  return requestIds
}

function claimNewConversationReceipt(draftId: string, threadId: string): boolean {
  return (
    creating.value &&
    isAgentChatsNewTaskDraftId(draftId) &&
    claimAgentChatsNewTaskReceipt(draftId, `agent:${threadId}`)
  )
}

async function submitFollowUp(
  submission: AgentPromptSubmission = {
    ...conversationSelection(selectedModelScope.value),
    annotations: annotations.value,
    attachments: []
  }
) {
  const thread = selectedThread.value
  const message = followUp.value.trim()
  if (
    (!creating.value && !thread?.nativeThreadId) ||
    (!message && !submission.annotations.length && !submission.attachments.length) ||
    submitting.value
  ) {
    return
  }
  error.value = ''
  submitting.value = true
  const submissionDraftId = conversationThreadId.value
  const captureResolution = await resolveBrowserCaptureAttachments(submission.attachments)
  const effectiveSubmission = {
    ...submission,
    attachments: captureResolution.attachments
  }
  const supersededRequestIds = thread ? supersedePendingMessageApprovals(thread) : []
  lastFollowUp.value = message
  lastAnnotations.value = submission.annotations.map((annotation) => ({ ...annotation }))
  lastAttachments.value = [...submission.attachments]
  composerDraft.clear()
  try {
    const receipt = await submitAgentConversation({
      ...(captureResolution.contextPrompt
        ? { contextPrompt: captureResolution.contextPrompt }
        : {}),
      nativeThreadId: thread?.nativeThreadId ?? null,
      onAccepted: ({ threadId }) => {
        if (!isAgentChatsNewTaskDraftId(submissionDraftId)) return
        claimAgentChatsNewTaskReceipt(submissionDraftId, `agent:${threadId}`)
        const projectId = pendingNewChatProjectId.value
        pendingNewChatProjectId.value = null
        if (projectId) void placeChatInWorkMap(threadId, projectId)
      },
      prompt: message,
      refresh,
      selection: effectiveSubmission,
      steer: steeringSelectedThread.value,
      threadId: submissionDraftId
    })
    if (claimNewConversationReceipt(submissionDraftId, receipt.threadId)) await refresh(true)
  } catch (cause) {
    for (const requestId of supersededRequestIds) {
      removeMessageApprovalFeedback(thread?.id ?? '', requestId)
    }
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    submitting.value = false
  }
}

async function retryFollowUp() {
  if (!lastFollowUp.value && !lastAnnotations.value.length && !lastAttachments.value.length) return
  followUp.value = lastFollowUp.value
  annotations.value = lastAnnotations.value.map((annotation) => ({ ...annotation }))
  attachments.value = [...lastAttachments.value]
  error.value = ''
  await submitFollowUp({
    ...conversationSelection(selectedModelScope.value),
    annotations: annotations.value,
    attachments: attachments.value
  })
}

async function stopConversation() {
  const thread = selectedThread.value
  if (!thread || !canStopSelected.value) return
  try {
    await stopAgentConversation(thread.nativeThreadId, thread.id)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  }
}

async function respondToApproval(requestId: string, response: AgentExtensionUiResponse) {
  const thread = selectedThread.value
  if (!thread || respondingUiRequests.value.includes(requestId)) return
  const request = thread.pendingUiRequests.find((candidate) => candidate.id === requestId)
  const preview = request ? messageApprovalPreview(request) : null
  if (preview) {
    const approved = response.confirmed === true || /^allow once$/i.test(response.value ?? '')
    setMessageApprovalFeedback({
      preview,
      requestId,
      requestedAt: request?.requestedAt ?? new Date().toISOString(),
      state: approved ? 'sending' : 'cancelled',
      threadId: thread.id
    })
  }
  error.value = ''
  respondingUiRequests.value = [...respondingUiRequests.value, requestId]
  try {
    await respondToAgentUiRequest(thread.nativeThreadId, requestId, response)
    await refresh(true)
  } catch (cause) {
    if (preview) removeMessageApprovalFeedback(thread.id, requestId)
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    respondingUiRequests.value = respondingUiRequests.value.filter((id) => id !== requestId)
  }
}

useEventListener(window, 'openpencil:context-comment-dispatched', async (event: Event) => {
  const detail = (event as CustomEvent<{ targetThreadId?: string }>).detail
  if (!detail?.targetThreadId) return
  await refresh(true)
  const id = `agent:${detail.targetThreadId}`
  if (history.value?.threads.some((thread) => thread.id === id)) {
    selectedId.value = id
    view.value = 'conversation'
  }
})
</script>

<template>
  <section
    ref="panel"
    data-test-id="agent-chats-panel"
    class="flex min-h-0 flex-1 flex-col overflow-clip overscroll-contain select-text"
    @keydown="containScrollKey"
    @touchstart.stop
    @touchmove.stop
    @wheel="containWheel"
  >
    <div class="flex min-h-0 flex-1 flex-col overflow-clip" data-test-id="agent-chat-stage">
      <div
        v-show="view === 'list'"
        data-test-id="agent-thread-selector"
        :aria-hidden="view !== 'list'"
        class="relative flex min-h-0 flex-1 flex-col overflow-clip"
        :class="listDragDepth > 0 ? 'ring-2 ring-inset ring-accent/60' : ''"
        @dragenter="listDragEnter"
        @dragover="listDragEnter"
        @dragleave="listDragLeave"
        @drop="dropOnList"
      >
        <div class="shrink-0 px-4 pt-2.5 pb-2">
          <div class="flex h-8 items-center gap-1">
            <div class="relative h-8 min-w-0 flex-1 overflow-hidden">
              <h2
                data-test-id="work-map-title"
                class="absolute inset-0 flex items-center truncate text-[17px] font-semibold tracking-[-0.015em] text-surface transition-[opacity,transform] duration-200 ease-out"
                :class="workMapSearchOpen ? 'pointer-events-none -translate-x-2 opacity-0' : ''"
              >
                Work map
              </h2>
              <label
                ref="workMapSearchField"
                data-test-id="work-map-search-field"
                :aria-hidden="!workMapSearchOpen"
                class="absolute inset-y-0 right-0 flex h-8 items-center overflow-hidden rounded-[8px] bg-hover/60 text-surface transition-[width,opacity,transform] duration-200 ease-out"
                :class="
                  workMapSearchOpen
                    ? 'w-full translate-x-0 px-2 opacity-100'
                    : 'pointer-events-none w-0 translate-x-2 px-0 opacity-0'
                "
              >
                <input
                  ref="workMapSearchInput"
                  v-model="search"
                  aria-label="Search work map"
                  type="text"
                  placeholder="Search work…"
                  :tabindex="workMapSearchOpen ? 0 : -1"
                  class="w-full min-w-0 border-0 bg-transparent text-[11px] text-surface outline-none placeholder:text-muted/75"
                  @keydown.esc.prevent.stop="closeWorkMapSearch"
                />
              </label>
            </div>
            <Tip
              v-if="archivedCount"
              :label="showArchived ? 'Show active chats' : 'Show archived chats'"
            >
              <button
                type="button"
                data-test-id="agent-thread-archive-toggle"
                :aria-label="showArchived ? 'Show active chats' : 'Show archived chats'"
                :aria-pressed="showArchived"
                class="flex size-7 shrink-0 items-center justify-center rounded-[7px] text-muted hover:bg-hover hover:text-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-component/30"
                :class="showArchived ? 'bg-chrome-detail text-surface' : ''"
                @click="showArchived = !showArchived"
              >
                <icon-lucide-archive-restore v-if="showArchived" class="size-3.5 stroke-[1.6]" />
                <icon-lucide-archive v-else class="size-3.5 stroke-[1.6]" />
              </button>
            </Tip>
            <Tip :label="workMapSearchOpen ? 'Close search' : 'Search work map'">
              <button
                ref="workMapSearchToggle"
                type="button"
                data-test-id="work-map-search-toggle"
                :aria-label="workMapSearchOpen ? 'Close search' : 'Search work map'"
                :aria-expanded="workMapSearchOpen"
                class="flex size-7 shrink-0 items-center justify-center text-muted hover:text-surface focus-visible:outline-none focus-visible:text-surface"
                :class="workMapSearchOpen ? 'text-surface' : ''"
                @click="toggleWorkMapSearch"
              >
                <IconlyIcon name="search" class="size-3.5 shrink-0 stroke-[1.6]" />
              </button>
            </Tip>
            <Tip label="New chat">
              <button
                type="button"
                data-test-id="agent-thread-new"
                aria-label="New chat"
                aria-description="Drag to place on the Board"
                class="flex size-7 shrink-0 cursor-grab items-center justify-center text-muted hover:text-surface active:cursor-grabbing focus-visible:outline-none focus-visible:text-surface"
                @pointerdown="armNewThreadPointerDrag"
                @click="startNewConversation()"
              >
                <icon-lucide-square-pen class="size-3.5 stroke-[1.6]" />
              </button>
            </Tip>
            <Tip label="New project">
              <button
                type="button"
                data-test-id="work-map-new-project"
                aria-label="New project"
                class="flex size-7 shrink-0 items-center justify-center text-muted hover:text-surface focus-visible:outline-none focus-visible:text-surface"
                @click="addWorkMapProject()"
              >
                <icon-lucide-folder-plus class="size-3.5 stroke-[1.6]" />
              </button>
            </Tip>
          </div>
        </div>
        <ScrollAreaRoot class="min-h-0 flex-1">
          <ScrollAreaViewport
            class="h-full touch-pan-y overscroll-y-contain [&>div]:min-h-full"
            data-test-id="agent-thread-list"
          >
            <nav aria-label="Work map" class="min-h-full px-3 pb-3">
              <div class="mb-1 flex h-9 items-center px-2 text-left">
                <span class="min-w-0 flex-1 truncate text-[12px] font-medium text-surface">
                  Pinned
                </span>
              </div>

              <div class="pb-1">
                <section
                  v-for="entry in workMapDisplayEntries"
                  :key="entry.project.id"
                  class="relative mb-0.5"
                  :class="entry.depth ? 'ml-3.5' : ''"
                >
                  <div
                    :data-test-id="
                      entry.misc ? 'work-map-misc-row' : `work-map-project-row-${entry.project.id}`
                    "
                    class="group/project relative flex h-9 cursor-pointer items-center rounded-[8px] px-1 transition-colors hover:bg-hover"
                    :class="
                      workMapDropProjectId === (entry.misc ? null : entry.project.id)
                        ? 'bg-accent/10 text-accent'
                        : ''
                    "
                    @dragover.stop="
                      showWorkMapProjectDrop($event, entry.misc ? null : entry.project.id)
                    "
                    @dragleave="workMapDropProjectId = undefined"
                    @drop="dropWorkMapThread($event, entry.misc ? null : entry.project.id)"
                    @click="toggleWorkMapProject(entry.project.id)"
                  >
                    <Tip v-if="!entry.misc" :label="`Open ${entry.project.name} layers`">
                      <button
                        type="button"
                        :data-test-id="`work-map-project-layers-${entry.project.id}`"
                        :aria-label="`Open ${entry.project.name} layers`"
                        class="flex size-7 shrink-0 items-center justify-center rounded-[7px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-component/25"
                        @click.stop="showProjectLayers(entry.project)"
                      >
                        <img
                          :src="
                            isWorkMapProjectOpen(entry.project.id)
                              ? workMapProjectOpenIcon
                              : workMapProjectClosedIcon
                          "
                          alt=""
                          aria-hidden="true"
                          class="size-5 shrink-0 object-contain"
                        />
                      </button>
                    </Tip>
                    <button
                      type="button"
                      class="flex min-w-0 items-center gap-1.5 text-left text-[12px] font-medium text-surface focus-visible:outline-none"
                      :aria-label="`${isWorkMapProjectOpen(entry.project.id) ? 'Collapse' : 'Expand'} ${entry.project.name}`"
                      :aria-expanded="isWorkMapProjectOpen(entry.project.id)"
                      @click.stop="toggleWorkMapProject(entry.project.id)"
                    >
                      <span class="truncate">{{ entry.project.name }}</span>
                      <IconlyIcon
                        name="arrow-down"
                        v-if="entry.misc && isWorkMapProjectOpen(entry.project.id)"
                        class="size-3 shrink-0 stroke-[1.8] text-muted"
                      />
                      <IconlyIcon
                        name="arrow-right"
                        v-else-if="entry.misc"
                        class="size-3 shrink-0 stroke-[1.8] text-muted opacity-0 transition-opacity group-hover/project:opacity-100 group-focus-within/project:opacity-100"
                      />
                    </button>
                    <span class="min-w-0 flex-1" />
                    <template v-if="!entry.misc">
                      <Tip label="New chat in project">
                        <button
                          type="button"
                          :data-test-id="`work-map-new-chat-${entry.project.id}`"
                          aria-label="New chat in project"
                          class="flex size-6 items-center justify-center text-muted opacity-0 hover:text-surface focus:opacity-100 focus-visible:outline-none focus-visible:text-surface group-hover/project:opacity-100"
                          @click.stop="startNewConversation(entry.project.id)"
                        >
                          <IconlyIcon name="plus" class="size-3.5 stroke-[1.7]" />
                        </button>
                      </Tip>
                      <Tip v-if="entry.depth === 0" label="Add subproject">
                        <button
                          type="button"
                          :data-test-id="`work-map-add-subproject-${entry.project.id}`"
                          aria-label="Add subproject"
                          class="flex size-6 items-center justify-center text-muted opacity-0 hover:text-surface focus:opacity-100 focus-visible:outline-none focus-visible:text-surface group-hover/project:opacity-100"
                          @click.stop="addWorkMapProject(entry.project.id)"
                        >
                          <icon-lucide-folder-plus class="size-3.5 stroke-[1.7]" />
                        </button>
                      </Tip>
                    </template>
                  </div>

                  <Transition
                    enter-active-class="grid overflow-hidden transition-[grid-template-rows,opacity,transform] duration-250 ease-out motion-reduce:transition-none"
                    enter-from-class="-translate-y-1 grid-rows-[0fr] opacity-0"
                    enter-to-class="grid-rows-[1fr] translate-y-0 opacity-100"
                    leave-active-class="grid overflow-hidden transition-[grid-template-rows,opacity,transform] duration-200 ease-in motion-reduce:transition-none"
                    leave-from-class="grid-rows-[1fr] translate-y-0 opacity-100"
                    leave-to-class="-translate-y-1 grid-rows-[0fr] opacity-0"
                  >
                    <div
                      v-if="isWorkMapProjectOpen(entry.project.id)"
                      :data-test-id="`work-map-project-content-${entry.project.id}`"
                      class="ml-2"
                    >
                      <div class="min-h-0 overflow-hidden pt-0.5 pb-1">
                        <AgentConversationContextMenu
                          v-for="thread in entry.misc ? visibleMiscThreads : []"
                          :key="thread.id"
                          :thread="thread"
                        >
                          <button
                            type="button"
                            draggable="true"
                            :data-agent-thread-id="thread.id"
                            :data-test-id="`agent-chat-thread-${thread.id}`"
                            :aria-current="selectedId === thread.id ? 'true' : undefined"
                            :aria-label="`${agentConversationDisplayTitle(thread)}; ${threadStateLabel(thread)}; drag to organize or place on board`"
                            class="relative flex min-h-8 w-full cursor-pointer items-center gap-2 overflow-hidden rounded-[7px] px-2 text-left hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-component/35"
                            :class="[
                              captureDropTargetId === thread.id ? 'bg-accent/10' : '',
                              pressedWorkMapThreadId === thread.id ||
                              draggedWorkMapThreadId === thread.nativeThreadId
                                ? '!cursor-grabbing'
                                : ''
                            ]"
                            @dragenter="browserCaptureDragEnter($event, thread)"
                            @dragleave="browserCaptureDragLeave($event, thread)"
                            @dragover="browserCaptureDragEnter($event, thread)"
                            @pointerdown="armThreadPointerDrag($event, thread)"
                            @dragstart="beginThreadDrag($event, thread)"
                            @dragend="endWorkMapDrag"
                            @drop="dropBrowserCaptureOnThread($event, thread)"
                            @click="selectThread(thread)"
                          >
                            <span
                              v-if="captureDropTargetId === thread.id"
                              aria-hidden="true"
                              class="bg-chrome-raised/95 absolute inset-0 z-10 flex items-center justify-center gap-1.5 text-[11px] font-medium text-accent backdrop-blur-sm"
                            >
                              <icon-lucide-link class="size-3 stroke-[1.8]" />
                              Drop to attach
                            </span>
                            <icon-lucide-pin
                              v-if="isAgentConversationPinned(thread)"
                              class="size-3 shrink-0 stroke-[1.6] text-muted"
                              aria-label="Pinned"
                            />
                            <span class="min-w-0 flex-1 truncate text-[11.5px] text-surface">
                              {{ agentConversationDisplayTitle(thread) }}
                            </span>
                            <AgentThreadStatusIndicator
                              v-if="threadStatus(thread)"
                              :status="threadStatus(thread)"
                            />
                            <span v-else class="shrink-0 text-[9px] text-muted/80">
                              {{ threadStateLabel(thread) }}
                            </span>
                          </button>
                        </AgentConversationContextMenu>
                        <button
                          v-if="entry.misc && visibleMiscThreads.length < miscThreads.length"
                          type="button"
                          data-test-id="work-map-show-more-misc"
                          :aria-label="`Show ${Math.min(WORK_MAP_MISC_PAGE_SIZE, miscThreads.length - visibleMiscThreads.length)} more chats`"
                          class="flex h-7 w-full items-center rounded-[7px] px-2 text-left text-[11px] text-muted/70 transition-colors hover:!text-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-component/35"
                          @click.stop="showMoreMiscThreads"
                        >
                          Show more
                        </button>

                        <template v-if="!entry.misc">
                          <section
                            v-for="status in workMapTodoStatuses"
                            :key="status"
                            class="relative mb-0.5 after:absolute after:top-[33px] after:-bottom-[1px] after:left-5 after:w-px after:bg-chrome-border/70 after:content-['']"
                            @dragover.stop="showWorkMapTodoDrop($event, entry.project.id, status)"
                            @dragleave="workMapDropTodoStatus = null"
                            @drop="dropWorkMapTodo($event, entry.project.id, status)"
                          >
                            <div
                              class="group/status flex h-8 items-center gap-2 rounded-[6px] px-2 text-[11.5px] font-medium text-surface"
                              :class="
                                workMapDropTodoStatus === `${entry.project.id}:${status}`
                                  ? 'bg-accent/10 text-accent'
                                  : ''
                              "
                            >
                              <span
                                class="relative z-10 flex h-8 w-6 shrink-0 items-center justify-center"
                              >
                                <IconlyIcon
                                  :name="workMapStatusIconNames[status]"
                                  class="size-[18px]"
                                  :class="workMapStatusIconClasses[status]"
                                />
                              </span>
                              <span>{{ workMapStatusLabels[status] }}</span>
                              <span class="min-w-0 flex-1" />
                              <Tip v-if="status === 'todo'" label="Add todo">
                                <button
                                  type="button"
                                  :data-test-id="`work-map-add-todo-${entry.project.id}`"
                                  aria-label="Add todo"
                                  class="flex size-6 items-center justify-center text-muted opacity-0 transition-opacity hover:text-surface focus:opacity-100 focus-visible:outline-none focus-visible:text-surface group-hover/status:opacity-100"
                                  @click.stop="addWorkMapTodo(entry.project)"
                                >
                                  <IconlyIcon name="plus" class="size-3.5 stroke-[1.7]" />
                                </button>
                              </Tip>
                            </div>
                            <div
                              v-for="todo in visibleProjectTodos(entry.project.id, status)"
                              :key="todo.id"
                              draggable="true"
                              :data-test-id="`work-map-todo-${todo.id}`"
                              class="relative z-10 ml-8 flex min-h-8 cursor-grab items-center rounded-[7px] pr-2 pl-2 text-left text-[11px] text-surface hover:bg-hover active:cursor-grabbing"
                              :title="todo.description || 'Open todo chat or drag to change status'"
                              @dragstart="beginWorkMapTodoDrag($event, todo)"
                              @dragend="endWorkMapDrag"
                              @click="openWorkMapTodo(todo)"
                              @keydown.enter.prevent="openWorkMapTodo(todo)"
                              role="button"
                              tabindex="0"
                            >
                              <span class="min-w-0 flex-1 truncate">{{ todo.title }}</span>
                              <button
                                v-if="todo.planObjectId"
                                type="button"
                                aria-label="Open plan"
                                class="flex size-5 shrink-0 items-center justify-center rounded-[5px] text-muted hover:bg-chrome-control hover:text-surface"
                                @click.stop="openTodoPlan(todo)"
                              >
                                <icon-lucide-arrow-up-right class="size-3 stroke-[1.7]" />
                              </button>
                            </div>
                            <button
                              v-if="hasMoreProjectTodos(entry.project.id, status)"
                              type="button"
                              :data-test-id="`work-map-show-more-${entry.project.id}-${status}`"
                              :aria-label="`Show ${Math.min(WORK_MAP_STATUS_PAGE_SIZE, projectTodos(entry.project.id, status).length - workMapVisibleCount(entry.project.id, status))} more ${workMapStatusLabels[status].toLowerCase()} tasks`"
                              class="relative z-10 ml-8 flex h-7 items-center rounded-[7px] px-2 text-left text-[10.5px] text-muted/70 transition-colors hover:!text-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-component/35"
                              @click.stop="showMoreProjectTodos(entry.project.id, status)"
                            >
                              Show more
                            </button>
                            <div
                              v-if="!projectTodos(entry.project.id, status).length"
                              :data-test-id="`work-map-empty-${entry.project.id}-${status}`"
                              class="relative z-10 flex h-7 items-center pr-2 pl-10 text-[10.5px] text-muted/55"
                            >
                              No tasks
                            </div>
                          </section>

                          <section
                            class="mt-0.5"
                            @dragover.stop="
                              showWorkMapTodoDrop($event, entry.project.id, 'finished')
                            "
                            @dragleave="workMapDropTodoStatus = null"
                            @drop="dropWorkMapTodo($event, entry.project.id, 'finished')"
                          >
                            <button
                              type="button"
                              class="group/finished flex h-8 w-full items-center gap-2 rounded-[7px] px-2 text-[11.5px] font-medium text-surface hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-component/35"
                              :class="
                                workMapDropTodoStatus === `${entry.project.id}:finished`
                                  ? 'bg-accent/10 text-accent'
                                  : ''
                              "
                              :aria-expanded="isWorkMapFinishedOpen(entry.project.id)"
                              title="Finished tasks are complete. Drag a task here when it is done."
                              @click="toggleWorkMapFinished(entry.project.id)"
                            >
                              <span
                                class="relative z-10 flex h-8 w-6 shrink-0 items-center justify-center"
                              >
                                <IconlyIcon
                                  :name="workMapStatusIconNames.finished"
                                  class="size-[18px]"
                                  :class="workMapStatusIconClasses.finished"
                                />
                              </span>
                              <span class="text-left">{{ workMapStatusLabels.finished }}</span>
                              <IconlyIcon
                                name="arrow-down"
                                v-if="isWorkMapFinishedOpen(entry.project.id)"
                                class="size-3 stroke-[1.7]"
                              />
                              <IconlyIcon
                                name="arrow-right"
                                v-else
                                class="size-3 stroke-[1.7] opacity-0 transition-opacity group-hover/finished:opacity-100 group-focus-within/finished:opacity-100"
                              />
                              <span class="min-w-0 flex-1" />
                            </button>
                            <div
                              v-for="todo in isWorkMapFinishedOpen(entry.project.id)
                                ? visibleProjectTodos(entry.project.id, 'finished')
                                : []"
                              :key="todo.id"
                              draggable="true"
                              :data-test-id="`work-map-todo-${todo.id}`"
                              class="flex min-h-8 w-full cursor-grab items-center rounded-[7px] pr-2 pl-10 text-left text-[10.5px] text-muted hover:bg-hover active:cursor-grabbing"
                              @dragstart="beginWorkMapTodoDrag($event, todo)"
                              @dragend="endWorkMapDrag"
                              @click="openWorkMapTodo(todo)"
                              @keydown.enter.prevent="openWorkMapTodo(todo)"
                              role="button"
                              tabindex="0"
                            >
                              <span class="min-w-0 flex-1 truncate">{{ todo.title }}</span>
                              <button
                                v-if="todo.planObjectId"
                                type="button"
                                aria-label="Open plan"
                                class="flex size-5 shrink-0 items-center justify-center rounded-[5px] text-muted hover:bg-chrome-control hover:text-surface"
                                @click.stop="openTodoPlan(todo)"
                              >
                                <icon-lucide-arrow-up-right class="size-3 stroke-[1.7]" />
                              </button>
                            </div>
                            <button
                              v-if="
                                isWorkMapFinishedOpen(entry.project.id) &&
                                hasMoreProjectTodos(entry.project.id, 'finished')
                              "
                              type="button"
                              :data-test-id="`work-map-show-more-${entry.project.id}-finished`"
                              :aria-label="`Show ${Math.min(WORK_MAP_STATUS_PAGE_SIZE, projectTodos(entry.project.id, 'finished').length - workMapVisibleCount(entry.project.id, 'finished'))} more finished tasks`"
                              class="flex h-7 w-full items-center rounded-[7px] pr-2 pl-10 text-left text-[10.5px] text-muted/70 transition-colors hover:!text-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-component/35"
                              @click.stop="showMoreProjectTodos(entry.project.id, 'finished')"
                            >
                              Show more
                            </button>
                          </section>
                        </template>
                      </div>
                    </div>
                  </Transition>
                </section>
              </div>

              <div
                v-if="
                  search.trim() && !filteredThreads.length && !visibleWorkMapProjectEntries.length
                "
                class="px-2 py-8 text-center text-[11px] leading-4 text-muted"
              >
                No matching work
              </div>
            </nav>
          </ScrollAreaViewport>
          <AppScrollAreaScrollbar />
        </ScrollAreaRoot>
      </div>

      <div
        v-show="view === 'conversation'"
        :aria-hidden="view !== 'conversation'"
        class="flex min-h-0 flex-1 flex-col"
        data-test-id="agent-selected-conversation"
      >
        <template v-if="selectedThread || creating">
          <AiConversationSurface
            :key="conversationSurfaceKey"
            v-model="followUp"
            v-model:annotations="annotations"
            v-model:attachments="attachments"
            :approval-visible="hasApprovalSurface"
            :can-retry="
              Boolean(error && (lastFollowUp || lastAnnotations.length || lastAttachments.length))
            "
            :can-stop="canStopSelected"
            :composer-banners="selectedComposerBanners"
            :context-usage="selectedThread?.contextUsage"
            :disabled="!creating && !selectedThread?.nativeThreadId"
            :empty-description="creating ? 'Describe what you want done.' : undefined"
            :empty-title="creating ? 'What do you want to work on?' : 'Conversation ready'"
            :has-older="selectedThread?.hasOlder === true"
            :input-label="creating ? 'New chat' : selectedTodoDraft ? 'Start todo' : 'Follow up'"
            :loading-older="loadingOlder"
            :messages="visibleMessages"
            :placeholder="composerPlaceholder"
            :send-label="steeringSelectedThread ? 'Steer task' : 'Send message'"
            :scope="selectedModelScope"
            :status="hasApprovalSurface ? 'ready' : uiStatus"
            :status-message="selectedStatusMessage"
            :turns="selectedThread?.turns"
            :working-label="selectedThread?.recentUpdate || ''"
            @load-older="loadOlderSelectedTranscript"
            @open-diff="openTurnDiff"
            @open-diff-annotation="openDiffAnnotation"
            @reveal-chapter="revealSelectedChapter"
            @retry="retryFollowUp"
            @send="submitFollowUp"
            @stop="stopConversation"
          >
            <template #header>
              <AgentConversationContextMenu :thread="selectedThread">
                <div
                  class="flex h-10 shrink-0 items-center gap-1.5 px-2"
                  data-test-id="agent-selected-header"
                >
                  <Tip label="Back to work map">
                    <button
                      type="button"
                      data-test-id="agent-thread-back"
                      aria-label="Back to work map"
                      class="flex size-7 shrink-0 items-center justify-center rounded-[7px] text-muted hover:bg-hover hover:text-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-component/30"
                      @click="showThreadList"
                    >
                      <icon-lucide-arrow-left class="size-3.5 stroke-[1.6]" />
                    </button>
                  </Tip>
                  <div
                    v-if="!renamingTitle"
                    data-test-id="agent-selected-header-title"
                    aria-description="Drag to place on the Board"
                    :aria-label="
                      creating
                        ? `${draftHeaderTitle}; drag to place on the Board`
                        : selectedThread
                          ? `${agentConversationDisplayTitle(selectedThread)}; drag to place on the Board`
                          : undefined
                    "
                    class="flex h-7 min-w-0 flex-1 cursor-grab items-center gap-1.5 rounded-[8px] px-2 transition-colors hover:bg-hover active:cursor-grabbing select-none"
                    @pointerdown="armSelectedThreadPointerDrag"
                    @dblclick="beginTitleRename"
                  >
                    <span class="min-w-0 flex-1 truncate text-[11px] font-medium text-surface">
                      {{
                        creating
                          ? draftHeaderTitle
                          : selectedThread
                            ? agentConversationDisplayTitle(selectedThread)
                            : 'Task'
                      }}
                    </span>
                    <AgentThreadStatusIndicator
                      v-if="selectedThread && threadStatus(selectedThread)"
                      :status="threadStatus(selectedThread)"
                    />
                  </div>
                  <form
                    v-else
                    class="flex h-7 min-w-0 flex-1 items-center"
                    @submit.prevent="commitTitleRename"
                  >
                    <input
                      ref="titleRenameInput"
                      v-model="renamingTitleDraft"
                      data-test-id="agent-selected-header-rename-input"
                      aria-label="Chat name"
                      class="border-chrome-control-border bg-chrome-control h-7 min-w-0 flex-1 rounded-[6px] border px-1.5 text-[11px] font-medium text-surface outline-none focus:border-component/35"
                      @blur="commitTitleRename"
                      @keydown.escape.prevent="cancelTitleRename"
                    />
                  </form>
                  <Tip label="Open diff">
                    <button
                      type="button"
                      data-test-id="agent-selected-diff"
                      aria-label="Open diff"
                      class="flex size-7 shrink-0 items-center justify-center rounded-[7px] text-muted hover:bg-hover hover:text-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-component/30"
                      @click="openLatestTurnDiff"
                    >
                      <icon-lucide-file-diff class="size-3.5 stroke-[1.6]" />
                    </button>
                  </Tip>
                  <Tip v-if="selectedWorkMapTodo?.planObjectId" label="Open plan">
                    <button
                      type="button"
                      data-test-id="agent-selected-plan"
                      aria-label="Open plan"
                      class="flex size-7 shrink-0 items-center justify-center rounded-[7px] text-muted hover:bg-hover hover:text-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-component/30"
                      @click="openTodoPlan(selectedWorkMapTodo)"
                    >
                      <icon-lucide-arrow-up-right class="size-3.5 stroke-[1.6]" />
                    </button>
                  </Tip>
                  <Tip label="New chat">
                    <button
                      type="button"
                      data-test-id="agent-selected-new"
                      aria-label="New chat"
                      aria-description="Drag to place on the Board"
                      class="flex size-7 shrink-0 cursor-grab items-center justify-center rounded-[7px] text-muted hover:bg-hover hover:text-surface active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-component/30"
                      @pointerdown="armNewThreadPointerDrag"
                      @click.stop="startNewConversation()"
                    >
                      <icon-lucide-square-pen class="size-3.5 stroke-[1.6]" />
                    </button>
                  </Tip>
                </div>
              </AgentConversationContextMenu>
            </template>
            <template #empty>
              <div
                v-if="selectedTodoDraft"
                class="agent-conversation-column my-auto py-10"
                data-test-id="agent-todo-brief"
              >
                <div class="border-chrome-border bg-chrome-raised/35 rounded-[14px] border p-5">
                  <div class="flex items-center gap-2">
                    <div
                      class="flex min-w-0 flex-1 items-center gap-2 text-[10px] font-medium tracking-[0.08em] text-muted uppercase"
                    >
                      <IconlyIcon name="time-circle" class="size-4 text-[#64748b]" />
                      Todo ready
                    </div>
                    <button
                      v-if="selectedWorkMapTodo?.planObjectId"
                      type="button"
                      class="border-chrome-border bg-chrome-control flex h-7 items-center gap-1.5 rounded-[8px] border px-2.5 text-[10.5px] font-medium text-surface hover:bg-hover"
                      @click="openTodoPlan(selectedWorkMapTodo)"
                    >
                      Open plan
                      <icon-lucide-arrow-up-right class="size-3 stroke-[1.7]" />
                    </button>
                  </div>
                  <h2 class="mt-3 text-[17px] leading-6 font-semibold text-surface">
                    {{ selectedTodoDraft.brief.goal }}
                  </h2>
                  <p
                    v-if="selectedTodoDraft.brief.context"
                    class="mt-2 text-[12px] leading-5 text-muted"
                  >
                    {{ selectedTodoDraft.brief.context }}
                  </p>
                  <p
                    v-if="selectedTodoDraft.brief.desiredOutcome"
                    class="mt-3 text-[12px] leading-5 text-surface"
                  >
                    <span class="text-muted">Outcome · </span>
                    {{ selectedTodoDraft.brief.desiredOutcome }}
                  </p>
                  <div
                    v-if="selectedTodoDraft.brief.knownFacts?.length"
                    class="border-chrome-border mt-4 border-t pt-4"
                  >
                    <div class="text-[10px] font-medium text-muted">What we already know</div>
                    <ul class="mt-2 space-y-1.5 text-[11.5px] leading-4.5 text-surface">
                      <li
                        v-for="fact in selectedTodoDraft.brief.knownFacts"
                        :key="fact"
                        class="flex gap-2"
                      >
                        <span class="text-muted">·</span><span>{{ fact }}</span>
                      </li>
                    </ul>
                  </div>
                  <div
                    v-if="selectedTodoDraft.brief.openQuestions?.length"
                    class="border-chrome-border mt-4 border-t pt-4"
                  >
                    <div class="text-[10px] font-medium text-muted">Worth deciding</div>
                    <ul class="mt-2 space-y-1.5 text-[11.5px] leading-4.5 text-surface">
                      <li
                        v-for="question in selectedTodoDraft.brief.openQuestions"
                        :key="question"
                        class="flex gap-2"
                      >
                        <span class="text-muted">·</span><span>{{ question }}</span>
                      </li>
                    </ul>
                  </div>
                  <div
                    v-if="selectedTodoDraft.brief.references?.length"
                    class="border-chrome-border mt-4 flex flex-wrap gap-2 border-t pt-4"
                  >
                    <span
                      v-for="reference in selectedTodoDraft.brief.references"
                      :key="`${reference.kind}:${reference.id}`"
                      class="border-chrome-border bg-chrome-control rounded-[7px] border px-2 py-1 text-[10.5px] text-muted"
                      :title="reference.note || reference.id"
                    >
                      {{ reference.label }}
                    </span>
                  </div>
                  <p class="mt-5 text-[11px] leading-4 text-muted">
                    {{
                      selectedTodoDraft.brief.suggestedNextStep ||
                      'Add your first thought below to start shaping the plan.'
                    }}
                  </p>
                </div>
              </div>
              <div v-else class="my-auto px-6 py-10 text-center">
                <h2 class="text-[16px] font-semibold text-surface">
                  {{ creating ? 'What do you want to work on?' : 'Conversation ready' }}
                </h2>
                <p v-if="creating" class="mt-2 text-[12px] text-muted">
                  Describe what you want done.
                </p>
              </div>
            </template>
            <template #approval="{ runId }">
              <div
                v-if="messageApprovalCardsForRun(runId).length"
                class="flex flex-col gap-2"
                data-test-id="agent-approval-column"
                :data-run-id="runId"
              >
                <AgentConversationApproval
                  v-for="card in messageApprovalCardsForRun(runId)"
                  :key="card.key"
                  :busy="Boolean(card.request && respondingUiRequests.includes(card.request.id))"
                  :preview="card.preview"
                  :request="card.request"
                  :state="card.state"
                  @respond="respondToApproval"
                />
              </div>
            </template>
          </AiConversationSurface>
        </template>
        <div v-else class="flex min-h-0 flex-1 items-center justify-center text-[13px] text-muted">
          No chats yet.
        </div>
      </div>
    </div>
  </section>
  <DialogRoot
    :open="Boolean(workMapCreateDraft)"
    @update:open="!$event && closeWorkMapCreateDialog()"
  >
    <DialogPortal>
      <DialogOverlay :class="workMapCreateDialog.overlay" />
      <DialogContent data-test-id="work-map-create-dialog" :class="workMapCreateDialog.content">
        <form class="p-4" @submit.prevent="submitWorkMapCreate">
          <DialogTitle :class="workMapCreateDialog.title">
            {{ workMapCreateDraft?.kind === 'todo' ? 'Add todo' : 'Add project' }}
          </DialogTitle>
          <DialogDescription :class="[workMapCreateDialog.description, 'mt-1']">
            <template v-if="workMapCreateDraft?.kind === 'todo'">
              Save later work in {{ workMapCreateDraft.projectName }}.
            </template>
            <template v-else-if="workMapCreateDraft?.parentId">
              Add one subproject inside {{ workMapCreateDraft.parentName }}.
            </template>
            <template v-else>Create a top-level Work Map project.</template>
          </DialogDescription>
          <input
            ref="workMapCreateInput"
            v-model="workMapCreateTitle"
            data-test-id="work-map-create-title"
            :aria-label="workMapCreateDraft?.kind === 'todo' ? 'Todo title' : 'Project name'"
            :placeholder="
              workMapCreateDraft?.kind === 'todo' ? 'What should happen later?' : 'Project name'
            "
            class="border-chrome-control-border bg-chrome-control mt-4 h-9 w-full rounded-[9px] border px-3 text-[12px] text-surface outline-none placeholder:text-muted/70 focus:border-accent/55 focus:ring-2 focus:ring-accent/15"
          />
          <div class="mt-4 flex justify-end gap-2">
            <button
              type="button"
              class="h-8 rounded-[8px] px-3 text-[11px] text-muted hover:bg-hover hover:text-surface"
              @click="closeWorkMapCreateDialog"
            >
              Cancel
            </button>
            <button
              type="submit"
              :disabled="!workMapCreateTitle.trim()"
              class="h-8 rounded-[8px] bg-accent px-3 text-[11px] font-medium text-white disabled:cursor-default disabled:opacity-40"
            >
              Add
            </button>
          </div>
        </form>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
  <AiRightPanelWorkspace
    :activation-nonce="agentRightPanelState.activationNonce"
    :changes="activeDiffChanges"
    :comments="activeDiffComments"
    :open="
      agentRightPanelState.open &&
      (agentRightPanelState.surface !== 'diff' || view === 'conversation')
    "
    :project-id="agentRightPanelState.projectId"
    :project-name="agentRightPanelState.projectName"
    :requested-surface="agentRightPanelState.surface"
    :selected-path="activeDiffState?.selectedPath"
    :thread-id="conversationThreadId"
    @add-comment="addDiffComment"
    @close="closeTurnDiff"
    @delete-comment="deleteDiffComment"
    @select-file="selectDiffFile"
    @surface-change="selectRightPanelSurface"
  />
</template>
