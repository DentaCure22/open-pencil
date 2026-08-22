<script setup lang="ts">
import { useClipboard, refAutoReset } from '@vueuse/core'
import { computed } from 'vue'
import { Markdown } from 'vue-stream-markdown'
import 'vue-stream-markdown/index.css'

import AiAttachments from './AiAttachments.vue'
import AiCodeBlock from './AiCodeBlock.vue'
import AiSources from './AiSources.vue'
import { messageParts } from './model'
import type { AiMessage, AiMessagePart } from './types'

const { message } = defineProps<{ message: AiMessage }>()

const parts = computed(() => messageParts(message))
const contentParts = computed(() =>
  parts.value.filter(
    (part) =>
      !['attachment', 'image', 'source'].includes(part.type) &&
      !['reasoning', 'tool'].includes(part.type)
  )
)
const attachments = computed(
  () =>
    parts.value.filter((part) => ['attachment', 'image'].includes(part.type)) as Extract<
      AiMessagePart,
      { type: 'attachment' | 'image' }
    >[]
)
const sources = computed(
  () =>
    parts.value.filter((part) => part.type === 'source') as Extract<
      AiMessagePart,
      { type: 'source' }
    >[]
)
const hasMessageBody = computed(
  () =>
    sources.value.length > 0 ||
    contentParts.value.some((part) => {
      if (part.type === 'text') return Boolean(part.text.trim())
      if (part.type === 'code') return Boolean(part.code.trim())
      return true
    })
)
const hasContent = computed(() => attachments.value.length > 0 || hasMessageBody.value)
const copied = refAutoReset(false, 1_500)
const copyText = computed(() =>
  contentParts.value
    .flatMap((part) => (part.type === 'text' ? [part.text] : []))
    .join('\n')
    .trim()
)
const { copy } = useClipboard({ source: copyText })
const messageTime = computed(() => {
  const timestamp = Date.parse(message.createdAt)
  if (!Number.isFinite(timestamp)) return ''
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(
    timestamp
  )
})
const copyLabel = computed(() => {
  const subject = message.role === 'user' ? 'Prompt' : 'Message'
  return copied.value ? `${subject} copied` : `Copy ${subject.toLowerCase()}`
})
async function copyMessage() {
  await copy(copyText.value)
  copied.value = true
}
</script>

<template>
  <article
    v-if="hasContent"
    data-test-id="ai-message"
    :data-message-id="message.id"
    :data-role="message.role"
    class="group/message flex w-full gap-2 font-sans text-[14px] font-normal leading-[1.58] tracking-normal select-text"
    :class="message.role === 'user' ? 'justify-end' : 'justify-start'"
  >
    <div
      class="flex min-w-0 flex-col"
      :class="
        message.role === 'user' ? 'max-w-[calc(100%_-_1rem)] items-end' : 'w-full items-start'
      "
    >
      <AiAttachments v-if="attachments.length" :parts="attachments" />
      <div
        v-if="hasMessageBody"
        data-test-id="ai-message-content"
        class="min-w-0"
        :class="[
          message.role === 'user'
            ? 'rounded-[18px] bg-hover/90 px-3.5 py-2.5 text-surface'
            : message.role === 'system'
              ? 'w-full px-0 py-1 text-[12px] text-muted'
              : 'w-full text-surface'
        ]"
      >
        <template v-for="(part, index) in contentParts" :key="`${part.type}-${String(index)}`">
          <Markdown
            v-if="part.type === 'text' && message.role === 'assistant'"
            :content="part.text"
            :controls="false"
            :mermaid="false"
            :previewers="false"
            class="assistant-markdown"
          />
          <p v-else-if="part.type === 'text'" class="whitespace-pre-wrap">{{ part.text }}</p>
          <AiCodeBlock
            v-else-if="part.type === 'code'"
            :code="part.code"
            :filename="part.filename"
            :language="part.language"
          />
        </template>
        <AiSources v-if="sources.length" :sources="sources" />
      </div>
      <div
        v-if="message.role !== 'system' && (messageTime || copyText)"
        data-test-id="ai-message-actions"
        class="pointer-events-none mt-1 flex h-5 items-center gap-1 opacity-0 transition-opacity duration-150 select-none group-hover/message:pointer-events-auto group-hover/message:opacity-100 group-focus-within/message:pointer-events-auto group-focus-within/message:opacity-100 motion-reduce:transition-none [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100"
        :class="message.role === 'user' ? 'justify-end' : ''"
      >
        <time
          v-if="messageTime"
          data-test-id="ai-message-time"
          :datetime="message.createdAt"
          class="text-[11px] leading-none text-muted/75"
        >
          {{ messageTime }}
        </time>
        <button
          v-if="copyText"
          type="button"
          data-test-id="ai-message-copy"
          :aria-label="copyLabel"
          class="flex size-5 items-center justify-center rounded-[5px] text-muted hover:bg-hover hover:text-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-component/30"
          @click="copyMessage"
        >
          <icon-lucide-check v-if="copied" class="size-3.5" />
          <icon-lucide-copy v-else class="size-3.5" />
        </button>
      </div>
    </div>
  </article>
