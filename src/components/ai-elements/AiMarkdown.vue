<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'

import AiMarkdownNodes from './AiMarkdownNodes.vue'
import { createAssistantMarkdownParser } from './markdown'
import { useStreamedText } from './streamed-text'

const { content, streaming = false } = defineProps<{
  content: string
  streaming?: boolean
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
const nodes = computed(() => parser.value.nodes(displayed.value))
</script>

<template>
  <div
    data-test-id="ai-markdown"
    class="assistant-markdown"
    :class="streaming ? 'assistant-markdown-streaming' : ''"
    :data-streaming="streaming ? 'true' : undefined"
  >
    <AiMarkdownNodes v-if="nodes.length" :nodes="nodes" />
    <p v-else class="whitespace-pre-wrap">{{ displayed }}</p>
  </div>
</template>
