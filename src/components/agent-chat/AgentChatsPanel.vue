<script setup lang="ts">
import { useEventListener, useNow } from '@vueuse/core'
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'

import { stopAgentConversation, submitAgentConversation } from '@/app/agent-chat/actions'
import {
  messageApprovalPreview,
  messageToolPreview,
  type MessageApprovalPreview,
  type MessageApprovalState
} from '@/app/agent-chat/approval'
import { threadLiveWorkingLabel } from '@/app/agent-chat/board-conversation'
import {
  type AgentConversationThread,
  type AgentExtensionUiResponse,
  respondToAgentUiRequest
} from '@/app/agent-chat/client'
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
  agentChatsPanelCreating,
  agentChatsPanelPendingThreadId,
  agentChatsPanelSelectedId,
  agentChatsPanelView
} from '@/app/agent-chat/panel'
import {
  clearOptimisticConversation,
  mergeOptimisticMessages,
  optimisticConversation
} from '@/app/agent-chat/optimistic'
import { plainConversationPreview } from '@/app/agent-chat/presentation'
import {
  agentConversationDisplayTitle,
  agentConversationLastUserMessageAt,
  isAgentConversationArchived,
  isAgentConversationPinned,
  isAgentConversationUnread,
  setAgentConversationTitle,
  setAgentConversationUnread,
  sortAgentConversationThreads
} from '@/app/agent-chat/thread-preferences'
import { toast } from '@/app/shell/ui'
import {
  browserCaptureAttachmentFromDrag,
  browserCaptureAttachmentKey,
  isBrowserCaptureAttachment,
  resolveBrowserCaptureAttachments
} from '@/app/browser-inspector/attachment'
import { hasBrowserCaptureDrag, readBrowserCaptureDrag } from '@/app/browser-inspector/drag'
import {
  armAgentConversationPointerDrag,
  newAgentConversationDragPayload,
  shouldSuppressAgentConversationClick,
  writeAgentConversationDrag,
  writeNewAgentConversationDrag,
  type AgentConversationDragPayload
} from '@/app/agent-terminal/drag'
import { AiConversationSurface, conversationStatus } from '@/components/ai-elements'
import AgentConversationApproval from '@/components/agent-chat/AgentConversationApproval.vue'
import AgentConversationContextMenu from '@/components/agent-chat/AgentConversationContextMenu.vue'
import Tip from '@/components/ui/Tip.vue'

const { error: historyError, history, refresh } = useAgentConversationHistory()
const now = useNow({ interval: 1_000 })
const search = ref('')
const selectedId = agentChatsPanelSelectedId
const creating = agentChatsPanelCreating
const pendingThreadId = agentChatsPanelPendingThreadId
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
const browserCaptureDrafts = new Map<string, File[]>()
const newConversationEpoch = ref(0)

