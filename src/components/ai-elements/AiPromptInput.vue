<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'

import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuTrigger
} from 'reka-ui'

import {
  conversationSelection,
  GLOBAL_MODEL_SCOPE,
  type AgentPromptAnnotation,
  type AgentPromptSubmission
} from '@/app/agent-chat/models'
import { openAgentImageAnnotation, readImagePreviewSize } from '@/app/context-comment'
import {
  appendDraftAttachments,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_COUNT
} from '@/app/agent-chat/attachments'
import {
  browserCaptureAttachmentPreview,
  browserCaptureAttachmentSummary,
  createBrowserCaptureAttachment,
  isBrowserCaptureAttachment
} from '@/app/browser-inspector/attachment'
import { browserCaptureSessions } from '@/app/browser-inspector/state'
import {
  speechDictationActiveOwner,
  speechDictationAvailable,
  startSpeechDictation,
  stopSpeechDictation
} from '@/app/speech-dictation'
import { toast } from '@/app/shell/ui'
import { searchAgentWorkspaceFiles } from '@/app/agent-chat/workspace'
import AiComposerCommandMenu from './AiComposerCommandMenu.vue'
import AiModelAndEffortSelect from './AiModelAndEffortSelect.vue'
import AiContextIndicator from './AiContextIndicator.vue'
import {
  createPastedTextAttachment,
  isPastedTextAttachment,
  shouldAttachPastedText
} from './prompt-paste'

import type { AgentConversationContextUsage } from '@/app/agent-chat/conversations'
import type { AiConversationStatus } from './types'
import {
  detectT3ComposerTrigger,
  filterT3ComposerItems,
  replaceT3ComposerTrigger,
  T3_COMPOSER_COMMANDS,
  T3_COMPOSER_SKILLS,
  type T3ComposerCommandItem
} from './t3-chat-chrome.logic'

const {
  canRetry = false,
  canStop = false,
  annotations = [],
  contextUsage,
  disabled = false,
  label = 'Message input',
  modelValue,
  placeholder = 'Message this conversation…',
  sendLabel = 'Send message',
  scope,
  status = 'ready'
} = defineProps<{
  annotations?: AgentPromptAnnotation[]
  canRetry?: boolean
  canStop?: boolean
  contextUsage?: AgentConversationContextUsage
  disabled?: boolean
  label?: string
  modelValue: string
  placeholder?: string
  sendLabel?: string
  scope?: string
  status?: AiConversationStatus
}>()
const attachments = defineModel<File[]>('attachments', { default: () => [] })
const modelScope = computed(() => scope || GLOBAL_MODEL_SCOPE)
const conversationThreadId = computed(() => {
  if (!scope?.startsWith('task:')) return undefined
  const threadId = scope.slice('task:'.length).trim()
  return threadId && threadId !== 'new' ? threadId : undefined
})

const emit = defineEmits<{
  'open-annotation': [id: string]
  retry: []
  send: [submission: AgentPromptSubmission]
  stop: []
  'update:annotations': [value: AgentPromptAnnotation[]]
  'update:modelValue': [value: string]
}>()
const dictationOwner = `ai-prompt-${useId()}`
const fileInput = ref<HTMLInputElement | null>(null)
const folderInput = ref<HTMLInputElement | null>(null)
const captureSessions = browserCaptureSessions
const attachmentError = ref('')
const annotatingImage = ref<File | null>(null)
const imagePreviewUrls = ref(new Map<File, string>())
const dictating = computed(() => speechDictationActiveOwner.value === dictationOwner)
const textarea = ref<HTMLTextAreaElement | null>(null)
const composerCursor = ref(modelValue.length)
const composerFocused = ref(false)
const dismissedTriggerSignature = ref('')
const pathItems = ref<T3ComposerCommandItem[]>([])
const pathSearchLoading = ref(false)
const pathSearchError = ref(false)
const activeCommandItemId = ref<string | null>(null)
let pathSearchTimer: ReturnType<typeof setTimeout> | null = null
let pathSearchSequence = 0
const busy = computed(() => ['streaming', 'submitted'].includes(status))
const hasDraft = computed(() => Boolean(modelValue.trim()))
const hasAnnotations = computed(() => annotations.length > 0)
const hasAttachments = computed(() => attachments.value.length > 0)
const pastedTextAttachments = computed(() =>
  attachments.value.filter((file) => isPastedTextAttachment(file))
)
const browserCaptureAttachments = computed(() =>
  attachments.value.filter((file) => isBrowserCaptureAttachment(file))
)
const fileAttachments = computed(() =>
  attachments.value.filter(
    (file) => !isPastedTextAttachment(file) && !isBrowserCaptureAttachment(file)
  )
)
const canSend = computed(
  () => !disabled && (hasDraft.value || hasAnnotations.value || hasAttachments.value)
)
const showStop = computed(
  () => !hasDraft.value && !hasAnnotations.value && !hasAttachments.value && busy.value && canStop
)
const showRetry = computed(
  () =>
    !hasDraft.value &&
    !hasAnnotations.value &&
    !hasAttachments.value &&
    !showStop.value &&
    (status === 'error' || status === 'stopped') &&
    canRetry
)

