<script setup lang="ts">
import { useEventListener } from '@vueuse/core'
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'

import { stopAgentConversation, submitAgentConversation } from '@/app/agent-chat/actions'
import {
  applyRoutedComposerKey,
  shouldRouteKeyToAgentComposer
} from '@/app/agent-chat/composer-focus'
import { useAgentBoardConversation } from '@/app/agent-chat/board-conversation'
import { useAgentComposerDraft } from '@/app/agent-chat/composer-drafts'
import {
  loadOlderAgentConversationTranscript,
  releaseAgentConversationTranscript,
  retainAgentConversationTranscript,
  revealAgentConversationChapter
} from '@/app/agent-chat/history-store'
import {
  planBoardTranscriptRetain,
  scheduleTranscriptHydration,
  type TranscriptHydrationHandle
} from '@/app/agent-chat/transcript-hydration'
import { mergeOptimisticMessages, optimisticConversation } from '@/app/agent-chat/optimistic'
import { AiConversationSurface, conversationStatus } from '@/components/ai-elements'
import { plainConversationPreview } from '@/app/agent-chat/presentation'
import { agentConversationDisplayTitle } from '@/app/agent-chat/thread-preferences'
import { appendDraftAttachments } from '@/app/agent-chat/attachments'
import { resolveBrowserCaptureAttachments } from '@/app/browser-inspector/attachment'
import {
  isAgentConversationDraftId,
  markAgentConversationDraftAccepted
} from '@/app/agent-terminal/board-object'
import { useEditorStore } from '@/app/editor/active-store'
import {
  agentConversationScope,
  conversationSelection,
  seedConversationModel,
  type AgentPromptAnnotation,
  type AgentPromptSubmission
} from '@/app/agent-chat/models'
import AgentConversationContextMenu from '@/components/agent-chat/AgentConversationContextMenu.vue'

const { frameId, interactionEnabled, threadName, workerConversationId } = defineProps<{
  frameId: string
  interactionEnabled: boolean
  threadName?: string
  workerConversationId?: string
}>()
const store = useEditorStore()
const { historyError, refresh, resolvedThreadId, thread, title, workerThreads } =
  useAgentBoardConversation({
    get workerConversationId() {
      return workerConversationId
    },
    get fallbackTitle() {
      return threadName
    }
  })
