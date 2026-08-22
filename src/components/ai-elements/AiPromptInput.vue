<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'

import {
  conversationSelection,
  GLOBAL_MODEL_SCOPE,
  type AgentPromptAnnotation,
  type AgentPromptSubmission
} from '@/app/agent-chat/models'
import {
  browserCaptureAttachmentFromDrag,
  browserCaptureAttachmentSummary,
  isBrowserCaptureAttachment
} from '@/app/browser-inspector/attachment'
import { hasBrowserCaptureDrag, readBrowserCaptureDrag } from '@/app/browser-inspector/drag'
import {
  speechDictationActiveOwner,
  speechDictationAvailable,
  startSpeechDictation,
  stopSpeechDictation
} from '@/app/speech-dictation'
import AiModelAndEffortSelect from './AiModelAndEffortSelect.vue'
import AiContextIndicator from './AiContextIndicator.vue'
import {
  createPastedTextAttachment,
  isPastedTextAttachment,
  shouldAttachPastedText
} from './prompt-paste'

import type { AgentConversationContextUsage } from '@/app/agent-chat/client'
import type { AiConversationStatus } from './types'

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
const attachmentError = ref('')
const fileDragDepth = ref(0)
const draggingBrowserCapture = ref(false)
const dictating = computed(() => speechDictationActiveOwner.value === dictationOwner)
const textarea = ref<HTMLTextAreaElement | null>(null)
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
function keydown(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === 'd') {
    event.preventDefault()
    toggleDictation()
    return
  }
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return
  event.preventDefault()
  submitPrompt()
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

const MAX_ATTACHMENT_COUNT = 5
const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024
const MAX_TOTAL_ATTACHMENT_BYTES = 250 * 1024 * 1024

function sameFile(left: File, right: File): boolean {
  return (
    left.name === right.name && left.size === right.size && left.lastModified === right.lastModified
  )
}

function addFiles(files: File[]) {
  if (!files.length || disabled) return
  const firstOversized = files.find((file) => file.size > MAX_ATTACHMENT_BYTES)
  const unique = [...attachments.value]
  let totalBytes = unique.reduce((total, file) => total + file.size, 0)
  let exceedsTotal = false
  for (const file of files) {
    if (file.size > MAX_ATTACHMENT_BYTES || unique.some((candidate) => sameFile(candidate, file))) {
      continue
    }
    if (unique.length === MAX_ATTACHMENT_COUNT) break
    if (totalBytes + file.size > MAX_TOTAL_ATTACHMENT_BYTES) {
      exceedsTotal = true
      continue
    }
    unique.push(file)
    totalBytes += file.size
  }
  attachments.value = unique
  if (firstOversized) {
    attachmentError.value = `${firstOversized.name} is larger than 100 MB.`
  } else if (exceedsTotal) {
    attachmentError.value = 'Attachments must be 250 MB or smaller in total.'
  } else if (files.some((file) => !unique.some((candidate) => sameFile(candidate, file)))) {
    attachmentError.value = 'You can attach up to 5 files.'
  } else {
    attachmentError.value = ''
  }
}

function addAttachments(event: Event) {
  const target = event.target
  if (!(target instanceof HTMLInputElement) || !target.files) return
  addFiles([...target.files])
  target.value = ''
}

function removeAttachment(file: File) {
  attachments.value = attachments.value.filter((candidate) => candidate !== file)
  attachmentError.value = ''
}

function carriesAttachment(event: DragEvent): boolean {
  return (
    [...(event.dataTransfer?.types ?? [])].includes('Files') ||
    hasBrowserCaptureDrag(event.dataTransfer)
  )
}

function fileDragEnter(event: DragEvent) {
  if (!carriesAttachment(event) || disabled) return
  event.preventDefault()
  event.stopPropagation()
  fileDragDepth.value += 1
  draggingBrowserCapture.value = hasBrowserCaptureDrag(event.dataTransfer)
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
}

function fileDragOver(event: DragEvent) {
  if (!carriesAttachment(event) || disabled) return
  event.preventDefault()
  event.stopPropagation()
  draggingBrowserCapture.value = hasBrowserCaptureDrag(event.dataTransfer)
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
}

function fileDragLeave(event: DragEvent) {
  if (disabled || fileDragDepth.value === 0) return
  event.preventDefault()
  event.stopPropagation()
  fileDragDepth.value = Math.max(0, fileDragDepth.value - 1)
  if (fileDragDepth.value === 0) draggingBrowserCapture.value = false
}