</template>

<style scoped>
:deep(.assistant-markdown) {
  font: inherit;
  color: inherit;
  overflow-wrap: anywhere;
}
:deep(.assistant-markdown > :first-child) {
  margin-top: 0 !important;
}
:deep(.assistant-markdown > :last-child) {
  margin-bottom: 0 !important;
}
:deep(.assistant-markdown [data-stream-markdown='paragraph']) {
  margin: 0 0 0.65em !important;
  line-height: inherit !important;
}
:deep(.assistant-markdown h1),
:deep(.assistant-markdown h2),
:deep(.assistant-markdown h3),
:deep(.assistant-markdown h4),
:deep(.assistant-markdown h5),
:deep(.assistant-markdown h6) {
  margin: 0.85em 0 0.35em !important;
  font-size: 1em !important;
  line-height: 1.4;
  font-weight: 600;
}
:deep(.assistant-markdown ul),
:deep(.assistant-markdown ol) {
  margin: 0.4em 0 0.7em !important;
  padding-left: 1.45em;
}
:deep(.assistant-markdown li) {
  margin: 0.1em 0 !important;
  padding: 0 !important;
  font-weight: 400;
}
:deep(.assistant-markdown strong) {
  font-weight: 600;
}
:deep(.assistant-markdown code:not(pre code)) {
  border-radius: 0.35rem;
  background: color-mix(in srgb, currentColor 9%, transparent);
  padding: 0.08em 0.35em;
  font-size: 0.9em;
}
:deep(.assistant-markdown a) {
  color: var(--color-accent);
  text-decoration: none;
}
:deep(.assistant-markdown a:hover) {
  text-decoration: underline;
}
:deep(.assistant-markdown blockquote) {
  margin: 0.7em 0 !important;
  border-left-width: 2px !important;
  padding-left: 0.75em !important;
  color: var(--color-muted);
  font-style: normal !important;
}
:deep(.assistant-markdown hr) {
  margin: 0.8em 0 !important;
}
:deep(.assistant-markdown [data-stream-markdown='table-wrapper']) {
  margin: 0.7em 0 !important;
  gap: 0 !important;
  align-items: stretch !important;
}
:deep(.assistant-markdown [data-stream-markdown='table-controls']) {
  display: none !important;
}
:deep(.assistant-markdown [data-stream-markdown='table-inner-wrapper']) {
  max-width: 100%;
  overflow-x: auto;
  overscroll-behavior-x: contain;
}
:deep(.assistant-markdown table) {
  width: max-content !important;
  min-width: 100%;
  border-radius: 0 !important;
  font-size: 0.9em;
}
:deep(.assistant-markdown thead) {
  background: color-mix(in srgb, currentColor 5%, transparent) !important;
}
:deep(.assistant-markdown tbody) {
  background: transparent !important;
  font-weight: 400 !important;
}
:deep(.assistant-markdown th),
:deep(.assistant-markdown td) {
  min-width: 6.5rem;
  padding: 0.38rem 0.5rem !important;
  font-size: 1em !important;
  line-height: 1.4;
  vertical-align: top;
  white-space: normal !important;
}
:deep(.assistant-markdown img) {
  max-width: 100%;
  height: auto;
}
</style>
