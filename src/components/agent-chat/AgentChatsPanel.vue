<script setup lang="ts">
import { useEventListener, useNow } from '@vueuse/core'
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'

import { stopAgentConversation, submitAgentConversation } from '@/app/agent-chat/actions'
import { threadLiveWorkingLabel } from '@/app/agent-chat/board-conversation'
import { type AgentConversationState, type AgentConversationThread } from '@/app/agent-chat/client'
import {
  agentConversationScope,
  conversationSelection,
  seedConversationModel,
  type AgentPromptSubmission
} from '@/app/agent-chat/models'
import {
  releaseAgentConversationTranscript,
  retainAgentConversationTranscript,
  useAgentConversationHistory
} from '@/app/agent-chat/history-store'
import { mergeOptimisticMessages, optimisticConversation } from '@/app/agent-chat/optimistic'
import { agentConversationTitle, plainConversationPreview } from '@/app/agent-chat/presentation'
import {
  writeAgentConversationDrag,
  writeNewAgentConversationDrag
} from '@/app/agent-terminal/drag'
import { AiConversationSurface, conversationStatus } from '@/components/ai-elements'
import Tip from '@/components/ui/Tip.vue'

const { error: historyError, history, refresh } = useAgentConversationHistory()
const now = useNow({ interval: 1_000 })
const search = ref('')
const selectedId = ref<string | null>(null)
const creating = ref(false)
const pendingThreadId = ref<string | null>(null)
const followUp = ref('')
const submitting = ref(false)
const error = ref('')
const lastFollowUp = ref('')
const panel = ref<HTMLElement | null>(null)
const view = ref<'conversation' | 'list'>('list')
const transcriptScrollTop = new Map<string, number>()

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
  const threads = history.value?.threads ?? []
  if (!query) return threads
  return threads.filter((thread) =>
    [thread.task, thread.recentUpdate].join(' ').toLowerCase().includes(query)
  )
})
const listedThreads = computed(() =>
  [...filteredThreads.value].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
)
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
    state: optimistic.value?.state === 'completed' ? 'completed' : selectedThread.value?.state
  })
)
const selectedStatusMessage = computed(() => {
  const immediate = optimistic.value?.error || error.value || historyError.value
  if (immediate) return immediate
  if (selectedThread.value?.state !== 'needs_attention') return undefined
  return plainConversationPreview(selectedThread.value.recentUpdate, 140) || undefined
})
const canStopSelected = computed(
  () =>
    Boolean(selectedThread.value?.canFollowUp && selectedThread.value.state === 'running') ||
    Boolean(
      selectedThread.value &&
      optimistic.value &&
      ['submitted', 'thinking'].includes(optimistic.value.state)
    )
)
const visibleMessages = computed(() =>
  mergeOptimisticMessages(conversationThreadId.value, selectedThread.value?.messages ?? [])
)

function stateTone(state: AgentConversationState): string {
  if (state === 'needs_attention') return 'bg-red-400'
  if (state === 'running') return 'bg-accent'
  return 'bg-muted/60'
}

function showStateDot(state: AgentConversationState): boolean {
  return state === 'needs_attention' || state === 'running'
}

function showThreadPreview(thread: AgentConversationThread): boolean {
  return thread.state === 'needs_attention' || thread.state === 'running'
}

function threadPreview(thread: AgentConversationThread): string {
  const preview = threadLiveWorkingLabel(thread, now.value.getTime()).trim()
  return plainConversationPreview(preview) || 'No response yet'
}

function beginThreadDrag(event: DragEvent, thread: AgentConversationThread) {
  writeAgentConversationDrag(event, {
    conversationId: thread.nativeThreadId,
    threadId: thread.id,
    title: agentConversationTitle(thread)
  })
}

function beginNewThreadDrag(event: DragEvent) {
  writeNewAgentConversationDrag(event)
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
  creating.value = false
  pendingThreadId.value = null
  selectedId.value = thread.id
  view.value = 'conversation'
  await restoreTranscriptScroll(thread.id)
  await nextTick()
  panel.value
    ?.querySelector<HTMLTextAreaElement>('[data-test-id="ai-prompt-input"] textarea')
    ?.focus({ preventScroll: true })
}

async function showThreadList() {
  retainTranscriptScroll()
  view.value = 'list'
  await nextTick()
  panel.value
    ?.querySelector<HTMLElement>(`[data-agent-thread-id="${CSS.escape(selectedId.value ?? '')}"]`)
    ?.focus()
}

async function startNewConversation() {
  retainTranscriptScroll()
  creating.value = true
  pendingThreadId.value = null
  selectedId.value = null
  view.value = 'conversation'
  followUp.value = ''
  error.value = ''
  search.value = ''
  await nextTick()
  const input = panel.value?.querySelector<HTMLTextAreaElement>(
    '[data-test-id="ai-prompt-input"] textarea'
  )
  input?.focus()
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

let retainedTranscriptId: string | null = null
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
        selectedId.value = pending.id
        pendingThreadId.value = null
        creating.value = false
      }
      return
    }
    if (creating.value) return
    if (
      nextHistory &&
      (!selectedId.value || !nextHistory.threads.some((thread) => thread.id === selectedId.value))
    ) {
      selectedId.value = nextHistory.threads[0]?.id ?? null
    }
  },
  { immediate: true }
)

