<script setup lang="ts">
import { useEventListener } from '@vueuse/core'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

import type {
  AgentConversationContextUsage,
  AgentConversationTurn
} from '@/app/agent-chat/conversations'
import type { VoiceDictationContext } from '@/app/speech-dictation-bridge'
import type {
  AgentPromptAnnotation,
  AgentPromptReply,
  AgentPromptSubmission
} from '@/app/agent-chat/models'
import { carriesAttachmentDrag, readAttachmentDrag } from '@/app/agent-chat/attachments'
import { boardObjectPageId, revealBoardObject } from '@/app/agent-chat/board-object-navigation'
import { useEditorStore } from '@/app/editor/active-store'
import { editorViewportInsets } from '@/app/editor/viewport-insets'
import AiActivityDisclosure from './AiActivityDisclosure.vue'
import AiBotPresence from './AiBotPresence.vue'
import AiBoardChanges from './AiBoardChanges.vue'
import AiComposerBannerStack from './AiComposerBannerStack.vue'
import AiConversationAnnotations from './AiConversationAnnotations.vue'
import AiConversation from './AiConversation.vue'
import AiConversationEmpty from './AiConversationEmpty.vue'
import AiConversationNavigationRail from './AiConversationNavigationRail.vue'
import AiImageGeneration from './AiImageGeneration.vue'
import AiMessageItem from './AiMessage.vue'
import AiPromptInput from './AiPromptInput.vue'
import AiStatusIndicator from './AiStatusIndicator.vue'
import AiTurnChanges from './AiTurnChanges.vue'
import AiVideoGeneration from './AiVideoGeneration.vue'
import type { T3ComposerBannerItem } from './T3ComposerBannerStack'
import {
  conversationNavigationItems,
  type ConversationNavigationItem
} from './conversation-navigation'
import { conversationRuns, type ConversationRun } from './conversation-runs'
import {
  conversationPaintedRuns,
  conversationRunAlwaysIndexes,
  conversationRunHeights,
  conversationRunWindow,
  conversationWindowFollowsLatest,
  nextConversationRunHeight
} from './conversation-window'
import type {
  AiConversationStatus,
  AiLinkedObject,
  AiMessage,
  AiTurnChanges as AiTurnChangesPayload
} from './types'
import { botPresencePhase } from './bot-presence'

type AiConversationPresentation = {
  chapterRailReady?: boolean
  emptyDescription?: string
  emptyTitle?: string
  headerMode?: 'inherit' | 'surface'
  initialAtBottom?: boolean
  initialScrollTop?: number
  inputLabel?: string
  botAvatarId?: string
  botAvatarVariant?: number
  botName?: string
  messageMode?: 'bot-text' | 'task'
  placeholder?: string
  sendLabel?: string
  workingLabel?: string
}

const {
  annotations,
  approvalVisible = false,
  canRetry = false,
  canStop = false,
  composerBanners,
  contextUsage,
  dictationContext,
  disabled = false,
  hasOlder = false,
  loadingOlder = false,
  linkedObjects = [],
  messages,
  modelValue,
  presentation,
  scope,
  status,
  turns,
  statusMessage
} = defineProps<{
  annotations: AgentPromptAnnotation[]
  approvalVisible?: boolean
  canRetry?: boolean
  canStop?: boolean
  composerBanners?: T3ComposerBannerItem[]
  contextUsage?: AgentConversationContextUsage
  dictationContext?: VoiceDictationContext
  disabled?: boolean
  hasOlder?: boolean
  loadingOlder?: boolean
  linkedObjects?: AiLinkedObject[]
  messages: AiMessage[]
  modelValue: string
  presentation?: AiConversationPresentation
  scope?: string
  status: AiConversationStatus
  statusMessage?: string
  turns?: AgentConversationTurn[]
}>()
const attachments = defineModel<File[]>('attachments', { default: () => [] })
const store = useEditorStore()