const composerTrigger = computed(() => detectT3ComposerTrigger(modelValue, composerCursor.value))
const composerTriggerSignature = computed(() => {
  const trigger = composerTrigger.value
  return trigger ? `${trigger.kind}:${trigger.rangeStart}:${trigger.rangeEnd}:${trigger.query}` : ''
})
const commandItems = computed<T3ComposerCommandItem[]>(() => {
  const trigger = composerTrigger.value
  if (!trigger) return []
  if (trigger.kind === 'path') return pathItems.value
  if (trigger.kind === 'skill') return filterT3ComposerItems(T3_COMPOSER_SKILLS, trigger.query)
  return filterT3ComposerItems(T3_COMPOSER_COMMANDS, trigger.query)
})
const commandMenuOpen = computed(
  () =>
    composerFocused.value &&
    Boolean(composerTrigger.value) &&
    composerTriggerSignature.value !== dismissedTriggerSignature.value
)
const commandEmptyText = computed(() => {
  if (composerTrigger.value?.kind === 'path') {
    return pathSearchError.value ? 'Workspace file search is unavailable.' : 'No matching files.'
  }
  if (composerTrigger.value?.kind === 'skill') return 'No matching skills.'
  return 'No matching command.'
})

function moveCommandHighlight(delta: number) {
  const items = commandItems.value
  if (!items.length) return
  const current = items.findIndex((item) => item.id === activeCommandItemId.value)
  const next = current === -1 ? 0 : (current + delta + items.length) % items.length
  activeCommandItemId.value = items[next]?.id ?? null
}

function keydown(event: KeyboardEvent) {
  if (commandMenuOpen.value) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      moveCommandHighlight(event.key === 'ArrowDown' ? 1 : -1)
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      dismissedTriggerSignature.value = composerTriggerSignature.value
      return
    }
    if ((event.key === 'Enter' || event.key === 'Tab') && !event.isComposing) {
      const item = commandItems.value.find(
        (candidate) => candidate.id === activeCommandItemId.value
      )
      if (item) {
        event.preventDefault()
        selectCommandItem(item.id)
        return
      }
    }
  }
  if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === 'd') {
    event.preventDefault()
    toggleDictation()
    return
  }
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return
  event.preventDefault()
  submitPrompt()
}

function applyComposerReplacement(replacement: string) {
  const trigger = composerTrigger.value
  if (!trigger) return
  const next = replaceT3ComposerTrigger(modelValue, trigger, replacement)
  dismissedTriggerSignature.value = ''
  emit('update:modelValue', next.text)
  composerCursor.value = next.cursor
  void nextTick(() => {
    textarea.value?.focus({ preventScroll: true })
    textarea.value?.setSelectionRange(next.cursor, next.cursor)
    syncComposerSize()
  })
}

function selectCommandItem(id: string) {
  const item = commandItems.value.find((candidate) => candidate.id === id)
  if (!item) return
  if (item.kind === 'path') {
    applyComposerReplacement(`@${item.value} `)
    return
  }
  if (item.kind === 'skill') {
    applyComposerReplacement(`/skill:${item.value} `)
    return
  }
  if (item.value === 'skills') {
    applyComposerReplacement('/skill:')
    return
  }
  if (item.value === 'model') {
    applyComposerReplacement('')
    void nextTick(() => {
      const form = textarea.value?.closest('form')
      form?.querySelector<HTMLButtonElement>('[data-test-id="agent-model-trigger"]')?.click()
    })
    return
  }
  applyComposerReplacement('')
  if (item.value === 'retry') emit('retry')
  if (item.value === 'stop') emit('stop')
}

function updateComposerCursor() {
  composerCursor.value = textarea.value?.selectionStart ?? modelValue.length
}

function composerFocus() {
  composerFocused.value = true
  updateComposerCursor()
}

function composerBlur() {
  composerFocused.value = false
}

function toggleDictation() {
  if (dictating.value) {
    stopSpeechDictation(dictationOwner)
    return
  }
  startSpeechDictation(dictationOwner, modelValue, (text) => emit('update:modelValue', text))
}

function submitPrompt() {
  if (!canSend.value) return
  stopSpeechDictation(dictationOwner)
  emit('send', {
    ...conversationSelection(modelScope.value),
    annotations: annotations.map((annotation) => ({ ...annotation })),
    attachments: [...attachments.value]
  })
}

function openAnnotation(annotationId: string) {
  emit('open-annotation', annotationId)
}

