<script setup lang="ts">
import { useEventListener } from '@vueuse/core'
import { computed, nextTick, ref } from 'vue'

import { useConversationApprovals } from '@/app/agent-chat/conversation-approvals'
import { useConversationScrollMemory } from '@/app/agent-chat/conversation-scroll-memory'
import { useConversationTitleRename } from '@/app/agent-chat/conversation-title-rename'
import { useConversationTranscriptLifecycle } from '@/app/agent-chat/conversation-transcript-lifecycle'
import {
  agentConversationMessageId,
  type AgentConversationThread
} from '@/app/agent-chat/conversations'
import { agentConversationScope } from '@/app/agent-chat/models'
import { useAgentConversationHistory } from '@/app/agent-chat/history-store'
import { useAgentPanelHistoryLifecycle } from '@/app/agent-chat/panel-history-lifecycle'
import { useAgentPanelConversationActions } from '@/app/agent-chat/panel-conversation-actions'
import { useAgentPanelConversationPresentation } from '@/app/agent-chat/panel-conversation-presentation'
import { useAgentPanelSyncLifecycle } from '@/app/agent-chat/panel-sync-lifecycle'
import {
  openAgentPanelTodoObject as openTodoObject,
  useAgentPanelObjectNavigation
} from '@/app/agent-chat/panel-object-navigation'
import {
  abandonAgentChatsNewTask,
  agentChatsPanelCreating,
  agentChatsPanelDraftId,
  agentChatsPanelPendingThreadId,
  agentChatsPanelSelectedId,
  agentChatsPanelView,
  beginAgentChatsNewTask
} from '@/app/agent-chat/panel'
import { agentRightPanelState } from '@/app/agent-chat/right-panel'
import { plainConversationPreview } from '@/app/agent-chat/presentation'
import { buildSpeechDictationContext } from '@/app/speech-dictation-context'
import {
  agentConversationDisplayTitle,
  setAgentConversationUnread
} from '@/app/agent-chat/thread-preferences'
import { useWorkMapNavigation } from '@/app/agent-chat/work-map-navigation'
import { useAgentWorkMapPersistence } from '@/app/agent-chat/work-map-persistence'
import {
  armAgentConversationPointerDrag,
  newAgentConversationDragPayload,
  shouldSuppressAgentConversationClick
} from '@/app/agent-terminal/drag'
import { AiConversationSurface } from '@/components/ai-elements'
import AiRightPanelWorkspace from '@/components/ai-elements/AiRightPanelWorkspace.vue'
import { useConversationDiffReview } from '@/components/ai-elements/useConversationDiffReview'
import type { T3ComposerBannerItem } from '@/components/ai-elements/T3ComposerBannerStack'
import AgentConversationApproval from '@/components/agent-chat/AgentConversationApproval.vue'
import AgentConversationContextMenu from '@/components/agent-chat/AgentConversationContextMenu.vue'
import AgentThreadStatusIndicator from '@/components/agent-chat/AgentThreadStatusIndicator.vue'
import AgentWorkMapSurface from '@/components/agent-chat/AgentWorkMapSurface.vue'
import Tip from '@/components/ui/Tip.vue'

const { error: historyError, history, refresh } = useAgentConversationHistory()
const { busy: workMapBusy, load: loadWorkMap, workMap } = useAgentWorkMapPersistence()
const selectedId = agentChatsPanelSelectedId
const { loadingOlder, loadOlderSelectedTranscript, revealSelectedChapter } =
  useConversationTranscriptLifecycle(selectedId)
const creating = agentChatsPanelCreating
const pendingThreadId = agentChatsPanelPendingThreadId
const draftId = agentChatsPanelDraftId
const panel = ref<HTMLElement | null>(null)
const view = agentChatsPanelView
const conversationSurfaceKey = ref('conversation')
const conversationSurface = ref<{ revealChapter: (chapterId: string) => void } | null>(null)