const chapterRailReady = computed(() => presentation?.chapterRailReady ?? true)
const emptyDescription = computed(() => presentation?.emptyDescription)
const emptyTitle = computed(() => presentation?.emptyTitle)
const headerMode = computed(() => presentation?.headerMode ?? 'surface')
const initialAtBottom = computed(() => presentation?.initialAtBottom ?? true)
const initialScrollTop = computed(() => presentation?.initialScrollTop)
const inputLabel = computed(() => presentation?.inputLabel ?? 'Message input')
const botAvatarId = computed(() => presentation?.botAvatarId)
const botAvatarVariant = computed(() => presentation?.botAvatarVariant ?? 0)
const botName = computed(() => presentation?.botName?.trim() || 'Bot')
const messageMode = computed(() => presentation?.messageMode ?? 'task')
const botTextMode = computed(() => messageMode.value === 'bot-text')
const placeholder = computed(() => presentation?.placeholder ?? 'Message this conversation…')
const sendLabel = computed(() => presentation?.sendLabel ?? 'Send message')
const workingLabel = computed(() => presentation?.workingLabel)

const busy = computed(() => ['streaming', 'submitted'].includes(status))
const dismissedComposerBanners = ref(new Set<string>())
const fallbackComposerBanners = computed<T3ComposerBannerItem[]>(() => {
  if (composerBanners !== undefined) return composerBanners
  if (status === 'submitted') {
    return [
      {
        description: 'Starting the agent and opening the live stream.',
        id: 'status:connecting',
        title: 'Connecting',
        variant: 'info'
      }
    ]
  }
  if ((status === 'error' || status === 'stopped') && statusMessage) {
    return [
      {
        ...(canRetry ? { action: 'retry' as const, actionLabel: 'Retry' } : {}),
        description: statusMessage,
        dismissible: true,
        id: `status:${status}`,
        title: status === 'stopped' ? 'Response stopped' : 'Message not sent',
        variant: 'error'
      }
    ]
  }
  if (status === 'needs_attention' && statusMessage) {
    return [
      {
        description: statusMessage,
        id: 'status:failed',
        title: 'Task failed',
        variant: 'error'
      }
    ]
  }
  return []
})
const visibleComposerBanners = computed(() =>
  fallbackComposerBanners.value.filter((item) => !dismissedComposerBanners.value.has(item.id))
)
const hasComposerBanner = computed(() => visibleComposerBanners.value.length > 0)
const runs = computed<ConversationRun[]>(() => conversationRuns(messages, { active: busy.value }))
const linkedObjectsByChapter = computed(() => {
  const grouped = new Map<string, AiLinkedObject[]>()
  for (const object of linkedObjects) {
    const current = grouped.get(object.chapterId) ?? []
    current.push(object)
    grouped.set(object.chapterId, current)
  }
  return grouped
})
const latestTurnChanges = computed(() => (busy.value ? null : (runs.value.at(-1)?.changes ?? null)))
const navigationItems = computed(() => {
  if (!chapterRailReady.value) return []
  return turns?.length ? turns : conversationNavigationItems(messages)
})
const pendingRevealId = ref<string | null>(null)
const measuredRunHeights = ref<Record<string, number>>({})
const transcriptScrollTop = ref(0)
const transcriptViewportHeight = ref(0)
const runObservers = new Map<string, ResizeObserver>()
let prependHeight: number | null = null
const conversation = ref<{
  scrollToLatest: (animation?: 'instant' | 'smooth') => Promise<boolean>
} | null>(null)
const promptInput = ref<{
  addFiles: (files: File[]) => void
  focusInput: () => void
} | null>(null)
const replyTarget = ref<AgentPromptReply | null>(null)
const conversationThreadId = computed(() =>
  scope?.startsWith('task:') ? scope.slice('task:'.length) : undefined
)
const lastRunHasActivity = computed(() => Boolean(runs.value.at(-1)?.activity.length))
const runWindow = computed(() => {
  const list = runs.value
  const alwaysIds: Array<string | null | undefined> = [pendingRevealId.value]
  if (busy.value) {
    const latest = list.at(-1)
    if (latest) alwaysIds.push(latest.id, latest.prompt?.id)
  }
  const heights = conversationRunHeights(
    list.map((run) => run.id),
    measuredRunHeights.value
  )
  return conversationRunWindow(heights, {
    alwaysIndexes: conversationRunAlwaysIndexes(list, alwaysIds),
    live:
      busy.value &&
      conversationWindowFollowsLatest(
        heights,
        transcriptScrollTop.value,
        transcriptViewportHeight.value
      ),
    scrollTop: transcriptScrollTop.value,
    viewportHeight: transcriptViewportHeight.value
  })
})
const paintedRuns = computed(() => conversationPaintedRuns(runs.value, runWindow.value))

