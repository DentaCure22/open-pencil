<script setup lang="ts">
import { computed, provide, shallowRef, watch } from 'vue'

import type { AiBoardObjectChange } from '@/app/agent-chat/types'
import AiMarkdownNodes from './AiMarkdownNodes.vue'
import { boardObjectLinkContextKey, linkBoardObjectReferences } from './board-object-links'
import { createAssistantMarkdownParser } from './markdown'
import { useStreamedText } from './streamed-text'

const {
  boardObjects = [],
  content,
  streaming = false,
  variant = 'answer'
} = defineProps<{
  boardObjects?: AiBoardObjectChange[]
  content: string
  streaming?: boolean
  variant?: 'activity' | 'answer' | 'bot-text'
}>()

const emit = defineEmits<{
  'hover-board-object': [id: string | null, pageId?: string]
  'open-board-object': [id: string, pageId?: string]
}>()

const parser = shallowRef(createAssistantMarkdownParser(streaming ? 'streaming' : 'static'))
watch(
  () => streaming,
  (live) => {
    parser.value = createAssistantMarkdownParser(live ? 'streaming' : 'static')
  }
)

const displayed = useStreamedText(
  () => content,
  () => streaming
)
const boardObjectById = computed(
  () => new Map(boardObjects.map((object) => [object.id, object] as const))
)
const boardObjectsSignature = computed(() =>
  boardObjects.map((object) => `${object.id}:${object.name}`).join('\0')
)
const blocks = computed(() => {
  const parsed = parser.value.blocks(displayed.value)
  if (streaming || boardObjects.length === 0) return parsed
  const linkedIds = new Set<string>()
  return parsed.map((block) => ({
    ...block,
    nodes: linkBoardObjectReferences(block.nodes, boardObjects, linkedIds)
  }))
})
const botTextBlocks = computed(() =>
  blocks.value.flatMap((block, blockIndex) =>
    block.nodes.flatMap((node, nodeIndex) =>
      node.type === 'thematicBreak'
        ? []
        : [
            {
              key: `${String(blockIndex)}:${String(nodeIndex)}`,
              nodes: [node],
              root: node
            }
          ]
    )
  )
)

provide(boardObjectLinkContextKey, {
  hover(id) {
    const object = id ? boardObjectById.value.get(id) : undefined
    emit('hover-board-object', id, object?.pageId)
  },
  open(id) {
    const object = boardObjectById.value.get(id)
    emit('open-board-object', id, object?.pageId)
  }
})
</script>

<template>
  <div
    data-test-id="ai-markdown"
    class="assistant-markdown"
    :class="[
      streaming ? 'assistant-markdown-streaming' : '',
      variant === 'activity' ? 'assistant-markdown-activity' : '',
      variant === 'bot-text' ? 'assistant-markdown-bot-text' : ''
    ]"
    :data-streaming="streaming ? 'true' : undefined"
  >
    <template v-if="blocks.length && variant === 'bot-text'">
      <div v-for="(block, index) in botTextBlocks" :key="block.key" class="assistant-text-bubble">
        <AiMarkdownNodes
          v-memo="[
            block.root,
            boardObjectsSignature,
            streaming && index === botTextBlocks.length - 1
          ]"
          :nodes="block.nodes"
          :streaming-tail="streaming && index === botTextBlocks.length - 1"
        />
      </div>
    </template>
    <template v-else-if="blocks.length">
      <AiMarkdownNodes
        v-for="(block, index) in blocks"
        :key="index"
        v-memo="[block.root, boardObjectsSignature, streaming && index === blocks.length - 1]"
        :nodes="block.nodes"
        :streaming-tail="streaming && index === blocks.length - 1"
      />
    </template>
    <p
      v-else
      class="whitespace-pre-wrap"
      :class="variant === 'bot-text' ? 'assistant-text-bubble' : ''"
    >
      {{ displayed }}
    </p>
  </div>
</template>

<style scoped>
.assistant-markdown-bot-text {
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.35rem;
}
.assistant-text-bubble {
  width: fit-content;
  max-width: 100%;
  border-radius: 20px;
  background: var(--color-agent-assistant-bubble);
  padding: 0.55rem 0.9rem;
  overflow-wrap: anywhere;
}
.assistant-text-bubble :deep(> :first-child) {
  margin-top: 0 !important;
}
.assistant-text-bubble :deep(> :last-child) {
  margin-bottom: 0 !important;
}
.assistant-text-bubble :deep(p:last-child) {
  margin-bottom: 0 !important;
}
.assistant-text-bubble :deep(.assistant-markdown-table) {
  margin-block: 0 !important;
}
.assistant-text-bubble :deep(ul),
.assistant-text-bubble :deep(ol) {
  margin-block: 0.15rem !important;
  padding-left: 1.15rem;
}
.assistant-text-bubble :deep(li) {
  margin-block: 0.1rem !important;
}

.assistant-markdown-activity {
  min-width: 0;
  font: inherit;
  font-weight: 400;
  color: inherit;
  overflow-wrap: anywhere;
}
.assistant-markdown-activity :deep(p) {
  margin: 0 !important;
  line-height: inherit !important;
}
.assistant-markdown-activity :deep(h1),
.assistant-markdown-activity :deep(h2),
.assistant-markdown-activity :deep(h3),
.assistant-markdown-activity :deep(h4),
.assistant-markdown-activity :deep(h5),
.assistant-markdown-activity :deep(h6) {
  margin: 0.4em 0 0.15em !important;
  font-size: 1em !important;
  line-height: inherit;
  font-weight: inherit;
}
.assistant-markdown-activity :deep(ul),
.assistant-markdown-activity :deep(ol) {
  margin: 0.2em 0 0.35em !important;
  padding-left: 1.35em;
}
.assistant-markdown-activity :deep(li) {
  margin: 0 !important;
  padding: 0 !important;
}
.assistant-markdown-activity :deep(li > p) {
  margin: 0 !important;
}
.assistant-markdown-activity :deep(strong),
.assistant-markdown-activity :deep(b) {
  font-weight: inherit;
}
.assistant-markdown-activity :deep(code:not(pre code)) {
  border-radius: 0.3rem;
  background: color-mix(in srgb, currentColor 9%, transparent);
  padding: 0.05em 0.3em;
  font-size: 0.9em;
}
.assistant-markdown-activity :deep(a) {
  color: var(--color-accent);
  text-decoration: none;
}
.assistant-markdown-activity :deep(a:hover) {
  text-decoration: underline;
}
.assistant-markdown-activity :deep(blockquote) {
  margin: 0.3em 0 !important;
  border-left-width: 2px !important;
  padding-left: 0.65em !important;
  color: inherit;
  font-style: normal !important;
}
.assistant-markdown-activity :deep(hr) {
  margin: 0.4em 0 !important;
}
.assistant-markdown-activity :deep(.assistant-markdown-table) {
  margin: 0.35em 0 !important;
  max-width: 100%;
  overflow-x: auto;
}
.assistant-markdown-activity :deep(img) {
  max-width: 100%;
  height: auto;
}
</style>