const { selectedThread } = useAgentPanelHistoryLifecycle({ history, loadWorkMap })
const {
  beginTitleRename,
  cancelTitleRename,
  commitTitleRename,
  renamingTitle,
  renamingTitleDraft,
  setTitleRenameInput
} = useConversationTitleRename(selectedThread)
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
const steeringSelectedThread = computed(() => selectedThread.value?.state === 'running')
const composerPlaceholder = computed(() => {
  if (steeringSelectedThread.value) return 'Add instructions…'
  if (selectedTodoDraft.value) return 'Add a thought to start shaping this…'
  if (configuringBot.value) return 'Message this Bot…'
  if (selectedWorkMapBot.value && selectedThread.value) {
    return `Message ${agentConversationDisplayTitle(selectedThread.value)}…`
  }
  return creating.value ? 'Describe a task…' : 'Follow up…'
})
const selectedModelScope = computed(() =>
  selectedThread.value
    ? agentConversationScope({ threadId: selectedThread.value.nativeThreadId })
    : agentConversationScope({ threadId: 'new' })
)
useAgentPanelSyncLifecycle({
  loadWorkMap,
  modelScope: selectedModelScope,
  selectedThread,
  view,
  workMapBusy
})
const { openInboxBriefing, refreshWorkMap, threadByNativeId } = useWorkMapNavigation({
  history,
  openTodoObject,
  refresh,
  selectThread
})
const rightPanelInboxItem = computed(() => {
  const inboxId = agentRightPanelState.value.inboxId
  if (!inboxId) return null
  return workMap.value?.inbox.find((item) => item.id === inboxId) ?? null
})
const rightPanelInboxBriefing = computed(() => rightPanelInboxItem.value?.briefing)
const rightPanelInboxTitle = computed(() => {
  const item = rightPanelInboxItem.value
  if (!item?.briefing) return undefined
  if (agentRightPanelState.value.objectTitle) return agentRightPanelState.value.objectTitle
  const thread = threadByNativeId.value.get(item.threadId)
  return thread ? `${agentConversationDisplayTitle(thread)} briefing` : item.briefing.title
})
const selectedInboxLinkedObjects = computed(() => {
  const thread = selectedThread.value
  if (!thread) return []
  const briefingName = `${agentConversationDisplayTitle(thread)} briefing`
  return (workMap.value?.inbox ?? []).flatMap((item) =>
    item.threadId === thread.nativeThreadId && item.messageId && item.briefing
      ? [
          {
            chapterId: agentConversationMessageId(thread.nativeThreadId, item.messageId),
            id: item.briefing.id,
            name: briefingName,
            verb: 'created' as const
          }
        ]
      : []
  )
})

async function openSelectedInboxBriefing(briefingId: string) {
  const item = workMap.value?.inbox.find((candidate) => candidate.briefing?.id === briefingId)
  if (!item) return
  await openInboxBriefing(item)
}
const selectedWorkMapBot = computed(() =>
  selectedThread.value
    ? (workMap.value?.bots.find((bot) => bot.threadId === selectedThread.value?.nativeThreadId) ??
      null)
    : null
)
const conversationThreadId = computed(
  () => selectedThread.value?.id ?? (creating.value ? (draftId.value ?? '') : '')
)
const {
  annotations,
  attachments,
  clearNewConversationDestination,
  configuringBot,
  discardNewConversationDraft,
  error,
  followUp,
  lastAnnotations,
  lastAttachments,
  lastFollowUp,
  respondingUiRequests,
  respondToApproval,
  retryFollowUp,
  setNewConversationDestination,
  stopConversation,
  submitFollowUp,
  submitting
} = useAgentPanelConversationActions({
  approvals: {
    beginResponse: (...args) => beginMessageApprovalResponse(...args),
    removeFeedback: (...args) => removeMessageApprovalFeedback(...args),
    supersedePending: (...args) => supersedePendingMessageApprovals(...args)
  },
  canStop: () => canStopSelected.value,
  conversationThreadId,
  modelScope: selectedModelScope,
  refresh,
  refreshWorkMap,
  selectedThread,
  steering: steeringSelectedThread
})
const botTextMode = computed(() => configuringBot.value || Boolean(selectedWorkMapBot.value))
const dictationContext = computed(() =>
  buildSpeechDictationContext({
    composerText: followUp.value,
    thread: selectedThread.value,
    workMap: workMap.value
  })
)
const {
  read: readTranscriptScroll,
  restore: restoreTranscriptScroll,
  retain: retainTranscriptScroll
} = useConversationScrollMemory({ identity: conversationThreadId, panel })
const initialTranscriptScrollTop = ref<number | undefined>()
const {
  openRightPanelTodoChat,
  openSelectedPlan,
  openSelectedTodoObject,
  refreshRightPanelTodo,
  rightPanelTodoDraft,
  rightPanelTodoThread,
  rightPanelWorkMapTodo,
  rightPanelWorkspaceId,
  selectRightPanelSurface
} = useAgentPanelObjectNavigation({
  conversationThreadId,
  refresh,
  selectedThread,
  selectedWorkMapTodo,
  selectThread,
  threadByNativeId,
  workMap
})
const { canStopSelected, draftHeaderTitle, optimistic, threadStatus, uiStatus, visibleMessages } =
  useAgentPanelConversationPresentation({
    conversationThreadId,
    error,
    selectedThread,
    submitting
  })