function dropFiles(event: DragEvent) {
  const capture = readBrowserCaptureDrag(event.dataTransfer)
  const captureAttachment = capture ? browserCaptureAttachmentFromDrag(capture) : null
  const files = captureAttachment ? [captureAttachment] : [...(event.dataTransfer?.files ?? [])]
  if (!files.length || disabled) return
  event.preventDefault()
  event.stopPropagation()
  fileDragDepth.value = 0
  draggingBrowserCapture.value = false
  addFiles(files)
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
  syncComposerSize()
}

watch(
  () => [modelValue, annotations.length] as const,
  async () => {
    await nextTick()
    syncComposerSize()
  }
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

onBeforeUnmount(() => stopSpeechDictation(dictationOwner))
</script>

<template>
  <form
    data-test-id="ai-prompt-input"
    :data-drag-active="fileDragDepth > 0 ? 'true' : 'false'"
    class="agent-conversation-column border-chrome-control-border bg-agent-composer focus-within:bg-agent-composer-active relative mb-3 flex shrink-0 flex-col rounded-[12px] border p-1 shadow-agent-composer focus-within:border-surface/15"
    :class="
      fileDragDepth > 0 ? 'border-accent/70 bg-agent-composer-active ring-2 ring-accent/15' : ''
    "
    @dragenter="fileDragEnter"
    @dragleave="fileDragLeave"
    @dragover="fileDragOver"
    @drop="dropFiles"
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
        class="border-chrome-control-border bg-chrome-control group flex h-8 max-w-full items-center overflow-hidden rounded-[10px] border text-[12px] font-medium text-surface shadow-sm"
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
        class="border-chrome-control-border bg-chrome-control group relative flex h-9 max-w-[240px] shrink-0 items-center overflow-hidden rounded-[10px] border text-surface shadow-sm"
      >
        <span class="flex h-full min-w-0 items-center gap-2 pr-7 pl-2.5">
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
        class="border-chrome-control-border bg-chrome-control group relative flex h-8 max-w-[220px] shrink-0 items-center overflow-hidden rounded-[10px] border text-surface shadow-sm"
      >
        <span class="flex h-full min-w-0 items-center gap-2 pr-6 pl-2.5">
          <span
            class="bg-input flex size-5 shrink-0 items-center justify-center rounded-[6px] text-muted"
            aria-hidden="true"
          >
            <icon-lucide-image v-if="attachmentKind(file) === 'image'" class="size-3.5" />
            <icon-lucide-film v-else-if="attachmentKind(file) === 'video'" class="size-3.5" />
            <icon-lucide-file v-else class="size-3.5" />
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
    <div
      v-if="fileDragDepth > 0"
      aria-hidden="true"
      class="bg-agent-composer-active/95 pointer-events-none absolute inset-1 z-10 flex items-center justify-center gap-2 rounded-[9px] text-[12px] font-medium text-surface backdrop-blur-sm"
    >
      <icon-lucide-upload class="size-4 text-accent" />
      <span>{{ draggingBrowserCapture ? 'Drop capture to attach' : 'Drop files to attach' }}</span>
    </div>
    <textarea
      ref="textarea"
      :aria-label="label"
      :disabled="disabled"
      :placeholder="placeholder"
      :value="modelValue"
      rows="1"
      class="max-h-40 min-h-10 w-full resize-none overflow-y-auto border-0 bg-transparent px-2 py-2 font-sans text-[13px] leading-5 text-surface outline-none select-text placeholder:text-muted/80 disabled:cursor-default disabled:text-muted disabled:placeholder:text-muted"
      @input="input"
      @keydown="keydown"
    />
    <div data-test-id="ai-prompt-toolbar" class="flex h-8 min-w-0 items-center gap-0.5 px-0.5">
      <button
        type="button"
        data-test-id="ai-prompt-attach"
        aria-label="Add files, images, or videos"
        :disabled="disabled"
        class="flex size-8 shrink-0 items-center justify-center rounded-[8px] text-muted hover:bg-hover hover:text-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-component/30 disabled:text-muted/45"
        @click="fileInput?.click()"
      >
        <icon-lucide-plus class="size-4" />
      </button>
      <input
        ref="fileInput"
        aria-hidden="true"
        type="file"
        multiple
        tabindex="-1"
        class="hidden"
        @change="addAttachments"
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
        <icon-lucide-square class="size-3" />
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
        <icon-lucide-mic v-else class="size-4 stroke-[1.8]" />
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