const selectedThread = computed(
  () => history.value?.threads.find((thread) => thread.id === selectedId.value) ?? null
)
const steeringSelectedThread = computed(() => selectedThread.value?.state === 'running')
const composerPlaceholder = computed(() => {
  if (steeringSelectedThread.value) return 'Add instructions…'
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
const listedThreads = computed(() => sortAgentConversationThreads(filteredThreads.value))
const conversationThreadId = computed(
  () => selectedThread.value?.id ?? (creating.value ? 'new-task' : '')
)
const optimistic = computed(() => optimisticConversation(conversationThreadId.value))
const optimisticSending = computed(
  () =>
    optimistic.value?.state === 'submitted' ||
    (optimistic.value?.state === 'thinking' && selectedThread.value?.state !== 'running')
)
const uiStatus = computed(() =>
  conversationStatus({
    error: optimistic.value?.error || error.value,
    sending: optimisticSending.value,
    state:
      selectedThread.value?.state === 'running'
        ? 'running'
        : optimistic.value?.state === 'completed'
          ? 'completed'
          : selectedThread.value?.state
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
function feedbackState(
  feedback: MessageApprovalFeedback
): Exclude<MessageApprovalState, 'pending'> {
  if (feedback.state !== 'sending') return feedback.state
  for (const message of [...(selectedThread.value?.messages ?? [])].reverse()) {
    for (const part of [...(message.parts ?? [])].reverse()) {
      if (part.type !== 'tool') continue
      const preview = messageToolPreview(part)
      if (
        !preview ||
        preview.recipient !== feedback.preview.recipient ||
        preview.texts.length !== feedback.preview.texts.length ||
        preview.texts.some((text, index) => text !== feedback.preview.texts[index])
      ) {
        continue
      }
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
  const feedback = messageApprovalFeedback.value.filter((item) => item.threadId === thread.id)
  const cards: MessageApprovalCard[] = feedback.map((item) => ({
    key: `feedback:${item.requestId}`,
    preview: item.preview,
    runId: approvalRunId(item.requestedAt),
    state: feedbackState(item)
  }))
  const feedbackIds = new Set(feedback.map((item) => item.requestId))
  for (const request of thread.pendingUiRequests) {
    if (feedbackIds.has(request.id)) continue
    const preview = messageApprovalPreview(request)
    if (!preview) continue
    const superseded = hasNewerUserMessage(request.requestedAt)
    cards.push({
      key: `request:${request.id}`,
      preview,
      ...(superseded ? {} : { request }),
      runId: approvalRunId(request.requestedAt),
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

function isThreadWorking(thread: AgentConversationThread): boolean {
  return thread.state === 'running'
}

function showThreadPreview(thread: AgentConversationThread): boolean {
  return thread.state === 'needs_attention' || thread.state === 'running'
}

function threadPreview(thread: AgentConversationThread): string {
  const preview = threadLiveWorkingLabel(thread, now.value.getTime()).trim()
  return plainConversationPreview(preview) || 'No response yet'
}

function threadDragPayload(thread: AgentConversationThread): AgentConversationDragPayload {
  return {
    conversationId: thread.nativeThreadId,
    threadId: thread.id,
    title: agentConversationDisplayTitle(thread)
  }
}

function beginThreadDrag(event: DragEvent, thread: AgentConversationThread) {
  writeAgentConversationDrag(event, threadDragPayload(thread))
}

function beginNewThreadDrag(event: DragEvent) {
  writeNewAgentConversationDrag(event)
}

function beginSelectedThreadDrag(event: DragEvent) {
  if (selectedThread.value) {
    beginThreadDrag(event, selectedThread.value)
    return
  }
  if (creating.value) {
    beginNewThreadDrag(event)
  }
}

function armThreadPointerDrag(event: PointerEvent, thread: AgentConversationThread) {
  armAgentConversationPointerDrag(event, threadDragPayload(thread))
}

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
  if (selectedId.value !== thread.id) {
    const previousDraftId = conversationThreadId.value
    if (previousDraftId) {
      browserCaptureDrafts.set(
        previousDraftId,
        attachments.value.filter(isBrowserCaptureAttachment)
      )
    }
    annotations.value = []
    attachments.value = [...(browserCaptureDrafts.get(thread.id) ?? [])]
  }
  creating.value = false
  pendingThreadId.value = null
  setAgentConversationUnread(thread, false)
  selectedId.value = thread.id
  view.value = 'conversation'
  await restoreTranscriptScroll(thread.id)
  await nextTick()
  panel.value
    ?.querySelector<HTMLTextAreaElement>('[data-test-id="ai-prompt-input"] textarea')
    ?.focus({ preventScroll: true })
}

function browserCaptureDragEnter(event: DragEvent, thread: AgentConversationThread) {
  if (!hasBrowserCaptureDrag(event.dataTransfer)) return
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
  const payload = readBrowserCaptureDrag(event.dataTransfer)
  captureDropTargetId.value = null
  if (!payload) return
  event.preventDefault()
  event.stopPropagation()
  const attachment = browserCaptureAttachmentFromDrag(payload)
  if (!attachment) return
  await selectThread(thread)
  const key = browserCaptureAttachmentKey(attachment)
  attachments.value = [
    ...attachments.value.filter(
      (candidate) => !key || browserCaptureAttachmentKey(candidate) !== key
    ),
    attachment
  ].slice(-5)
  browserCaptureDrafts.set(thread.id, attachments.value.filter(isBrowserCaptureAttachment))
}

async function showThreadList() {
  renamingTitle.value = false
  retainTranscriptScroll()
  if (creating.value) {
    creating.value = false
    pendingThreadId.value = null
  }
  view.value = 'list'
  await nextTick()
  panel.value
    ?.querySelector<HTMLElement>(`[data-agent-thread-id="${CSS.escape(selectedId.value ?? '')}"]`)
    ?.focus({ preventScroll: true })
}

function resetNewConversationComposer() {
  clearOptimisticConversation('new-task')
  browserCaptureDrafts.delete('new-task')
  followUp.value = ''
  annotations.value = []
  attachments.value = []
  lastFollowUp.value = ''
  lastAnnotations.value = []
  lastAttachments.value = []
  error.value = ''
}

async function startNewConversation() {
  if (shouldSuppressAgentConversationClick()) return
  renamingTitle.value = false
  retainTranscriptScroll()
  const previousDraftId = conversationThreadId.value
  if (previousDraftId && previousDraftId !== 'new-task') {
    browserCaptureDrafts.set(previousDraftId, attachments.value.filter(isBrowserCaptureAttachment))
  }
  creating.value = true
  pendingThreadId.value = null
  selectedId.value = null
  view.value = 'conversation'
  newConversationEpoch.value += 1
  resetNewConversationComposer()
  search.value = ''
  await nextTick()
  const input = panel.value?.querySelector<HTMLTextAreaElement>(
    '[data-test-id="ai-prompt-input"] textarea'
  )
  input?.focus({ preventScroll: true })
}

function relativeTime(value: string): string {
  const seconds = Math.max(0, Math.floor((now.value.getTime() - Date.parse(value)) / 1_000))
  if (seconds < 60) return 'now'
  if (seconds < 3_600) return `${String(Math.floor(seconds / 60))}m`
  if (seconds < 86_400) return `${String(Math.floor(seconds / 3_600))}h`
  return `${String(Math.floor(seconds / 86_400))}d`
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
watch(
  history,
  (nextHistory) => {
    if (creating.value && pendingThreadId.value) {
      const pending = nextHistory?.threads.find((thread) => thread.id === pendingThreadId.value)
      if (pending) {
        clearOptimisticConversation('new-task')
        selectedId.value = pending.id
        pendingThreadId.value = null
        creating.value = false
      }
      return
    }
    if (creating.value) return
    if (view.value === 'conversation' && selectedId.value) return
    if (nextHistory && !selectedId.value) {
      selectedId.value = nextHistory.threads[0]?.id ?? null
    }
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
  const captureResolution = await resolveBrowserCaptureAttachments(submission.attachments)
  const effectiveSubmission = {
    ...submission,
    attachments: captureResolution.attachments
  }
  const supersededRequestIds = thread ? supersedePendingMessageApprovals(thread) : []
  lastFollowUp.value = message
  lastAnnotations.value = submission.annotations.map((annotation) => ({ ...annotation }))
  lastAttachments.value = [...submission.attachments]
  followUp.value = ''
  annotations.value = []
  attachments.value = []
  browserCaptureDrafts.delete(conversationThreadId.value)
  try {
    const receipt = await submitAgentConversation({
      ...(captureResolution.contextPrompt
        ? { contextPrompt: captureResolution.contextPrompt }
        : {}),
      nativeThreadId: thread?.nativeThreadId ?? null,
      prompt: message,
      refresh,
      selection: effectiveSubmission,
      steer: steeringSelectedThread.value,
      threadId: conversationThreadId.value
    })
    if (creating.value) {
      pendingThreadId.value = `agent:${receipt.threadId}`
      await refresh(true)
    }
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
        class="flex min-h-0 flex-1 flex-col overflow-clip"
      >
        <div class="flex shrink-0 items-center gap-1.5 px-2.5 pt-2.5 pb-2">
          <label
            class="border-chrome-control-border bg-chrome-control flex h-8 min-w-0 flex-1 items-center gap-2 rounded-[8px] border px-2 text-muted focus-within:border-component/35 focus-within:text-surface"
          >
            <icon-lucide-search class="size-3.5 shrink-0 stroke-[1.6]" />
            <input
              v-model="search"
              aria-label="Search tasks"
              type="search"
              placeholder="Search tasks…"
              class="min-w-0 flex-1 border-0 bg-transparent text-[11px] text-surface outline-none placeholder:text-muted/75"
            />
            <button
              v-if="search"
              type="button"
              aria-label="Clear task search"
              class="flex size-5 shrink-0 items-center justify-center rounded-[5px] text-muted hover:bg-hover hover:text-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-component/30"
              @click="search = ''"
            >
              <icon-lucide-x class="size-3 stroke-[1.6]" />
            </button>
          </label>
          <Tip
            v-if="archivedCount"
            :label="showArchived ? 'Show active tasks' : 'Show archived tasks'"
          >
            <button
              type="button"
              data-test-id="agent-thread-archive-toggle"
              :aria-label="showArchived ? 'Show active tasks' : 'Show archived tasks'"
              :aria-pressed="showArchived"
              class="flex size-8 shrink-0 items-center justify-center rounded-[8px] text-muted hover:bg-hover hover:text-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-component/30"
              :class="showArchived ? 'bg-chrome-detail text-surface' : ''"
              @click="showArchived = !showArchived"
            >
              <icon-lucide-archive-restore v-if="showArchived" class="size-3.5 stroke-[1.6]" />
              <icon-lucide-archive v-else class="size-3.5 stroke-[1.6]" />
            </button>
          </Tip>
          <Tip label="New task">
            <button
              type="button"
              data-test-id="agent-thread-new"
              aria-label="New task"
              aria-description="Drag to place on the Board"
              class="flex size-8 shrink-0 cursor-grab items-center justify-center rounded-[8px] text-muted hover:bg-hover hover:text-surface active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-component/30"
              @pointerdown="armNewThreadPointerDrag"
              @dragstart="beginNewThreadDrag"
              @click="startNewConversation"
            >
              <icon-lucide-square-pen class="size-3.5 stroke-[1.6]" />
            </button>
          </Tip>
        </div>
        <nav
          aria-label="Tasks"
          class="scrollbar-thin min-h-0 flex-1 touch-pan-y overflow-y-auto px-2.5 pb-2 overscroll-y-contain"
          data-test-id="agent-thread-list"
        >
          <AgentConversationContextMenu
            v-for="thread in listedThreads"
            :key="thread.id"
            :thread="thread"
          >
            <button
              type="button"
              :data-agent-thread-id="thread.id"
              :data-test-id="`agent-chat-thread-${thread.id}`"
              :aria-current="selectedId === thread.id ? 'true' : undefined"
              :aria-label="`${agentConversationDisplayTitle(thread)}; drag to place on board`"
              class="relative mb-0.5 flex w-full cursor-grab flex-col justify-center overflow-hidden rounded-[8px] border border-transparent px-2.5 text-left hover:bg-hover active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-component/35"
              :class="[
                showThreadPreview(thread) ? 'min-h-[48px] py-1.5' : 'h-10',
                captureDropTargetId === thread.id ? 'border-accent/60 bg-accent/10' : ''
              ]"
              @dragenter="browserCaptureDragEnter($event, thread)"
              @dragleave="browserCaptureDragLeave($event, thread)"
              @dragover="browserCaptureDragEnter($event, thread)"
              @pointerdown="armThreadPointerDrag($event, thread)"
              @dragstart="beginThreadDrag($event, thread)"
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
              <span class="flex min-w-0 items-center gap-2">
                <span
                  v-if="isAgentConversationUnread(thread)"
                  class="size-1.5 shrink-0 rounded-full bg-accent"
                  aria-label="Unread"
                />
                <icon-lucide-pin
                  v-if="isAgentConversationPinned(thread)"
                  class="size-3 shrink-0 stroke-[1.6] text-muted"
                  aria-label="Pinned"
                />
                <span class="min-w-0 flex-1 truncate text-[12px] font-medium text-surface">
                  {{ agentConversationDisplayTitle(thread) }}
                </span>
                <span class="shrink-0 text-[9.5px] tabular-nums text-muted/80">
                  {{ relativeTime(agentConversationLastUserMessageAt(thread)) }}
                </span>
              </span>
              <span
                v-if="showThreadPreview(thread)"
                class="mt-0.5 flex min-w-0 items-center gap-1.5 text-[10px] text-muted"
              >
                <span
                  v-if="isThreadWorking(thread)"
                  class="flex size-3 shrink-0 items-center justify-center"
                  aria-label="Working"
                  role="status"
                >
                  <icon-lucide-loader-circle
                    class="size-3 animate-spin text-accent"
                    aria-hidden="true"
                  />
                </span>
                <span class="truncate">{{ threadPreview(thread) }}</span>
              </span>
            </button>
          </AgentConversationContextMenu>
          <div
            v-if="!listedThreads.length"
            class="px-2 py-8 text-center text-[11px] leading-4 text-muted"
          >
            {{
              search.trim()
                ? 'No matching tasks'
                : showArchived
                  ? 'No archived tasks'
                  : historyError
                    ? 'Chats are unavailable'
                    : 'No tasks yet'
            }}
          </div>
        </nav>
      </div>

      <div
        v-show="view === 'conversation'"
        :aria-hidden="view !== 'conversation'"
        class="flex min-h-0 flex-1 flex-col"
        data-test-id="agent-selected-conversation"
      >
        <template v-if="selectedThread || creating">
          <AiConversationSurface
            :key="
              creating ? `new-task:${String(newConversationEpoch)}` : selectedId || 'conversation'
            "
            v-model="followUp"
            v-model:annotations="annotations"
            v-model:attachments="attachments"
            :approval-visible="hasApprovalSurface"
            :can-retry="
              Boolean(error && (lastFollowUp || lastAnnotations.length || lastAttachments.length))
            "
            :can-stop="canStopSelected"
            :context-usage="selectedThread?.contextUsage"
            :disabled="!creating && !selectedThread?.nativeThreadId"
            :empty-description="creating ? 'Describe what you want done.' : undefined"
            :empty-title="creating ? 'What do you want to work on?' : 'Conversation ready'"
            :has-older="selectedThread?.hasOlder === true"
            :input-label="creating ? 'New task' : 'Follow up'"
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
                  <Tip label="Back to tasks">
                    <button
                      type="button"
                      data-test-id="agent-thread-back"
                      aria-label="Back to tasks"
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
                        ? 'New task; drag to place on the Board'
                        : selectedThread
                          ? `${agentConversationDisplayTitle(selectedThread)}; drag to place on the Board`
                          : undefined
                    "
                    class="flex h-7 min-w-0 flex-1 cursor-grab items-center gap-1.5 rounded-[8px] px-2 transition-colors hover:bg-hover active:cursor-grabbing select-none"
                    @pointerdown="armSelectedThreadPointerDrag"
                    @dragstart="beginSelectedThreadDrag"
                    @dblclick="beginTitleRename"
                  >
                    <span class="min-w-0 flex-1 truncate text-[11px] font-medium text-surface">
                      {{
                        creating
                          ? 'New task'
                          : selectedThread
                            ? agentConversationDisplayTitle(selectedThread)
                            : 'Task'
                      }}
                    </span>
                    <span
                      v-if="selectedThread && isThreadWorking(selectedThread)"
                      class="flex size-3 shrink-0 items-center justify-center"
                      aria-label="Working"
                      role="status"
                    >
                      <icon-lucide-loader-circle
                        class="size-3 animate-spin text-accent"
                        aria-hidden="true"
                      />
                    </span>
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
                      aria-label="Task name"
                      class="border-chrome-control-border bg-chrome-control h-7 min-w-0 flex-1 rounded-[6px] border px-1.5 text-[11px] font-medium text-surface outline-none focus:border-component/35"
                      @blur="commitTitleRename"
                      @keydown.escape.prevent="cancelTitleRename"
                    />
                  </form>
                  <Tip v-if="!creating" label="New task">
                    <button
                      type="button"
                      data-test-id="agent-selected-new"
                      aria-label="New task"
                      aria-description="Drag to place on the Board"
                      class="flex size-7 shrink-0 cursor-grab items-center justify-center rounded-[7px] text-muted hover:bg-hover hover:text-surface active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-component/30"
                      @pointerdown="armNewThreadPointerDrag"
                      @dragstart.stop="beginNewThreadDrag"
                      @click.stop="startNewConversation"
                    >
                      <icon-lucide-square-pen class="size-3.5 stroke-[1.6]" />
                    </button>
                  </Tip>
                </div>
              </AgentConversationContextMenu>
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
          No tasks yet.
        </div>
      </div>
    </div>
  </section>
</template>