const {
  addComment: addDiffComment,
  changes: activeDiffChanges,
  close: closeTurnDiff,
  comments: activeDiffComments,
  deleteComment: deleteDiffComment,
  open: openTurnDiff,
  openAnnotation: openDiffAnnotation,
  reopen: reopenRightPanel,
  selectFile: selectDiffFile,
  state: activeDiffState
} = useConversationDiffReview({
  annotations,
  messages: visibleMessages,
  threadId: conversationThreadId,
  view
})

const {
  beginResponse: beginMessageApprovalResponse,
  cardsForRun: messageApprovalCardsForRun,
  hasSurface: hasApprovalSurface,
  remove: removeMessageApprovalFeedback,
  supersedePending: supersedePendingMessageApprovals
} = useConversationApprovals({ selectedThread, visibleMessages })
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

async function handleConversationBotChange() {
  await refreshWorkMap()
}

async function handleConversationArchivedChange() {
  await loadWorkMap()
}

function armNewThreadPointerDrag(event: PointerEvent) {
  armAgentConversationPointerDrag(event, newAgentConversationDragPayload())
}

function armSelectedThreadPointerDrag(event: PointerEvent) {
  if (selectedThread.value) {
    armAgentConversationPointerDrag(event, {
      conversationId: selectedThread.value.nativeThreadId,
      threadId: selectedThread.value.id,
      title: agentConversationDisplayTitle(selectedThread.value)
    })
    return
  }
  if (creating.value) armNewThreadPointerDrag(event)
}

