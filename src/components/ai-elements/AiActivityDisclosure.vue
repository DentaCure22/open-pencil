<script setup lang="ts">
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { onBeforeUnmount, onMounted, shallowRef, useTemplateRef, watchEffect } from 'vue'

import T3MessagesTimeline from './T3MessagesTimeline'
import type { AiConversationStatus, AiMessage } from './types'

const {
  endedAt,
  hasVisibleContent = false,
  messages,
  startedAt,
  status,
  workingLabel
} = defineProps<{
  endedAt?: string
  hasVisibleContent?: boolean
  messages: AiMessage[]
  startedAt?: string
  status: AiConversationStatus
  workingLabel?: string
}>()

const host = useTemplateRef<HTMLDivElement>('host')
const root = shallowRef<Root>()

function renderTimeline() {
  root.value?.render(
    createElement(T3MessagesTimeline, {
      endedAt,
      hasVisibleContent,
      messages,
      startedAt,
      status,
      workingLabel
    })
  )
}

onMounted(() => {
  const element = host.value
  if (!element) return
  root.value = createRoot(element)
  renderTimeline()
})

watchEffect(renderTimeline)

onBeforeUnmount(() => {
  root.value?.unmount()
  root.value = undefined
})
</script>

<template>
  <div ref="host" class="contents" data-test-id="t3-messages-timeline-island" />
</template>
