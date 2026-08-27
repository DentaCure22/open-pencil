<script setup lang="ts">
import { refAutoReset, useClipboard } from '@vueuse/core'
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui'
import { computed, ref } from 'vue'

import {
  AGENT_MESSAGE_REACTIONS,
  agentMessageReactionLabel,
  useAgentMessageReaction,
  type AgentMessageReactionKind
} from '@/app/agent-chat/message-reactions'
import { nativeAgentConversationMessageId } from '@/app/agent-chat/conversations'
import type { AgentPromptReply } from '@/app/agent-chat/models'
import { usePopoverUI } from '@/components/ui/popover'
import AiAttachments from './AiAttachments.vue'
import AiMarkdown from './AiMarkdown.vue'
import AiCodeBlock from './AiCodeBlock.vue'
import AiSources from './AiSources.vue'
import { messageParts } from './model'
import type { AiBoardObjectChange, AiMessage, AiMessagePart } from './types'

const {
  boardObjects = [],
  conversationThreadId,
  message,
  messageMode = 'task',
  modelScope,
  steer = false,
  streaming = false
} = defineProps<{
  boardObjects?: AiBoardObjectChange[]
  conversationThreadId?: string
  message: AiMessage
  messageMode?: 'bot-text' | 'task'
  modelScope?: string
  steer?: boolean
  streaming?: boolean
}>()

const emit = defineEmits<{
  'hover-board-object': [id: string | null, pageId?: string]
  'open-board-object': [id: string, pageId?: string]
  reply: [target: AgentPromptReply]
}>()