async function selectThread(thread: AgentConversationThread) {
  if (shouldSuppressAgentConversationClick()) return
  renamingTitle.value = false
  initialTranscriptScrollTop.value = readTranscriptScroll(thread.id)
  conversationSurfaceKey.value = thread.id
  selectedId.value = thread.id
  if (creating.value) {
    clearNewConversationDestination()
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

async function openThreadChapter(thread: AgentConversationThread, nativeChapterId: string) {
  await selectThread(thread)
  await nextTick()
  conversationSurface.value?.revealChapter(
    agentConversationMessageId(thread.nativeThreadId, nativeChapterId)
  )
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

async function startNewConversation(projectId: string | null = null, botProjectId?: string | null) {
  if (shouldSuppressAgentConversationClick()) return
  renamingTitle.value = false
  retainTranscriptScroll()
  initialTranscriptScrollTop.value = undefined
  if (view.value === 'conversation') discardNewConversationDraft()
  setNewConversationDestination(projectId, botProjectId)
  if (!creating.value) conversationSurfaceKey.value = beginAgentChatsNewTask()
  else {
    conversationSurfaceKey.value = draftId.value ?? 'new-task'
    view.value = 'conversation'
  }
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
    @keydown.stop
    @touchstart.stop
    @touchmove.stop
    @wheel="containWheel"
  >
    <div class="flex min-h-0 flex-1 flex-col overflow-clip" data-test-id="agent-chat-stage">
      <AgentWorkMapSurface
        v-model:attachments="attachments"
        :model-scope="selectedModelScope"
        :open-thread-chapter="openThreadChapter"
        :select-thread="selectThread"
        :start-conversation="startNewConversation"
        :thread-status="threadStatus"
      />
      <div
        v-show="view === 'conversation'"
        :aria-hidden="view !== 'conversation'"
        class="flex min-h-0 flex-1 flex-col"
        data-test-id="agent-selected-conversation"
      >
        <template v-if="selectedThread || creating">
          <AiConversationSurface
            ref="conversationSurface"
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
            :dictation-context="dictationContext"
            :disabled="!creating && !selectedThread?.nativeThreadId"
            :has-older="selectedThread?.hasOlder === true"
            :loading-older="loadingOlder"
            :linked-objects="selectedInboxLinkedObjects"
            :messages="visibleMessages"
            :presentation="{
              emptyDescription: configuringBot
                ? 'Text it what it should own and how it should help.'
                : creating
                  ? 'Describe what you want done.'
                  : undefined,
              emptyTitle: configuringBot
                ? 'Set up this Bot'
                : creating
                  ? 'What do you want to work on?'
                  : 'Conversation ready',
              headerMode: 'inherit',
              initialAtBottom: !selectedTodoDraft,
              initialScrollTop: initialTranscriptScrollTop,
              inputLabel: creating ? 'New chat' : selectedTodoDraft ? 'Start todo' : 'Follow up',
              botAvatarId: selectedWorkMapBot?.id,
              botAvatarVariant: selectedWorkMapBot?.avatarVariant,
              botName: selectedThread ? agentConversationDisplayTitle(selectedThread) : 'Bot',
              messageMode: botTextMode ? 'bot-text' : 'task',
              placeholder: composerPlaceholder,
              sendLabel: steeringSelectedThread ? 'Steer task' : 'Send message',
              workingLabel: selectedThread?.recentUpdate || ''
            }"
            :scope="selectedModelScope"
            :status="hasApprovalSurface ? 'ready' : uiStatus"
            :status-message="selectedStatusMessage"
            :turns="selectedThread?.turns"
            @load-older="loadOlderSelectedTranscript"
            @open-diff="openTurnDiff"
            @open-diff-annotation="openDiffAnnotation"
            @open-linked-object="openSelectedInboxBriefing"
            @reveal-chapter="revealSelectedChapter"
            @retry="retryFollowUp"
            @send="submitFollowUp"
            @stop="stopConversation"
          >
            <template #header>
              <AgentConversationContextMenu
                :bot="Boolean(selectedWorkMapBot)"
                :thread="selectedThread"
                @archived-change="handleConversationArchivedChange"
                @bot-change="handleConversationBotChange"
              >
                <div
                  class="mt-2 flex h-10 shrink-0 items-center gap-1.5 px-2"
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
                      :ref="setTitleRenameInput"
                      v-model="renamingTitleDraft"
                      data-test-id="agent-selected-header-rename-input"
                      aria-label="Chat name"
                      class="border-chrome-control-border bg-chrome-control h-7 min-w-0 flex-1 rounded-[6px] border px-1.5 text-[11px] font-medium text-surface outline-none focus:border-component/35"
                      @blur="commitTitleRename"
                      @keydown.escape.prevent="cancelTitleRename"
                    />
                  </form>
                  <Tip v-if="selectedThread?.todoDraft" label="Open Todo">
                    <button
                      type="button"
                      data-test-id="agent-selected-todo-object"
                      aria-label="Open Todo"
                      class="flex size-7 shrink-0 items-center justify-center rounded-[7px] text-muted hover:bg-hover hover:text-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-component/30"
                      @click="openSelectedTodoObject"
                    >
                      <icon-lucide-panel-right-open class="size-3.5 stroke-[1.6]" />
                    </button>
                  </Tip>
                  <Tip v-if="selectedWorkMapTodo?.planObjectId" label="Open Plan">
                    <button
                      type="button"
                      data-test-id="agent-selected-plan-object"
                      aria-label="Open Plan"
                      class="flex size-7 shrink-0 items-center justify-center rounded-[7px] text-muted hover:bg-hover hover:text-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-component/30"
                      @click="openSelectedPlan"
                    >
                      <icon-lucide-file-text class="size-3.5 stroke-[1.6]" />
                    </button>
                  </Tip>
                  <Tip label="New chat">
                    <button
                      type="button"
                      data-test-id="agent-selected-new"
                      aria-label="New chat"
                      aria-description="Drag to place on the Board"
                      class="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-[7px] text-muted hover:bg-hover hover:text-surface active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-component/30"
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
                class="agent-conversation-column my-auto py-6"
                data-test-id="agent-todo-brief"
              >
                <button
                  type="button"
                  data-test-id="agent-todo-link"
                  :aria-label="`Open Todo: ${selectedTodoDraft.brief.goal}`"
                  class="border-chrome-border bg-chrome-raised/25 flex min-h-16 w-full items-center gap-3 rounded-[12px] border px-3.5 py-3 text-left outline-none transition-[background-color,border-color] hover:border-chrome-control-border hover:bg-hover/55 focus-visible:ring-2 focus-visible:ring-accent/25"
                  @click="openSelectedTodoObject"
                >
                  <IconlyIcon name="time-circle" class="size-4 shrink-0 text-muted" />
                  <span class="min-w-0 flex-1">
                    <span
                      class="block text-[9.5px] font-medium tracking-[0.09em] text-muted uppercase"
                    >
                      Todo
                    </span>
                    <span
                      class="mt-0.5 line-clamp-2 block text-[12px] leading-4.5 font-medium text-surface"
                    >
                      {{ selectedTodoDraft.brief.goal }}
                    </span>
                  </span>
                  <icon-lucide-chevron-right class="size-4 shrink-0 stroke-[1.6] text-muted" />
                </button>
              </div>
              <div v-else class="my-auto px-6 py-10 text-center">
                <h2 class="text-[16px] font-semibold text-surface">
                  {{
                    configuringBot
                      ? 'Set up this Bot'
                      : creating
                        ? 'What do you want to work on?'
                        : 'Conversation ready'
                  }}
                </h2>
                <p v-if="creating" class="mt-2 text-[12px] text-muted">
                  {{
                    configuringBot
                      ? 'Text it what it should own and how it should help.'
                      : 'Describe what you want done.'
                  }}
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
                  :message-mode="botTextMode ? 'bot-text' : 'task'"
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
  <AiRightPanelWorkspace
    :activation-nonce="agentRightPanelState.activationNonce"
    :changes="activeDiffChanges"
    :comments="activeDiffComments"
    :inbox-briefing="rightPanelInboxBriefing"
    :inbox-title="rightPanelInboxTitle"
    :open="agentRightPanelState.open"
    :object-id="agentRightPanelState.objectId"
    :project-id="agentRightPanelState.projectId"
    :project-name="agentRightPanelState.projectName"
    :requested-surface="agentRightPanelState.surface"
    :selected-path="activeDiffState?.selectedPath"
    :show-reopen="!agentRightPanelState.open"
    :thread-id="rightPanelWorkspaceId"
    :todo="rightPanelWorkMapTodo"
    :todo-draft="rightPanelTodoDraft"
    :todo-thread-id="rightPanelTodoThread?.nativeThreadId ?? ''"
    @add-comment="addDiffComment"
    @close="closeTurnDiff"
    @delete-comment="deleteDiffComment"
    @open="reopenRightPanel"
    @open-related-chat="openRightPanelTodoChat"
    @todo-saved="refreshRightPanelTodo"
    @select-file="selectDiffFile"
    @surface-change="selectRightPanelSurface"
  />
</template>