function syncTranscriptWindow() {
  const viewport = transcriptViewport()
  if (!viewport) return
  transcriptScrollTop.value = viewport.scrollTop
  transcriptViewportHeight.value = viewport.clientHeight
}

function observePaintedRun(runId: string, element: unknown) {
  runObservers.get(runId)?.disconnect()
  runObservers.delete(runId)
  if (!(element instanceof HTMLElement) || typeof ResizeObserver === 'undefined') return
  const observer = new ResizeObserver((entries) => {
    const height = entries[0]?.contentRect.height
    if (typeof height !== 'number') return
    const latest = runs.value.at(-1)
    const nextHeight = nextConversationRunHeight(measuredRunHeights.value[runId], height, {
      allowShrink: !(busy.value && latest?.id === runId)
    })
    if (nextHeight === undefined) return
    if (busy.value && latest && runId !== latest.id) return
    measuredRunHeights.value = { ...measuredRunHeights.value, [runId]: nextHeight }
  })
  observer.observe(element)
  runObservers.set(runId, observer)
}

function runSharesLatestTurn(run: ConversationRun): boolean {
  const latest = runs.value.at(-1)
  if (!run.prompt || !latest?.prompt) return false
  return run.prompt.completedAt === latest.prompt.completedAt
}

function generationStatus(run: ConversationRun, runIndex: number): AiConversationStatus {
  return runIndex === runs.value.length - 1 || runSharesLatestTurn(run) ? status : 'ready'
}

const BOT_TIME_SEPARATOR_MS = 30 * 60 * 1_000

function runTimestamp(run: ConversationRun): number | null {
  const timestamp = Date.parse(run.startedAt ?? '')
  return Number.isFinite(timestamp) ? timestamp : null
}

function botRunTimeLabel(run: ConversationRun, runIndex: number): string {
  if (!botTextMode.value || runIndex < 1) return ''
  const previousRun = runs.value[runIndex - 1]
  if (!previousRun) return ''
  const timestamp = runTimestamp(run)
  const previousTimestamp = runTimestamp(previousRun)
  if (timestamp === null || previousTimestamp === null) return ''
  const date = new Date(timestamp)
  const previous = new Date(previousTimestamp)
  const sameDay = date.toDateString() === previous.toDateString()
  if (sameDay && timestamp - previousTimestamp < BOT_TIME_SEPARATOR_MS) return ''

  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  let day = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(date)
  if (date.toDateString() === today.toDateString()) day = 'Today'
  else if (date.toDateString() === yesterday.toDateString()) day = 'Yesterday'
  const time = new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit'
  }).format(date)
  return `${day} ${time}`
}

const surface = ref<HTMLElement | null>(null)
const conversationAnnotations = ref<InstanceType<typeof AiConversationAnnotations> | null>(null)

const emit = defineEmits<{
  'load-older': []
  'open-diff': [changes: AiTurnChangesPayload, selectedPath: string]
  'open-diff-annotation': [annotation: AgentPromptAnnotation]
  'open-linked-object': [objectId: string]
  'reveal-chapter': [chapterId: string]
  retry: []
  send: [submission: AgentPromptSubmission]
  stop: []
  'update:annotations': [value: AgentPromptAnnotation[]]
  'update:modelValue': [value: string]
}>()

function containWheel(event: WheelEvent) {
  event.stopPropagation()
  if (event.ctrlKey || event.metaKey) event.preventDefault()
}

function transcriptViewport(): HTMLElement | null {
  return (
    surface.value?.querySelector<HTMLElement>('[data-test-id="ai-conversation-viewport"]') ?? null
  )
}

function escapedChapterId(value: string): string {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : value.replaceAll('"', '\\"')
}

function chapterElement(itemId: string): HTMLElement | null {
  return (
    transcriptViewport()?.querySelector<HTMLElement>(
      `[data-conversation-chapter-id="${escapedChapterId(itemId)}"]`
    ) ?? null
  )
}

