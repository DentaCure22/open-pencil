<script setup lang="ts">
import { refAutoReset, useClipboard, useEventListener } from '@vueuse/core'
import { computed, nextTick, ref } from 'vue'

import AiActivityDisclosure from './AiActivityDisclosure.vue'
import AiConversation from './AiConversation.vue'
import AiConversationEmpty from './AiConversationEmpty.vue'
import AiMessageItem from './AiMessage.vue'
import AiPromptInput from './AiPromptInput.vue'
import AiStatusIndicator from './AiStatusIndicator.vue'
import { latestMessageCreatedAt } from './model'
import { addSelectionToDraft } from './selection'
import type { AiConversationStatus, AiMessage } from './types'
import type { AgentConversationContextUsage } from '@/app/agent-chat/client'
import type { AgentPromptSubmission } from '@/app/agent-chat/models'

const {
  canRetry = false,
  canStop = false,
  contextUsage,
  disabled = false,
  emptyDescription,
  emptyTitle,
  inputLabel = 'Message input',
  messages,
  modelValue,
  placeholder = 'Message this conversation…',
  sendLabel = 'Send message',
  scope,
  status,
  statusMessage,
  workingLabel
} = defineProps<{
  canRetry?: boolean
  canStop?: boolean
  contextUsage?: AgentConversationContextUsage
  disabled?: boolean
  emptyDescription?: string
  emptyTitle?: string
  inputLabel?: string
  messages: AiMessage[]
  modelValue: string
  placeholder?: string
  sendLabel?: string
  scope?: string
  status: AiConversationStatus
  statusMessage?: string
  workingLabel?: string
}>()

type ConversationRun = {
  activity: AiMessage[]
  endedAt?: string
  id: string
  missingResponse: boolean
  prompt?: AiMessage & { completedAt?: string }
  startedAt?: string
  visible: AiMessage[]
}

function hasVisibleContent(message: AiMessage): boolean {
  if (message.text.trim()) return true
  return Boolean(
    message.parts?.some((part) => {
      if (part.type === 'tool' || part.type === 'reasoning') return false
      if (part.type === 'text') return Boolean(part.text.trim())
      if (part.type === 'code') return Boolean(part.code.trim())
      return true
    })
  )
}

const runs = computed<ConversationRun[]>(() => {
  const grouped: Array<{
    id: string
    messages: AiMessage[]
    prompt?: AiMessage & { completedAt?: string }
  }> = []
  for (const message of messages) {
    if (message.role === 'user') {
      grouped.push({ id: message.id, messages: [], prompt: message })
      continue
    }
    if (!grouped.length) grouped.push({ id: `run:${message.id}`, messages: [] })
    grouped.at(-1)?.messages.push(message)
  }
  return grouped.map((run) => {
    const visible = run.messages.filter(hasVisibleContent)
    return {
      activity: run.messages.filter((message) =>
        message.parts?.some((part) => part.type === 'tool' || part.type === 'reasoning')
      ),
      endedAt: run.prompt?.completedAt ?? latestMessageCreatedAt(run.messages),
      id: run.id,
      missingResponse: Boolean(run.prompt && !visible.length),
      prompt: run.prompt,
      startedAt: run.prompt?.createdAt ?? run.messages[0]?.createdAt,
      visible
    }
  })
})
const busy = computed(() => ['streaming', 'submitted'].includes(status))
const lastRunHasActivity = computed(() => Boolean(runs.value.at(-1)?.activity.length))
const surface = ref<HTMLElement | null>(null)
const copiedSelection = refAutoReset(false, 1_500)
const selectedText = ref('')
const selectionPosition = ref({ left: 0, placeBelow: false, top: 0 })
const selectionActionStyle = computed(() => ({
  left: `${String(selectionPosition.value.left)}px`,
  top: `${String(selectionPosition.value.top)}px`,
  transform: `translate(-50%, ${selectionPosition.value.placeBelow ? '0' : '-100%'})`
}))
const { copy } = useClipboard()

const emit = defineEmits<{
  retry: []
  send: [submission: AgentPromptSubmission]
  stop: []
  'update:modelValue': [value: string]
}>()

function containWheel(event: WheelEvent) {
  event.stopPropagation()
  if (event.ctrlKey || event.metaKey) event.preventDefault()
}

function selectionNodeInsideTranscript(node: Node | null): boolean {
  const viewport = surface.value?.querySelector('[data-test-id="ai-conversation-viewport"]')
  return Boolean(node && viewport?.contains(node))
}