const parts = computed(() => messageParts(message))
const botTextMode = computed(() => messageMode === 'bot-text')
const contentParts = computed(() =>
  parts.value.filter(
    (part) =>
      !['attachment', 'image', 'source'].includes(part.type) &&
      !['commentary', 'reasoning', 'tool'].includes(part.type)
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
const reactionMenuOpen = ref(false)
const actionsMenuOpen = ref(false)
const reactionPopover = usePopoverUI({
  content:
    'z-[140] flex items-center gap-0.5 rounded-full border-chrome-border bg-sidebar p-1 shadow-chrome-menu'
})
const actionsPopover = usePopoverUI({
  content:
    'z-[140] flex min-w-40 flex-col rounded-[12px] border-chrome-border bg-sidebar p-1.5 shadow-chrome-menu'
})
const {
  count: reactionCount,
  reaction: reactionEvent,
  toggle: toggleReactionState
} = useAgentMessageReaction(
  () => conversationThreadId,
  () => message.id
)
const reaction = computed(() => reactionEvent.value?.kind)
const reactionLabel = computed(() =>
  reaction.value ? agentMessageReactionLabel(reaction.value) : ''
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
const enteringPrompt = computed(
  () => message.role === 'user' && message.id.startsWith('optimistic:')
)
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

function hoverBoardObject(id: string | null, pageId?: string) {
  emit('hover-board-object', id, pageId)
}

function openBoardObject(id: string, pageId?: string) {
  emit('open-board-object', id, pageId)
}

async function copyMessage() {
  await copy(copyText.value)
  copied.value = true
  actionsMenuOpen.value = false
}

async function copyMessageId() {
  await copy(
    conversationThreadId
      ? nativeAgentConversationMessageId(conversationThreadId, message.id)
      : message.id
  )
  copied.value = true
  actionsMenuOpen.value = false
}

function toggleReaction(next: AgentMessageReactionKind) {
  toggleReactionState(next)
  reactionMenuOpen.value = false
}

function replyToMessage() {
  const text = copyText.value
  if (!text || message.role === 'system') return
  emit('reply', {
    messageId: conversationThreadId
      ? nativeAgentConversationMessageId(conversationThreadId, message.id)
      : message.id,
    role: message.role,
    text
  })
}
</script>

<template>
  <article
    v-if="hasContent"
    data-test-id="ai-message"
    :data-entering="enteringPrompt ? 'true' : undefined"
    :data-message-id="message.id"
    :data-message-mode="messageMode"
    :data-role="message.role"
    class="group/message flex w-full gap-2 font-sans font-normal tracking-normal select-text"
    :class="[
      botTextMode ? 'text-[15px] leading-[1.48]' : 'text-[14px] leading-[1.58]',
      message.role === 'user' ? 'justify-end' : 'justify-start',
      enteringPrompt ? 'agent-prompt-enter' : ''
    ]"
  >
    <div
      class="relative flex min-w-0 flex-col"
      :class="[
        message.role === 'user'
          ? botTextMode
            ? 'max-w-[82%] items-end'
            : 'max-w-[calc(100%_-_1rem)] items-end'
          : botTextMode && message.role === 'assistant'
            ? 'max-w-[calc(100%_-_4.5rem)] items-start'
            : 'w-full items-start'
      ]"
    >
      <AiAttachments
        v-if="attachments.length"
        :conversation-thread-id="conversationThreadId"
        :model-scope="modelScope"
        :parts="attachments"
        :steer="steer"
      />
      <div
        v-if="hasMessageBody"
        data-test-id="ai-message-content"
        class="min-w-0"
        :class="[
          message.role === 'user'
            ? botTextMode
              ? 'rounded-[20px] bg-agent-bot-user-bubble px-3.5 py-2 text-white'
              : 'rounded-[18px] bg-agent-user-bubble px-3.5 py-2.5 text-agent-ink'
            : message.role === 'system'
              ? 'w-full px-0 py-1 text-[12px] text-muted'
              : 'w-full text-agent-ink'
        ]"
      >
        <template v-for="(part, index) in contentParts" :key="`${part.type}-${String(index)}`">
          <AiMarkdown
            v-if="part.type === 'text' && message.role === 'assistant'"
            :board-objects="boardObjects"
            :content="part.text"
            :streaming="streaming"
            :variant="botTextMode ? 'bot-text' : 'answer'"
            @hover-board-object="hoverBoardObject"
            @open-board-object="openBoardObject"
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
        v-if="botTextMode && reaction"
        class="-mt-2.5 flex min-h-5 items-center"
        :class="message.role === 'user' ? 'justify-end px-3' : 'justify-start px-3'"
      >
        <button
          type="button"
          data-test-id="ai-message-reaction"
          :data-reaction="reaction"
          :aria-label="`Remove ${reactionLabel.toLowerCase()} reaction`"
          class="flex h-5 items-center gap-1 rounded-full border border-accent/15 bg-accent/15 px-1.5 text-[10px] font-medium text-accent shadow-[0_1px_1px_rgba(0,0,0,0.08)] transition-colors hover:border-accent/25 hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-component/30"
          @click="toggleReaction(reaction)"
        >
          <icon-lucide-thumbs-up v-if="reaction === 'like'" class="size-3 stroke-[1.8]" />
          <icon-lucide-heart v-else-if="reaction === 'love'" class="size-3 stroke-[1.8]" />
          <icon-lucide-smile v-else class="size-3 stroke-[1.8]" />
          <span>{{ reactionCount }}</span>
        </button>
      </div>
      <div
        v-if="message.role !== 'system' && (messageTime || copyText || botTextMode)"
        data-test-id="ai-message-actions"
        class="flex items-center gap-1 select-none"
        :class="[
          botTextMode
            ? message.role === 'user'
              ? 'pointer-events-none absolute top-1/2 right-full z-30 mr-2 -translate-y-1/2'
              : 'pointer-events-none absolute top-1/2 left-full z-30 ml-2 -translate-y-1/2'
            : 'relative mt-1 min-h-5',
          !botTextMode && message.role === 'user' ? 'justify-end' : ''
        ]"
      >
        <div
          class="flex items-center gap-1 transition-opacity duration-150 motion-reduce:transition-none [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100"
          :class="[
            'relative',
            reactionMenuOpen || actionsMenuOpen
              ? 'pointer-events-auto opacity-100'
              : 'pointer-events-none opacity-0 group-hover/message:pointer-events-auto group-hover/message:opacity-100 group-focus-within/message:pointer-events-auto group-focus-within/message:opacity-100'
          ]"
        >
          <time
            v-if="messageTime && !botTextMode"
            data-test-id="ai-message-time"
            :datetime="message.createdAt"
            class="text-[11px] leading-none text-muted/75"
          >
            {{ messageTime }}
          </time>
          <button
            v-if="copyText && !botTextMode"
            type="button"
            data-test-id="ai-message-copy"
            :aria-label="copyLabel"
            class="flex size-5 items-center justify-center rounded-[5px] text-muted hover:bg-hover hover:text-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-component/30"
            @click="copyMessage"
          >
            <icon-lucide-check v-if="copied" class="size-3.5" />
            <icon-lucide-copy v-else class="size-3.5" />
          </button>
          <PopoverRoot v-if="botTextMode" v-model:open="reactionMenuOpen">
            <PopoverTrigger as-child>
              <button
                type="button"
                data-test-id="ai-message-reaction-trigger"
                aria-label="React to message"
                class="flex size-5 items-center justify-center rounded-[5px] text-muted hover:bg-hover hover:text-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-component/30"
              >
                <icon-lucide-smile-plus class="size-3.5 stroke-[1.7]" />
              </button>
            </PopoverTrigger>
            <PopoverPortal>
              <PopoverContent
                role="group"
                aria-label="Message reactions"
                data-test-id="ai-message-reaction-menu"
                :class="reactionPopover.content"
                side="top"
                :side-offset="5"
                :align="message.role === 'user' ? 'end' : 'start'"
                :collision-padding="12"
              >
                <button
                  v-for="option in AGENT_MESSAGE_REACTIONS"
                  :key="option"
                  type="button"
                  :aria-pressed="reaction === option"
                  :aria-label="agentMessageReactionLabel(option)"
                  :data-reaction-option="option"
                  class="flex size-7 items-center justify-center rounded-full text-muted transition-[background-color,color,transform] hover:scale-105 hover:bg-hover hover:text-surface focus-visible:bg-hover focus-visible:text-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-component/30 active:scale-95 motion-reduce:transition-none"
                  :class="reaction === option ? 'bg-hover text-surface' : ''"
                  @click="toggleReaction(option)"
                >
                  <icon-lucide-thumbs-up v-if="option === 'like'" class="size-4 stroke-[1.8]" />
                  <icon-lucide-heart v-else-if="option === 'love'" class="size-4 stroke-[1.8]" />
                  <icon-lucide-smile v-else class="size-4 stroke-[1.8]" />
                </button>
              </PopoverContent>
            </PopoverPortal>
          </PopoverRoot>
          <button
            v-if="botTextMode && copyText"
            type="button"
            aria-label="Reply to message"
            data-test-id="ai-message-reply"
            class="flex size-5 items-center justify-center rounded-[5px] text-muted hover:bg-hover hover:text-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-component/30"
            @click="replyToMessage"
          >
            <icon-lucide-reply class="size-3.5 stroke-[1.7]" />
          </button>
          <PopoverRoot v-if="botTextMode && copyText" v-model:open="actionsMenuOpen">
            <PopoverTrigger as-child>
              <button
                type="button"
                data-test-id="ai-message-actions-trigger"
                aria-label="More message actions"
                class="flex size-5 items-center justify-center rounded-[5px] text-muted hover:bg-hover hover:text-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-component/30"
              >
                <icon-lucide-ellipsis class="size-3.5" />
              </button>
            </PopoverTrigger>
            <PopoverPortal>
              <PopoverContent
                data-test-id="ai-message-actions-menu"
                :class="actionsPopover.content"
                side="top"
                :side-offset="5"
                :align="message.role === 'user' ? 'end' : 'start'"
                :collision-padding="12"
              >
                <button
                  type="button"
                  data-test-id="ai-message-copy"
                  class="flex h-8 items-center gap-2 rounded-[8px] px-2.5 text-left text-[12px] text-surface hover:bg-hover focus-visible:bg-hover focus-visible:outline-none"
                  @click="copyMessage"
                >
                  <icon-lucide-copy class="size-3.5 text-muted" />
                  <span>{{ copied ? 'Copied' : 'Copy' }}</span>
                </button>
                <button
                  type="button"
                  data-test-id="ai-message-copy-id"
                  class="flex h-8 items-center gap-2 rounded-[8px] px-2.5 text-left text-[12px] text-surface hover:bg-hover focus-visible:bg-hover focus-visible:outline-none"
                  @click="copyMessageId"
                >
                  <icon-lucide-copy class="size-3.5 text-muted" />
                  <span>Copy request ID</span>
                </button>
              </PopoverContent>
            </PopoverPortal>
          </PopoverRoot>
        </div>
      </div>
    </div>
  </article>
</template>

<style scoped>
@keyframes agent-prompt-enter {
  from {
    opacity: 0.35;
    transform: translate3d(0, 12px, 0) scale(0.985);
  }
  to {
    opacity: 1;
    transform: translate3d(0, 0, 0) scale(1);
  }
}

.agent-prompt-enter {
  transform-origin: bottom right;
  animation: agent-prompt-enter 240ms cubic-bezier(0.22, 1, 0.36, 1) both;
}

@media (prefers-reduced-motion: reduce) {
  .agent-prompt-enter {
    animation: none;
  }
}

:deep(.assistant-markdown) {
  font: inherit;
  color: var(--color-agent-ink);
  overflow-wrap: anywhere;
}
:deep(.assistant-markdown > :first-child) {
  margin-top: 0 !important;
}
:deep(.assistant-markdown > :last-child) {
  margin-bottom: 0 !important;
}
:deep(.assistant-markdown p) {
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
:deep(.assistant-markdown li > p) {
  margin: 0 !important;
}
:deep(.assistant-markdown li > input[type='checkbox']) {
  margin-right: 0.4em;
  vertical-align: middle;
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
:deep(.assistant-markdown .assistant-markdown-table) {
  margin: 0.7em 0 !important;
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