function loadedChapter(itemId: string): boolean {
  return runs.value.some((run) => run.prompt?.id === itemId)
}

function handleReveal(item: ConversationNavigationItem) {
  const chapter = chapterElement(item.id)
  if (chapter) {
    chapter.scrollIntoView({ behavior: 'auto', block: 'start' })
    return
  }
  pendingRevealId.value = item.id
  if (loadedChapter(item.id)) return
  emit('reveal-chapter', item.id)
}

function revealChapter(chapterId: string) {
  handleReveal({ id: chapterId, prompt: '', response: '' })
}

defineExpose({ revealChapter })

watch(
  () => messages[0]?.id,
  (next, previous) => {
    if (!previous || !next || next === previous) return
    const viewport = transcriptViewport()
    if (!viewport) return
    prependHeight = viewport.scrollHeight
    void nextTick(() => {
      if (prependHeight === null) return
      const live = transcriptViewport()
      if (live) live.scrollTop += live.scrollHeight - prependHeight
      prependHeight = null
      syncTranscriptWindow()
    })
  }
)

watch(
  () => [pendingRevealId.value, paintedRuns.value.map((item) => item.run.id).join('\0')] as const,
  async ([chapterId]) => {
    if (!chapterId) return
    await nextTick()
    const chapter = chapterElement(chapterId)
    if (!chapter) return
    chapter.scrollIntoView({ behavior: 'auto', block: 'start' })
    pendingRevealId.value = null
    syncTranscriptWindow()
  }
)

watch(
  () => messages.length,
  () => {
    void nextTick(syncTranscriptWindow)
  },
  { immediate: true }
)

async function scrollTranscriptToLatest(animation: 'instant' | 'smooth' = 'instant') {
  await nextTick()
  await conversation.value?.scrollToLatest(animation)
  syncTranscriptWindow()
}

function submitPrompt(submission: AgentPromptSubmission) {
  const replyTo = replyTarget.value
  emit('send', { ...submission, ...(replyTo ? { replyTo } : {}) })
  replyTarget.value = null
  void scrollTranscriptToLatest('smooth')
}

function beginReply(target: AgentPromptReply) {
  replyTarget.value = target
  void nextTick(() => promptInput.value?.focusInput())
}

function retryPrompt() {
  emit('retry')
  void scrollTranscriptToLatest('smooth')
}

function handleSurfaceScroll() {
  syncTranscriptWindow()
  conversationAnnotations.value?.handleSurfaceScroll()
}

function syncSelectionActions() {
  conversationAnnotations.value?.syncSelectionActions()
}

function openAnnotation(annotationId: string) {
  void conversationAnnotations.value?.openAnnotation(annotationId)
}

const surfaceDragActive = ref(false)
const hoveredBoardObjectId = ref<string | null>(null)

function hoverBoardObject(objectId: string | null, pageId?: string) {
  if (!objectId) {
    if (hoveredBoardObjectId.value && store.state.hoveredNodeId === hoveredBoardObjectId.value) {
      store.setHoveredNode(null)
    }
    hoveredBoardObjectId.value = null
    return
  }
  const targetPageId = boardObjectPageId(store, objectId, pageId)
  if (
    !store.graph.getNode(objectId) ||
    (targetPageId && targetPageId !== store.state.currentPageId)
  ) {
    return
  }
  hoveredBoardObjectId.value = objectId
  store.setHoveredNode(objectId)
  store.requestOverlayRepaint()
}

async function openBoardObject(objectId: string, pageId?: string) {
  hoverBoardObject(null)
  await revealBoardObject(store, objectId, {
    pageId,
    viewportInsets: editorViewportInsets
  })
}

function resetSurfaceDrag() {
  surfaceDragActive.value = false
}

function dragRemainsInsideSurface(event: DragEvent): boolean {
  const current = event.currentTarget
  if (!(current instanceof HTMLElement)) return false
  const related = event.relatedTarget
  if (related instanceof Node) return current.contains(related)
  const bounds = current.getBoundingClientRect()
  return (
    event.clientX > bounds.left &&
    event.clientX < bounds.right &&
    event.clientY > bounds.top &&
    event.clientY < bounds.bottom
  )
}

