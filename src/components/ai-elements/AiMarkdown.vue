<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'

import AiMarkdownNodes from './AiMarkdownNodes.vue'
import { createAssistantMarkdownParser } from './markdown'
import { useStreamedText } from './streamed-text'

const {
  content,
  streaming = false,
  variant = 'answer'
} = defineProps<{
  content: string
  streaming?: boolean
  variant?: 'activity' | 'answer'
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
const blocks = computed(() => parser.value.blocks(displayed.value))
</script>

<template>
  <div
    data-test-id="ai-markdown"
    class="assistant-markdown"
    :class="[
      streaming ? 'assistant-markdown-streaming' : '',
      variant === 'activity' ? 'assistant-markdown-activity' : ''
    ]"
    :data-streaming="streaming ? 'true' : undefined"
  >
    <template v-if="blocks.length">
      <AiMarkdownNodes
        v-for="(block, index) in blocks"
        :key="index"
        v-memo="[block.root, streaming && index === blocks.length - 1]"
        :nodes="block.nodes"
        :streaming-tail="streaming && index === blocks.length - 1"
      />
    </template>
    <p v-else class="whitespace-pre-wrap">{{ displayed }}</p>
  </div>
</template>

<style scoped>
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
