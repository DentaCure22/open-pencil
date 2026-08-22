<script setup lang="ts">
import { useEventListener } from '@vueuse/core'
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'

import { stopAgentConversation, submitAgentConversation } from '@/app/agent-chat/actions'
import {
  applyRoutedComposerKey,
  shouldRouteKeyToAgentComposer
} from '@/app/agent-chat/composer-focus'
import { useAgentBoardConversation } from '@/app/agent-chat/board-conversation'
import {
  releaseAgentConversationTranscript,
  retainAgentConversationTranscript
} from '@/app/agent-chat/history-store'
import { mergeOptimisticMessages, optimisticConversation } from '@/app/agent-chat/optimistic'
import { AiConversationSurface, conversationStatus } from '@/components/ai-elements'
import { plainConversationPreview } from '@/app/agent-chat/presentation'
import { agentConversationDisplayTitle } from '@/app/agent-chat/thread-preferences'
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
const {
  historyError,
  refresh,
  resolvedThreadId,
  statusDotClass,
  thread,
  title,
  workerThreads,
  workingLabel
} = useAgentBoardConversation({
  get workerConversationId() {
    return workerConversationId
  },
  get fallbackTitle() {
    return threadName
  }
})
let retainedTranscriptId: string | null = null
function syncRetainedTranscript() {
  const next = resolvedThreadId.value || null
  if (retainedTranscriptId === next) return
  if (retainedTranscriptId) releaseAgentConversationTranscript(retainedTranscriptId)
  retainedTranscriptId = next
  if (retainedTranscriptId) retainAgentConversationTranscript(retainedTranscriptId)
}
watch(resolvedThreadId, syncRetainedTranscript, { immediate: true })
onUnmounted(() => {
  if (retainedTranscriptId) releaseAgentConversationTranscript(retainedTranscriptId)
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
const displayTitle = computed(() =>
  thread.value ? agentConversationDisplayTitle(thread.value) : title.value
)
const optimistic = computed(() => optimisticConversation(conversationIdentity.value))
const optimisticSending = computed(
  () =>
    optimistic.value?.state === 'submitted' ||
    (optimistic.value?.state === 'thinking' && thread.value?.state !== 'running')
)
const uiStatus = computed(() =>
  conversationStatus({
    error: optimistic.value?.error || error.value,
    sending: optimisticSending.value,
    state: optimistic.value?.state === 'completed' ? 'completed' : thread.value?.state
  })
)
const liveStatusDotClass = computed(() => {
  if (uiStatus.value === 'error' || uiStatus.value === 'needs_attention') return 'bg-red-400'
  if (uiStatus.value === 'streaming') return 'bg-accent'
  if (uiStatus.value === 'submitted') return 'bg-amber-400'
  return statusDotClass.value
})
const headerStatus = computed(() => {
  if (uiStatus.value === 'error' || uiStatus.value === 'needs_attention') return 'Needs attention'
  if (uiStatus.value === 'streaming') return 'Working'
  if (uiStatus.value === 'submitted') return 'Starting'
  return ''
})
const statusMessage = computed(() => {
  const immediate = optimistic.value?.error || error.value || historyError.value
  if (immediate) return immediate
  if (thread.value?.state !== 'needs_attention') return undefined
  return plainConversationPreview(thread.value.recentUpdate, 140) || undefined
})
const canCompose = computed(() => Boolean(thread.value?.nativeThreadId) || isDraft.value)
const steering = computed(() => thread.value?.state === 'running')
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
  message.value = ''
  annotations.value = []
  attachments.value = []
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
    class="border-agent-border bg-agent-surface flex size-full flex-col overflow-hidden rounded-[inherit] border text-surface select-text"
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
      :context-usage="thread?.contextUsage"
      :disabled="!canCompose"
      empty-title="Conversation ready"
      input-label="Task conversation input"
      :messages="conversationMessages"
      :placeholder="isDraft ? 'Describe the task…' : steering ? 'Add instructions…' : 'Follow up…'"
      :send-label="steering ? 'Steer task' : 'Send message'"
      :scope="modelScope"
      :status="uiStatus"
      :status-message="statusMessage"
      :working-label="workingLabel"
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
              v-if="headerStatus"
              :aria-label="headerStatus"
              class="size-1.5 shrink-0 rounded-full"
              data-test-id="agent-conversation-status-dot"
              role="status"
              :class="liveStatusDotClass"
            />
          </header>
        </AgentConversationContextMenu>
      </template>
    </AiConversationSurface>
  </article>
</template>