function onSurfaceDragEnter(event: DragEvent) {
  if (!carriesAttachmentDrag(event.dataTransfer) || disabled) return
  event.preventDefault()
  event.stopPropagation()
  surfaceDragActive.value = true
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
}

function onSurfaceDragOver(event: DragEvent) {
  if (!carriesAttachmentDrag(event.dataTransfer) || disabled) return
  event.preventDefault()
  event.stopPropagation()
  surfaceDragActive.value = true
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
}

function onSurfaceDragLeave(event: DragEvent) {
  if (disabled || !surfaceDragActive.value || dragRemainsInsideSurface(event)) return
  event.preventDefault()
  event.stopPropagation()
  resetSurfaceDrag()
}

function onSurfaceDrop(event: DragEvent) {
  if (disabled || !carriesAttachmentDrag(event.dataTransfer)) return
  event.preventDefault()
  event.stopPropagation()
  resetSurfaceDrag()
  const files = readAttachmentDrag(event.dataTransfer)
  if (files.length) promptInput.value?.addFiles(files)
}

function composerBannerAction(id: string) {
  const item = visibleComposerBanners.value.find((candidate) => candidate.id === id)
  if (item?.action === 'retry') emit('retry')
}

function dismissComposerBanner(id: string) {
  dismissedComposerBanners.value = new Set([...dismissedComposerBanners.value, id])
}

useEventListener(document, 'drop', resetSurfaceDrag, { capture: true })
useEventListener(window, 'dragend', resetSurfaceDrag)
useEventListener(window, 'blur', resetSurfaceDrag)
watch(
  () => disabled,
  (value) => {
    if (value) resetSurfaceDrag()
  }
)
watch(
  () => conversationThreadId,
  () => {
    replyTarget.value = null
  }
)

onBeforeUnmount(() => {
  hoverBoardObject(null)
  for (const observer of runObservers.values()) observer.disconnect()
  runObservers.clear()
})
</script>

