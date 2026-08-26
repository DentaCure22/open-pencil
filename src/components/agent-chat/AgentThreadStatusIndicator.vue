<script setup lang="ts">
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { onBeforeUnmount, onMounted, shallowRef, useTemplateRef, watchEffect } from 'vue'

import T3ThreadStatusIndicator from '@/components/ai-elements/T3ThreadStatusIndicator'
import type { T3ThreadStatus } from '@/components/ai-elements/t3-chat-chrome.logic'

const { status } = defineProps<{ status?: T3ThreadStatus }>()
const host = useTemplateRef<HTMLSpanElement>('host')
const root = shallowRef<Root>()

function renderStatus() {
  root.value?.render(status ? createElement(T3ThreadStatusIndicator, { status }) : null)
}

onMounted(() => {
  const element = host.value
  if (!element) return
  root.value = createRoot(element)
  renderStatus()
})

watchEffect(renderStatus)

onBeforeUnmount(() => {
  root.value?.unmount()
  root.value = undefined
})
</script>

<template>
  <span ref="host" class="contents" data-test-id="t3-thread-status-island" />
</template>
