<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'

import {
  conversationSelection,
  GLOBAL_MODEL_SCOPE,
  type AgentPromptSubmission
} from '@/app/agent-chat/models'
import {
  speechDictationActiveOwner,
  speechDictationAvailable,
  startSpeechDictation,
  stopSpeechDictation
} from '@/app/speech-dictation'
import AiModelAndEffortSelect from './AiModelAndEffortSelect.vue'
import AiContextIndicator from './AiContextIndicator.vue'

import type { AgentConversationContextUsage } from '@/app/agent-chat/client'
import type { AiConversationStatus } from './types'

const {
  canRetry = false,
  canStop = false,
  contextUsage,
  disabled = false,
  label = 'Message input',
  modelValue,
  placeholder = 'Message this conversation…',
  sendLabel = 'Send message',
  scope,
  status = 'ready'
} = defineProps<{
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
const modelScope = computed(() => scope || GLOBAL_MODEL_SCOPE)

const emit = defineEmits<{
  retry: []
  send: [submission: AgentPromptSubmission]
  stop: []
  'update:modelValue': [value: string]
}>()
const dictationOwner = `ai-prompt-${useId()}`
const fileInput = ref<HTMLInputElement | null>(null)
const attachments = ref<File[]>([])
const pendingSubmission = ref(false)
const dictating = computed(() => speechDictationActiveOwner.value === dictationOwner)
const textarea = ref<HTMLTextAreaElement | null>(null)
const busy = computed(() => ['streaming', 'submitted'].includes(status))
const hasDraft = computed(() => Boolean(modelValue.trim()))
const canSend = computed(() => !disabled && hasDraft.value)
const showStop = computed(() => !hasDraft.value && busy.value && canStop)
const showRetry = computed(
  () =>
    !hasDraft.value && !showStop.value && (status === 'error' || status === 'stopped') && canRetry
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
  pendingSubmission.value = true
  emit('send', {
    ...conversationSelection(modelScope.value),
    attachments: [...attachments.value]
  })
}

function addAttachments(event: Event) {
  const target = event.target
  if (!(target instanceof HTMLInputElement) || !target.files) return
  const next = [...attachments.value, ...target.files]
  attachments.value = next
    .filter(
      (file, index, all) =>
        all.findIndex(
          (candidate) =>
            candidate.name === file.name &&
            candidate.size === file.size &&
            candidate.lastModified === file.lastModified
        ) === index
    )
    .slice(0, 5)
  target.value = ''
}

function syncComposerSize() {
  const el = textarea.value
  if (!el) return
  el.style.height = '1px'
  el.style.height = `${el.scrollHeight}px`
}

function input(event: Event) {
  const target = event.target
  if (!(target instanceof HTMLTextAreaElement)) return
  emit('update:modelValue', target.value)
  syncComposerSize()
}

watch(
  () => modelValue,
  async (value) => {
    if (pendingSubmission.value && !value.trim()) {
      attachments.value = []
      pendingSubmission.value = false
    }
    await nextTick()
    syncComposerSize()
  }
)

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
    class="border-chrome-control-border bg-agent-composer focus-within:bg-agent-composer-active mx-2.5 mb-2.5 flex shrink-0 flex-col rounded-[12px] border p-1 shadow-agent-composer focus-within:border-surface/15"
    @pointerdown="focusComposer"
    @submit.prevent="submitPrompt"
  >
    <div
      v-if="attachments.length"
      class="flex min-w-0 flex-wrap items-center gap-1.5 px-2 pt-2 pb-1"
    >
      <span
        v-for="(file, index) in attachments"
        :key="`${file.name}:${String(file.lastModified)}`"
        class="flex h-7 max-w-[180px] items-center gap-1.5 rounded-[7px] border border-border/80 bg-input px-2 text-[10px] text-surface"
      >
        <icon-lucide-image v-if="file.type.startsWith('image/')" class="size-3 shrink-0" />
        <icon-lucide-paperclip v-else class="size-3 shrink-0" />
        <span class="truncate">{{ file.name }}</span>
        <button
          type="button"
          :aria-label="`Remove ${file.name}`"
          class="ml-0.5 shrink-0 text-muted hover:text-surface"
          @click="attachments.splice(index, 1)"
        >
          <icon-lucide-x class="size-3" />
        </button>
      </span>
      <span v-if="attachments.length >= 5" class="text-[10px] text-muted">5 file limit</span>
    </div>
    <textarea
      ref="textarea"
      :aria-label="label"
      :disabled="disabled"
      :placeholder="placeholder"
      :value="modelValue"
      rows="1"
      class="max-h-40 min-h-10 w-full resize-none border-0 bg-transparent px-2 py-2 font-sans text-[13px] leading-5 text-surface outline-none select-text placeholder:text-muted/80 disabled:cursor-default disabled:text-muted disabled:placeholder:text-muted"
      @input="input"
      @keydown="keydown"
    />
    <div data-test-id="ai-prompt-toolbar" class="flex h-8 min-w-0 items-center gap-0.5 px-0.5">
      <button
        type="button"
        data-test-id="ai-prompt-attach"
        aria-label="Add files or images"
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
        accept="image/*,.pdf,.txt,.md,.csv,.json,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
        @change="addAttachments"
      />
      <span class="min-w-1 flex-1" />
      <AiContextIndicator v-if="contextUsage" :context-usage="contextUsage" />
      <div class="min-w-0 max-w-[150px] shrink self-center overflow-hidden">
        <AiModelAndEffortSelect :scope="modelScope" />
      </div>
      <button
        v-if="hasDraft"
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