<template>
  <section
    ref="surface"
    data-test-id="ai-conversation-surface"
    :data-conversation-mode="messageMode"
    :data-drag-active="surfaceDragActive ? 'true' : 'false'"
    class="relative flex min-h-0 flex-1 flex-col overflow-clip overscroll-contain select-text [container-type:inline-size]"
    :class="surfaceDragActive ? 'ring-2 ring-inset ring-accent/60' : ''"
    @dragenter="onSurfaceDragEnter"
    @dragover="onSurfaceDragOver"
    @dragleave="onSurfaceDragLeave"
    @drop="onSurfaceDrop"
    @keydown.stop
    @keyup="syncSelectionActions"
    @scroll.capture="handleSurfaceScroll"
    @touchstart.stop
    @touchmove.stop
    @wheel="containWheel"
  >
    <div
      v-if="surfaceDragActive"
      aria-hidden="true"
      data-test-id="ai-conversation-drop-overlay"
      class="bg-agent-surface/90 absolute inset-0 z-30 flex flex-col items-center justify-center gap-2 rounded-[inherit] border-2 border-dashed border-accent/60 backdrop-blur-sm pointer-events-none"
    >
      <icon-lucide-paperclip class="t3-drop-overlay-icon size-6 text-accent" />
      <span class="text-[12px] font-medium text-surface">Drop to attach files</span>
    </div>
    <div
      v-if="$slots.header"
      class="relative z-20 shrink-0"
      :class="headerMode === 'inherit' ? 'bg-sidebar-header' : 'bg-agent-surface'"
    >
      <slot name="header" />
      <div
        aria-hidden="true"
        class="pointer-events-none absolute inset-x-0 top-full h-7 bg-gradient-to-b to-transparent"
        :class="
          headerMode === 'inherit'
            ? 'from-sidebar-header via-sidebar-header/80'
            : 'from-agent-surface via-agent-surface/80'
        "
        data-test-id="ai-conversation-header-fade"
      />
    </div>
    <AiConversation
      ref="conversation"
      :can-load-older="hasOlder"
      :initial-at-bottom="initialAtBottom"
      :initial-scroll-top="initialScrollTop"
      :loading-older="loadingOlder"
      @load-older="emit('load-older')"
    >
      <template #overlay="{ scrollElement }">
        <AiConversationNavigationRail
          v-if="chapterRailReady && !botTextMode"
          :items="navigationItems"
          :scroll-element="scrollElement"
          @reveal="handleReveal"
        />
      </template>
      <div
        v-if="messages.length"
        class="mt-auto flex flex-col pt-10 pb-4"
        :class="
          botTextMode ? 'agent-conversation-column-bot gap-6' : 'agent-conversation-column gap-5'
        "
      >
        <div
          v-if="runWindow.leading"
          aria-hidden="true"
          data-test-id="ai-conversation-run-spacer-leading"
          :style="{ height: `${String(runWindow.leading)}px` }"
        />
        <div
          v-for="{ run, runIndex } in paintedRuns"
          :key="run.id"
          :ref="(element) => observePaintedRun(run.id, element)"
          class="flex scroll-mt-10 flex-col [contain:layout]"
          :class="botTextMode ? 'gap-3.5' : 'gap-2.5'"
          :data-conversation-chapter-id="run.prompt?.id"
        >
          <time
            v-if="botRunTimeLabel(run, runIndex)"
            :datetime="run.startedAt"
            data-test-id="ai-message-time-separator"
            class="py-2 text-center text-[12px] font-normal text-muted/85"
          >
            {{ botRunTimeLabel(run, runIndex) }}
          </time>
          <AiMessageItem
            v-if="run.prompt"
            :conversation-thread-id="conversationThreadId"
            :message="run.prompt"
            :message-mode="messageMode"
            :model-scope="scope"
            :steer="busy"
            @reply="beginReply"
          />
          <AiActivityDisclosure
            v-if="!botTextMode"
            :ended-at="run.endedAt"
            :has-visible-content="run.visible.length > 0"
            :messages="run.activity"
            :started-at="run.startedAt"
            :status="runIndex === runs.length - 1 && !approvalVisible ? status : 'ready'"
            :working-label="workingLabel"
          />
          <AiBoardChanges
            v-if="run.boardChanges.length"
            :changes="run.boardChanges"
            @hover-object="hoverBoardObject"
            @open-object="openBoardObject"
          />
          <AiBoardChanges
            v-if="run.prompt && linkedObjectsByChapter.get(run.prompt.id)?.length"
            :changes="linkedObjectsByChapter.get(run.prompt.id) ?? []"
            destination-label="in Object panel"
            direct
            direct-label="Scheduled result"
            noun="briefing object"
            @open-object="(objectId) => emit('open-linked-object', objectId)"
          />
          <AiMessageItem
            v-for="message in run.visible"
            :key="message.id"
            :board-objects="run.boardChanges"
            :conversation-thread-id="conversationThreadId"
            :message="message"
            :message-mode="messageMode"
            :model-scope="scope"
            :steer="busy"
            :streaming="busy && runIndex === runs.length - 1"
            @hover-board-object="hoverBoardObject"
            @open-board-object="openBoardObject"
            @reply="beginReply"
          />
          <AiBotPresence
            v-if="botTextMode && busy && runIndex === runs.length - 1"
            :bot-id="botAvatarId"
            :bot-name="botName"
            :phase="botPresencePhase(run)"
            :variant="botAvatarVariant"
          />
          <AiImageGeneration
            v-if="run.activity.length"
            :conversation-thread-id="conversationThreadId"
            :messages="run.activity"
            :model-scope="scope"
            :steer="busy"
            :status="generationStatus(run, runIndex)"
          />
          <AiVideoGeneration
            v-if="run.activity.length"
            :messages="run.activity"
            :status="generationStatus(run, runIndex)"
          />
          <AiStatusIndicator
            v-if="
              !approvalVisible &&
              run.missingResponse &&
              runIndex === runs.length - 1 &&
              !busy &&
              status === 'ready'
            "
            message="No final response"
            status="needs_attention"
          />
          <slot name="approval" :run-id="run.id" />
        </div>
        <div
          v-if="runWindow.trailing"
          aria-hidden="true"
          data-test-id="ai-conversation-run-spacer-trailing"
          :style="{ height: `${String(runWindow.trailing)}px` }"
        />
        <AiStatusIndicator
          v-if="
            !approvalVisible &&
            !busy &&
            !hasComposerBanner &&
            status !== 'ready' &&
            (statusMessage || !lastRunHasActivity)
          "
          :message="statusMessage"
          :status="status"
        />
      </div>
      <div
        v-else-if="busy"
        class="mt-auto flex flex-col gap-4 pt-10 pb-4"
        :class="botTextMode ? 'agent-conversation-column-bot' : 'agent-conversation-column'"
      >
        <AiActivityDisclosure
          v-if="!botTextMode"
          :messages="[]"
          :status="status"
          :working-label="workingLabel"
        />
        <AiBotPresence
          v-else
          :bot-id="botAvatarId"
          :bot-name="botName"
          phase="thinking"
          :variant="botAvatarVariant"
        />
      </div>
      <template v-else-if="status === 'ready' && !approvalVisible">
        <slot name="empty">
          <AiConversationEmpty :description="emptyDescription" :heading="emptyTitle" />
        </slot>
      </template>
      <div
        v-else-if="!approvalVisible && !hasComposerBanner"
        class="agent-conversation-column mt-auto pt-10 pb-4"
      >
        <AiStatusIndicator :message="statusMessage" :status="status" />
      </div>
      <slot v-if="!messages.length" name="approval" run-id="unattached" />
    </AiConversation>
    <AiComposerBannerStack
      v-if="visibleComposerBanners.length"
      :items="visibleComposerBanners"
      @action="composerBannerAction"
      @dismiss="dismissComposerBanner"
    />
    <div
      v-if="latestTurnChanges && !botTextMode"
      class="relative z-20 flex shrink-0 justify-center pb-2"
      :class="botTextMode ? 'agent-conversation-column-bot' : 'agent-conversation-column'"
      data-test-id="ai-turn-changes-dock"
    >
      <AiTurnChanges
        :changes="latestTurnChanges"
        @open-file="emit('open-diff', latestTurnChanges, $event)"
      />
    </div>
    <div
      v-if="botTextMode && replyTarget"
      class="agent-conversation-column-bot relative z-20 shrink-0 pb-1"
      data-test-id="ai-reply-context"
    >
      <div
        class="flex min-w-0 items-center gap-2.5 rounded-[14px] bg-agent-assistant-bubble px-3 py-2 text-agent-ink"
      >
        <icon-lucide-reply class="size-4 shrink-0 stroke-[1.7] text-muted" />
        <div class="min-w-0 flex-1">
          <div class="text-[11px] font-medium text-muted">
            {{ replyTarget.role === 'assistant' ? `Replying to ${botName}` : 'Replying to you' }}
          </div>
          <p class="truncate text-[12px] leading-4">{{ replyTarget.text }}</p>
        </div>
        <button
          type="button"
          aria-label="Cancel reply"
          class="flex size-6 shrink-0 items-center justify-center rounded-full text-muted hover:bg-hover hover:text-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-component/30"
          @click="replyTarget = null"
        >
          <icon-lucide-x class="size-3.5" />
        </button>
      </div>
    </div>
    <AiPromptInput
      ref="promptInput"
      v-model:attachments="attachments"
      :annotations="annotations"
      :can-retry="canRetry"
      :can-stop="canStop"
      :context-usage="contextUsage"
      :dictation-context="dictationContext"
      :disabled="disabled"
      :label="inputLabel"
      :compact="botTextMode"
      :compact-conversation="botTextMode"
      :model-value="modelValue"
      :placeholder="placeholder"
      :send-label="sendLabel"
      :scope="scope"
      :status="status"
      @open-annotation="openAnnotation"
      @retry="retryPrompt"
      @send="submitPrompt"
      @stop="emit('stop')"
      @update:annotations="emit('update:annotations', $event)"
      @update:model-value="emit('update:modelValue', $event)"
    />
    <AiConversationAnnotations
      ref="conversationAnnotations"
      :annotations="annotations"
      :content-revision="messages.length"
      :surface="surface"
      @open-diff-annotation="emit('open-diff-annotation', $event)"
      @update:annotations="emit('update:annotations', $event)"
    />
  </section>
</template>