const loadingOlder = ref(false)
let idleRetainId: string | null = null
let retainIdleHandle: TranscriptHydrationHandle | null = null
let retainedTranscriptId: string | null = null
async function loadOlderTranscript() {
  const threadId = resolvedThreadId.value
  if (!threadId || loadingOlder.value) return
  loadingOlder.value = true
  try {
    await loadOlderAgentConversationTranscript(threadId)
  } finally {
    loadingOlder.value = false
  }
}
async function revealChapter(chapterId: string) {
  const threadId = resolvedThreadId.value
  if (!threadId) return
  loadingOlder.value = true
  try {
    await revealAgentConversationChapter(threadId, chapterId)
  } finally {
    loadingOlder.value = false
  }
}
function cancelIdleRetain() {
  retainIdleHandle?.()
  retainIdleHandle = null
  idleRetainId = null
}
function releaseRetainedTranscript() {
  if (!retainedTranscriptId) return
  releaseAgentConversationTranscript(retainedTranscriptId)
  retainedTranscriptId = null
}
function retainTranscriptNow(threadId: string) {
  cancelIdleRetain()
  if (retainedTranscriptId === threadId) return
  releaseRetainedTranscript()
  retainedTranscriptId = threadId
  retainAgentConversationTranscript(threadId)
}
function syncRetainedTranscript() {
  const next = resolvedThreadId.value || null
  const plan = planBoardTranscriptRetain({
    idleForId: idleRetainId,
    interactionEnabled,
    nextId: next,
    retainedId: retainedTranscriptId
  })
  if (plan.type === 'keep') return
  if (plan.type === 'clear') {
    cancelIdleRetain()
    releaseRetainedTranscript()
    return
  }
  if (plan.type === 'retain') {
    retainTranscriptNow(plan.id)
    return
  }
  cancelIdleRetain()
  if (retainedTranscriptId && retainedTranscriptId !== plan.id) releaseRetainedTranscript()
  idleRetainId = plan.id
  retainIdleHandle = scheduleTranscriptHydration(() => {
    retainIdleHandle = null
    idleRetainId = null
    if (resolvedThreadId.value === plan.id) retainTranscriptNow(plan.id)
  })
}
watch([resolvedThreadId, () => interactionEnabled], syncRetainedTranscript, { immediate: true })
onUnmounted(() => {
  cancelIdleRetain()
  releaseRetainedTranscript()
})
const modelScope = computed(() =>
  agentConversationScope({
    workerConversationId: thread.value?.nativeThreadId ?? workerConversationId
  })
)
const message = ref('')
const annotations = ref<AgentPromptAnnotation[]>([])
const attachments = ref<File[]>([])
const sending = ref(false)
const error = ref('')
const lastMessage = ref('')
const lastAnnotations = ref<AgentPromptAnnotation[]>([])
const lastAttachments = ref<File[]>([])
const surface = ref<HTMLElement | null>(null)
const isDraft = computed(() => isAgentConversationDraftId(workerConversationId))
const conversationIdentity = computed(
  () => resolvedThreadId.value || workerConversationId || `draft:${frameId}`
)
const composerDraft = useAgentComposerDraft({
  annotations,
  attachments,
  identity: conversationIdentity,
  text: message
})
const displayTitle = computed(() =>
  thread.value ? agentConversationDisplayTitle(thread.value) : title.value
)
const optimistic = computed(() => optimisticConversation(conversationIdentity.value))
const optimisticSending = computed(
  () =>
    optimistic.value?.state === 'submitted' ||
    (optimistic.value?.state === 'thinking' && thread.value?.state !== 'running')
)
const conversationState = computed(() => {
  if (thread.value?.state === 'running') return 'running'
  if (optimistic.value?.state === 'completed') return 'completed'
  return thread.value?.state
})
const uiStatus = computed(() =>
  conversationStatus({
    error: optimistic.value?.error || error.value,
    sending: optimisticSending.value,
    state: conversationState.value
  })
)
const statusMessage = computed(() => {
  const immediate = optimistic.value?.error || error.value || historyError.value
  if (immediate) return immediate
  if (thread.value?.state !== 'needs_attention') return undefined
  return plainConversationPreview(thread.value.recentUpdate, 140) || undefined
})
const canCompose = computed(() => Boolean(thread.value?.nativeThreadId) || isDraft.value)
const steering = computed(() => thread.value?.state === 'running')
const isWorking = computed(
  () => steering.value || optimisticSending.value || uiStatus.value === 'streaming'
)
const canStop = computed(
  () =>
    Boolean(thread.value?.canFollowUp && thread.value.state === 'running') ||
    Boolean(
      thread.value && optimistic.value && ['submitted', 'thinking'].includes(optimistic.value.state)
    )
)
const conversationMessages = computed(() =>
  mergeOptimisticMessages(
    conversationIdentity.value,
    workerThreads.value
      .flatMap((item) => item.messages)
      .filter(
        (item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index
      )
  )
)
async function send(submission: AgentPromptSubmission) {
  const draft = message.value.trim()
  if (
    !canCompose.value ||
    (!draft && !submission.annotations.length && !submission.attachments.length) ||
    sending.value
  ) {
    return
  }
  error.value = ''
  sending.value = true
  const captureResolution = await resolveBrowserCaptureAttachments(submission.attachments)
  const effectiveSubmission = {
    ...submission,
    attachments: captureResolution.attachments
  }
  lastMessage.value = draft
  lastAnnotations.value = submission.annotations.map((annotation) => ({ ...annotation }))
  lastAttachments.value = [...submission.attachments]
  composerDraft.clear()
  try {
    await submitAgentConversation({
      ...(captureResolution.contextPrompt
        ? { contextPrompt: captureResolution.contextPrompt }
        : {}),
      nativeThreadId: thread.value?.nativeThreadId ?? null,
      onAccepted: isDraft.value
        ? (receipt) => markAgentConversationDraftAccepted(store, frameId, receipt.threadId)
        : undefined,
      prompt: draft,
      refresh,
      selection: effectiveSubmission,
      steer: steering.value,
      threadId: conversationIdentity.value
    })
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    sending.value = false
  }
}
async function retry() {
  if (!lastMessage.value && !lastAnnotations.value.length && !lastAttachments.value.length) return
  message.value = lastMessage.value
  annotations.value = lastAnnotations.value.map((annotation) => ({ ...annotation }))
  attachments.value = [...lastAttachments.value]
  error.value = ''
  await send({
    ...conversationSelection(modelScope.value),
    annotations: annotations.value,
    attachments: attachments.value
  })
}
async function stop() {
  if (!thread.value || !canStop.value) return
  try {
    await stopAgentConversation(thread.value.nativeThreadId, resolvedThreadId.value)
    await refresh(true)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  }
}
useEventListener(
  window,
  'keydown',
  (event: KeyboardEvent) => {
    if (!interactionEnabled) return
    const composer = surface.value?.querySelector('textarea')
    if (!composer || composer.disabled) return
    if (event.target === composer) return
    if (!shouldRouteKeyToAgentComposer(event)) return
    event.preventDefault()
    event.stopPropagation()
    composer.focus({ preventScroll: true })
    const start = composer.selectionStart ?? message.value.length
    const end = composer.selectionEnd ?? message.value.length
    const next = applyRoutedComposerKey(message.value, event.key, start, end)
    message.value = next.value
    void nextTick(() => composer.setSelectionRange(next.caret, next.caret))
  },
  { capture: true }
)
useEventListener(window, 'openpencil:agent-card-attach', (event: Event) => {
  const detail = (
    event as CustomEvent<{
      files: File[]
      frameId?: string
      workerConversationId?: string
    }>
  ).detail
  if (!detail?.files?.length) return
  if (detail.frameId !== frameId && detail.workerConversationId !== workerConversationId) return
  const result = appendDraftAttachments(attachments.value, detail.files)
  attachments.value = result.attachments
  if (result.error) {
    error.value = result.error
  }
})
watch(
  thread,
  (next) => {
    if (!next) return
    seedConversationModel(modelScope.value, next.model, next.effort)
  },
  { immediate: true }
)
watch(
  () => interactionEnabled,
  async (enabled) => {
    if (!enabled) return
    await nextTick()
    surface.value?.querySelector('textarea')?.focus({ preventScroll: true })
  }
)
</script>

<template>
  <article
    ref="surface"
    class="border-agent-border bg-agent-surface flex size-full flex-col overflow-clip rounded-[inherit] border text-agent-ink select-text"
    :class="interactionEnabled ? '' : 'pointer-events-none'"
    :inert="!interactionEnabled"
    data-test-id="agent-chat-board-surface"
    data-agent-kind="task"
    :data-conversation-id="workerConversationId"
  >
    <AiConversationSurface
      v-model="message"
      v-model:annotations="annotations"
      v-model:attachments="attachments"
      :can-retry="
        Boolean(error && (lastMessage || lastAnnotations.length || lastAttachments.length))
      "
      :can-stop="canStop"
      :chapter-rail-ready="interactionEnabled"
      :context-usage="thread?.contextUsage"
      :disabled="!canCompose"
      empty-title="Conversation ready"
      :has-older="thread?.hasOlder === true"
      input-label="Task conversation input"
      :loading-older="loadingOlder"
      :messages="conversationMessages"
      :placeholder="isDraft ? 'Describe the task…' : steering ? 'Add instructions…' : 'Follow up…'"
      :send-label="steering ? 'Steer task' : 'Send message'"
      :scope="modelScope"
      :status="uiStatus"
      :status-message="statusMessage"
      :turns="thread?.turns"
      :working-label="thread?.recentUpdate || ''"
      @load-older="loadOlderTranscript"
      @reveal-chapter="revealChapter"
      @retry="retry"
      @send="send"
      @stop="stop"
    >
      <template #header>
        <AgentConversationContextMenu :thread="thread">
          <header
            data-test-id="agent-conversation-header"
            class="flex h-10 shrink-0 items-center gap-2 px-3"
          >
            <span class="min-w-0 flex-1 truncate text-[12px] font-medium tracking-[-0.01em]">
              {{ displayTitle }}
            </span>
            <span
              v-if="isWorking"
              class="flex size-3 shrink-0 items-center justify-center"
              aria-label="Working"
              data-test-id="agent-conversation-working"
              role="status"
            >
              <icon-lucide-loader-circle
                class="size-3 animate-spin text-accent"
                aria-hidden="true"
              />
            </span>
          </header>
        </AgentConversationContextMenu>
      </template>
    </AiConversationSurface>
  </article>
</template>