function clearAnnotations() {
  emit('update:annotations', [])
}

function addFiles(files: File[]) {
  if (!files.length || disabled) return
  const result = appendDraftAttachments(attachments.value, files)
  attachments.value = result.attachments
  attachmentError.value = result.error ?? ''
}

defineExpose({ addFiles })

function addAttachments(event: Event) {
  const target = event.target
  if (!(target instanceof HTMLInputElement) || !target.files) return
  addFiles([...target.files])
  target.value = ''
}

function folderPath(file: File) {
  return file.webkitRelativePath || file.name
}

function addFolderAttachments(event: Event) {
  const target = event.target
  if (!(target instanceof HTMLInputElement) || !target.files) return
  const files = [...target.files]
    .filter((file) => !file.name.startsWith('.'))
    .sort((left, right) => {
      const leftDepth = folderPath(left).split('/').length
      const rightDepth = folderPath(right).split('/').length
      return leftDepth - rightDepth || left.name.localeCompare(right.name)
    })
  addFiles(files)
  target.value = ''
}

const attachSessionsOpen = ref(false)

function onAttachMenuOpenChange(open: boolean) {
  if (!open) attachSessionsOpen.value = false
}

function openFilePicker() {
  fileInput.value?.click()
}

function openFolderPicker() {
  folderInput.value?.click()
}

function attachCaptureSession(sessionId: string) {
  const session = captureSessions.value.find((candidate) => candidate.id === sessionId)
  if (!session) return
  const attachment = createBrowserCaptureAttachment(session)
  if (attachment) addFiles([attachment])
}

function sessionItemCount(session: (typeof captureSessions.value)[number]) {
  return session.selections.length + session.recordings.length
}

function removeAttachment(file: File) {
  attachments.value = attachments.value.filter((candidate) => candidate !== file)
  attachmentError.value = ''
}

function paste(event: ClipboardEvent) {
  const files = [...(event.clipboardData?.files ?? [])]
  if (files.length) {
    event.preventDefault()
    addFiles(files)
    return
  }
  const text = event.clipboardData?.getData('text/plain') ?? ''
  if (
    disabled ||
    attachments.value.length >= MAX_ATTACHMENT_COUNT ||
    !shouldAttachPastedText(text)
  ) {
    return
  }
  const attachment = createPastedTextAttachment(text, attachments.value)
  if (attachment.size > MAX_ATTACHMENT_BYTES) return
  event.preventDefault()
  addFiles([attachment])
}

function attachmentKind(file: File): 'file' | 'image' | 'video' {
  if (file.type.startsWith('image/')) return 'image'
  if (file.type.startsWith('video/')) return 'video'
  return 'file'
}

function attachmentTypeLabel(file: File): string {
  const extension = file.name.includes('.') ? file.name.split('.').at(-1)?.trim() : ''
  if (extension && extension.length <= 6) return extension.toUpperCase()
  const kind = attachmentKind(file)
  return kind === 'file' ? 'FILE' : kind.toUpperCase()
}

function syncImagePreviewUrls(files: File[]) {
  const previous = imagePreviewUrls.value
  const next = new Map<File, string>()
  for (const file of files) {
    if (attachmentKind(file) !== 'image') continue
    next.set(file, previous.get(file) ?? URL.createObjectURL(file))
  }
  for (const [file, url] of previous) {
    if (!next.has(file)) URL.revokeObjectURL(url)
  }
  imagePreviewUrls.value = next
}

function releaseImagePreviewUrls() {
  for (const url of imagePreviewUrls.value.values()) URL.revokeObjectURL(url)
  imagePreviewUrls.value = new Map()
}

function imagePreviewUrl(file: File): string | undefined {
  return imagePreviewUrls.value.get(file)
}

async function annotateDraftImage(
  file: File,
  event: MouseEvent,
  imageUrl: string,
  fallback?: { height: number; width: number }
): Promise<void> {
  if (annotatingImage.value) return
  const preview = (event.currentTarget as HTMLElement).querySelector('img')
  annotatingImage.value = file
  try {
    const size = await readImagePreviewSize(preview, fallback)
    await openAgentImageAnnotation({
      action: busy.value ? 'steer' : 'follow-up',
      height: size.height,
      imageUrl,
      modelScope: modelScope.value,
      threadId: conversationThreadId.value,
      width: size.width
    })
  } catch (error) {
    toast.error(
      error instanceof Error ? error.message : 'The image annotation editor is unavailable.'
    )
  } finally {
    annotatingImage.value = null
  }
}

async function annotateImageAttachment(file: File, event: MouseEvent): Promise<void> {
  const imageUrl = imagePreviewUrl(file)
  if (!imageUrl) return
  await annotateDraftImage(file, event, imageUrl)
}