async function submitFollowUp(
  submission: AgentPromptSubmission = {
    ...conversationSelection(selectedModelScope.value),
    attachments: []
  }
) {
  const thread = selectedThread.value
  const message = followUp.value.trim()
  if ((!creating.value && !thread?.nativeThreadId) || !message || submitting.value) return
  error.value = ''
  submitting.value = true
  lastFollowUp.value = message
  try {
    const receipt = await submitAgentConversation({
      nativeThreadId: thread?.nativeThreadId ?? null,
      prompt: message,
      refresh,
      selection: submission,
      steer: steeringSelectedThread.value,
      threadId: conversationThreadId.value
    })
    followUp.value = ''
    if (creating.value) {
      pendingThreadId.value = `agent:${receipt.threadId}`
      await refresh(true)
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    submitting.value = false
  }
}

async function retryFollowUp() {
  if (!lastFollowUp.value) return
  followUp.value = lastFollowUp.value
  error.value = ''
  await submitFollowUp()
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
    class="flex min-h-0 flex-1 flex-col overflow-hidden overscroll-contain"
    @keydown="containScrollKey"
    @touchstart.stop
    @touchmove.stop
    @wheel="containWheel"
  >
    <div class="flex min-h-0 flex-1 flex-col overflow-hidden" data-test-id="agent-chat-stage">
      <div
        v-show="view === 'list'"
        data-test-id="agent-thread-selector"
        :aria-hidden="view !== 'list'"
        class="flex min-h-0 flex-1 flex-col overflow-hidden"
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
          <Tip label="New task">
            <button
              type="button"
              draggable="true"
              data-test-id="agent-thread-new"
              aria-label="New task"
              aria-description="Drag to place on the Board"
              class="flex size-8 shrink-0 cursor-grab items-center justify-center rounded-[8px] text-muted hover:bg-hover hover:text-surface active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-component/30"
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
          <button
            v-for="thread in listedThreads"
            :key="thread.id"
            type="button"
            draggable="true"
            :data-agent-thread-id="thread.id"
            :data-test-id="`agent-chat-thread-${thread.id}`"
            :aria-current="selectedId === thread.id ? 'true' : undefined"
            :aria-label="`${agentConversationTitle(thread)}; drag to place on board`"
            class="mb-0.5 flex w-full cursor-grab flex-col justify-center rounded-[8px] border border-transparent px-2.5 text-left hover:bg-hover active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-component/35"
            :class="[
              showThreadPreview(thread) ? 'min-h-[48px] py-1.5' : 'h-10',
              selectedId === thread.id ? 'border-border/70 bg-chrome-detail' : ''
            ]"
            @dragstart="beginThreadDrag($event, thread)"
            @click="selectThread(thread)"
          >
            <span class="flex min-w-0 items-center gap-2">
              <span class="min-w-0 flex-1 truncate text-[12px] font-medium text-surface">
                {{ agentConversationTitle(thread) }}
              </span>
              <span class="shrink-0 text-[9.5px] tabular-nums text-muted/80">
                {{ relativeTime(thread.updatedAt) }}
              </span>
            </span>
            <span
              v-if="showThreadPreview(thread)"
              class="mt-0.5 flex min-w-0 items-center gap-1.5 text-[10px] text-muted"
            >
              <span
                v-if="showStateDot(thread.state)"
                class="size-1.5 shrink-0 rounded-full"
                :class="stateTone(thread.state)"
                aria-hidden="true"
              />
              <span class="truncate">{{ threadPreview(thread) }}</span>
            </span>
          </button>
          <div
            v-if="!listedThreads.length"
            class="px-2 py-8 text-center text-[11px] leading-4 text-muted"
          >
            {{ search.trim() ? 'No matching tasks' : 'No tasks yet' }}
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
            v-model="followUp"
            :can-retry="Boolean(error && lastFollowUp)"
            :can-stop="canStopSelected"
            :context-usage="selectedThread?.contextUsage"
            :disabled="!creating && !selectedThread?.nativeThreadId"
            :empty-description="creating ? 'Describe what you want done.' : undefined"
            :empty-title="creating ? 'What do you want to work on?' : 'Conversation ready'"
            :input-label="creating ? 'New task' : 'Follow up'"
            :messages="visibleMessages"
            :placeholder="composerPlaceholder"
            :send-label="steeringSelectedThread ? 'Steer task' : 'Send message'"
            :scope="selectedModelScope"
            :status="uiStatus"
            :status-message="selectedStatusMessage"
            :working-label="
              selectedThread ? threadLiveWorkingLabel(selectedThread, now.getTime()) : ''
            "
            @retry="retryFollowUp"
            @send="submitFollowUp"
            @stop="stopConversation"
          >
            <template #header>
              <div
                class="border-border/55 flex h-10 shrink-0 items-center gap-1.5 border-b px-2"
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
                <span class="min-w-0 flex-1 truncate text-[11px] font-medium text-surface">
                  {{
                    creating
                      ? 'New task'
                      : selectedThread
                        ? agentConversationTitle(selectedThread)
                        : 'Task'
                  }}
                </span>
                <span
                  v-if="selectedThread && showStateDot(selectedThread.state)"
                  :aria-label="selectedThread.state.replace('_', ' ')"
                  class="size-1.5 shrink-0 rounded-full"
                  :class="stateTone(selectedThread.state)"
                  role="status"
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