function syncSelectionActions() {
  const selection = window.getSelection()
  if (
    !selection ||
    selection.isCollapsed ||
    !selection.rangeCount ||
    !selectionNodeInsideTranscript(selection.anchorNode) ||
    !selectionNodeInsideTranscript(selection.focusNode)
  ) {
    selectedText.value = ''
    return
  }
  const text = selection.toString().trim()
  if (!text) {
    selectedText.value = ''
    return
  }
  const range = selection.getRangeAt(0)
  const rect = range.getBoundingClientRect()
  if (!rect.width && !rect.height) {
    selectedText.value = ''
    return
  }
  selectedText.value = text
  const left = Math.min(window.innerWidth - 112, Math.max(112, rect.left + rect.width / 2))
  const placeBelow = rect.top < 58
  selectionPosition.value = {
    left,
    placeBelow,
    top: placeBelow ? rect.bottom + 8 : rect.top - 8
  }
}

function clearSelectionActions() {
  selectedText.value = ''
  window.getSelection()?.removeAllRanges()
}

async function copySelectedText() {
  if (!selectedText.value) return
  await copy(selectedText.value)
  copiedSelection.value = true
}

async function addSelectedTextToChat() {
  if (!selectedText.value) return
  emit('update:modelValue', addSelectionToDraft(modelValue, selectedText.value))
  clearSelectionActions()
  await nextTick()
  const composer = surface.value?.querySelector('textarea')
  if (!composer) return
  composer.focus({ preventScroll: true })
  composer.setSelectionRange(composer.value.length, composer.value.length)
}

useEventListener(document, 'selectionchange', syncSelectionActions)
useEventListener(window, 'resize', syncSelectionActions)
</script>

<template>
  <section
    ref="surface"
    data-test-id="ai-conversation-surface"
    class="flex min-h-0 flex-1 flex-col overflow-hidden overscroll-contain"
    @keydown.stop
    @keyup="syncSelectionActions"
    @pointerup="syncSelectionActions"
    @scroll.capture="syncSelectionActions"
    @touchstart.stop
    @touchmove.stop
    @wheel="containWheel"
  >
    <slot name="header" />
    <AiConversation>
      <div v-if="messages.length" class="mt-auto flex flex-col gap-5 px-3 py-3">
        <div v-for="(run, runIndex) in runs" :key="run.id" class="flex flex-col gap-2.5">
          <AiMessageItem v-if="run.prompt" :message="run.prompt" />
          <AiActivityDisclosure
            v-if="run.activity.length || (runIndex === runs.length - 1 && busy)"
            :ended-at="run.endedAt"
            :messages="run.activity"
            :started-at="run.startedAt"
            :status="runIndex === runs.length - 1 ? status : 'ready'"
            :working-label="workingLabel"
          />
          <AiMessageItem v-for="message in run.visible" :key="message.id" :message="message" />
          <AiStatusIndicator
            v-if="
              run.missingResponse && (runIndex < runs.length - 1 || (!busy && status === 'ready'))
            "
            message="No final response"
            status="needs_attention"
          />
        </div>
        <AiStatusIndicator
          v-if="!busy && status !== 'ready' && (statusMessage || !lastRunHasActivity)"
          :message="statusMessage"
          :status="status"
        />
      </div>
      <div v-else-if="busy" class="mt-auto flex flex-col gap-4 px-4 py-4">
        <AiActivityDisclosure :messages="[]" :status="status" :working-label="workingLabel" />
      </div>
      <AiConversationEmpty
        v-else-if="status === 'ready'"
        :description="emptyDescription"
        :heading="emptyTitle"
      />
      <div v-else class="mt-auto px-3 py-3">
        <AiStatusIndicator :message="statusMessage" :status="status" />
      </div>
    </AiConversation>
    <AiPromptInput
      :can-retry="canRetry"
      :can-stop="canStop"
      :context-usage="contextUsage"
      :disabled="disabled"
      :label="inputLabel"
      :model-value="modelValue"
      :placeholder="placeholder"
      :send-label="sendLabel"
      :scope="scope"
      :status="status"
      @retry="emit('retry')"
      @send="emit('send', $event)"
      @stop="emit('stop')"
      @update:model-value="emit('update:modelValue', $event)"
    />
    <Teleport to="body">
      <div
        v-if="selectedText"
        data-test-id="ai-selection-actions"
        class="fixed z-[160] flex items-center overflow-hidden rounded-[11px] border border-border/90 bg-chrome-raised/98 text-[11px] font-medium text-surface shadow-chrome-menu backdrop-blur-xl select-none"
        :style="selectionActionStyle"
        @pointerdown.prevent
      >
        <button
          type="button"
          class="flex h-9 items-center gap-1.5 px-3 hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40"
          @click="addSelectedTextToChat"
        >
          <icon-lucide-message-square-plus class="size-3.5" />
          <span>Add to chat</span>
        </button>
        <span aria-hidden="true" class="h-5 w-px bg-border/80" />
        <button
          type="button"
          :aria-label="copiedSelection ? 'Selection copied' : 'Copy selection'"
          class="flex size-9 items-center justify-center hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40"
          @click="copySelectedText"
        >
          <icon-lucide-check v-if="copiedSelection" class="size-3.5" />
          <icon-lucide-copy v-else class="size-3.5" />
        </button>
      </div>
    </Teleport>
  </section>
</template>