async function annotateBrowserCapture(file: File, event: MouseEvent): Promise<void> {
  const preview = browserCaptureAttachmentPreview(file)
  if (!preview) return
  await annotateDraftImage(file, event, preview.imageUrl, preview)
}

function pastedTextSize(file: File): string {
  if (file.size < 1_024) return `${String(file.size)} B`
  const kilobytes = file.size / 1_024
  return `${kilobytes < 10 ? kilobytes.toFixed(1) : Math.round(kilobytes).toString()} KB`
}

function syncComposerSize() {
  const el = textarea.value
  if (!el) return
  el.style.height = '1px'
  const maxHeight = Number.parseFloat(window.getComputedStyle(el).maxHeight)
  const height = Number.isFinite(maxHeight) ? Math.min(el.scrollHeight, maxHeight) : el.scrollHeight
  el.style.height = `${String(height)}px`
  el.style.overflowY = el.scrollHeight > height ? 'auto' : 'hidden'
}

function input(event: Event) {
  const target = event.target
  if (!(target instanceof HTMLTextAreaElement)) return
  emit('update:modelValue', target.value)
  composerCursor.value = target.selectionStart
  dismissedTriggerSignature.value = ''
  syncComposerSize()
}

watch(fileAttachments, syncImagePreviewUrls, { immediate: true })
watch(
  () => [modelValue, annotations.length] as const,
  async () => {
    await nextTick()
    syncComposerSize()
  }
)

watch(
  () => {
    const trigger = composerTrigger.value
    return trigger?.kind === 'path' ? trigger.query : null
  },
  (query) => {
    if (pathSearchTimer) clearTimeout(pathSearchTimer)
    pathSearchTimer = null
    pathSearchSequence += 1
    const sequence = pathSearchSequence
    pathItems.value = []
    pathSearchError.value = false
    pathSearchLoading.value = query !== null
    if (query === null) return
    pathSearchTimer = setTimeout(() => {
      pathSearchTimer = null
      void searchAgentWorkspaceFiles(query).then(
        (files) => {
          if (sequence !== pathSearchSequence) return
          pathItems.value = files.map((file) => ({
            description: 'Workspace file',
            id: `path:${file.path}`,
            kind: 'path',
            label: file.path.split('/').at(-1) ?? file.path,
            value: file.path
          }))
          pathSearchLoading.value = false
          return undefined
        },
        () => {
          if (sequence !== pathSearchSequence) return
          pathSearchError.value = true
          pathSearchLoading.value = false
          return undefined
        }
      )
    }, 90)
  },
  { immediate: true }
)

watch(
  commandItems,
  (items) => {
    if (!items.some((item) => item.id === activeCommandItemId.value)) {
      activeCommandItemId.value = items[0]?.id ?? null
    }
  },
  { immediate: true }
)

onMounted(syncComposerSize)

function focusComposer(event: PointerEvent) {
  const target = event.target
  if (
    target instanceof HTMLElement &&
    target.closest('button, select, input, [role="combobox"], [data-test-id="agent-model-trigger"]')
  ) {
    return
  }
  textarea.value?.focus({ preventScroll: true })
}

onBeforeUnmount(() => {
  if (pathSearchTimer) clearTimeout(pathSearchTimer)
  pathSearchSequence += 1
  stopSpeechDictation(dictationOwner)
  releaseImagePreviewUrls()
})
</script>

<template>
  <AiComposerCommandMenu
    v-if="commandMenuOpen && composerTrigger"
    :active-item-id="activeCommandItemId"
    :empty-state-text="commandEmptyText"
    :is-loading="composerTrigger.kind === 'path' && pathSearchLoading"
    :items="commandItems"
    :trigger-kind="composerTrigger.kind"
    @highlight="activeCommandItemId = $event"
    @select="selectCommandItem"
  />
  <form
    data-test-id="ai-prompt-input"
    class="agent-conversation-column border-chrome-control-border bg-agent-composer focus-within:bg-agent-composer-active relative mb-3 flex shrink-0 flex-col rounded-[12px] border p-1 shadow-agent-composer focus-within:border-surface/15"
    @paste="paste"
    @pointerdown="focusComposer"
    @submit.prevent="submitPrompt"
  >
    <div
      v-if="pastedTextAttachments.length"
      data-test-id="ai-prompt-pasted-texts"
      class="flex min-w-0 flex-wrap gap-1.5 px-2 pt-2 pb-0.5"
    >
      <div
        v-for="file in pastedTextAttachments"
        :key="`${file.name}:${String(file.lastModified)}:${String(file.size)}`"
        data-test-id="ai-prompt-pasted-text"
        class="border-chrome-control-border bg-chrome-control group relative flex h-8 max-w-[220px] items-center overflow-hidden rounded-[10px] border text-surface shadow-sm"
      >
        <span class="flex h-full min-w-0 items-center gap-2 pr-6 pl-2.5">
          <span
            class="bg-input flex size-5 shrink-0 items-center justify-center rounded-[6px] text-muted"
            aria-hidden="true"
          >
            <icon-lucide-clipboard class="size-3.5" />
          </span>
          <span class="min-w-0 leading-none">
            <span class="block truncate text-[12px] font-medium">Pasted text</span>
            <span class="mt-0.5 block text-[9px] font-medium text-muted">
              {{ pastedTextSize(file) }}
            </span>
          </span>
        </span>
        <button
          type="button"
          aria-label="Remove pasted text"
          class="bg-surface/85 text-panel/90 pointer-events-none absolute top-1 right-1 flex size-3.5 items-center justify-center rounded-full opacity-0 transition-[opacity,transform,background-color,color] duration-150 ease-out group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 hover:scale-105 hover:bg-surface hover:text-panel active:scale-95 focus:pointer-events-auto focus:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/50 focus-visible:ring-offset-1 focus-visible:ring-offset-chrome-control"
          @click="removeAttachment(file)"
        >
          <icon-lucide-x class="size-2" />
        </button>
      </div>
    </div>
    <div v-if="annotations.length" class="flex min-w-0 flex-wrap gap-1.5 px-2 pt-2 pb-0.5">
      <div
        class="border-agent-border bg-agent-annotation-chip group flex h-8 max-w-full items-center overflow-hidden rounded-[9px] border text-[12px] font-medium text-surface"
      >
        <button
          type="button"
          data-test-id="ai-prompt-annotation-summary"
          :aria-label="`Open annotation 1 of ${String(annotations.length)}`"
          class="flex h-full min-w-0 items-center gap-2 px-2.5 hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40"
          @click="openAnnotation(annotations[0]!.id)"
        >
          <icon-lucide-message-square-text class="size-3.5 shrink-0 text-muted" />
          <span class="truncate">
            {{ annotations.length }} annotation{{ annotations.length === 1 ? '' : 's' }}
          </span>
        </button>
        <button
          type="button"
          data-test-id="ai-prompt-clear-annotations"
          aria-label="Clear all annotations"
          class="pointer-events-none flex h-8 w-0 shrink-0 items-center justify-center overflow-hidden text-muted opacity-0 transition-[width,opacity,color,background-color] duration-150 group-hover:pointer-events-auto group-hover:w-8 group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:w-8 group-focus-within:opacity-100 hover:bg-red-400/10 hover:text-red-400 focus:pointer-events-auto focus:w-8 focus:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-red-400/35"
          @click="clearAnnotations"
        >
          <icon-lucide-x class="size-3.5" />
        </button>
      </div>
    </div>
    <div
      v-if="browserCaptureAttachments.length"
      data-test-id="ai-prompt-browser-captures"
      class="scrollbar-none flex min-w-0 flex-nowrap items-center gap-1.5 overflow-x-auto overflow-y-hidden overscroll-x-contain px-2 pt-2 pb-0.5 touch-pan-x"
    >
      <div
        v-for="file in browserCaptureAttachments"
        :key="`${file.name}:${String(file.lastModified)}`"
        data-test-id="ai-prompt-browser-capture"
        class="border-chrome-control-border bg-chrome-control group relative flex max-w-[240px] shrink-0 items-center overflow-hidden rounded-[10px] border text-surface shadow-sm"
        :class="browserCaptureAttachmentPreview(file) ? 'h-12' : 'h-9'"
      >
        <button
          v-if="browserCaptureAttachmentPreview(file)"
          type="button"
          data-test-id="ai-prompt-browser-capture-image"
          :aria-label="`Annotate ${browserCaptureAttachmentSummary(file)?.title ?? 'Chrome capture'}`"
          class="flex h-full min-w-0 items-center gap-2 pr-7 pl-1.5 text-left hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/50"
          @click="annotateBrowserCapture(file, $event)"
        >
          <span
            class="bg-input relative flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-[7px] text-muted"
          >
            <img
              :src="browserCaptureAttachmentPreview(file)?.imageUrl"
              :alt="`Preview ${browserCaptureAttachmentSummary(file)?.title ?? 'Chrome capture'}`"
              class="size-full object-cover"
            />
            <span
              v-if="annotatingImage === file"
              class="absolute inset-0 flex items-center justify-center bg-black/45 text-white"
              aria-hidden="true"
            >
              <icon-lucide-loader-circle class="size-4 animate-spin" />
            </span>
          </span>
          <span class="min-w-0 leading-none">
            <span class="block truncate text-[12px] font-medium">
              {{ browserCaptureAttachmentSummary(file)?.title ?? 'Chrome capture' }}
            </span>
            <span class="mt-1 block truncate text-[9px] font-medium text-muted">
              <template v-if="browserCaptureAttachmentSummary(file)?.captureCount">
                {{ browserCaptureAttachmentSummary(file)?.captureCount }} capture{{
                  browserCaptureAttachmentSummary(file)?.captureCount === 1 ? '' : 's'
                }}
              </template>
              <template v-if="browserCaptureAttachmentSummary(file)?.recordingCount">
                <template v-if="browserCaptureAttachmentSummary(file)?.captureCount"> · </template>
                {{ browserCaptureAttachmentSummary(file)?.recordingCount }} video{{
                  browserCaptureAttachmentSummary(file)?.recordingCount === 1 ? '' : 's'
                }}
              </template>
              <template v-if="browserCaptureAttachmentSummary(file)?.annotationCount">
                · {{ browserCaptureAttachmentSummary(file)?.annotationCount }} note{{
                  browserCaptureAttachmentSummary(file)?.annotationCount === 1 ? '' : 's'
                }}
              </template>
              <template v-if="browserCaptureAttachmentSummary(file)?.traceLinked">
                · Trace linked
              </template>
            </span>
          </span>
        </button>
        <span v-else class="flex h-full min-w-0 items-center gap-2 pr-7 pl-2.5">
          <span
            class="bg-input flex size-5 shrink-0 items-center justify-center rounded-[6px] text-accent"
            aria-hidden="true"
          >
            <icon-lucide-scan-search class="size-3.5" />
          </span>
          <span class="min-w-0 leading-none">
            <span class="block truncate text-[11.5px] font-medium">
              {{ browserCaptureAttachmentSummary(file)?.title ?? 'Chrome capture' }}
            </span>
            <span class="mt-1 block truncate text-[9px] font-medium text-muted">
              <template v-if="browserCaptureAttachmentSummary(file)?.captureCount">
                {{ browserCaptureAttachmentSummary(file)?.captureCount }} capture{{
                  browserCaptureAttachmentSummary(file)?.captureCount === 1 ? '' : 's'
                }}
              </template>
              <template v-if="browserCaptureAttachmentSummary(file)?.recordingCount">
                <template v-if="browserCaptureAttachmentSummary(file)?.captureCount"> · </template>
                {{ browserCaptureAttachmentSummary(file)?.recordingCount }} video{{
                  browserCaptureAttachmentSummary(file)?.recordingCount === 1 ? '' : 's'
                }}
              </template>
              <template v-if="browserCaptureAttachmentSummary(file)?.annotationCount">
                · {{ browserCaptureAttachmentSummary(file)?.annotationCount }} note{{
                  browserCaptureAttachmentSummary(file)?.annotationCount === 1 ? '' : 's'
                }}
              </template>
              <template v-if="browserCaptureAttachmentSummary(file)?.traceLinked">
                · Trace linked
              </template>
            </span>
          </span>
        </span>
        <button
          type="button"
          data-test-id="ai-prompt-remove-browser-capture"
          :aria-label="`Remove ${browserCaptureAttachmentSummary(file)?.title ?? 'Chrome capture'}`"
          class="bg-surface/85 text-panel/90 pointer-events-none absolute top-1 right-1 flex size-3.5 items-center justify-center rounded-full opacity-0 transition-[opacity,transform,background-color,color] duration-150 ease-out group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 hover:scale-105 hover:bg-surface hover:text-panel active:scale-95 focus:pointer-events-auto focus:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/50 focus-visible:ring-offset-1 focus-visible:ring-offset-chrome-control"
          @click="removeAttachment(file)"
        >
          <icon-lucide-x class="size-2" />
        </button>
      </div>
    </div>
    <div
      v-if="fileAttachments.length"
      data-test-id="ai-prompt-attachments"
      class="scrollbar-none flex min-w-0 flex-nowrap items-center gap-1.5 overflow-x-auto overflow-y-hidden overscroll-x-contain px-2 pt-2 pb-0.5 touch-pan-x"
    >
      <div
        v-for="file in fileAttachments"
        :key="`${file.name}:${String(file.lastModified)}:${String(file.size)}`"
        data-test-id="ai-prompt-attachment"
        class="border-chrome-control-border bg-chrome-control group relative flex max-w-[240px] shrink-0 items-center overflow-hidden rounded-[10px] border text-surface shadow-sm"
        :class="attachmentKind(file) === 'image' ? 'h-12' : 'h-8'"
      >
        <button
          v-if="attachmentKind(file) === 'image'"
          type="button"
          data-test-id="ai-prompt-image"
          :aria-label="`Annotate ${file.name}`"
          class="flex h-full min-w-0 items-center gap-2 pr-7 pl-1.5 text-left hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/50"
          @click="annotateImageAttachment(file, $event)"
        >
          <span
            class="bg-input relative flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-[7px] text-muted"
          >
            <img
              :src="imagePreviewUrl(file)"
              :alt="`Preview ${file.name}`"
              class="size-full object-cover"
            />
            <span
              v-if="annotatingImage === file"
              class="absolute inset-0 flex items-center justify-center bg-black/45 text-white"
              aria-hidden="true"
            >
              <icon-lucide-loader-circle class="size-4 animate-spin" />
            </span>
          </span>
          <span class="min-w-0 leading-none">
            <span class="block truncate text-[12px] font-medium">{{ file.name }}</span>
            <span class="mt-1 block text-[9px] font-medium text-muted">
              {{ attachmentTypeLabel(file) }}
            </span>
          </span>
        </button>
        <span v-else class="flex h-full min-w-0 items-center gap-2 pr-6 pl-2.5">
          <span
            class="bg-input flex size-5 shrink-0 items-center justify-center rounded-[6px] text-muted"
            aria-hidden="true"
          >
            <icon-lucide-film v-if="attachmentKind(file) === 'video'" class="size-3.5" />
            <IconlyIcon name="document" v-else class="size-3.5" />
          </span>
          <span class="min-w-0 leading-none">
            <span class="block truncate text-[12px] font-medium">{{ file.name }}</span>
            <span class="mt-0.5 block text-[9px] font-medium text-muted">
              {{ attachmentTypeLabel(file) }}
            </span>
          </span>
        </span>
        <button
          type="button"
          :aria-label="`Remove ${file.name}`"
          class="bg-surface/85 text-panel/90 pointer-events-none absolute top-1 right-1 flex size-3.5 items-center justify-center rounded-full opacity-0 transition-[opacity,transform,background-color,color] duration-150 ease-out group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 hover:scale-105 hover:bg-surface hover:text-panel active:scale-95 focus:pointer-events-auto focus:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/50 focus-visible:ring-offset-1 focus-visible:ring-offset-chrome-control"
          @click="removeAttachment(file)"
        >
          <icon-lucide-x class="size-2" />
        </button>
      </div>
    </div>
    <p v-if="attachmentError" class="px-2 pt-1 text-[10px] leading-4 text-red-400" role="status">
      {{ attachmentError }}
    </p>
    <textarea
      ref="textarea"
      :aria-label="label"
      :disabled="disabled"
      :placeholder="placeholder"
      :value="modelValue"
      rows="1"
      class="max-h-40 min-h-10 w-full resize-none overflow-y-auto border-0 bg-transparent px-2 py-2 font-sans text-[13px] leading-5 text-agent-ink outline-none select-text placeholder:text-muted/80 disabled:cursor-default disabled:text-muted disabled:placeholder:text-muted"
      @input="input"
      @blur="composerBlur"
      @click="updateComposerCursor"
      @focus="composerFocus"
      @keydown="keydown"
      @keyup="updateComposerCursor"
      @select="updateComposerCursor"
    />
    <div data-test-id="ai-prompt-toolbar" class="flex h-8 min-w-0 items-center gap-0.5 px-0.5">
      <DropdownMenuRoot :modal="false" @update:open="onAttachMenuOpenChange">
        <DropdownMenuTrigger as-child>
          <button
            type="button"
            data-test-id="ai-prompt-attach"
            aria-label="Add files, folders, or sessions"
            :disabled="disabled"
            class="flex size-8 shrink-0 items-center justify-center rounded-[8px] text-muted hover:bg-hover hover:text-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-component/30 disabled:text-muted/45 data-[state=open]:bg-hover data-[state=open]:text-surface"
          >
            <IconlyIcon name="plus" class="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuPortal>
          <DropdownMenuContent
            data-test-id="ai-prompt-attach-menu"
            align="start"
            side="top"
            :avoid-collisions="false"
            :side-offset="8"
            class="pointer-events-auto isolate z-[140] flex min-w-[220px] rounded-[13px] border border-border/90 bg-panel p-1.5 text-surface shadow-[0_18px_48px_rgba(0,0,0,0.38)] outline-none"
            @close-auto-focus.prevent
          >
            <div class="flex min-w-[220px] flex-col">
              <DropdownMenuItem
                data-test-id="ai-prompt-attach-files"
                class="flex h-8 cursor-default items-center gap-2 rounded-[8px] px-2.5 text-[12px] outline-none select-none hover:bg-hover data-[highlighted]:bg-hover"
                @pointerenter="attachSessionsOpen = false"
                @select="openFilePicker"
              >
                <IconlyIcon name="document" class="size-3.5 text-muted" />
                <span>Files</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                data-test-id="ai-prompt-attach-folders"
                class="flex h-8 cursor-default items-center gap-2 rounded-[8px] px-2.5 text-[12px] outline-none select-none hover:bg-hover data-[highlighted]:bg-hover"
                @pointerenter="attachSessionsOpen = false"
                @select="openFolderPicker"
              >
                <IconlyIcon name="folder" class="size-3.5 text-muted" />
                <span>Folders</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                data-test-id="ai-prompt-attach-sessions"
                aria-haspopup="menu"
                :aria-expanded="attachSessionsOpen"
                class="flex h-8 cursor-default items-center gap-2 rounded-[8px] px-2.5 text-[12px] outline-none select-none hover:bg-hover data-[highlighted]:bg-hover"
                :class="attachSessionsOpen ? 'bg-hover' : ''"
                @pointerenter="attachSessionsOpen = true"
                @select.prevent="attachSessionsOpen = true"
              >
                <icon-lucide-scan-search class="size-3.5 text-muted" />
                <span class="flex-1">Sessions</span>
                <IconlyIcon name="arrow-right" class="size-3.5 text-muted" />
              </DropdownMenuItem>
            </div>
            <div
              v-if="attachSessionsOpen"
              data-test-id="ai-prompt-attach-sessions-menu"
              class="ml-1.5 flex min-w-[220px] flex-col border-l border-border/80 pl-1.5"
            >
              <DropdownMenuItem
                v-if="!captureSessions.length"
                disabled
                class="flex h-8 cursor-default items-center rounded-[8px] px-2.5 text-[12px] text-muted/70 outline-none"
              >
                No capture sessions
              </DropdownMenuItem>
              <DropdownMenuItem
                v-for="session in captureSessions"
                :key="session.id"
                data-test-id="ai-prompt-attach-session"
                class="flex h-8 cursor-default items-center gap-2 rounded-[8px] px-2.5 text-[12px] outline-none select-none hover:bg-hover data-[highlighted]:bg-hover"
                @select="attachCaptureSession(session.id)"
              >
                <icon-lucide-scan-search class="size-3.5 shrink-0 text-muted" />
                <span class="min-w-0 flex-1 truncate">{{ session.title }}</span>
                <span class="shrink-0 tabular-nums text-muted">
                  {{ sessionItemCount(session) }}
                </span>
              </DropdownMenuItem>
            </div>
          </DropdownMenuContent>
        </DropdownMenuPortal>
      </DropdownMenuRoot>
      <input
        ref="fileInput"
        data-test-id="ai-prompt-file-input"
        aria-hidden="true"
        type="file"
        multiple
        tabindex="-1"
        class="hidden"
        @change="addAttachments"
      />
      <input
        ref="folderInput"
        data-test-id="ai-prompt-folder-input"
        aria-hidden="true"
        type="file"
        webkitdirectory
        tabindex="-1"
        class="hidden"
        @change="addFolderAttachments"
      />
      <span class="min-w-1 flex-1" />
      <AiContextIndicator v-if="contextUsage" :context-usage="contextUsage" />
      <div class="min-w-0 max-w-[150px] shrink self-center overflow-hidden">
        <AiModelAndEffortSelect :scope="modelScope" />
      </div>
      <button
        v-if="hasDraft || hasAnnotations || hasAttachments"
        type="submit"
        data-test-id="ai-prompt-send"
        :aria-label="sendLabel"
        :disabled="!canSend"
        class="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface text-panel shadow-sm disabled:bg-transparent disabled:text-muted/35 disabled:shadow-none"
      >
        <icon-lucide-arrow-up class="size-4" />
      </button>
      <button
        v-else-if="showStop"
        type="button"
        data-test-id="ai-prompt-stop"
        aria-label="Stop response"
        class="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface text-panel shadow-sm"
        @click="$emit('stop')"
      >
        <span class="block size-3 rounded-[3px] bg-current" aria-hidden="true" />
      </button>
      <button
        v-else-if="showRetry"
        type="button"
        data-test-id="ai-prompt-retry"
        aria-label="Retry message"
        class="flex size-8 shrink-0 items-center justify-center rounded-full bg-hover text-surface hover:bg-surface hover:text-panel"
        @click="$emit('retry')"
      >
        <icon-lucide-rotate-ccw class="size-4" />
      </button>
      <button
        v-else-if="speechDictationAvailable"
        type="button"
        data-test-id="ai-prompt-dictation"
        :aria-label="dictating ? 'Stop dictation' : 'Start dictation'"
        :aria-pressed="dictating"
        :disabled="disabled"
        class="flex size-8 shrink-0 items-center justify-center rounded-[8px] text-muted hover:bg-hover hover:text-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-component/30 disabled:cursor-default disabled:text-muted/45 aria-pressed:bg-accent aria-pressed:text-white"
        @click="toggleDictation"
      >
        <icon-lucide-mic-off v-if="dictating" class="size-4 stroke-[1.8]" />
        <IconlyIcon name="voice" v-else class="size-4 stroke-[1.8]" />
      </button>
      <button
        v-else
        type="submit"
        aria-label="Send message"
        disabled
        class="flex size-8 shrink-0 items-center justify-center rounded-full bg-transparent text-muted/35"
      >
        <icon-lucide-arrow-up class="size-4" />
      </button>
    </div>
  </form>
</template>
